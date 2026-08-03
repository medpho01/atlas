'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getSessionUser, hashPassword, type User } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

const ROLES: User['role'][] = ['admin', 'network', 'accounts', 'operations', 'editor', 'viewer'];

async function requireAdmin() {
  const me = await getSessionUser();
  if (!me) return { err: 'unauthenticated' as const, me: null };
  if (me.role !== 'admin') return { err: 'admin_only' as const, me: null };
  return { err: null, me };
}

export type UserRow = {
  id: number;
  email: string;
  name: string;
  role: User['role'];
  active: boolean;
  created_at: string;
  last_login_at: string | null;
};

export async function listUsers(): Promise<{ ok: boolean; users?: UserRow[]; error?: string }> {
  const { err } = await requireAdmin();
  if (err) return { ok: false, error: err };
  const users = await query<UserRow>(
    `SELECT id, email, name, role, active, created_at, last_login_at
     FROM atlas.users ORDER BY active DESC, role, name`,
  );
  return { ok: true, users };
}

export async function createUser(input: {
  email: string; name: string; password: string; role: User['role'];
}): Promise<{ ok: boolean; error?: string }> {
  const { err, me } = await requireAdmin();
  if (err) return { ok: false, error: err };

  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Invalid email' };
  if (!input.name.trim()) return { ok: false, error: 'Name required' };
  if ((input.password ?? '').length < 8) return { ok: false, error: 'Password must be at least 8 characters' };
  if (!ROLES.includes(input.role)) return { ok: false, error: 'Invalid role' };

  const exists = await queryOne(`SELECT 1 FROM atlas.users WHERE lower(email) = $1`, [email]);
  if (exists) return { ok: false, error: 'A user with this email already exists' };

  const hash = await hashPassword(input.password);
  await query(
    `INSERT INTO atlas.users (email, name, password_hash, role, active) VALUES ($1, $2, $3, $4, true)`,
    [email, input.name.trim(), hash, input.role],
  );
  await query(
    `INSERT INTO atlas.audit_log (user_id, action, detail) VALUES ($1, 'user_create', $2)
     ON CONFLICT DO NOTHING`,
    [me!.id, `created ${email} as ${input.role}`],
  ).catch(() => {}); // audit table optional
  revalidatePath('/users');
  return { ok: true };
}

export async function updateUser(input: {
  id: number; role?: User['role']; active?: boolean; newPassword?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { err, me } = await requireAdmin();
  if (err) return { ok: false, error: err };
  if (input.id === me!.id && input.active === false) {
    return { ok: false, error: "You can't deactivate your own account" };
  }
  if (input.role !== undefined) {
    if (!ROLES.includes(input.role)) return { ok: false, error: 'Invalid role' };
    if (input.id === me!.id && input.role !== 'admin') {
      return { ok: false, error: "You can't remove your own admin role" };
    }
    await query(`UPDATE atlas.users SET role = $1 WHERE id = $2`, [input.role, input.id]);
  }
  if (input.active !== undefined) {
    await query(`UPDATE atlas.users SET active = $1 WHERE id = $2`, [input.active, input.id]);
    if (input.active === false) {
      // Kill any live sessions for a deactivated user
      await query(`DELETE FROM atlas.sessions WHERE user_id = $1`, [input.id]).catch(() => {});
    }
  }
  if (input.newPassword !== undefined) {
    if (input.newPassword.length < 8) return { ok: false, error: 'Password must be at least 8 characters' };
    const hash = await hashPassword(input.newPassword);
    await query(`UPDATE atlas.users SET password_hash = $1 WHERE id = $2`, [hash, input.id]);
  }
  revalidatePath('/users');
  return { ok: true };
}

/**
 * Remove a user outright.
 *
 * Deactivation is the right answer almost always: it revokes access instantly
 * and keeps the person's history intact. Delete exists for the other case — an
 * account created by mistake, or someone who never signed in.
 *
 * Twelve tables reference atlas.users with NO ACTION (CRM threads, activities,
 * phlebo and nurse uploads), so deleting anyone who has actually done something
 * raises a foreign-key violation. Rather than cascade — which would silently
 * destroy their CRM history — that case is caught and turned into a message
 * pointing at deactivation.
 */
export async function deleteUser(input: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const { err, me } = await requireAdmin();
  if (err) return { ok: false, error: err };
  if (input.id === me!.id) return { ok: false, error: "You can't delete your own account" };

  const target = await queryOne<{ email: string; name: string; role: string; active: boolean }>(
    `SELECT email, name, role, active FROM atlas.users WHERE id = $1`, [input.id],
  );
  if (!target) return { ok: false, error: 'User not found' };

  // Never leave the instance without a way back in.
  if (target.role === 'admin' && target.active) {
    const others = await queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM atlas.users WHERE role = 'admin' AND active AND id <> $1`,
      [input.id],
    );
    if (Number(others?.n ?? 0) === 0) {
      return { ok: false, error: 'This is the last active admin — promote someone else first' };
    }
  }

  try {
    await query(`DELETE FROM atlas.users WHERE id = $1`, [input.id]);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '23503') {
      return {
        ok: false,
        error: `${target.name} has records in Atlas (CRM threads, activities or uploads) and can't be deleted without destroying them. Deactivate instead — it revokes access immediately.`,
      };
    }
    throw e;
  }

  await query(
    `INSERT INTO atlas.audit_log (user_id, action, detail) VALUES ($1, 'user_delete', $2)`,
    [me!.id, `deleted ${target.email} (${target.role})`],
  ).catch(() => {});
  revalidatePath('/users');
  return { ok: true };
}

/**
 * Password for a bulk-created account.
 *
 * Generated server-side so it can't be predicted from anything the browser
 * knows, and drawn from an alphabet without 0/O/1/l/I so it survives being
 * read off a screen and typed by hand.
 */
function generatePassword(len = 14): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export type BulkRow = { email: string; name: string; role: User['role'] };
export type BulkResult = {
  email: string;
  name: string;
  role: string;
  status: 'created' | 'skipped' | 'failed';
  password?: string;
  reason?: string;
};

/**
 * Create many users at once, each with a generated password.
 *
 * The passwords come back once, in this response, and are never stored in
 * readable form — only the bcrypt hash is written. If the admin closes the
 * page without copying them, the accounts need a password reset rather than a
 * lookup, which is the correct trade.
 *
 * Rows are independent: a duplicate or malformed row is reported against that
 * row and the rest still get created.
 */
export async function bulkCreateUsers(
  rows: BulkRow[],
): Promise<{ ok: boolean; error?: string; results?: BulkResult[] }> {
  const { err, me } = await requireAdmin();
  if (err) return { ok: false, error: err };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: 'Nothing to create' };
  if (rows.length > 200) return { ok: false, error: 'Too many rows — 200 at a time' };

  const results: BulkResult[] = [];
  const seen = new Set<string>();

  for (const raw of rows) {
    const email = (raw.email ?? '').trim().toLowerCase();
    const name = (raw.name ?? '').trim();
    const role = raw.role;
    const base = { email, name, role: String(role) };

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      results.push({ ...base, status: 'failed', reason: 'Invalid email' }); continue;
    }
    if (!name) { results.push({ ...base, status: 'failed', reason: 'Name required' }); continue; }
    if (!ROLES.includes(role)) {
      results.push({ ...base, status: 'failed', reason: `Unknown role "${role}"` }); continue;
    }
    // A file listing the same address twice would otherwise create one and
    // report the second as an existing user, which reads like a bug.
    if (seen.has(email)) {
      results.push({ ...base, status: 'skipped', reason: 'Duplicate row in file' }); continue;
    }
    seen.add(email);

    const exists = await queryOne(`SELECT 1 FROM atlas.users WHERE lower(email) = $1`, [email]);
    if (exists) {
      results.push({ ...base, status: 'skipped', reason: 'Already has an account' }); continue;
    }

    const password = generatePassword();
    try {
      await query(
        `INSERT INTO atlas.users (email, name, password_hash, role, active) VALUES ($1,$2,$3,$4,true)`,
        [email, name, await hashPassword(password), role],
      );
      results.push({ ...base, status: 'created', password });
    } catch {
      results.push({ ...base, status: 'failed', reason: 'Could not be created' });
    }
  }

  const created = results.filter((r) => r.status === 'created').length;
  await query(
    `INSERT INTO atlas.audit_log (user_id, action, detail) VALUES ($1, 'user_bulk_create', $2)`,
    [me!.id, `${created} of ${rows.length} users created from upload`],
  ).catch(() => {});
  revalidatePath('/users');
  return { ok: true, results };
}
