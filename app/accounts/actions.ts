'use server';

import { revalidatePath } from 'next/cache';
import { query, queryOne } from '@/lib/db';
import { getSessionUser, audit } from '@/lib/auth';
import { canManage } from '@/lib/access';

type R = { ok: boolean; error?: string };

async function gate() {
  const me = await getSessionUser();
  if (!me) return { me: null, error: 'unauthenticated' as const };
  if (!canManage(me, 'accountHealth')) {
    return { me: null, error: 'Needs the accounts or admin role' as const };
  }
  return { me, error: null };
}

/**
 * Who owns the commercial relationship.
 *
 * Written to atlas.store_profile alongside ops_owner_id rather than into a
 * table of its own: one row per store, one place to look. Separate column,
 * because chasing a late pickup and owning the account are different jobs.
 */
export async function setAccountManager(input: {
  storeId: number; managerId: number | null;
}): Promise<R> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };
  if (input.managerId != null) {
    const who = await queryOne<{ id: number }>(
      `SELECT id FROM atlas.users WHERE id = $1 AND active`, [input.managerId]);
    if (!who) return { ok: false, error: 'That person is not an active user' };
  }
  await query(`
    INSERT INTO atlas.store_profile (store_id, account_manager_id, updated_by, updated_at)
    VALUES ($1, $2, $3, now())
    ON CONFLICT (store_id) DO UPDATE SET
      account_manager_id = EXCLUDED.account_manager_id,
      updated_by = EXCLUDED.updated_by, updated_at = now()
  `, [input.storeId, input.managerId, me.id]);
  audit(me.id, '/accounts', 'set-manager');
  revalidatePath('/accounts');
  revalidatePath(`/accounts/${input.storeId}`);
  return { ok: true };
}

export async function addTask(input: {
  storeId: number; title: string; detail?: string;
  dueOn?: string; assigneeId?: number | null; repeat?: string;
}): Promise<R> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };
  const title = (input.title ?? '').trim().slice(0, 300);
  if (!title) return { ok: false, error: 'What has to happen?' };
  const due = input.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) ? input.dueOn : null;
  const repeat = ['none', 'monthly', 'quarterly'].includes(input.repeat ?? '')
    ? input.repeat : 'none';
  if (repeat !== 'none' && !due) {
    return { ok: false, error: 'A repeating task needs a first date to repeat from' };
  }
  await query(`
    INSERT INTO atlas.account_task
      (store_id, title, detail, due_on, assignee_id, repeat_every, created_by)
    VALUES ($1, $2, NULLIF(btrim($3), ''), $4::date, $5, $6, $7)
  `, [input.storeId, title, input.detail ?? '', due, input.assigneeId ?? me.id, repeat, me.id]);
  audit(me.id, '/accounts', 'task');
  revalidatePath('/accounts');
  revalidatePath('/accounts/tasks');
  revalidatePath(`/accounts/${input.storeId}`);
  return { ok: true };
}

/**
 * Tick a task, and write its successor if it repeats.
 *
 * The next copy is created on completion rather than by a scheduler, so a
 * month nobody did the review shows up as one overdue task instead of a
 * backlog of twelve that everybody learns to ignore. Untick removes the
 * successor again, so a misclick does not leave a stray task behind.
 */
export async function toggleTask(input: { taskId: number; done: boolean }): Promise<R> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };

  if (!input.done) {
    await query(`DELETE FROM atlas.account_task WHERE parent_id = $1 AND done_at IS NULL`,
      [input.taskId]);
    const row = await queryOne<{ store_id: number }>(
      `UPDATE atlas.account_task SET done_at = NULL, done_by = NULL
        WHERE id = $1 RETURNING store_id`, [input.taskId]);
    revalidatePath('/accounts/tasks');
    if (row) revalidatePath(`/accounts/${row.store_id}`);
    return { ok: true };
  }

  const t = await queryOne<{
    id: number; store_id: number; title: string; detail: string | null;
    due_on: string | null; assignee_id: number | null; repeat_every: string;
  }>(`
    UPDATE atlas.account_task SET done_at = now(), done_by = $2
     WHERE id = $1 AND done_at IS NULL
     RETURNING id, store_id, title, detail, due_on::text AS due_on, assignee_id, repeat_every
  `, [input.taskId, me.id]);

  if (t && t.repeat_every !== 'none' && t.due_on) {
    const step = t.repeat_every === 'monthly' ? '1 month' : '3 months';
    // Already generated? A double-click should not make two.
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM atlas.account_task WHERE parent_id = $1`, [t.id]);
    if (!existing) {
      await query(`
        INSERT INTO atlas.account_task
          (store_id, title, detail, due_on, assignee_id, repeat_every, parent_id, created_by)
        VALUES ($1, $2, $3, ($4::date + $5::interval)::date, $6, $7, $8, $9)
      `, [t.store_id, t.title, t.detail, t.due_on, step, t.assignee_id, t.repeat_every, t.id, me.id]);
    }
  }

  audit(me.id, '/accounts', 'task-done');
  revalidatePath('/accounts');
  revalidatePath('/accounts/tasks');
  if (t) revalidatePath(`/accounts/${t.store_id}`);
  return { ok: true };
}

export async function addNote(input: { storeId: number; kind: string; body: string }): Promise<R> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };
  const body = (input.body ?? '').trim().slice(0, 4000);
  if (!body) return { ok: false, error: 'Write something first' };
  const kind = ['note', 'call', 'email', 'meeting'].includes(input.kind) ? input.kind : 'note';
  await query(`INSERT INTO atlas.account_note (store_id, kind, body, author_id)
               VALUES ($1, $2, $3, $4)`, [input.storeId, kind, body, me.id]);
  audit(me.id, '/accounts', `note:${kind}`);
  revalidatePath(`/accounts/${input.storeId}`);
  return { ok: true };
}

export async function addContact(input: {
  storeId: number; name: string; role?: string; phone?: string; email?: string;
}): Promise<R> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };
  const name = (input.name ?? '').trim().slice(0, 120);
  if (!name) return { ok: false, error: 'A name, at least' };
  await query(`
    INSERT INTO atlas.store_contact (store_id, name, role, phone, email, added_by)
    VALUES ($1, $2, NULLIF(btrim($3), ''), NULLIF(btrim($4), ''), NULLIF(btrim($5), ''), $6)
  `, [input.storeId, name, input.role ?? '', input.phone ?? '', input.email ?? '', me.id]);
  audit(me.id, '/accounts', 'contact');
  revalidatePath(`/accounts/${input.storeId}`);
  return { ok: true };
}

export async function removeContact(input: { contactId: number; storeId: number }): Promise<R> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };
  await query(`DELETE FROM atlas.store_contact WHERE id = $1 AND store_id = $2`,
    [input.contactId, input.storeId]);
  revalidatePath(`/accounts/${input.storeId}`);
  return { ok: true };
}

/**
 * The activation checklist for a line the account has never bought.
 *
 * The same four steps every time, as tasks on the account. The sequence is
 * known — confirm the need, price it, get one order through, review it — so it
 * should not be re-invented in somebody's notes each quarter.
 */
export async function startActivation(input: { storeId: number; stream: string }): Promise<R> {
  const { me, error } = await gate();
  if (!me) return { ok: false, error: error! };
  const LINE: Record<string, string> = {
    APPOINTMENT: 'consultations', PHARMA_ORDER: 'pharmacy', LAB_ORDER: 'diagnostics',
  };
  const line = LINE[input.stream];
  if (!line) return { ok: false, error: 'Unknown business line' };

  const already = await queryOne<{ id: number }>(`
    SELECT id FROM atlas.account_task
     WHERE store_id = $1 AND done_at IS NULL AND title LIKE $2 LIMIT 1
  `, [input.storeId, `%${line}%`]);
  if (already) return { ok: false, error: `An activation for ${line} is already open` };

  const steps: [string, number][] = [
    [`Confirm the clinical need for ${line}`, 3],
    [`Price ${line} for this account`, 10],
    [`Get one pilot ${line} order through`, 21],
    [`Review the ${line} pilot at 30 days`, 45],
  ];
  for (const [title, days] of steps) {
    await query(`
      INSERT INTO atlas.account_task (store_id, title, due_on, assignee_id, created_by)
      VALUES ($1, $2, atlas.ist_today() + $3::int, $4, $5)
    `, [input.storeId, title, days, me.id, me.id]);
  }
  await query(`INSERT INTO atlas.account_note (store_id, kind, body, author_id)
               VALUES ($1, 'system', $2, $3)`,
    [input.storeId, `Started activation for ${line}.`, me.id]);

  audit(me.id, '/accounts', `activate:${input.stream}`);
  revalidatePath('/accounts');
  revalidatePath(`/accounts/${input.storeId}`);
  return { ok: true };
}
