import 'server-only';
import { unstable_cache } from 'next/cache';
import { query, queryOne } from './db';

/**
 * Public, customer-facing network data.
 *
 * Scope: ONLY Center Visit and Home Sample Collection for LAB and HOSPITAL kinds.
 * Hard rule: never expose internal metrics here. No revenue, no cancel rate, no
 * quality scores, no internal IDs. Just "what services where, by name/city/distance".
 *
 * Center-visit reach is computed via analytics.mv_pincode_cv_reach, which
 * pre-computes haversine distances up to 20 km. The visible radius is applied
 * at query time and varies by city tier, so it can be tuned without rebuilding
 * the MV.
 */

// One catchment radius, 10 km, everywhere.
//
// Overridable with CV_REACH_RADIUS_KM, but the default is the number the page
// states. Widening from 5km buys roughly a quarter more reach; the ceiling is
// how many pincodes have real coordinates, not how far the circle is drawn.
const CV_RADIUS_KM = Number(process.env.CV_REACH_RADIUS_KM ?? 10);

export const CV_RADIUS = CV_RADIUS_KM;

export type NetworkStats = {
  pincodes_covered: number;
  india_pincodes: number;

  home_sample_pincodes: number;
  home_sample_labs: number;

  center_visit_pincodes: number;
  center_visit_centres: number;
  center_visit_labs: number;
  center_visit_hospitals: number;

  distinct_labs: number;
  distinct_cities: number;
};

async function networkStats(): Promise<NetworkStats> {
  // One row, precomputed nightly by analytics.mv_public_network_summary. This
  // used to derive tier-aware reach on the request and took over a second on a
  // small database; caching only moved the cost onto whoever arrived first.
  const row = await queryOne<NetworkStats>(
    `SELECT pincodes_covered, india_pincodes,
            home_sample_pincodes, home_sample_labs,
            center_visit_pincodes, center_visit_centres,
            center_visit_labs, center_visit_hospitals,
            distinct_labs, distinct_cities
     FROM analytics.mv_public_network_summary`,
  );
  return row ?? {
    pincodes_covered: 0, india_pincodes: 0,
    home_sample_pincodes: 0, home_sample_labs: 0,
    center_visit_pincodes: 0, center_visit_centres: 0,
    center_visit_labs: 0, center_visit_hospitals: 0,
    distinct_labs: 0, distinct_cities: 0,
  };
}

/**
 * Field-staff strength, for the phlebo and nurse cards.
 *
 * Reads the same rosters the internal /phlebos and /nurses pages use, not
 * mv_provider_unified — the provider MV only carries the handful that are
 * modelled as providers, which understates the roster by orders of magnitude.
 * Counts only: no names, no phone numbers.
 */
export type StaffStrength = {
  people: number;
  pincodes: number;
  cities: number;
  top_cities: { city: string; people: number }[];
};

async function staffStrength(view: 'phlebos_all' | 'nurses_all'): Promise<StaffStrength | null> {
  // The roster views are built by the phlebo/nurse derivation jobs. If one has
  // not been built in this environment, hide the card rather than publishing
  // "0 phlebos" — a confident zero is worse than an absent section. Loud on
  // the server log so a genuinely broken roster is not silently cosmetic.
  try {
    const totals = await queryOne<{ people: number; pincodes: number; cities: number }>(`
      SELECT COUNT(*)::int AS people,
             COUNT(DISTINCT pincode)::int AS pincodes,
             (COUNT(DISTINCT lower(TRIM(city))) FILTER (WHERE city IS NOT NULL AND TRIM(city) <> ''))::int AS cities
      FROM atlas.${view}
    `);
    const top = await query<{ city: string; people: number }>(`
      SELECT TRIM(city) AS city, COUNT(*)::int AS people
      FROM atlas.${view}
      WHERE city IS NOT NULL AND TRIM(city) <> ''
      GROUP BY TRIM(city)
      ORDER BY people DESC
      LIMIT 5
    `);
    if (!totals?.people) return null;
    return {
      people: totals.people,
      pincodes: totals.pincodes ?? 0,
      cities: totals.cities ?? 0,
      top_cities: top,
    };
  } catch (e) {
    console.error(`[network] atlas.${view} unavailable — hiding that card:`, (e as Error).message);
    return null;
  }
}

/**
 * The page is force-dynamic (it needs the session to decide its chrome), which
 * overrides `revalidate` — so before this every single visitor recomputed all
 * four queries against the reach MV, and concurrent visitors piled onto the
 * database. The underlying data changes once a night, so it is cached here
 * instead, independently of how the page itself renders.
 */
const CACHE_TTL_SECONDS = 300;
const cached = <T>(key: string, fn: () => Promise<T>) =>
  unstable_cache(fn, ['public-network', key], { revalidate: CACHE_TTL_SECONDS });

export const getNetworkStats    = cached('stats',   networkStats);
export const getMapPoints       = cached('points',  mapPoints);
export const getPhleboStrength  = cached('phlebos', () => staffStrength('phlebos_all'));
export const getNurseStrength   = cached('nurses',  () => staffStrength('nurses_all'));

export type NetworkMapPoint = {
  pincode: string;
  latitude: number;
  longitude: number;
  cv: number;            // centres reachable via centre visit within the tiered radius
  hs: number;            // labs serving this pincode via home sample
};

async function mapPoints(): Promise<NetworkMapPoint[]> {
  return query<NetworkMapPoint>(
    `SELECT pincode, latitude, longitude, cv, hs
     FROM analytics.mv_public_network_pincode`,
  );
}

export type PincodeLab = {
  name: string;
  kind: 'LAB' | 'HOSPITAL';
  city: string | null;
  state: string | null;
  modalities: string[];        // subset of ['CENTER_VISIT', 'HOME_SAMPLE']
  distance_km?: number | null; // present only for center-visit results from neighbour pincodes
};

export type PincodeLookup = {
  pincode: string;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  center_visit: PincodeLab[];
  home_sample: PincodeLab[];
  found: boolean;
  cv_radius_km: number;        // the radius that actually applied to this pincode
};

/**
 * Look up labs serving a specific pincode for CV or HS.
 * - CV: labs/hospitals within the tier-aware radius of $1, nearest first.
 * - HS: labs with $1 in their pincodesServiced and homeCollection=true.
 *
 * Returns name + kind + city + distance only. No IDs, no revenue, no quality.
 */
export async function getPincodeNetwork(pincode: string): Promise<PincodeLookup> {
  if (!/^\d{6}$/.test(pincode)) {
    return {
      pincode, city: null, state: null, latitude: null, longitude: null,
      center_visit: [], home_sample: [], found: false,
      cv_radius_km: CV_RADIUS_KM,
    };
  }

  const meta = await queryOne<{ city: string | null; state: string | null; latitude: number | null; longitude: number | null }>(`
    SELECT c.city, c.state, g.latitude, g.longitude
    FROM analytics.mv_pincode_geo g
    LEFT JOIN analytics.mv_pincode_city c ON c.pincode = g.pincode
    WHERE g.pincode = $1
  `, [pincode]);

  // Center visit — include nearby centres ordered by distance.
  // Deduplicate by entity_id in case the MV ever produces multiples per centre.
  const cv = await query<PincodeLab & { radius_km: number }>(`
    SELECT DISTINCT ON (r.entity_id)
      r.name,
      r.kind,
      r.city,
      r.state,
      ARRAY['CENTER_VISIT']::text[] AS modalities,
      r.distance_km::float8 AS distance_km,
      $2::float8 AS radius_km
    FROM analytics.mv_pincode_cv_reach r
    WHERE r.covered_pincode = $1
      AND r.distance_km <= $2::numeric
    ORDER BY r.entity_id, r.distance_km
  `, [pincode, CV_RADIUS_KM]);

  // Re-sort by distance after the DISTINCT ON dedup (DISTINCT ON requires its
  // ORDER BY to start with the distinct key).
  cv.sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));

  const hs = await query<PincodeLab>(`
    SELECT DISTINCT
      name,
      kind,
      city,
      state,
      modalities
    FROM analytics.mv_provider_unified
    WHERE serviced_pincodes IS NOT NULL
      AND $1 = ANY(serviced_pincodes)
      AND kind IN ('LAB','HOSPITAL')
      AND 'HOME_SAMPLE' = ANY(modalities)
      AND active = true
    ORDER BY name
    LIMIT 50
  `, [pincode]);

  return {
    pincode,
    city: meta?.city ?? null,
    state: meta?.state ?? null,
    latitude: meta?.latitude ?? null,
    longitude: meta?.longitude ?? null,
    center_visit: cv.slice(0, 50),
    home_sample: hs,
    found: cv.length > 0 || hs.length > 0,
    cv_radius_km: CV_RADIUS_KM,
  };
}
