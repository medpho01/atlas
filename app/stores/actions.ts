'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser, type User } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { canManage } from '@/lib/access';

/**
 * Everything this screen can write.
 *
 * Which is deliberately little. A store's name, address, serviceability and
 * an order's appointment all live in LabStack, reached through a read-only
 * replica — Atlas has never written a row there and a dashboard is the last
 * place that should start. What is writable here is the layer beside it: who
 * runs the account on our side, when the account is worth interrupting
 * somebody about, whether the requests queue includes it, and which orders
 * somebody has decided need a new date.
 *
 * Every one of them lands in atlas.store_change_log with the before and after,
 * because the question afterwards is never "was this page opened" — which is
 * all atlas.audit_log can answer — but "who turned this partner off, and
 * when".
 */

type R = { ok: boolean; error?: string };

const DENIED = 'Changing a store needs the accounts, network lead or admin role';

/** The session, or a reason to refuse. One shape, so no action can forget a check. */
async function actor(): Promise<{ me: User } | { error: string }> {
  const me = await getSessionUser();
  if (!me) return { error: 'Session expired. Sign in again.' };
  if (!canManage(me, 'storeOrders')) return { error: DENIED };
  return { me };
}

/** A store id that came off a URL or a form. */
function storeId(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Append to the log.
 *
 * Awaited rather than fire-and-forget: if the record of a change cannot be
 * written, the caller needs to know before it tells somebody the change was
 * made. That is the opposite of the choice audit() makes for page views, and
 * for the opposite reason — a missing view is noise, a missing change is the
 * one row somebody will come looking for.
 */
async function logChange(
  storeIdValue: number, actorId: number, action: string, summary: string, detail?: unknown,
): Promise<void> {
  await query(
    `INSERT INTO atlas.store_change_log (store_id, action, summary, detail, actor_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [storeIdValue, action, summary, detail ? JSON.stringify(detail) : null, actorId],
  );
}

function refresh(id: number): void {
  revalidatePath('/stores');
  revalidatePath(`/stores/${id}`);
}

// ---------------------------------------------------------------------------
// The account overlay
// ---------------------------------------------------------------------------

export type ProfilePatch = {
  ops_owner_id: number | null;
  ops_contact_name: string;
  ops_contact_phone: string;
  ops_contact_email: string;
  coverage_note: string;
  delay_alert_hours: number;
  pending_alert_count: number;
};

/** Empty string means "cleared", which is a different fact from "unchanged". */
function trimOrNull(v: string | null | undefined, max: number): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  return s.slice(0, max);
}

export async function saveStoreProfile(id: number, patch: ProfilePatch): Promise<R> {
  const a = await actor();
  if ('error' in a) return { ok: false, error: a.error };
  const sid = storeId(id);
  if (!sid) return { ok: false, error: 'Bad store' };

  const delay = Math.round(Number(patch.delay_alert_hours));
  const pending = Math.round(Number(patch.pending_alert_count));
  // The same bounds the CHECK constraints use. Caught here so the person gets
  // a sentence instead of a Postgres error, and caught there too so a bad row
  // cannot arrive by any other route.
  if (!Number.isFinite(delay) || delay < 1 || delay > 720) {
    return { ok: false, error: 'Delay alert must be between 1 and 720 hours' };
  }
  if (!Number.isFinite(pending) || pending < 1 || pending > 10000) {
    return { ok: false, error: 'Pending alert must be between 1 and 10,000 orders' };
  }

  const email = trimOrNull(patch.ops_contact_email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'That email address does not look right' };
  }

  const owner = patch.ops_owner_id == null ? null : storeId(patch.ops_owner_id);
  if (patch.ops_owner_id != null && owner == null) {
    return { ok: false, error: 'Bad owner' };
  }
  // A store cannot be handed to somebody who cannot open it. Checked against
  // the table rather than trusted from the form, because the select is built
  // from a list the browser can edit.
  if (owner != null) {
    const ok = await queryOne<{ id: number }>(
      `SELECT id FROM atlas.users WHERE id = $1 AND active`, [owner]);
    if (!ok) return { ok: false, error: 'That person is not an active Atlas user' };
  }

  const before = await queryOne<Record<string, unknown>>(`
    SELECT ops_owner_id, ops_contact_name, ops_contact_phone, ops_contact_email,
           coverage_note, delay_alert_hours, pending_alert_count
    FROM atlas.store_profile WHERE store_id = $1
  `, [sid]);

  const after = {
    ops_owner_id: owner,
    ops_contact_name: trimOrNull(patch.ops_contact_name, 120),
    ops_contact_phone: trimOrNull(patch.ops_contact_phone, 40),
    ops_contact_email: email,
    coverage_note: trimOrNull(patch.coverage_note, 2000),
    delay_alert_hours: delay,
    pending_alert_count: pending,
  };

  await query(`
    INSERT INTO atlas.store_profile
      (store_id, ops_owner_id, ops_contact_name, ops_contact_phone, ops_contact_email,
       coverage_note, delay_alert_hours, pending_alert_count, updated_by, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
    ON CONFLICT (store_id) DO UPDATE SET
      ops_owner_id      = EXCLUDED.ops_owner_id,
      ops_contact_name  = EXCLUDED.ops_contact_name,
      ops_contact_phone = EXCLUDED.ops_contact_phone,
      ops_contact_email = EXCLUDED.ops_contact_email,
      coverage_note     = EXCLUDED.coverage_note,
      delay_alert_hours = EXCLUDED.delay_alert_hours,
      pending_alert_count = EXCLUDED.pending_alert_count,
      updated_by        = EXCLUDED.updated_by,
      updated_at        = now()
  `, [sid, after.ops_owner_id, after.ops_contact_name, after.ops_contact_phone,
      after.ops_contact_email, after.coverage_note, after.delay_alert_hours,
      after.pending_alert_count, a.me.id]);

  // Only the fields that moved. A log entry that lists seven unchanged values
  // is one nobody reads twice.
  const changed = Object.keys(after).filter(
    (k) => (before?.[k] ?? null) !== ((after as Record<string, unknown>)[k] ?? null));

  await logChange(sid, a.me.id, 'profile_updated',
    changed.length
      ? `Updated ${changed.map(fieldLabel).join(', ')}`
      : 'Saved the account details with no changes',
    { changed, before: before ?? null, after });

  refresh(sid);
  return { ok: true };
}

const FIELD_LABEL: Record<string, string> = {
  ops_owner_id: 'account owner',
  ops_contact_name: 'contact name',
  ops_contact_phone: 'contact phone',
  ops_contact_email: 'contact email',
  coverage_note: 'coverage note',
  delay_alert_hours: 'delay threshold',
  pending_alert_count: 'pending threshold',
};
function fieldLabel(k: string): string { return FIELD_LABEL[k] ?? k; }

// ---------------------------------------------------------------------------
// Whether the requests queue includes this partner
// ---------------------------------------------------------------------------

/**
 * Take a store out of the requests queue, or put it back.
 *
 * This is the nearest thing Atlas has to removing a store, and it is worth
 * being clear that it is not one: nothing is deleted, the orders stay on this
 * page, and the queue keeps saying how many requests are hidden. Deleting a
 * partner is a console operation with a great deal more behind it than a
 * dashboard should be able to trigger.
 *
 * Admin only, which is stricter than the rest of this file. Turning a partner
 * off is the one action here that stops other people's work appearing — the
 * requests queue is somebody else's screen — and a wrong click is invisible
 * to the person it affects.
 */
export async function setStoreQueueTracking(id: number, tracked: boolean): Promise<R> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'Session expired. Sign in again.' };
  if (me.role !== 'admin') {
    return { ok: false, error: 'Only an admin can take a store out of the requests queue' };
  }
  const sid = storeId(id);
  if (!sid) return { ok: false, error: 'Bad store' };

  const exists = await queryOne<{ id: number }>(
    `SELECT id FROM src_local."Store" WHERE id = $1`, [sid]);
  if (!exists) return { ok: false, error: 'No such store' };

  // What the queue would lose, counted before the change so the log records
  // the consequence and not just the click.
  const open = await queryOne<{ n: number }>(`
    SELECT count(*)::int AS n FROM analytics.mv_request_state
    WHERE store_id = $1 AND NOT is_converted
  `, [sid]);

  await query(`
    INSERT INTO atlas.store_tracking (store_id, tracked, updated_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (store_id) DO UPDATE
      SET tracked = EXCLUDED.tracked, updated_by = EXCLUDED.updated_by, updated_at = now()
  `, [sid, tracked, me.id]);

  await logChange(sid, me.id, tracked ? 'tracked_on' : 'tracked_off',
    tracked
      ? 'Put back into the requests queue'
      : `Taken out of the requests queue, hiding ${open?.n ?? 0} open request(s)`,
    { tracked, open_requests_hidden: tracked ? 0 : open?.n ?? 0 });

  refresh(sid);
  revalidatePath('/requests');
  revalidatePath('/settings/stores');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bulk: orders that need a new date
// ---------------------------------------------------------------------------

/** Ids off a form: deduplicated, bounded, and every one an integer. */
function orderIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out = new Set<number>();
  for (const v of raw) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) return null;
    out.add(n);
  }
  // A bulk action over a page of rows. The cap is the page size, not a guess:
  // anything larger did not come from this screen.
  if (out.size === 0 || out.size > 500) return null;
  return [...out];
}

/**
 * Mark orders as needing a new appointment.
 *
 * Atlas does not move appointments and this does not claim to. It records a
 * decision — these orders, this reason, this person, this moment — so that
 * going through a store's stalled list happens once rather than every morning,
 * and so the console operator gets a list instead of a paragraph in a chat.
 * The screen says as much above the button; see docs/STORES-AND-ORDERS.md.
 */
export async function flagOrdersForReschedule(
  id: number, ids: number[], reason: string,
): Promise<R & { flagged?: number }> {
  const a = await actor();
  if ('error' in a) return { ok: false, error: a.error };
  const sid = storeId(id);
  if (!sid) return { ok: false, error: 'Bad store' };

  const orders = orderIds(ids);
  if (!orders) return { ok: false, error: 'Select between 1 and 500 orders' };

  const why = trimOrNull(reason, 400);
  if (!why) return { ok: false, error: 'Say why these need a new date' };

  // Only orders that really belong to this store, checked against the data
  // rather than taken from the form — otherwise a crafted post could attach a
  // flag to another partner's order, and the store page would then show a row
  // it has no business showing.
  const mine = await query<{ order_id: number }>(`
    SELECT order_id FROM analytics.v_store_order
    WHERE store_id = $1 AND order_id = ANY($2::int[])
  `, [sid, orders]);
  if (mine.length === 0) {
    return { ok: false, error: 'None of those orders belong to this store' };
  }
  const ok = mine.map((r) => r.order_id);

  await query(`
    INSERT INTO atlas.order_reschedule_flag (order_id, store_id, reason, flagged_by)
    SELECT o, $1, $2, $3 FROM unnest($4::int[]) o
    ON CONFLICT (order_id) DO UPDATE
      SET store_id = EXCLUDED.store_id, reason = EXCLUDED.reason,
          flagged_by = EXCLUDED.flagged_by, flagged_at = now(),
          cleared_at = NULL, cleared_by = NULL
  `, [sid, why, a.me.id, ok]);

  await logChange(sid, a.me.id, 'orders_flagged',
    `Marked ${ok.length} order${ok.length === 1 ? '' : 's'} as needing a new date`,
    { reason: why, order_ids: ok, requested: orders.length });

  refresh(sid);
  // The count, so the screen can say what happened rather than assuming every
  // row it sent was accepted.
  return { ok: true, flagged: ok.length };
}

/** Clear flags — because the date was moved, or because it never needed to be. */
export async function clearRescheduleFlags(id: number, ids: number[]): Promise<R & { cleared?: number }> {
  const a = await actor();
  if ('error' in a) return { ok: false, error: a.error };
  const sid = storeId(id);
  if (!sid) return { ok: false, error: 'Bad store' };

  const orders = orderIds(ids);
  if (!orders) return { ok: false, error: 'Select between 1 and 500 orders' };

  const done = await query<{ order_id: number }>(`
    UPDATE atlas.order_reschedule_flag
       SET cleared_at = now(), cleared_by = $1
     WHERE store_id = $2 AND order_id = ANY($3::int[]) AND cleared_at IS NULL
    RETURNING order_id
  `, [a.me.id, sid, orders]);

  if (done.length === 0) return { ok: false, error: 'Nothing there was still flagged' };

  await logChange(sid, a.me.id, 'flags_cleared',
    `Cleared the reschedule flag on ${done.length} order${done.length === 1 ? '' : 's'}`,
    { order_ids: done.map((r) => r.order_id) });

  refresh(sid);
  return { ok: true, cleared: done.length };
}
