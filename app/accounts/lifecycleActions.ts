'use server';

import { revalidatePath } from 'next/cache';
import { requireView } from '@/lib/guard';
import { canManage } from '@/lib/access';
import { query, queryOne } from '@/lib/db';
import { CADENCES, STAGES, type Cadence, type Stage } from '@/lib/lifecycle';

/**
 * Everything that writes to the account spine.
 *
 * Either capability opens it: the accounts team owns the row once it is live,
 * and sales owns the same row while it is still a deal — they reach these
 * panels from the deal page. Requiring only accountHealth would have locked
 * sales out of the meetings they themselves logged.
 */
async function gate(path: string) {
  const g = await requireView('accountHealth', path);
  if (g.blocked) return null;
  if (!canManage(g.user, 'accountHealth') && !canManage(g.user, 'salesCrm')) return null;
  return g.user;
}

const clean = (v: string | undefined | null) => {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
};

/** A number typed into a ₹ box, or nothing. Never a NaN into the column. */
const num = (v: string | undefined | null) => {
  const s = (v ?? '').replace(/[, ]/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const date = (v: string | undefined | null) => {
  const s = (v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

export async function createAccount(input: {
  name: string; city?: string; accountType?: string; ownerId?: number;
}) {
  const user = await gate('/accounts');
  if (!user) return { ok: false as const, error: 'Not allowed' };

  const name = clean(input.name);
  if (!name) return { ok: false as const, error: 'A name is needed' };

  const row = await queryOne<{ id: number }>(`
    INSERT INTO atlas.account (name, city, account_type, owner_id, lifecycle, created_by)
    VALUES ($1, $2, $3, $4, 'sales', $5)
    RETURNING id
  `, [name, clean(input.city), clean(input.accountType), input.ownerId ?? null, user.id]);

  revalidatePath('/accounts');
  return { ok: true as const, id: row!.id };
}

/**
 * Owner, cadence and the plain details. Deliberately NOT the book sizing:
 * one action writing every column meant changing the cadence silently blanked
 * the numbers sales had typed, because they were not part of that form.
 */
export async function updateAccount(input: {
  accountId: number;
  ownerId?: number | null;
  cadence?: string;
  city?: string;
  website?: string;
}) {
  const user = await gate(`/accounts/${input.accountId}`);
  if (!user) return { ok: false as const, error: 'Not allowed' };

  const cadence: Cadence | null =
    input.cadence && (CADENCES as readonly string[]).includes(input.cadence)
      ? input.cadence as Cadence : null;

  await query(`
    UPDATE atlas.account SET
      owner_id       = COALESCE($2, owner_id),
      review_cadence = COALESCE($3, review_cadence),
      city           = COALESCE($4, city),
      website        = COALESCE($5, website),
      updated_at     = now()
    WHERE id = $1
  `, [input.accountId, input.ownerId ?? null, cadence,
      clean(input.city), clean(input.website)]);

  revalidatePath(`/accounts/${input.accountId}`);
  return { ok: true as const };
}

/**
 * The three numbers a human types: both book sizes and what one service is
 * worth. All three are written together because they are one form — and a
 * blank here is a deliberate 'we do not know', so it is stored as NULL rather
 * than kept at its old value.
 */
export async function updateSizing(input: {
  accountId: number; premiumBookCr?: string; opdBookCr?: string; avgTicketInr?: string;
}) {
  const user = await gate(`/accounts/${input.accountId}`);
  if (!user) return { ok: false as const, error: 'Not allowed' };

  await query(`
    UPDATE atlas.account SET
      premium_book_cr = $2, opd_book_cr = $3, avg_ticket_inr = $4, updated_at = now()
    WHERE id = $1
  `, [input.accountId, num(input.premiumBookCr), num(input.opdBookCr), num(input.avgTicketInr)]);

  revalidatePath(`/accounts/${input.accountId}`);
  revalidatePath('/accounts');
  return { ok: true as const };
}

/** Moving stage is deliberate and logged — it is the handover between teams. */
export async function moveStage(input: { accountId: number; stage: string; reason?: string }) {
  const user = await gate(`/accounts/${input.accountId}`);
  if (!user) return { ok: false as const, error: 'Not allowed' };
  if (!(STAGES as readonly string[]).includes(input.stage)) {
    return { ok: false as const, error: 'Unknown stage' };
  }
  const stage = input.stage as Stage;

  await query(`
    UPDATE atlas.account SET
      lifecycle     = $2,
      closed_reason = CASE WHEN $2 IN ('lost', 'churned') THEN $3 ELSE closed_reason END,
      live_since    = CASE WHEN $2 = 'managed' THEN COALESCE(live_since, atlas.ist_today()) ELSE live_since END,
      updated_at    = now()
    WHERE id = $1
  `, [input.accountId, stage, clean(input.reason)]);

  revalidatePath(`/accounts/${input.accountId}`);
  revalidatePath('/accounts');
  return { ok: true as const };
}

export async function addContact(input: {
  accountId: number; name: string; role?: string; phone?: string;
  email?: string; decisionMaker?: boolean;
}) {
  const user = await gate(`/accounts/${input.accountId}`);
  if (!user) return { ok: false as const, error: 'Not allowed' };
  const name = clean(input.name);
  if (!name) return { ok: false as const, error: 'A name is needed' };

  await query(`
    INSERT INTO atlas.account_contact
      (account_id, name, role, phone, email, is_decision_maker, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [input.accountId, name, clean(input.role), clean(input.phone),
      clean(input.email), !!input.decisionMaker, user.id]);

  revalidatePath(`/accounts/${input.accountId}`);
  return { ok: true as const };
}

export async function removeContact(input: { accountId: number; contactId: number }) {
  const user = await gate(`/accounts/${input.accountId}`);
  if (!user) return { ok: false as const, error: 'Not allowed' };
  await query(`DELETE FROM atlas.account_contact WHERE id = $1 AND account_id = $2`,
    [input.contactId, input.accountId]);
  revalidatePath(`/accounts/${input.accountId}`);
  return { ok: true as const };
}

/**
 * Log a meeting that happened, or book one that will. A next step with a date
 * also becomes a task, because an agreement nobody is chased for is a note.
 */
export async function logMeeting(input: {
  accountId: number;
  kind?: string;
  happenedOn?: string;
  scheduledOn?: string;
  title?: string;
  attendees?: string;
  notes?: string;
  nextStep?: string;
  nextStepDue?: string;
  nextStepOwnerId?: number;
}) {
  const user = await gate(`/accounts/${input.accountId}`);
  if (!user) return { ok: false as const, error: 'Not allowed' };

  const kind = ['meeting', 'call', 'mbr', 'qbr'].includes(input.kind ?? '')
    ? input.kind! : 'meeting';
  const happened = date(input.happenedOn);
  const scheduled = date(input.scheduledOn);
  if (!happened && !scheduled) {
    return { ok: false as const, error: 'A date is needed — when it happened, or when it is booked' };
  }

  const meeting = await queryOne<{ id: number }>(`
    INSERT INTO atlas.meeting
      (account_id, kind, happened_on, scheduled_on, title, attendees, notes,
       next_step, next_step_due, next_step_owner_id, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id
  `, [input.accountId, kind, happened, scheduled, clean(input.title),
      clean(input.attendees), clean(input.notes), clean(input.nextStep),
      date(input.nextStepDue), input.nextStepOwnerId ?? null, user.id]);

  const step = clean(input.nextStep);
  if (step) {
    await query(`
      INSERT INTO atlas.account_task
        (account_id, title, due_on, assignee_id, phase, meeting_id, created_by)
      VALUES ($1, $2, $3, $4, 'managed', $5, $6)
    `, [input.accountId, step, date(input.nextStepDue),
        input.nextStepOwnerId ?? user.id, meeting!.id, user.id]);
  }

  revalidatePath(`/accounts/${input.accountId}`);
  revalidatePath('/accounts');
  return { ok: true as const };
}

/** What the account is entitled to order, which our data cannot infer. */
export async function setService(input: {
  accountId: number; stream: string; status: string; note?: string;
}) {
  const user = await gate(`/accounts/${input.accountId}`);
  if (!user) return { ok: false as const, error: 'Not allowed' };
  if (!['discussed', 'contracted', 'live', 'paused'].includes(input.status)) {
    return { ok: false as const, error: 'Unknown status' };
  }

  await query(`
    INSERT INTO atlas.account_service
      (account_id, stream, status, contracted_on, note, updated_by, updated_at)
    VALUES ($1, $2, $3, CASE WHEN $3 IN ('contracted','live') THEN atlas.ist_today() END, $4, $5, now())
    ON CONFLICT (account_id, stream) DO UPDATE SET
      status        = EXCLUDED.status,
      contracted_on = COALESCE(atlas.account_service.contracted_on, EXCLUDED.contracted_on),
      note          = COALESCE(EXCLUDED.note, atlas.account_service.note),
      updated_by    = EXCLUDED.updated_by,
      updated_at    = now()
  `, [input.accountId, input.stream, input.status, clean(input.note), user.id]);

  revalidatePath(`/accounts/${input.accountId}`);
  return { ok: true as const };
}

export async function clearService(input: { accountId: number; stream: string }) {
  const user = await gate(`/accounts/${input.accountId}`);
  if (!user) return { ok: false as const, error: 'Not allowed' };
  await query(`DELETE FROM atlas.account_service WHERE account_id = $1 AND stream = $2`,
    [input.accountId, input.stream]);
  revalidatePath(`/accounts/${input.accountId}`);
  return { ok: true as const };
}

export async function addTask(input: {
  accountId: number; title: string; department?: string; assigneeId?: number;
  dueOn?: string; plannedStart?: string; phase?: string; detail?: string;
}) {
  const user = await gate(`/accounts/${input.accountId}`);
  if (!user) return { ok: false as const, error: 'Not allowed' };
  const title = clean(input.title);
  if (!title) return { ok: false as const, error: 'A title is needed' };

  await query(`
    INSERT INTO atlas.account_task
      (account_id, title, detail, department, assignee_id, due_on, planned_start, phase, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [input.accountId, title, clean(input.detail), clean(input.department),
      input.assigneeId ?? null, date(input.dueOn), date(input.plannedStart),
      input.phase === 'onboarding' ? 'onboarding' : 'managed', user.id]);

  revalidatePath(`/accounts/${input.accountId}`);
  return { ok: true as const };
}

export async function toggleTask(input: { accountId: number; taskId: number; done: boolean }) {
  const user = await gate(`/accounts/${input.accountId}`);
  if (!user) return { ok: false as const, error: 'Not allowed' };

  await query(`
    UPDATE atlas.account_task
       SET done_at = CASE WHEN $3 THEN now() END,
           done_by = CASE WHEN $3 THEN $4 END
     WHERE id = $1 AND account_id = $2
  `, [input.taskId, input.accountId, input.done, user.id]);

  revalidatePath(`/accounts/${input.accountId}`);
  revalidatePath('/accounts');
  return { ok: true as const };
}

/** Companies already on the book that look like the one being typed. */
export async function checkDuplicate(name: string) {
  const g = await requireView('accountHealth', '/accounts');
  if (g.blocked) return [];
  const { findSimilar } = await import('@/lib/lifecycle');
  return findSimilar(name);
}
