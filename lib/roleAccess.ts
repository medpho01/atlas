import 'server-only';
import { query } from './db';
import {
  setCapabilityOverrides, ACTIVE_ROLES, LEGACY_ROLES, FEATURE_LABEL,
  type Capability, type Feature, type Role,
} from './access';

/**
 * The feature × role matrix, loaded from atlas.role_feature and handed to
 * lib/access.ts.
 *
 * Cached in the module, refreshed on a short interval and bumped the moment
 * somebody saves. It has to be a cache: capability() is called synchronously
 * from forty places including client components, and making it async would be
 * a refactor of the whole application to change one admin screen.
 *
 * Thirty seconds is the window in which a revoked screen stays reachable in an
 * already-running process. A save bumps every process that handles the next
 * request, and the person whose access changed will have been told.
 */
const TTL_MS = 30_000;
let loadedAt = 0;
let inflight: Promise<void> | null = null;

async function load(): Promise<void> {
  const rows = await query<{ role: string; feature: string; capability: Capability }>(
    `SELECT role, feature, capability FROM atlas.role_feature`,
  );
  const map: Record<string, Capability> = {};
  for (const r of rows) map[`${r.role}:${r.feature}`] = r.capability;
  setCapabilityOverrides(map);
  loadedAt = Date.now();
}

/**
 * Make sure the overrides are current. Awaited once per request by the page
 * guard; everything downstream of it stays synchronous.
 *
 * Never throws. A database that cannot answer leaves the compiled matrix in
 * place, which is strictly the safer failure: the rules that shipped with the
 * code, not an empty table that would open or close everything at once.
 */
export async function ensureRoleAccess(): Promise<void> {
  if (Date.now() - loadedAt < TTL_MS) return;
  if (!inflight) {
    inflight = load().catch(() => { /* keep the compiled matrix */ })
      .finally(() => { inflight = null; });
  }
  await inflight;
}

/** Force the next read to go to the database — called after a save. */
export function invalidateRoleAccess(): void {
  loadedAt = 0;
}

export type MatrixRow = { feature: Feature; label: string; caps: Record<Role, Capability> };

/** Every role, in the order the settings screen shows them. */
export const MATRIX_ROLES: Role[] = [...ACTIVE_ROLES, ...LEGACY_ROLES];

/**
 * The matrix as the settings screen renders it: the stored row where there is
 * one, the compiled default where there is not, so the grid never shows a
 * blank for a feature a deploy has just added.
 */
export async function getRoleMatrix(): Promise<MatrixRow[]> {
  await ensureRoleAccess();
  const { capability } = await import('./access');
  return (Object.keys(FEATURE_LABEL) as Feature[]).map((feature) => ({
    feature,
    label: FEATURE_LABEL[feature],
    caps: Object.fromEntries(
      MATRIX_ROLES.map((role) => [role, capability({ role }, feature)]),
    ) as Record<Role, Capability>,
  }));
}
