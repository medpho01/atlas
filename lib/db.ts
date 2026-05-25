import { Pool } from 'pg';

/**
 * Single-pool architecture.
 *
 * Atlas talks to ONE Postgres: atlas-db (in the docker container, env var
 * APP_DATABASE_URL). atlas-db contains three schemas:
 *
 *   atlas      — our writable state (users, sessions, audit_log, prefs,
 *                pincode_directory). Read/write here.
 *   analytics  — materialized views (mv_pincode_summary, mv_pincode_city,
 *                mv_unified_demand, etc.). Read-only at the app layer;
 *                refreshed by a scheduled job.
 *   src        — postgres_fdw foreign tables mirroring the operational
 *                LabStack DB ("Lab", "Provider", "Order", "Profile", ...).
 *                Atlas reads from these transparently; the actual rows live
 *                in the source DB, which is never written to.
 *
 * The DB has search_path = analytics, atlas, src, public set, so unqualified
 * names like `mv_pincode_summary` or `"Lab"` resolve correctly without the
 * app having to schema-qualify every query.
 *
 * Legacy helpers `appQuery` / `appQueryOne` and the named pools `sourceDb` /
 * `appDb` are kept as aliases so no call site needs to change.
 */

const URL =
  process.env.APP_DATABASE_URL ??
  process.env.DATABASE_URL ??
  process.env.SOURCE_DATABASE_URL; // legacy single-DB dev fallback

if (!URL) {
  throw new Error(
    'APP_DATABASE_URL must be set (it points at atlas-db). ' +
      'SOURCE_DATABASE_URL is used only by atlas-db init for FDW.',
  );
}

const globalForPg = global as unknown as { pgPool?: Pool };

export const pool =
  globalForPg.pgPool ??
  new Pool({ connectionString: URL, max: 10, idleTimeoutMillis: 30_000 });

if (process.env.NODE_ENV !== 'production') {
  globalForPg.pgPool = pool;
}

// Aliases kept for the legacy two-pool API. They all point at the same pool.
export const sourceDb = pool;
export const appDb = pool;

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function appQuery<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function appQueryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await appQuery<T>(text, params);
  return rows[0] ?? null;
}
