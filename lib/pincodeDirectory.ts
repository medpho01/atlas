import 'server-only';
import { appQuery } from './db';

/**
 * In-memory mirror of atlas.pincode_directory.
 *
 * Previously the India Post directory was JOIN'd into mv_pincode_city directly
 * in the source DB. Once we split the DBs (source = LabStack operational,
 * app = Atlas-owned in the Docker container), that join can't span databases,
 * so we do the enrichment in Node.
 *
 * Cost: ~19,300 small rows ≈ 2 MB of heap. Lookups are O(1) via a Map.
 * Lifecycle: lazy-loaded on first call, cached for the process lifetime.
 * Refresh: call `refreshPincodeDirectory()` (e.g. from a scheduled job) to
 * pick up India Post updates without restarting the app.
 */

export type PincodeGeo = {
  city: string | null;
  state: string | null;
};

type Cache = {
  loadedAt: number;
  map: Map<string, PincodeGeo>;
};

let cache: Cache | null = null;
let loading: Promise<Cache> | null = null;

async function loadCache(): Promise<Cache> {
  const rows = await appQuery<{ pincode: string; city: string | null; state: string | null }>(
    `SELECT pincode, city, state FROM atlas.pincode_directory`,
  );
  const map = new Map<string, PincodeGeo>();
  for (const r of rows) {
    map.set(r.pincode, { city: r.city, state: r.state });
  }
  return { loadedAt: Date.now(), map };
}

/** Returns the cache, loading it on the first call. Safe for concurrent callers. */
async function getCache(): Promise<Cache> {
  if (cache) return cache;
  if (!loading) loading = loadCache().then((c) => (cache = c));
  return loading;
}

/** Force a re-read on next access. Call from a scheduled job after CSV updates. */
export function refreshPincodeDirectory(): void {
  cache = null;
  loading = null;
}

/** Look up a single pincode. null when not in the directory (rare: ~1% of valid pincodes). */
export async function lookupPincode(pincode: string): Promise<PincodeGeo | null> {
  const c = await getCache();
  return c.map.get(pincode) ?? null;
}

/**
 * Mutate-in-place enrichment for a list of rows that came back from the source
 * DB. Rows that already have a non-null `city` are left alone — local data
 * wins. Otherwise we fill from the directory.
 *
 *   const rows = await query(`SELECT pincode, city, state FROM mv_pincode_city ...`);
 *   await enrichRowsWithCity(rows);
 */
export async function enrichRowsWithCity<T extends { pincode: string; city?: string | null; state?: string | null }>(
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const c = await getCache();
  for (const r of rows) {
    const hasCity = r.city != null && r.city !== '';
    const hasState = r.state != null && r.state !== '';
    if (hasCity && hasState) continue;
    const ref = c.map.get(r.pincode);
    if (!ref) continue;
    if (!hasCity)  r.city  = ref.city;
    if (!hasState) r.state = ref.state;
  }
  return rows;
}

/**
 * Lookup map for callers that want to do their own JOIN — e.g. when the column
 * names differ or the row shape is custom.
 */
export async function getPincodeCityMap(): Promise<ReadonlyMap<string, PincodeGeo>> {
  const c = await getCache();
  return c.map;
}
