// Server-side auth helpers.
// - Passwords hashed with bcryptjs (pure JS, no native build issues in Alpine).
// - Sessions stored in atlas.sessions, keyed by a 32-byte random session id.
// - Cookie name: atlas_session. httpOnly + sameSite=lax. Secure flag set in prod.
//
// Usage:
//   const user = await getSessionUser();  // server component / action
//   if (!user) redirect('/login');
//
// All functions here must run on the server.

import 'server-only';
import bcrypt from 'bcryptjs';
import { cookies, headers } from 'next/headers';
import crypto from 'node:crypto';
import { appQuery, appQueryOne } from './db';
import { SESSION_COOKIE, SESSION_TTL_DAYS } from './authConstants';

export { SESSION_COOKIE, SESSION_TTL_DAYS };

export type User = {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
};

// ---- Password ----------------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ---- Sessions ----------------------------------------------------------------

function newSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Verify an email/password pair. Returns the user on success, null on failure. */
export async function authenticate(email: string, password: string): Promise<User | null> {
  const row = await appQueryOne<{ id: number; email: string; name: string; role: User['role']; password_hash: string; active: boolean }>(
    `SELECT id, email, name, role, password_hash, active
       FROM atlas.users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email],
  );
  if (!row || !row.active) return null;
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return null;
  // Touch last_login_at
  await appQuery(`UPDATE atlas.users SET last_login_at = now() WHERE id = $1`, [row.id]);
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/** Create a server-side session and set the httpOnly cookie. */
export async function createSession(userId: number): Promise<string> {
  const sid = newSessionId();
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const h = headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || null;
  const ua = h.get('user-agent') ?? null;
  await appQuery(
    `INSERT INTO atlas.sessions (session_id, user_id, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [sid, userId, expires.toISOString(), ip, ua],
  );
  cookies().set(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires,
  });
  return sid;
}

/** Read the cookie, look up the session, return the user. Touches last_seen_at. */
export async function getSessionUser(): Promise<User | null> {
  const sid = cookies().get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const row = await appQueryOne<{ id: number; email: string; name: string; role: User['role'] }>(
    `SELECT u.id, u.email, u.name, u.role
       FROM atlas.sessions s JOIN atlas.users u ON u.id = s.user_id
      WHERE s.session_id = $1 AND s.expires_at > now() AND u.active = true
      LIMIT 1`,
    [sid],
  );
  if (!row) return null;
  // Best-effort touch; don't block the request if it fails.
  appQuery(`UPDATE atlas.sessions SET last_seen_at = now() WHERE session_id = $1`, [sid]).catch(() => {});
  return row;
}

/** Destroy the current session (logout). */
export async function destroySession(): Promise<void> {
  const sid = cookies().get(SESSION_COOKIE)?.value;
  if (sid) {
    await appQuery(`DELETE FROM atlas.sessions WHERE session_id = $1`, [sid]);
  }
  cookies().delete(SESSION_COOKIE);
}

/** Append an audit row. Fire-and-forget; never throws. */
export function audit(userId: number | null, path: string, action = 'view'): void {
  const h = headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || null;
  const ua = h.get('user-agent') ?? null;
  appQuery(
    `INSERT INTO atlas.audit_log (user_id, path, action, ip, user_agent) VALUES ($1, $2, $3, $4, $5)`,
    [userId, path, action, ip, ua],
  ).catch(() => {});
}
