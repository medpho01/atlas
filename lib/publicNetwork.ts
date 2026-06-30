import 'server-only';
import { query, queryOne } from './db';

/**
 * Public, customer-facing network data.
 *
 * Scope: ONLY Center Visit and Home Sample Collection for LAB and HOSPITAL kinds.
 * Hard rule: never expose internal metrics here. No revenue, no cancel rate, no
 * quality scores, no internal IDs. Just "what services where, by name/city/distance".
 *
 * Center-visit reach is computed via analytics.mv_pincode_cv_reach which
 * pre-computes haversine distances. CV_REACH_RADIUS_KM controls the radius
 * used at query time (default 10 km). The MV stores up to 20 km, so we can
 * tune the visible radius without re-building it.
 */

// Configurable via env. Default 10 km matches Practo/Tata 1mg-style "lab near you" reach.
const CV_REACH_RADIUS_KM = Number(process.env.CV_REACH_RADIUS_KM ?? 10);

export type NetworkStats = {
  pincodes_covered: number;
  center_visit_pincodes: number;
  home_sample_pincodes: number;
  distinct_labs: number;
  distinct_cities: number;
};

export async function getNetworkStats(): Promise<NetworkStats> {
  const row = await queryOne<NetworkStats>(`
    WITH cv AS (
      -- Center visit = a lab/hospital with centerVisit=true is within CV_REACH_RADIUS_KM
      -- of the pincode. Uses the precomputed haversine MV.
      SELECT DISTINCT covered_pincode AS pincode
      FROM analytics.mv_pincode_cv_reach
      WHERE distance_km <= $1
    ),
    hs AS (
      SELECT DISTINCT pincode FROM analytics.mv_pincode_coverage
      WHERE kind IN ('LAB','HOSPITAL') AND modality = 'HOME_SAMPLE' AND providers > 0
    ),
    any_lab AS (
      SELECT pincode FROM cv UNION SELECT pincode FROM hs
    )
    SELECT
      (SELECT COUNT(*) FROM any_lab)                                                  AS pincodes_covered,
      (SELECT COUNT(*) FROM cv)                                                        AS center_visit_pincodes,
      (SELECT COUNT(*) FROM hs)                                                        AS home_sample_pincodes,
      (SELECT COUNT(DISTINCT entity_id) FROM analytics.mv_provider_unified
        WHERE kind IN ('LAB','HOSPITAL')
          AND (modalities @> ARRAY['CENTER_VISIT']::text[]
            OR modalities @> ARRAY['HOME_SAMPLE']::text[]))                            AS distinct_labs,
      (SELECT COUNT(DISTINCT city) FROM analytics.mv_provider_unified
        WHERE kind IN ('LAB','HOSPITAL') AND city IS NOT NULL AND TRIM(city) <> '')   AS distinct_cities;
  `, [CV_REACH_RADIUS_KM]);
  return row ?? {
    pincodes_covered: 0, center_visit_pincodes: 0, home_sample_pincodes: 0,
    distinct_labs: 0, distinct_cities: 0,
  };
}

export type NetworkMapPoint = {
  pincode: string;
  latitude: number;
  longitude: number;
  cv: number;            // labs reachable via center visit within CV_REACH_RADIUS_KM
  hs: number;            // labs serving this pincode via home sample
};

export async function getMapPoints(): Promise<NetworkMapPoint[]> {
  return query<NetworkMapPoint>(`
    WITH cv_count AS (
      SELECT covered_pincode AS pincode, COUNT(DISTINCT entity_id)::int AS cv
      FROM analytics.mv_pincode_cv_reach
      WHERE distance_km <= $1
      GROUP BY covered_pincode
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
  `, [CV_REACH_RADIUS_KM]);
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
  cv_radius_km: number;        // exposed so the UI can label "within X km"
};

/**
 * Look up labs serving a specific pincode for CV or HS.
 * - CV: labs/hospitals whose physical pincode is within CV_REACH_RADIUS_KM of $1.
 *       Ordered by distance, so the nearest lab appears first.
 * - HS: labs with $1 in their pincodesServiced and homeCollection=true.
 *
 * Returns name + kind + city + distance only. No IDs, no revenue, no quality.
 */
export async function getPincodeNetwork(pincode: string): Promise<PincodeLookup> {
  if (!/^\d{6}$/.test(pincode)) {
    return {
      pincode, city: null, state: null, latitude: null, longitude: null,
      center_visit: [], home_sample: [], found: false,
      cv_radius_km: CV_REACH_RADIUS_KM,
    };
  }

  const meta = await queryOne<{ city: string | null; state: string | null; latitude: number | null; longitude: number | null }>(`
    SELECT c.city, c.state, g.latitude, g.longitude
    FROM analytics.mv_pincode_geo g
    LEFT JOIN analytics.mv_pincode_city c ON c.pincode = g.pincode
    WHERE g.pincode = $1
  `, [pincode]);

  // Center visit — include nearby labs ordered by distance.
  // Deduplicate by entity_id in case the MV ever produces multiples per lab.
  const cv = await query<PincodeLab>(`
    SELECT DISTINCT ON (entity_id)
      name,
      kind,
      city,
      state,
      ARRAY['CENTER_VISIT']::text[] AS modalities,
      distance_km::float8 AS distance_km
    FROM analytics.mv_pincode_cv_reach
    WHERE covered_pincode = $1
      AND distance_km <= $2
    ORDER BY entity_id, distance_km
  `, [pincode, CV_REACH_RADIUS_KM]);

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
    cv_radius_km: CV_REACH_RADIUS_KM,
  };
}
