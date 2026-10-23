'use server';

import { revalidatePath } from 'next/cache';
import { query, queryOne } from '@/lib/db';
import { getSessionUser, audit } from '@/lib/auth';
import { canManage } from '@/lib/access';
import type { Stage } from '@/lib/salesCrm';

type R = { ok: boolean; error?: string };

async function gate() {
  const me = await getSessionUser();
  if (!me) return { me: null, error: 'unauthenticated' as const };
  if (!canManage(me, 'salesCrm')) return { me: null, error: 'Needs the sales or admin role' as const };
  return { me, error: null };
}

/**
 * Contact, not tidying.
 *
 * last_touch_at is what the board's "stuck" badge reads, so only the three
 * things that mean somebody actually worked the deal bump it: a note, a task,
 * a stage move. Correcting a misspelled city does not.
 */
async function touch(dealId: number) {
  await query(`UPDATE atlas.sales_deal SET last_touch_at = now(), updated_at = now() WHERE id = $1`,
    [dealId]);
}

async function stagesOf(pipelineId: number): Promise<Stage[]> {
  const row = await queryOne<{ stages: Stage[] }>(
    `SELECT stages FROM atlas.sales_pipeline WHERE id = $1`, [pipelineId]);
  return row?.stages ?? [];
}

/** A key from atlas.sales_account_type, or nothing. */
async function validType(key?: string | null): Promise<string | null> {
  if (!key) return null;
  const row = await queryOne<{ key: string }>(
    `SELECT key FROM atlas.sales_account_type WHERE key = $1 AND active`, [key]);
  return row?.key ?? null;
}

export async function createDeal(input: {
  company: string; city?: string; website?: string; accountType?: string;
  value?: string; expectedClose?: string; source?: string; ownerId?: number | null;
  // Sizing and the first contact, captured here because the moment somebody
  // opens an account is the moment they know these — asking later means a
  // board full of companies nobody can rank.
  premiumBookCr?: string; opdBookCr?: string; avgTicketInr?: string;
  contactName?: string; contactRole?: string; contactPhone?: string;
  contactEmail?: string; contactIsDecisionMaker?: boolean;
  firstMeetingOn?: string;
}): Promise<R & { id?: number }> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };

  const company = (input.company ?? '').trim().slice(0, 200);
  if (!company) return { ok: false, error: 'A company name, at least' };

  const p = await queryOne<{ id: number; stages: Stage[] }>(
    `SELECT id, stages FROM atlas.sales_pipeline ORDER BY is_default DESC, id LIMIT 1`);
  if (!p) return { ok: false, error: 'No pipeline configured' };
  const first = p.stages.find((s) => s.outcome === 'open');
  if (!first) return { ok: false, error: 'The pipeline has no open stage' };

  const value = input.value && /^\d+$/.test(input.value) ? Number(input.value) : null;
  const close = input.expectedClose && /^\d{4}-\d{2}-\d{2}$/.test(input.expectedClose)
    ? input.expectedClose : null;

  const accountType = await validType(input.accountType);

  const row = await queryOne<{ id: number }>(`
    INSERT INTO atlas.sales_deal
      (pipeline_id, company, city, website, account_type, stage_key, value_inr,
       expected_close, source, owner_id, created_by)
    VALUES ($1, $2, NULLIF(btrim($3), ''), NULLIF(btrim($4), ''), $5, $6, $7, $8::date,
            NULLIF(btrim($9), ''), $10, $11)
    RETURNING id
  `, [p.id, company, input.city ?? '', input.website ?? '', accountType, first.key,
      value, close, input.source ?? '', input.ownerId ?? me.id, me.id]);

  if (row) {
    await query(`INSERT INTO atlas.sales_stage_event (deal_id, to_key, moved_by) VALUES ($1, $2, $3)`,
      [row.id, first.key, me.id]);

    // Every deal gets the account row it is one chapter of, straight away.
    // Created here rather than by a trigger so the id comes back and the two
    // can never drift apart in the first place.
    const num = (v?: string) => {
      const t = (v ?? '').replace(/[, ]/g, '').trim();
      if (t === '') return null;
      const n = Number(t);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };

    const account = await queryOne<{ id: number }>(`
      INSERT INTO atlas.account (name, city, website, account_type, lifecycle,
                                 owner_id, source, premium_book_cr, opd_book_cr,
                                 avg_ticket_inr, created_by)
      VALUES ($1, NULLIF(btrim($2), ''), NULLIF(btrim($3), ''), $4, 'sales', $5,
              NULLIF(btrim($6), ''), $7, $8, $9, $10)
      RETURNING id
    `, [company, input.city ?? '', input.website ?? '', accountType,
        input.ownerId ?? me.id, input.source ?? '',
        num(input.premiumBookCr), num(input.opdBookCr), num(input.avgTicketInr), me.id]);

    if (account) {
      await query(`UPDATE atlas.sales_deal SET account_id = $2 WHERE id = $1`,
        [row.id, account.id]);

      const contact = (input.contactName ?? '').trim();
      if (contact) {
        await query(`
          INSERT INTO atlas.account_contact
            (account_id, name, role, phone, email, is_decision_maker, created_by)
          VALUES ($1, $2, NULLIF(btrim($3), ''), NULLIF(btrim($4), ''),
                  NULLIF(btrim($5), ''), $6, $7)
        `, [account.id, contact.slice(0, 120), input.contactRole ?? '',
            input.contactPhone ?? '', input.contactEmail ?? '',
            !!input.contactIsDecisionMaker, me.id]);
      }

      // A first meeting date given at creation is a meeting that happened —
      // it is how the funnel-age and "first met" columns start counting.
      const met = (input.firstMeetingOn ?? '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(met)) {
        await query(`
          INSERT INTO atlas.meeting (account_id, kind, happened_on, title, created_by)
          VALUES ($1, 'meeting', $2::date, 'First meeting', $3)
        `, [account.id, met, me.id]);
      }
    }
  }
  audit(me.id, '/sales', 'create-deal');
  revalidatePath('/sales');
  return { ok: true, id: row?.id };
}

/**
 * Move a deal.
 *
 * Winning needs a store, because a won deal that points nowhere is the one
 * state this whole feature exists to avoid — the board would claim a customer
 * Stores & Orders has never heard of. Atlas cannot create the store; the
 * console does, and this links to it.
 */
export async function moveDeal(input: {
  dealId: number; stageKey: string; storeId?: number | null; lostReason?: string;
}): Promise<R> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };

  const deal = await queryOne<{ id: number; pipeline_id: number; stage_key: string }>(
    `SELECT id, pipeline_id, stage_key FROM atlas.sales_deal WHERE id = $1`, [input.dealId]);
  if (!deal) return { ok: false, error: 'No such deal' };

  const stages = await stagesOf(deal.pipeline_id);
  const to = stages.find((s) => s.key === input.stageKey);
  if (!to) return { ok: false, error: 'No such stage' };
  if (to.key === deal.stage_key) return { ok: true };

  if (to.outcome === 'won') {
    if (!input.storeId) {
      return { ok: false, error: 'Pick the store this became — create it in the console first' };
    }
    const taken = await queryOne<{ id: number }>(
      `SELECT id FROM atlas.sales_deal WHERE store_id = $1 AND id <> $2`, [input.storeId, deal.id]);
    if (taken) return { ok: false, error: 'Another deal already points at that store' };
    const exists = await queryOne<{ id: number }>(
      `SELECT id FROM src_local."Store" WHERE id = $1`, [input.storeId]);
    if (!exists) return { ok: false, error: 'That store is not in the LabStack snapshot yet' };
  }

  await query(`
    UPDATE atlas.sales_deal SET
      stage_key     = $2,
      stage_since   = now(),
      store_id      = CASE WHEN $3 = 'won'  THEN $4::int ELSE store_id END,
      lost_reason   = CASE WHEN $3 = 'lost' THEN NULLIF(btrim($5), '') ELSE lost_reason END,
      closed_at     = CASE WHEN $3 IN ('won','lost') THEN now() ELSE NULL END,
      last_touch_at = now(),
      updated_at    = now()
    WHERE id = $1
  `, [deal.id, to.key, to.outcome, input.storeId ?? null, input.lostReason ?? '']);

  // The store Atlas is being pointed at may already have an account — 36 gave
  // every live store one. Two rows for one company cannot both hold the
  // store_id, so the deal's account folds into the store's, which is the row
  // the rest of Atlas already references.
  if (to.outcome === 'won' && input.storeId) {
    const dealAccount = await queryOne<{ account_id: number | null }>(
      `SELECT account_id FROM atlas.sales_deal WHERE id = $1`, [deal.id]);
    const storeAccount = await queryOne<{ id: number }>(
      `SELECT id FROM atlas.account WHERE store_id = $1`, [input.storeId]);

    if (dealAccount?.account_id && storeAccount && storeAccount.id !== dealAccount.account_id) {
      await query(`SELECT atlas.merge_account($1, $2)`, [dealAccount.account_id, storeAccount.id]);
    } else if (dealAccount?.account_id && !storeAccount) {
      await query(`UPDATE atlas.account SET store_id = $2, updated_at = now() WHERE id = $1`,
        [dealAccount.account_id, input.storeId]);
    }
  }

  // Winning hands the account to onboarding — not straight to managed. The
  // weeks between signing and the first order are the ones nobody could see,
  // and skipping them here would put the account back out of sight.
  await query(`
    UPDATE atlas.account SET
      lifecycle     = CASE WHEN $2 = 'won'  THEN 'onboarding'
                           WHEN $2 = 'lost' THEN 'lost'
                           ELSE lifecycle END,
      mou_signed_on = CASE WHEN $2 = 'won' THEN COALESCE(mou_signed_on, atlas.ist_today())
                           ELSE mou_signed_on END,
      closed_reason = CASE WHEN $2 = 'lost' THEN NULLIF(btrim($3), '') ELSE closed_reason END,
      updated_at    = now()
    WHERE id = (SELECT account_id FROM atlas.sales_deal WHERE id = $1)
  `, [deal.id, to.outcome, input.lostReason ?? '']);

  await query(`INSERT INTO atlas.sales_stage_event (deal_id, from_key, to_key, moved_by)
               VALUES ($1, $2, $3, $4)`, [deal.id, deal.stage_key, to.key, me.id]);
  await query(`INSERT INTO atlas.sales_note (deal_id, kind, body, author_id)
               VALUES ($1, 'stage', $2, $3)`,
    [deal.id,
     `Moved to ${to.label}${to.outcome === 'lost' && input.lostReason ? ` — ${input.lostReason.trim().slice(0, 300)}` : ''}`,
     me.id]);

  audit(me.id, '/sales', `move:${to.key}`);
  revalidatePath('/sales');
  revalidatePath(`/sales/${deal.id}`);
  revalidatePath('/accounts');
  return { ok: true };
}

export async function assignDeal(input: { dealId: number; ownerId: number | null }): Promise<R> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };
  if (input.ownerId != null) {
    const who = await queryOne<{ id: number }>(
      `SELECT id FROM atlas.users WHERE id = $1 AND active`, [input.ownerId]);
    if (!who) return { ok: false, error: 'That person is not an active user' };
  }
  await query(`UPDATE atlas.sales_deal SET owner_id = $2, updated_at = now() WHERE id = $1`,
    [input.dealId, input.ownerId]);
  audit(me.id, '/sales', 'assign');
  revalidatePath('/sales');
  revalidatePath(`/sales/${input.dealId}`);
  return { ok: true };
}

export async function addNote(input: { dealId: number; kind: string; body: string }): Promise<R> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };
  const body = (input.body ?? '').trim().slice(0, 4000);
  if (!body) return { ok: false, error: 'Write something first' };
  const kind = ['note', 'call', 'email', 'meeting'].includes(input.kind) ? input.kind : 'note';
  await query(`INSERT INTO atlas.sales_note (deal_id, kind, body, author_id) VALUES ($1, $2, $3, $4)`,
    [input.dealId, kind, body, me.id]);
  await touch(input.dealId);
  audit(me.id, '/sales', `note:${kind}`);
  revalidatePath(`/sales/${input.dealId}`);
  return { ok: true };
}

export async function addTask(input: {
  dealId: number; title: string; dueOn?: string; assigneeId?: number | null;
}): Promise<R> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };
  const title = (input.title ?? '').trim().slice(0, 300);
  if (!title) return { ok: false, error: 'What has to happen?' };
  const due = input.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) ? input.dueOn : null;
  await query(`
    INSERT INTO atlas.sales_task (deal_id, title, due_on, assignee_id, created_by)
    VALUES ($1, $2, $3::date, $4, $5)
  `, [input.dealId, title, due, input.assigneeId ?? me.id, me.id]);
  await touch(input.dealId);
  audit(me.id, '/sales', 'task');
  revalidatePath('/sales');
  revalidatePath(`/sales/${input.dealId}`);
  return { ok: true };
}

export async function toggleTask(input: { taskId: number; done: boolean }): Promise<R> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };
  const row = await queryOne<{ deal_id: number }>(`
    UPDATE atlas.sales_task
       SET done_at = CASE WHEN $2 THEN now() ELSE NULL END,
           done_by = CASE WHEN $2 THEN $3::int ELSE NULL END
     WHERE id = $1 RETURNING deal_id
  `, [input.taskId, input.done, me.id]);
  if (row) await touch(row.deal_id);
  revalidatePath('/sales');
  if (row) revalidatePath(`/sales/${row.deal_id}`);
  return { ok: true };
}

/** Tags are created by using them — a separate screen to mint one is a screen nobody opens. */
export async function setTag(input: { dealId: number; label: string; on: boolean }): Promise<R> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };
  const label = (input.label ?? '').trim().slice(0, 40);
  if (!label) return { ok: false, error: 'Name the tag' };
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!key) return { ok: false, error: 'That tag is all punctuation' };

  if (input.on) {
    await query(`INSERT INTO atlas.sales_tag (key, label) VALUES ($1, $2)
                 ON CONFLICT (key) DO NOTHING`, [key, label]);
    await query(`INSERT INTO atlas.sales_deal_tag (deal_id, tag_id)
                 SELECT $1, id FROM atlas.sales_tag WHERE key = $2
                 ON CONFLICT DO NOTHING`, [input.dealId, key]);
  } else {
    await query(`DELETE FROM atlas.sales_deal_tag
                  WHERE deal_id = $1
                    AND tag_id = (SELECT id FROM atlas.sales_tag WHERE key = $2)`,
      [input.dealId, key]);
  }
  revalidatePath('/sales');
  revalidatePath(`/sales/${input.dealId}`);
  return { ok: true };
}

export async function updateDeal(input: {
  dealId: number; accountType?: string;
  value?: string; expectedClose?: string;
  contactName?: string; contactRole?: string; contactPhone?: string; contactEmail?: string;
  city?: string; website?: string;
}): Promise<R> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };
  const value = input.value && /^\d+$/.test(input.value) ? Number(input.value) : null;
  const close = input.expectedClose && /^\d{4}-\d{2}-\d{2}$/.test(input.expectedClose)
    ? input.expectedClose : null;
  const accountType = await validType(input.accountType);
  await query(`
    UPDATE atlas.sales_deal SET
      account_type   = $10,
      value_inr      = $2,
      expected_close = $3::date,
      contact_name   = NULLIF(btrim($4), ''),
      contact_role   = NULLIF(btrim($5), ''),
      contact_phone  = NULLIF(btrim($6), ''),
      contact_email  = NULLIF(btrim($7), ''),
      city           = NULLIF(btrim($8), ''),
      website        = NULLIF(btrim($9), ''),
      updated_at     = now()
    WHERE id = $1
  `, [input.dealId, value, close, input.contactName ?? '', input.contactRole ?? '',
      input.contactPhone ?? '', input.contactEmail ?? '', input.city ?? '', input.website ?? '',
      accountType]);
  audit(me.id, '/sales', 'edit-deal');
  revalidatePath('/sales');
  revalidatePath(`/sales/${input.dealId}`);
  return { ok: true };
}
