import 'server-only';
import { query, queryOne } from './db';

/**
 * Public, customer-facing network data.
 *
 * Scope: ONLY Center Visit and Home Sample Collection for LAB and HOSPITAL kinds.
 * Hard rule: never expose internal metrics here. No revenue, no cancel rate, no
 * quality scores, no internal IDs. Just "what services where, by name/city".
 */

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
      SELECT DISTINCT pincode FROM analytics.mv_pincode_coverage
      WHERE kind IN ('LAB','HOSPITAL') AND modality = 'CENTER_VISIT' AND providers > 0
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
  `);
  return row ?? {
    pincodes_covered: 0, center_visit_pincodes: 0, home_sample_pincodes: 0,
    distinct_labs: 0, distinct_cities: 0,
  };
}

export type NetworkMapPoint = {
  pincode: string;
  latitude: number;
  longitude: number;
  cv: number;            // labs providing center visit at this pincode
  hs: number;            // labs serving this pincode via home sample
};

export async function getMapPoints(): Promise<NetworkMapPoint[]> {
  return query<NetworkMapPoint>(`
    SELECT
      g.pincode,
      g.latitude,
      g.longitude,
      COALESCE(cv.providers, 0)::int AS cv,
      COALESCE(hs.providers, 0)::int AS hs
    FROM analytics.mv_pincode_geo g
    LEFT JOIN analytics.mv_pincode_coverage cv
      ON cv.pincode = g.pincode
      AND cv.kind IN ('LAB','HOSPITAL')
      AND cv.modality = 'CENTER_VISIT'
    LEFT JOIN analytics.mv_pincode_coverage hs
      ON hs.pincode = g.pincode
      AND hs.kind IN ('LAB','HOSPITAL')
      AND hs.modality = 'HOME_SAMPLE'
    WHERE g.latitude IS NOT NULL
      AND g.geo_source IN ('exact','prefix3')   -- skip coarse prefix2 to keep map clean
      AND (COALESCE(cv.providers, 0) > 0 OR COALESCE(hs.providers, 0) > 0)
  `);
}

export type PincodeLab = {
  name: string;
  kind: 'LAB' | 'HOSPITAL';
  city: string | null;
  state: string | null;
  modalities: string[];   // subset of ['CENTER_VISIT', 'HOME_SAMPLE']
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
};

/**
 * Look up labs serving a specific pincode for CV or HS.
 * - CV: lab.pincode = $1 AND 'CENTER_VISIT' in modalities
 * - HS: $1 in lab.serviced_pincodes AND 'HOME_SAMPLE' in modalities
 *
 * Returns name + kind + city only — nothing that could identify a customer
 * relationship or internal metric.
 */
export async function getPincodeNetwork(pincode: string): Promise<PincodeLookup> {
  if (!/^\d{6}$/.test(pincode)) {
    return { pincode, city: null, state: null, latitude: null, longitude: null,
             center_visit: [], home_sample: [], found: false };
  }

  // City/state + coordinates in a single round-trip
  const meta = await queryOne<{ city: string | null; state: string | null; latitude: number | null; longitude: number | null }>(`
    SELECT
      c.city,
      c.state,
      g.latitude,
      g.longitude
    FROM analytics.mv_pincode_geo g
    LEFT JOIN analytics.mv_pincode_city c ON c.pincode = g.pincode
    WHERE g.pincode = $1
  `, [pincode]);

  const cv = await query<PincodeLab>(`
    SELECT DISTINCT
      name,
      kind,
      city,
      state,
      modalities
    FROM analytics.mv_provider_unified
    WHERE pincode = $1
      AND kind IN ('LAB','HOSPITAL')
      AND 'CENTER_VISIT' = ANY(modalities)
      AND active = true
    ORDER BY name
    LIMIT 50
  `, [pincode]);

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
    center_visit: cv,
    home_sample: hs,
    found: cv.length > 0 || hs.length > 0,
  };
}
