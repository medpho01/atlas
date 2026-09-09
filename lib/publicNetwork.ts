import 'server-only';
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

// Centre-visit catchment is a travel-time judgement, not a distance one. In a
// metro, 10 km of traffic is not a trip anyone makes for a blood test, so the
// radius tightens to 5 km; outside the metros roads are quicker and 10 km is
// a normal catchment. Tier comes from atlas.city_tier, which Atlas already
// classifies — 'Tier 1' is the metro set. Anything unclassified is treated as
// non-metro, which is the honest default: we would rather understate a metro's
// reach than claim a lab serves somewhere nobody would travel from.
const METRO_RADIUS_KM     = Number(process.env.CV_METRO_RADIUS_KM ?? 5);
const NON_METRO_RADIUS_KM = Number(process.env.CV_REACH_RADIUS_KM ?? 10);

/**
 * Centre-visit reach with the tier-aware radius applied.
 *
 * Tier is taken from the CENTRE's city rather than the covered pincode's: the
 * MV carries it, and a pincode within a few km of a metro lab is part of that
 * metro's travel problem whether or not its own city string says so.
 *
 * $1 = metro radius, $2 = non-metro radius. Callers that need extra columns
 * select them from `r`.
 */
const CV_REACH_SQL = `
  SELECT r.*
  FROM analytics.mv_pincode_cv_reach r
  LEFT JOIN atlas.city_tier ct ON ct.city_key = atlas.city_key(r.city)
  WHERE r.distance_km <= CASE WHEN ct.tier = 'Tier 1' THEN $1::numeric ELSE $2::numeric END
`;

const RADII: [number, number] = [METRO_RADIUS_KM, NON_METRO_RADIUS_KM];

export const CV_RADII = { metro: METRO_RADIUS_KM, nonMetro: NON_METRO_RADIUS_KM };

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

export async function getNetworkStats(): Promise<NetworkStats> {
  const row = await queryOne<NetworkStats>(`
    WITH cv AS (${CV_REACH_SQL}),
    cv_pin AS (SELECT DISTINCT covered_pincode AS pincode FROM cv),
    hs AS (
      SELECT DISTINCT pincode FROM analytics.mv_pincode_coverage
      WHERE kind IN ('LAB','HOSPITAL') AND modality = 'HOME_SAMPLE' AND providers > 0
    ),
    any_lab AS (SELECT pincode FROM cv_pin UNION SELECT pincode FROM hs)
    SELECT
      (SELECT COUNT(*) FROM any_lab)::int                                   AS pincodes_covered,
      -- All of India, not just the pincodes we geocode: mv_pincode_geo is
      -- filtered down to what the network touches, so it would flatter the
      -- percentage badly. pincode_directory is the full postal list.
      (SELECT COUNT(DISTINCT pincode) FROM atlas.pincode_directory)::int    AS india_pincodes,

      (SELECT COUNT(*) FROM hs)::int                                        AS home_sample_pincodes,
      (SELECT COUNT(DISTINCT entity_id) FROM analytics.mv_provider_unified
        WHERE kind IN ('LAB','HOSPITAL')
          AND modalities @> ARRAY['HOME_SAMPLE']::text[])::int              AS home_sample_labs,

      (SELECT COUNT(*) FROM cv_pin)::int                                    AS center_visit_pincodes,
      (SELECT COUNT(DISTINCT entity_id) FROM cv)::int                       AS center_visit_centres,
      (SELECT COUNT(DISTINCT entity_id) FROM cv WHERE kind = 'LAB')::int    AS center_visit_labs,
      (SELECT COUNT(DISTINCT entity_id) FROM cv WHERE kind = 'HOSPITAL')::int AS center_visit_hospitals,

      (SELECT COUNT(DISTINCT entity_id) FROM analytics.mv_provider_unified
        WHERE kind IN ('LAB','HOSPITAL')
          AND (modalities @> ARRAY['CENTER_VISIT']::text[]
            OR modalities @> ARRAY['HOME_SAMPLE']::text[]))::int            AS distinct_labs,
      (SELECT COUNT(DISTINCT city) FROM analytics.mv_provider_unified
        WHERE kind IN ('LAB','HOSPITAL') AND city IS NOT NULL AND TRIM(city) <> '')::int AS distinct_cities;
  `, RADII);
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

export const getPhleboStrength = () => staffStrength('phlebos_all');
export const getNurseStrength  = () => staffStrength('nurses_all');

export type NetworkMapPoint = {
  pincode: string;
  latitude: number;
  longitude: number;
  cv: number;            // centres reachable via centre visit within the tiered radius
  hs: number;            // labs serving this pincode via home sample
};

export async function getMapPoints(): Promise<NetworkMapPoint[]> {
  return query<NetworkMapPoint>(`
    WITH cv AS (${CV_REACH_SQL}),
    cv_count AS (
      SELECT covered_pincode AS pincode, COUNT(DISTINCT entity_id)::int AS cv
      FROM cv GROUP BY covered_pincode
    )
    SELECT
      g.pincode,
      g.latitude,
      g.longitude,
      COALESCE(cv.cv, 0)::int AS cv,
      COALESCE(hs.providers, 0)::int AS hs
    FROM analytics.mv_pincode_geo g
    LEFT JOIN cv_count cv ON cv.pincode = g.pincode
    LEFT JOIN analytics.mv_pincode_coverage hs
      ON hs.pincode = g.pincode
      AND hs.kind IN ('LAB','HOSPITAL')
      AND hs.modality = 'HOME_SAMPLE'
    WHERE g.latitude IS NOT NULL
      AND g.geo_source IN ('exact','prefix3')
      AND (COALESCE(cv.cv, 0) > 0 OR COALESCE(hs.providers, 0) > 0)
  `, RADII);
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
      cv_radius_km: NON_METRO_RADIUS_KM,
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
      (CASE WHEN ct.tier = 'Tier 1' THEN $2::numeric ELSE $3::numeric END)::float8 AS radius_km
    FROM analytics.mv_pincode_cv_reach r
    LEFT JOIN atlas.city_tier ct ON ct.city_key = atlas.city_key(r.city)
    WHERE r.covered_pincode = $1
      AND r.distance_km <= CASE WHEN ct.tier = 'Tier 1' THEN $2::numeric ELSE $3::numeric END
    ORDER BY r.entity_id, r.distance_km
  `, [pincode, METRO_RADIUS_KM, NON_METRO_RADIUS_KM]);

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
    // Whichever radius the matched centres were judged against; falls back to
    // the metro radius when nothing matched, since that is the stricter claim.
    cv_radius_km: cv[0]?.radius_km ?? METRO_RADIUS_KM,
  };
}
