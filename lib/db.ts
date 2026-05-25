import { Pool } from 'pg';

/**
 * Two-pool architecture:
 *
 *   sourceDb  — read-only against the operational LabStack DB.
 *               Holds Lab/Provider/Order/Profile + all mv_* analytics views.
 *               Env: SOURCE_DATABASE_URL (or legacy DATABASE_URL).
 *
 *   appDb     — read/write against Atlas's own DB (lives in the docker container).
 *               Holds atlas.users, sessions, audit_log, user_preferences,
 *               pincode_directory.
 *               Env: APP_DATABASE_URL (falls back to SOURCE_DATABASE_URL for
 *               legacy single-DB dev setups so localhost-only devs keep working).
 *
 * Helpers:
 *   query()    → sourceDb (default — used by every analytics query)
 *   appQuery() → appDb     (used by lib/auth.ts and anything writing atlas.*)
 */

const SOURCE_URL = process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL;
const APP_URL    = process.env.APP_DATABASE_URL    ?? SOURCE_URL;

if (!SOURCE_URL) {
  // Surface a loud error at boot rather than the inscrutable "self signed cert"
  // or "ECONNREFUSED" we'd otherwise get when the first query fires.
  throw new Error('SOURCE_DATABASE_URL (or DATABASE_URL) must be set.');
}

const globalForPg = global as unknown as { sourcePgPool?: Pool; appPgPool?: Pool };

export const sourceDb =
  globalForPg.sourcePgPool ??
  new Pool({ connectionString: SOURCE_URL, max: 10, idleTimeoutMillis: 30_000 });

export const appDb =
  globalForPg.appPgPool ??
  new Pool({ connectionString: APP_URL, max: 5, idleTimeoutMillis: 30_000 });

if (process.env.NODE_ENV !== 'production') {
  globalForPg.sourcePgPool = sourceDb;
  globalForPg.appPgPool = appDb;
}

// Legacy export — call sites that imported `pool` directly default to source.
export const pool = sourceDb;

// ---- Source-DB helpers (analytics) ----------------------------------------
export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res = await sourceDb.query(text, params);
  return res.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

// ---- App-DB helpers (atlas state) -----------------------------------------
export async function appQuery<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res = await appDb.query(text, params);
  return res.rows as T[];
}

export async function appQueryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await appQuery<T>(text, params);
  return rows[0] ?? null;
}
