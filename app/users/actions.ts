'use server';

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
