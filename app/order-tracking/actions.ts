'use server';

import { revalidatePath } from 'next/cache';
import { queryOne } from '@/lib/db';
import { getSessionUser, audit } from '@/lib/auth';
import { canManage, canView } from '@/lib/access';
import { TASK_KINDS, type TaskKind } from '@/lib/orderTracking';

type R = { ok: boolean; error?: string };

const isKind = (k: string): k is TaskKind => (TASK_KINDS as readonly string[]).includes(k);

/**
 * Hand a task to somebody.
 *
 * A lead's call, not the assignee's: the team is given its work rather than
 * picking it up, so this needs manage rather than view. Who assigned it is
 * recorded alongside who holds it, because "who is working on what" is asked
 * a week later and by then only the row remembers.
 */
export async function assignTasks(
  input: { orderIds: number[]; kind: string; assigneeId: number | null },
): Promise<R & { assigned?: number }> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!canManage(me, 'orderTracking')) {
    return { ok: false, error: 'Needs the network lead or admin role' };
  }
  if (!isKind(input.kind)) return { ok: false, error: 'Unknown queue' };

  const ids = input.orderIds.filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
  if (!ids.length) return { ok: false, error: 'Nothing selected' };

  if (input.assigneeId != null) {
    const who = await queryOne<{ id: number }>(
      `SELECT id FROM atlas.users WHERE id = $1 AND active`, [input.assigneeId]);
    if (!who) return { ok: false, error: 'That person is not an active user' };
  }

  // Upsert, because the task row may not exist yet — the task itself is
  // derived, and this table only ever holds the human part of it.
  await queryOne(`
    INSERT INTO atlas.order_task (order_id, kind, assignee_id, assigned_by, assigned_at)
    SELECT id, $2, $3, $4, CASE WHEN $3::int IS NULL THEN NULL ELSE now() END
    FROM unnest($1::int[]) AS id
    ON CONFLICT (order_id, kind) DO UPDATE SET
      assignee_id = EXCLUDED.assignee_id,
      assigned_by = EXCLUDED.assigned_by,
      assigned_at = EXCLUDED.assigned_at,
      updated_at  = now()
  `, [ids, input.kind, input.assigneeId, me.id]);

  audit(me.id, '/order-tracking', input.assigneeId == null ? 'unassign' : 'assign');
  revalidatePath('/order-tracking');
  return { ok: true, assigned: ids.length };
}

/**
 * Record what the lab said.
 *
 * Anyone who can see the queue can add one: the person on the phone is not
 * always the person who was given the task, and a note nobody can write is a
 * note nobody writes.
 */
export async function addTaskNote(
  input: { orderId: number; kind: string; body: string },
): Promise<R> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!canView(me, 'orderTracking')) return { ok: false, error: 'No access' };
  if (!isKind(input.kind)) return { ok: false, error: 'Unknown queue' };

  const body = input.body.trim().slice(0, 2000);
  if (!body) return { ok: false, error: 'Write something first' };
  if (!Number.isInteger(input.orderId) || input.orderId <= 0) {
    return { ok: false, error: 'Bad order' };
  }

  await queryOne(`
    INSERT INTO atlas.order_task_note (order_id, kind, body, author_id)
    VALUES ($1, $2, $3, $4)
  `, [input.orderId, input.kind, body, me.id]);

  // The note is about a task, so make sure the task row exists to hang
  // assignment off later.
  await queryOne(`
    INSERT INTO atlas.order_task (order_id, kind) VALUES ($1, $2)
    ON CONFLICT (order_id, kind) DO UPDATE SET updated_at = now()
  `, [input.orderId, input.kind]);

  audit(me.id, '/order-tracking', 'note');
  // Deliberately no revalidatePath: re-rendering the page from under an open
  // drawer closes it, and losing your place every time you write a line is
  // how a notes field stops being used. The drawer refetches its own notes,
  // and the row's count catches up when the drawer closes.
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Which stores are tracked
// ---------------------------------------------------------------------------

/**
 * Add a store to the tracked list, or take it off.
 *
 * This is the first line of the spec — "all the data needs to be tracked for
 * the following stores" — and everything on this screen derives from it. A
 * store that is not on the list produces no queue rows at all, which is the
 * point: the desk watches a named handful of partners, not the whole book.
 *
 * Needs manage on orderTracking, the same bar as handing work out, because it
 * decides what work exists for everybody. Taking a store off does not delete
 * anything — its orders are untouched and adding it back brings the queues
 * straight back.
 */
export async function setStoreTracked(storeId: number, tracked: boolean): Promise<R> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'Session expired. Sign in again.' };
  if (!canManage(me, 'orderTracking')) {
    return { ok: false, error: 'Changing the tracked stores needs the network lead or admin role' };
  }
  if (!Number.isInteger(storeId) || storeId <= 0) return { ok: false, error: 'Bad store' };

  // Checked against the directory, so a crafted id cannot put a row in the
  // group for a store that does not exist — which would then render as
  // "Store 41207" with queues nobody can explain.
  const exists = await queryOne<{ id: number }>(
    `SELECT id FROM analytics.v_store_directory WHERE id = $1`, [storeId]);
  if (!exists) return { ok: false, error: 'No such store' };

  if (tracked) {
    await queryOne(`
      INSERT INTO atlas.store_group_member (group_code, store_id, added_by)
      VALUES ('TRACKED', $1, $2)
      ON CONFLICT (group_code, store_id) DO NOTHING
    `, [storeId, me.id]);
  } else {
    await queryOne(
      `DELETE FROM atlas.store_group_member WHERE group_code = 'TRACKED' AND store_id = $1`,
      [storeId]);
  }

  // The same log the stores screen writes to, so one store's history reads in
  // one place whichever screen the change was made on.
  await queryOne(`
    INSERT INTO atlas.store_change_log (store_id, action, summary, actor_id)
    VALUES ($1, $2, $3, $4)
  `, [
    storeId,
    tracked ? 'tracking_on' : 'tracking_off',
    tracked ? 'Added to the tracked stores on order tracking'
            : 'Removed from the tracked stores on order tracking',
    me.id,
  ]);

  revalidatePath('/order-tracking');
  revalidatePath('/stores');
  revalidatePath(`/stores/${storeId}`);
  return { ok: true };
}
