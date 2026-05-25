import { query, queryOne } from './db';

// ----------------------------------------------------------------------------
// Home Dashboard
// ----------------------------------------------------------------------------

export type NetworkKpis = {
  active_pincodes: number;
  well_served: number;
  at_risk: number;
  demand_no_supply: number;
  pincodes_with_orders_l30d: number;
  pipeline_count: number;
};

export async function getNetworkKpis(): Promise<NetworkKpis> {
  // Migrated to use mv_pincode_coverage (kind × modality model) instead of the
  // legacy network_strength column. "Total providers" = SUM across (kind, modality)
  // tuples per pincode, de-duped via DISTINCT entity_ids.
  const row = await queryOne<NetworkKpis>(`
    WITH pin_provider_counts AS (
      SELECT pincode, SUM(providers)::int AS total_providers
      FROM mv_pincode_coverage
      GROUP BY pincode
    ),
    pin_demand AS (
      SELECT pincode, orders_l30d, orders_l90d FROM mv_pincode_summary
    ),
    joined AS (
      SELECT
        COALESCE(c.pincode, d.pincode) AS pincode,
        COALESCE(c.total_providers, 0) AS total_providers,
        COALESCE(d.orders_l30d, 0) AS orders_l30d,
        COALESCE(d.orders_l90d, 0) AS orders_l90d
      FROM pin_provider_counts c
      FULL OUTER JOIN pin_demand d ON d.pincode = c.pincode
    )
    SELECT
      COUNT(*) FILTER (WHERE total_providers > 0)::int AS active_pincodes,
      COUNT(*) FILTER (WHERE total_providers >= 5)::int AS well_served,
      COUNT(*) FILTER (WHERE total_providers = 1)::int AS at_risk,
      COUNT(*) FILTER (WHERE total_providers = 0 AND orders_l90d > 0)::int AS demand_no_supply,
      COUNT(*) FILTER (WHERE orders_l30d > 0)::int AS pincodes_with_orders_l30d,
      0::int AS pipeline_count
    FROM joined
  `);
  return row as NetworkKpis;
}

export type CityRow = {
  city: string;
  active_pincodes: number;
  providers_total: number;
  labs_total: number;
  pharmacies_total: number;
  orders_l30d: number;
  orders_l90d: number;
  orders_all_time: number;
  well_served: number;
  single_provider: number;
  demand_no_supply: number;
};

export async function getCityLeaderboard(limit = 15): Promise<CityRow[]> {
  return query<CityRow>(`
    SELECT * FROM mv_city_rollup
    WHERE city IS NOT NULL AND TRIM(city) <> ''
    ORDER BY orders_all_time DESC NULLS LAST
    LIMIT $1
  `, [limit]);
}

export type MapPoint = {
  pincode: string;
  latitude: number;
  longitude: number;
  network_strength: number;
  orders_l30d: number;
  orders_l90d: number;
  orders_all_time: number;
  coverage_bucket: string;
  gap_score: number;
  geo_source: 'exact' | 'prefix3' | 'prefix2' | 'none';
};

export async function getMapPoints(opts: { minOrders?: number; minStrength?: number } = {}): Promise<MapPoint[]> {
  const minOrders = opts.minOrders ?? 0;
  const minStrength = opts.minStrength ?? 1;
  // Use mv_pincode_geo for the (possibly inferred) coordinates so we don't lose
  // ~5,300 pincodes that lack exact geocoding. The `geo_source` column lets the
  // UI render inferred points more subtly.
  return query<MapPoint>(`
    SELECT s.pincode, g.latitude, g.longitude, s.network_strength, s.orders_l30d, s.orders_l90d, s.orders_all_time, s.coverage_bucket, s.gap_score, g.geo_source
    FROM mv_pincode_summary s
    JOIN mv_pincode_geo g ON g.pincode = s.pincode
    WHERE g.latitude IS NOT NULL
      AND g.longitude IS NOT NULL
      AND (s.orders_all_time >= $1 OR s.network_strength >= $2)
    LIMIT 8000
  `, [minOrders, minStrength]);
}

// Returns map-related counts so the UI can communicate "X of Y plotted, of which N exact"
export async function getMapCoverage(): Promise<{ plotted: number; active_total: number; exact_count: number; inferred: number; unmappable: number }> {
  const row = await queryOne<{ plotted: number; active_total: number; exact_count: number; inferred: number; unmappable: number }>(`
    WITH active AS (SELECT pincode FROM mv_pincode_summary WHERE network_strength > 0)
    SELECT
      (SELECT COUNT(*)::int FROM active a JOIN mv_pincode_geo g ON g.pincode = a.pincode WHERE g.geo_source <> 'none') AS plotted,
      (SELECT COUNT(*)::int FROM active) AS active_total,
      (SELECT COUNT(*)::int FROM active a JOIN mv_pincode_geo g ON g.pincode = a.pincode WHERE g.geo_source = 'exact') AS exact_count,
      (SELECT COUNT(*)::int FROM active a JOIN mv_pincode_geo g ON g.pincode = a.pincode WHERE g.geo_source IN ('prefix3','prefix2')) AS inferred,
      (SELECT COUNT(*)::int FROM active a JOIN mv_pincode_geo g ON g.pincode = a.pincode WHERE g.geo_source = 'none') AS unmappable
  `);
  return row as any;
}

// ----------------------------------------------------------------------------
// Pincode Explorer
// ----------------------------------------------------------------------------

export type PincodeSummary = {
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  labs_local: number;
  labs_serviced: number;
  doctors: number;
  phlebos: number;
  nurses: number;
  providers_total: number;
  pharmacies: number;
  orders_all_time: number;
  orders_l30d: number;
  orders_l90d: number;
  orders_l365d: number;
  home_sample: number;
  camp: number;
  center_visit: number;
  requests_l90d: number;
  unserviceable_requests: number;
  conversion_pct: number;
  network_strength: number;
  coverage_bucket: string;
  gap_score: number;
};

export async function getPincodeSummary(pincode: string): Promise<PincodeSummary | null> {
  return queryOne<PincodeSummary>(`SELECT * FROM mv_pincode_summary WHERE pincode = $1`, [pincode]);
}

export async function getPincodeCity(pincode: string): Promise<{ city: string | null; state: string | null }> {
  // Two-step lookup since pincode_directory now lives in the app DB:
  //   1. mv_pincode_city — derived from Lab/Provider/Profile (source DB)
  //   2. atlas.pincode_directory — India Post backfill (app DB), via in-memory cache
  const row = await queryOne<{ city: string | null; state: string | null }>(
    `SELECT city, state FROM mv_pincode_city WHERE pincode = $1`,
    [pincode],
  );
  if (row?.city) return row;
  const { lookupPincode } = await import('./pincodeDirectory');
  const ref = await lookupPincode(pincode);
  return ref ?? row ?? { city: null, state: null };
}

export type ProviderRow = {
  id: number;
  name: string;
  type_name: string;
  mobile: string | null;
  email: string | null;
  is_verified: boolean;
  pincode: string | null;
  city: string | null;
};

export async function getProvidersInPincode(pincode: string): Promise<ProviderRow[]> {
  return query<ProviderRow>(`
    SELECT p.id, p.name, pt."typeName" AS type_name, p.mobile, p.email, p."isVerified" AS is_verified, p.pincode, p.city
    FROM "Provider" p
    JOIN "ProviderType" pt ON pt.id = p."typeId"
    WHERE p.pincode = $1
    ORDER BY pt."typeName", p.name
  `, [pincode]);
}

export type LabRow = {
  id: number;
  lab_name: string;
  chain_name: string | null;
  city: string | null;
  pincode: string | null;
  active: boolean | null;
  home_collection: boolean | null;
  orders_total: number;
  orders_l30d: number;
  cancel_pct: number | null;
  delivered_pct: number | null;
  health_score: number;
};

export async function getLabsServingPincode(pincode: string): Promise<LabRow[]> {
  return query<LabRow>(`
    SELECT
      l.id, l."labName" AS lab_name, c."chainName" AS chain_name,
      l.city, l.pincode, l.active, l."homeCollection" AS home_collection,
      h.orders_total, h.orders_l30d, h.cancel_pct, h.delivered_pct, h.health_score
    FROM "Lab" l
    LEFT JOIN "Chain" c ON c.id = l.chain_id
    LEFT JOIN mv_lab_health h ON h.lab_id = l.id
    WHERE l.pincode = $1
       OR $1 = ANY(l."pincodesServiced")
    ORDER BY h.health_score DESC NULLS LAST, h.orders_total DESC NULLS LAST
  `, [pincode]);
}

export type NearbyPincode = {
  pincode: string;
  distance_km: number;
  network_strength: number;
  orders_l30d: number;
};

export async function getNearbyPincodes(pincode: string, radiusKm = 5): Promise<NearbyPincode[]> {
  // Haversine in km. Bbox-filtered to India so Singapore-pointers don't pollute.
  // Origin coords come from mv_pincode_geo, which unions PincodeToLatLong with
  // atlas.pincode_directory — so nearby search now works for ~6× more pincodes.
  return query<NearbyPincode>(`
    WITH origin AS (
      SELECT latitude, longitude FROM mv_pincode_geo
      WHERE pincode = $1
        AND geo_source = 'exact'           -- only run nearby search from anchored pincodes
        AND latitude BETWEEN 6 AND 38
        AND longitude BETWEEN 67 AND 98
    )
    SELECT
      s.pincode,
      ROUND(
        (6371 * acos(
          GREATEST(-1, LEAST(1,
            cos(radians(o.latitude)) * cos(radians(s.latitude)) *
            cos(radians(s.longitude) - radians(o.longitude)) +
            sin(radians(o.latitude)) * sin(radians(s.latitude))
          ))
        ))::numeric, 2
      ) AS distance_km,
      s.network_strength,
      s.orders_l30d
    FROM origin o, mv_pincode_summary s
    WHERE s.pincode <> $1
      AND s.latitude BETWEEN 6 AND 38
      AND s.longitude BETWEEN 67 AND 98
      AND (6371 * acos(
        GREATEST(-1, LEAST(1,
          cos(radians(o.latitude)) * cos(radians(s.latitude)) *
          cos(radians(s.longitude) - radians(o.longitude)) +
          sin(radians(o.latitude)) * sin(radians(s.latitude))
        ))
      )) <= $2
    ORDER BY distance_km ASC
    LIMIT 12
  `, [pincode, radiusKm]);
}

// Demand vs supply funnel (all L90D-scoped)
export async function getPincodeFunnel(pincode: string) {
  return queryOne<{
    requests: number;
    serviceable: number;
    converted: number;
    delivered: number;
  }>(`
    SELECT
      COALESCE(r.requests_l90d, 0) AS requests,
      COALESCE(r.serviceable_l90d, 0) AS serviceable,
      COALESCE(r.converted_l90d, 0) AS converted,
      COALESCE(s.orders_l90d, 0) AS delivered
    FROM mv_pincode_summary s
    LEFT JOIN mv_pincode_requests r ON r.pincode = s.pincode
    WHERE s.pincode = $1
  `, [pincode]);
}

// ----------------------------------------------------------------------------
// Directory
// ----------------------------------------------------------------------------

export async function listLabs(opts: { centerType?: string; city?: string; search?: string; limit?: number; offset?: number } = {}) {
  const conds: string[] = ['1=1'];
  const params: any[] = [];
  if (opts.centerType) { params.push(opts.centerType); conds.push(`l."centerType"::text = $${params.length}`); }
  if (opts.city) { params.push(opts.city); conds.push(`l.city = $${params.length}`); }
  if (opts.search) { params.push(`%${opts.search}%`); conds.push(`(l."labName" ILIKE $${params.length} OR l.pincode = $${params.length} OR l.city ILIKE $${params.length})`); }
  params.push(opts.limit ?? 50);
  params.push(opts.offset ?? 0);
  return query(`
    SELECT
      l.id, l."labName" AS lab_name, l.city, l.pincode, l.active, l."mouEndDate" AS mou_end_date,
      l."centerType"::text AS center_type,
      l."centerVisit" AS center_visit, l."homeCollection" AS home_collection,
      c."chainName" AS chain_name,
      COALESCE(array_length(l."pincodesServiced", 1), 0) AS pincodes_serviced_count,
      COALESCE(h.orders_total, 0) AS orders_total,
      COALESCE(h.orders_l30d, 0) AS orders_l30d,
      COALESCE(h.health_score, 50) AS health_score,
      COALESCE(h.cancel_pct, 0) AS cancel_pct
    FROM "Lab" l
    LEFT JOIN "Chain" c ON c.id = l.chain_id
    LEFT JOIN mv_lab_health h ON h.lab_id = l.id
    WHERE ${conds.join(' AND ')}
    ORDER BY h.orders_total DESC NULLS LAST, l."labName"
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);
}

export async function listProviders(opts: { type?: string; city?: string; search?: string; limit?: number; offset?: number } = {}) {
  const conds: string[] = ['1=1'];
  const params: any[] = [];
  if (opts.type) { params.push(opts.type); conds.push(`pt."typeName" = $${params.length}`); }
  if (opts.city) { params.push(opts.city); conds.push(`p.city = $${params.length}`); }
  if (opts.search) { params.push(`%${opts.search}%`); conds.push(`(p.name ILIKE $${params.length} OR p.pincode = $${params.length} OR p.city ILIKE $${params.length})`); }
  params.push(opts.limit ?? 50);
  params.push(opts.offset ?? 0);
  return query(`
    SELECT p.id, p.name, p.mobile, p.email, p.pincode, p.city, p."isVerified" AS is_verified,
           pt."typeName" AS type_name
    FROM "Provider" p
    JOIN "ProviderType" pt ON pt.id = p."typeId"
    WHERE ${conds.join(' AND ')}
    ORDER BY p.name
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);
}

export async function getDataQualityNudges() {
  return queryOne<{
    labs_missing_service_area: number;
    labs_mass_claim: number;
    labs_inactive_but_referenced: number;
    providers_missing_pincode: number;
    bad_format_pincodes: number;
    pharmacies_missing_pincode: number;
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM "Lab" WHERE active AND COALESCE(array_length("pincodesServiced", 1), 0) = 0) AS labs_missing_service_area,
      (SELECT COUNT(*)::int FROM "Lab" WHERE active AND array_length("pincodesServiced", 1) > 500) AS labs_mass_claim,
      (SELECT COUNT(*)::int FROM "Lab" WHERE active IS FALSE) AS labs_inactive_but_referenced,
      (SELECT COUNT(*)::int FROM "Provider" WHERE pincode IS NULL OR pincode = '') AS providers_missing_pincode,
      (SELECT COUNT(*)::int FROM "Lab" WHERE pincode IS NOT NULL AND pincode !~ '^[0-9]{6}$')
        + (SELECT COUNT(*)::int FROM "Profile" WHERE pincode IS NOT NULL AND pincode <> '' AND pincode !~ '^[0-9]{6}$')
        + (SELECT COUNT(*)::int FROM "Request" WHERE pincode IS NOT NULL AND pincode <> '' AND pincode !~ '^[0-9]{6}$') AS bad_format_pincodes,
      (SELECT COUNT(*)::int FROM "Pharmacy" WHERE pincode IS NULL OR pincode = '') AS pharmacies_missing_pincode
  `);
}

export async function listCities() {
  return query<{ city: string }>(`
    SELECT DISTINCT city FROM mv_city_rollup
    WHERE city IS NOT NULL AND TRIM(city) <> ''
    ORDER BY city
  `);
}

// ----------------------------------------------------------------------------
// Gap Scorer
// ----------------------------------------------------------------------------

export type GapRow = {
  pincode: string;
  city: string | null;
  network_strength: number;
  labs_local: number;
  providers_total: number;
  orders_l30d: number;
  orders_l90d: number;
  requests_l90d: number;
  unserviceable_requests: number;
  gap_score: number;
};

export async function getGapQueue(limit = 50): Promise<GapRow[]> {
  return query<GapRow>(`
    WITH pincode_city AS (
      SELECT pincode, city, ROW_NUMBER() OVER (PARTITION BY pincode ORDER BY n DESC) AS rn
      FROM (
        SELECT pincode, city, COUNT(*) AS n FROM "Lab" WHERE pincode IS NOT NULL AND city IS NOT NULL GROUP BY pincode, city
        UNION ALL
        SELECT pincode, city, COUNT(*) FROM "Provider" WHERE pincode IS NOT NULL AND city IS NOT NULL GROUP BY pincode, city
        UNION ALL
        SELECT pincode, city, COUNT(*) FROM "Profile" WHERE pincode IS NOT NULL AND city IS NOT NULL AND city <> '' GROUP BY pincode, city
      ) x
    )
    SELECT
      s.pincode,
      pc.city,
      s.network_strength,
      s.labs_local,
      s.providers_total,
      s.orders_l30d,
      s.orders_l90d,
      s.requests_l90d,
      s.unserviceable_requests,
      s.gap_score
    FROM mv_pincode_summary s
    LEFT JOIN pincode_city pc ON pc.pincode = s.pincode AND pc.rn = 1
    WHERE s.orders_l90d > 0 OR s.unserviceable_requests > 0
    ORDER BY s.gap_score DESC, s.orders_l90d DESC
    LIMIT $1
  `, [limit]);
}

// ----------------------------------------------------------------------------
// Quality
// ----------------------------------------------------------------------------

export async function getQualityList(opts: { health?: 'green'|'amber'|'red'|'all'; city?: string; limit?: number } = {}) {
  const params: any[] = [];
  const conds: string[] = ['orders_total > 0'];
  if (opts.health === 'green') conds.push('health_score_v2 >= 75');
  else if (opts.health === 'amber') conds.push('health_score_v2 BETWEEN 50 AND 74');
  else if (opts.health === 'red') conds.push('health_score_v2 < 50');
  if (opts.city) { params.push(opts.city); conds.push(`city = $${params.length}`); }
  params.push(opts.limit ?? 100);
  return query(`
    SELECT lab_id, lab_name, chain_name, city, pincode, orders_total, orders_l30d,
           cancel_pct, delivered_pct, avg_tat_hours, median_tat_hours,
           repeat_rate_pct, repeat_users, unique_users,
           health_score_v2 AS health_score
    FROM mv_lab_quality_v2
    WHERE ${conds.join(' AND ')}
    ORDER BY orders_total DESC NULLS LAST
    LIMIT $${params.length}
  `, params);
}

export async function getChainList() {
  return query(`
    SELECT chain_id, chain_name, total_branches, distinct_cities, distinct_pincodes,
           home_sample_pincodes_served, orders_total, orders_l30d, orders_l90d,
           weighted_cancel_pct, weighted_delivered_pct, weighted_avg_tat_hours,
           chain_repeat_rate_pct, weighted_health_score
    FROM mv_chain_summary
    WHERE chain_name IS NOT NULL
    ORDER BY orders_total DESC NULLS LAST
  `);
}

export async function getChainDetail(chainId: number) {
  return queryOne(`
    SELECT * FROM mv_chain_summary WHERE chain_id = $1
  `, [chainId]);
}

export async function getChainBranches(chainId: number) {
  return query(`
    SELECT lab_id, lab_name, city, pincode, center_type, active,
           orders_total, orders_l30d, cancel_pct, delivered_pct, avg_tat_hours,
           repeat_rate_pct, health_score_v2 AS health_score
    FROM mv_lab_quality_v2
    WHERE chain_id = $1
    ORDER BY orders_total DESC NULLS LAST
  `, [chainId]);
}

// ----------------------------------------------------------------------------
// Public Check
// ----------------------------------------------------------------------------

export async function publicCheckPincode(pincode: string) {
  return queryOne(`
    SELECT
      s.pincode,
      s.labs_local + s.labs_serviced AS labs_count,
      s.doctors,
      s.phlebos,
      s.providers_total,
      s.pharmacies,
      s.orders_all_time
    FROM mv_pincode_summary s
    WHERE s.pincode = $1
  `, [pincode]);
}

export async function getPlatformStats() {
  return queryOne<{ labs: number; pincodes: number; chains: number; providers: number }>(`
    SELECT
      (SELECT COUNT(*) FROM "Lab")::int AS labs,
      (SELECT COUNT(DISTINCT pincode) FROM mv_pincode_summary WHERE network_strength > 0)::int AS pincodes,
      (SELECT COUNT(*) FROM "Chain")::int AS chains,
      (SELECT COUNT(*) FROM "Provider")::int AS providers
  `);
}
