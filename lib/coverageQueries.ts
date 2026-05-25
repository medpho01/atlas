import { query, queryOne } from './db';
import { lensToServiceLines, type ProviderKind, type Modality } from './coverage';

// ----------------------------------------------------------------------------
// City Leaderboard — Orders mode OR Coverage mode (filtered by kind × modality)
// ----------------------------------------------------------------------------

export type LeaderboardRow = {
  city: string;
  orders_all_time: number;
  orders_l30d: number;
  covered_pincodes: number;
  well_served_pincodes: number;
  total_providers: number;
  total_chains: number;            // Distinct chain count — surfaces chain-concentration risk
  top_chain_share_pct: number;     // % of providers from biggest chain
  total_active_pincodes: number;
  chain_breakdown: { name: string; branches: number; pct: number }[];
  pincode_samples: { pincode: string; providers: number }[];
};

export async function getLeaderboard(opts: {
  mode: 'ORDERS' | 'COVERAGE';
  kinds?: ProviderKind[] | 'ANY';
  modality?: Modality | 'ANY';
  limit?: number;
}): Promise<LeaderboardRow[]> {
  const kindsFilter: ProviderKind[] | null =
    opts.kinds && opts.kinds !== 'ANY' && opts.kinds.length > 0 ? opts.kinds : null;
  const modalityFilter = opts.modality && opts.modality !== 'ANY' ? opts.modality : null;
  const limit = opts.limit ?? 12;
  // Service lines that correspond to the lens — used to filter the Orders leaderboard
  // so "All Labs — Center Visit" shows LAB_CENTER_VISIT orders, not platform-wide totals.
  const serviceLines = lensToServiceLines(
    kindsFilter ?? 'ANY',
    modalityFilter ?? 'ANY'
  );

  // Stash on the result so the caller can build platform-total Share% — see getPlatformLeaderboardTotal.
  void serviceLines;

  // For specific (kind, modality), only one row matches per city in mv_city_coverage
  // and SUMming is identical to selecting that row. For ANY lens, SUMming double-counts
  // pincodes covered by multiple (kind, modality) tuples and providers offering multiple
  // modalities. We compute DISTINCT counts from the underlying expansion in that case.

  if (!kindsFilter && !modalityFilter) {
    // ANY-lens path: distinct counts from base data
    return query<LeaderboardRow>(`
      WITH city_pin_coverage AS (
        SELECT pc.city, cov.pincode, SUM(cov.providers)::int AS providers_any
        FROM mv_pincode_coverage cov
        JOIN mv_pincode_city pc ON pc.pincode = cov.pincode
        GROUP BY pc.city, cov.pincode
      ),
      coverage_slice AS (
        SELECT city,
          COUNT(*) FILTER (WHERE providers_any >= 1)::int AS covered_pincodes,
          COUNT(*) FILTER (WHERE providers_any >= 3)::int AS well_served_pincodes,
          0::int AS total_active_pincodes
        FROM city_pin_coverage
        WHERE city IS NOT NULL AND TRIM(city) <> ''
        GROUP BY city
      ),
      city_providers AS (
        SELECT DISTINCT pc.city, p.entity_id, p.chain_id
        FROM mv_provider_unified p JOIN mv_pincode_city pc ON pc.pincode = p.pincode
        WHERE p.active
        UNION
        SELECT DISTINCT pc.city, p.entity_id, p.chain_id
        FROM mv_provider_unified p
        CROSS JOIN LATERAL unnest(COALESCE(p.serviced_pincodes, ARRAY[]::text[])) sp
        JOIN mv_pincode_city pc ON pc.pincode = sp
        WHERE p.active AND 'HOME_SAMPLE' = ANY(p.modalities)
      ),
      chain_counts AS (
        SELECT city, chain_id, COUNT(*)::int AS branches FROM city_providers GROUP BY city, chain_id
      ),
      providers_slice AS (
        SELECT city, COUNT(*)::int AS total_providers,
          COUNT(DISTINCT chain_id) FILTER (WHERE chain_id IS NOT NULL)::int AS total_chains,
          SUM(branches)::int AS total_branches_keyed
        FROM (
          SELECT city, chain_id, COUNT(*)::int AS branches FROM city_providers GROUP BY city, chain_id
        ) x GROUP BY city
      ),
      top_chain_slice AS (
        SELECT city, MAX(branches) AS top_branches
        FROM chain_counts WHERE chain_id IS NOT NULL GROUP BY city
      ),
      chain_breakdown AS (
        SELECT
          cc.city,
          jsonb_agg(
            jsonb_build_object(
              'name', COALESCE(ch."chainName", '— Independent —'),
              'branches', cc.branches,
              'pct', ROUND(100.0 * cc.branches / NULLIF((SELECT SUM(branches) FROM chain_counts WHERE city = cc.city), 0))::int
            ) ORDER BY cc.branches DESC
          ) FILTER (WHERE cc.branches > 0) AS breakdown
        FROM chain_counts cc LEFT JOIN "Chain" ch ON ch.id = cc.chain_id
        GROUP BY cc.city
      ),
      pincode_samples AS (
        SELECT city,
          jsonb_agg(
            jsonb_build_object('pincode', pincode, 'providers', providers_any) ORDER BY providers_any DESC
          ) FILTER (WHERE providers_any > 0) AS samples
        FROM (
          SELECT city, pincode, providers_any,
            ROW_NUMBER() OVER (PARTITION BY city ORDER BY providers_any DESC) AS rn
          FROM city_pin_coverage
        ) x WHERE rn <= 8 GROUP BY city
      ),
      orders_slice AS (
        -- Service-line aware: if $2 is null, count ALL events; otherwise filter
        SELECT pc.city,
          COUNT(*)::int AS orders_all_time,
          COUNT(*) FILTER (WHERE d.created_at >= NOW() - INTERVAL '30 days')::int AS orders_l30d
        FROM mv_unified_demand d
        JOIN mv_pincode_city pc ON pc.pincode = d.pincode
        WHERE $2::text[] IS NULL OR d.service_line = ANY($2::text[])
        GROUP BY pc.city
      )
      SELECT
        COALESCE(cs.city, ps.city, os.city) AS city,
        COALESCE(os.orders_all_time, 0) AS orders_all_time,
        COALESCE(os.orders_l30d, 0) AS orders_l30d,
        COALESCE(cs.covered_pincodes, 0) AS covered_pincodes,
        COALESCE(cs.well_served_pincodes, 0) AS well_served_pincodes,
        COALESCE(ps.total_providers, 0) AS total_providers,
        COALESCE(ps.total_chains, 0) AS total_chains,
        CASE WHEN ps.total_providers > 0 AND tc.top_branches IS NOT NULL
          THEN ROUND(100.0 * tc.top_branches / ps.total_providers)::int
          ELSE 0 END AS top_chain_share_pct,
        COALESCE(cs.total_active_pincodes, 0) AS total_active_pincodes,
        COALESCE(cb.breakdown, '[]'::jsonb) AS chain_breakdown,
        COALESCE(pp.samples, '[]'::jsonb) AS pincode_samples
      FROM coverage_slice cs
      FULL OUTER JOIN providers_slice ps ON ps.city = cs.city
      LEFT JOIN top_chain_slice tc ON tc.city = COALESCE(cs.city, ps.city)
      LEFT JOIN chain_breakdown cb ON cb.city = COALESCE(cs.city, ps.city)
      LEFT JOIN pincode_samples pp ON pp.city = COALESCE(cs.city, ps.city)
      FULL OUTER JOIN orders_slice os ON os.city = COALESCE(cs.city, ps.city)
      WHERE COALESCE(cs.city, ps.city, os.city) IS NOT NULL
      ORDER BY ${opts.mode === 'COVERAGE' ? 'covered_pincodes DESC NULLS LAST, total_providers DESC NULLS LAST' : 'orders_all_time DESC NULLS LAST'}
      LIMIT $1
    `, [limit, serviceLines]);
  }

  // Specific-lens path. For combined lenses (kinds = multiple), we use ARRAY-aware filters
  // and DISTINCT entity_ids / DISTINCT pincodes to avoid the double-counting bug across kinds.
  // $4 = service_lines filter so the Orders column matches the lens (e.g. "All Labs — Center
  // Visit" surfaces LAB_CENTER_VISIT orders only, not platform-wide totals).
  const params: any[] = [kindsFilter, modalityFilter ?? null, limit, serviceLines];
  return query<LeaderboardRow>(`
    WITH coverage_slice AS (
      -- Pincode-level distinct counts across the slice (multiple kinds: a pincode covered
      -- by Diag AND Coll counts once)
      SELECT pc.city,
        COUNT(DISTINCT cov.pincode)::int AS covered_pincodes,
        COUNT(DISTINCT cov.pincode) FILTER (WHERE pin_total.providers >= 3)::int AS well_served_pincodes,
        0::int AS total_providers,    -- replaced below by sliced provider count
        0::int AS total_active_pincodes
      FROM mv_pincode_coverage cov
      JOIN mv_pincode_city pc ON pc.pincode = cov.pincode
      JOIN LATERAL (
        SELECT SUM(c2.providers)::int AS providers FROM mv_pincode_coverage c2
        WHERE c2.pincode = cov.pincode
          AND ($1::text[] IS NULL OR c2.kind = ANY($1::text[]))
          AND ($2::text IS NULL OR c2.modality = $2)
      ) pin_total ON true
      WHERE cov.providers > 0
        AND ($1::text[] IS NULL OR cov.kind = ANY($1::text[]))
        AND ($2::text IS NULL OR cov.modality = $2)
        AND pc.city IS NOT NULL AND TRIM(pc.city) <> ''
      GROUP BY pc.city
    ),
    sliced_providers AS (
      SELECT DISTINCT pc.city, p.entity_id, p.chain_id
      FROM mv_provider_unified p JOIN mv_pincode_city pc ON pc.pincode = p.pincode
      WHERE p.active
        AND ($1::text[] IS NULL OR p.kind = ANY($1::text[]))
        AND ($2::text IS NULL OR $2 = ANY(p.modalities))
      UNION
      SELECT DISTINCT pc.city, p.entity_id, p.chain_id
      FROM mv_provider_unified p
      CROSS JOIN LATERAL unnest(COALESCE(p.serviced_pincodes, ARRAY[]::text[])) sp
      JOIN mv_pincode_city pc ON pc.pincode = sp
      WHERE p.active AND 'HOME_SAMPLE' = ANY(p.modalities) AND $2 = 'HOME_SAMPLE'
        AND ($1::text[] IS NULL OR p.kind = ANY($1::text[]))
    ),
    providers_count AS (
      SELECT city, COUNT(*)::int AS total_providers FROM sliced_providers GROUP BY city
    ),
    chain_counts AS (
      SELECT city, chain_id, COUNT(*)::int AS branches FROM sliced_providers GROUP BY city, chain_id
    ),
    chain_slice AS (
      SELECT city,
        COUNT(DISTINCT chain_id) FILTER (WHERE chain_id IS NOT NULL)::int AS total_chains,
        MAX(branches) FILTER (WHERE chain_id IS NOT NULL)::int AS top_branches,
        SUM(branches)::int AS total_branches
      FROM chain_counts GROUP BY city
    ),
    chain_breakdown AS (
      SELECT cc.city,
        jsonb_agg(
          jsonb_build_object(
            'name', COALESCE(ch."chainName", '— Independent —'),
            'branches', cc.branches,
            'pct', ROUND(100.0 * cc.branches / NULLIF((SELECT SUM(branches) FROM chain_counts WHERE city = cc.city), 0))::int
          ) ORDER BY cc.branches DESC
        ) AS breakdown
      FROM chain_counts cc LEFT JOIN "Chain" ch ON ch.id = cc.chain_id
      GROUP BY cc.city
    ),
    pincode_samples AS (
      -- Aggregate distinct pincode totals across the slice, then take top 8 per city
      SELECT city,
        jsonb_agg(
          jsonb_build_object('pincode', pincode, 'providers', providers) ORDER BY providers DESC
        ) AS samples
      FROM (
        SELECT pc.city, cov.pincode, SUM(cov.providers)::int AS providers,
          ROW_NUMBER() OVER (PARTITION BY pc.city ORDER BY SUM(cov.providers) DESC) AS rn
        FROM mv_pincode_coverage cov JOIN mv_pincode_city pc ON pc.pincode = cov.pincode
        WHERE cov.providers > 0
          AND ($1::text[] IS NULL OR cov.kind = ANY($1::text[]))
          AND ($2::text IS NULL OR cov.modality = $2)
        GROUP BY pc.city, cov.pincode
      ) x
      WHERE rn <= 8
      GROUP BY city
    ),
    orders_slice AS (
      -- Service-line aware Orders: matches the lens
      SELECT pc.city,
        COUNT(*)::int AS orders_all_time,
        COUNT(*) FILTER (WHERE d.created_at >= NOW() - INTERVAL '30 days')::int AS orders_l30d
      FROM mv_unified_demand d
      JOIN mv_pincode_city pc ON pc.pincode = d.pincode
      WHERE $4::text[] IS NULL OR d.service_line = ANY($4::text[])
      GROUP BY pc.city
    )
    SELECT
      COALESCE(cs.city, os.city) AS city,
      COALESCE(os.orders_all_time, 0) AS orders_all_time,
      COALESCE(os.orders_l30d, 0) AS orders_l30d,
      COALESCE(cs.covered_pincodes, 0) AS covered_pincodes,
      COALESCE(cs.well_served_pincodes, 0) AS well_served_pincodes,
      COALESCE(pc2.total_providers, 0) AS total_providers,
      COALESCE(ch.total_chains, 0) AS total_chains,
      CASE WHEN ch.total_branches > 0 AND ch.top_branches IS NOT NULL
        THEN ROUND(100.0 * ch.top_branches / ch.total_branches)::int
        ELSE 0 END AS top_chain_share_pct,
      COALESCE(cs.total_active_pincodes, 0) AS total_active_pincodes,
      COALESCE(cb.breakdown, '[]'::jsonb) AS chain_breakdown,
      COALESCE(pp.samples, '[]'::jsonb) AS pincode_samples
    FROM coverage_slice cs
    LEFT JOIN providers_count pc2 ON pc2.city = cs.city
    LEFT JOIN chain_slice ch ON ch.city = cs.city
    LEFT JOIN chain_breakdown cb ON cb.city = cs.city
    LEFT JOIN pincode_samples pp ON pp.city = cs.city
    FULL OUTER JOIN orders_slice os ON os.city = cs.city
    ORDER BY ${opts.mode === 'COVERAGE' ? 'covered_pincodes DESC NULLS LAST, total_providers DESC NULLS LAST' : 'orders_all_time DESC NULLS LAST'}
    LIMIT $3
  `, params);
}

// ----------------------------------------------------------------------------
// Platform-wide total used as the Share% denominator on the leaderboard.
//   Orders mode: total unified-demand events matching the lens.
//   Coverage mode: total distinct pincodes nationally matching the lens.
// ----------------------------------------------------------------------------

export async function getPlatformLeaderboardTotal(opts: {
  mode: 'ORDERS' | 'COVERAGE';
  kinds?: ProviderKind[] | 'ANY';
  modality?: Modality | 'ANY';
}): Promise<number> {
  const kindsFilter = opts.kinds && opts.kinds !== 'ANY' && opts.kinds.length > 0 ? opts.kinds : null;
  const modalityFilter = opts.modality && opts.modality !== 'ANY' ? opts.modality : null;

  if (opts.mode === 'ORDERS') {
    const serviceLines = lensToServiceLines(kindsFilter ?? 'ANY', modalityFilter ?? 'ANY');
    const row = await queryOne<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM mv_unified_demand
       WHERE $1::text[] IS NULL OR service_line = ANY($1::text[])`,
      [serviceLines]
    );
    return row?.total ?? 0;
  }

  // COVERAGE — count distinct pincodes nationally for the lens slice
  const row = await queryOne<{ total: number }>(
    `SELECT COUNT(DISTINCT pincode)::int AS total
     FROM mv_pincode_coverage
     WHERE providers > 0
       AND ($1::text[] IS NULL OR kind = ANY($1::text[]))
       AND ($2::text IS NULL OR modality = $2)`,
    [kindsFilter, modalityFilter]
  );
  return row?.total ?? 0;
}

// ----------------------------------------------------------------------------
// Pincode coverage matrix (in-pincode counts, no radius)
// ----------------------------------------------------------------------------

export type CoverageCell = {
  kind: ProviderKind;
  modality: Modality;
  providers: number;
  local_providers: number;
  serviced_providers: number;
};

export async function getPincodeCoverageMatrix(pincode: string): Promise<CoverageCell[]> {
  return query<CoverageCell>(`
    SELECT kind, modality, providers, local_providers, serviced_providers
    FROM mv_pincode_coverage
    WHERE pincode = $1
  `, [pincode]);
}

// ----------------------------------------------------------------------------
// Pincode coverage WITH radius — live query against mv_provider_unified
// ----------------------------------------------------------------------------

export type CoverageCellRadius = {
  kind: ProviderKind;
  modality: Modality;
  in_pincode: number;
  within_radius: number;
  verified_within_radius: number;  // Excludes mass-claim labs (≥500 pincodes serviced)
  nearest_km: number | null;
};

// Mass-claim threshold: labs declaring more than this many pincodes are treated as
// "unverified" for HOME_SAMPLE coverage. Source-data finding from the audit.
export const MASS_CLAIM_THRESHOLD = 500;

/**
 * Coverage for a pincode counting providers either:
 *   (a) located in this pincode, OR
 *   (b) within radiusKm of the pincode centroid (Haversine), OR
 *   (c) serving this pincode via `pincodesServiced` (HOME_SAMPLE only).
 *
 * Radius is user-controlled from UI; default 5km.
 */
export async function getPincodeCoverageWithRadius(pincode: string, radiusKm: number): Promise<CoverageCellRadius[]> {
  return query<CoverageCellRadius>(`
    WITH origin AS (
      -- Bbox filter origin to India (lat 6-38, lng 67-98) so Singapore-pointing rows don't poison the radius
      SELECT latitude AS lat, longitude AS lng
      FROM "PincodeToLatLong"
      WHERE pincode = $1
        AND latitude BETWEEN 6 AND 38
        AND longitude BETWEEN 67 AND 98
    ),
    capabilities AS (
      SELECT DISTINCT kind, m::text AS modality
      FROM mv_provider_unified p, unnest(p.modalities) m
      WHERE p.active
    ),
    expanded AS (
      -- Each provider × modality, with distance from origin (if both have India-valid lat/lng)
      SELECT
        p.entity_id,
        p.kind,
        m::text AS modality,
        p.pincode AS provider_pincode,
        p.latitude,
        p.longitude,
        CASE
          WHEN p.latitude BETWEEN 6 AND 38
            AND p.longitude BETWEEN 67 AND 98
            AND o.lat IS NOT NULL AND o.lng IS NOT NULL THEN
            6371 * acos(
              GREATEST(-1, LEAST(1,
                cos(radians(o.lat)) * cos(radians(p.latitude)) *
                cos(radians(p.longitude) - radians(o.lng)) +
                sin(radians(o.lat)) * sin(radians(p.latitude))
              ))
            )
          ELSE NULL
        END AS distance_km,
        p.serviced_pincodes
      FROM mv_provider_unified p, unnest(p.modalities) m, origin o
      WHERE p.active
    ),
    flagged AS (
      SELECT
        kind,
        modality,
        entity_id,
        (provider_pincode = $1) AS is_local,
        (distance_km IS NOT NULL AND distance_km <= $2) AS within_radius,
        (modality = 'HOME_SAMPLE' AND serviced_pincodes IS NOT NULL AND $1 = ANY(serviced_pincodes)) AS via_serviced,
        -- "Verified": exclude HOME_SAMPLE coverage that comes ONLY from mass-claim labs
        -- (those declaring more than threshold pincodes serviced). Lab still counts if
        -- it's local-in-pincode or within radius — only the wide service-area claim is suspect.
        (modality = 'HOME_SAMPLE'
          AND serviced_pincodes IS NOT NULL
          AND $1 = ANY(serviced_pincodes)
          AND COALESCE(array_length(serviced_pincodes, 1), 0) > $3) AS only_via_mass_claim,
        distance_km
      FROM expanded
    )
    SELECT
      c.kind,
      c.modality,
      COALESCE(COUNT(DISTINCT f.entity_id) FILTER (WHERE f.is_local), 0)::int AS in_pincode,
      COALESCE(COUNT(DISTINCT f.entity_id) FILTER (WHERE f.is_local OR f.within_radius OR f.via_serviced), 0)::int AS within_radius,
      COALESCE(COUNT(DISTINCT f.entity_id) FILTER (
        WHERE (f.is_local OR f.within_radius OR f.via_serviced)
          AND NOT (f.only_via_mass_claim AND NOT f.is_local AND NOT f.within_radius)
      ), 0)::int AS verified_within_radius,
      MIN(f.distance_km) FILTER (WHERE f.distance_km IS NOT NULL) AS nearest_km
    FROM capabilities c
    LEFT JOIN flagged f ON f.kind = c.kind AND f.modality = c.modality
    GROUP BY c.kind, c.modality
    ORDER BY c.kind, c.modality
  `, [pincode, radiusKm, MASS_CLAIM_THRESHOLD]);
}

// ----------------------------------------------------------------------------
// List providers covering this pincode for a specific (kind, modality), with radius
// ----------------------------------------------------------------------------

export async function getProvidersCoveringPincode(
  pincode: string,
  kind: ProviderKind,
  modality: Modality,
  radiusKm: number
) {
  return query(`
    WITH origin AS (
      SELECT latitude AS lat, longitude AS lng FROM "PincodeToLatLong"
      WHERE pincode = $1
        AND latitude BETWEEN 6 AND 38
        AND longitude BETWEEN 67 AND 98
    )
    SELECT
      p.entity_id,
      p.source_id,
      p.source_table,
      p.name,
      p.kind,
      p.pincode,
      p.city,
      p.chain_id,
      CASE
        WHEN p.latitude BETWEEN 6 AND 38 AND p.longitude BETWEEN 67 AND 98
          AND o.lat IS NOT NULL AND o.lng IS NOT NULL THEN
          ROUND((
            6371 * acos(
              GREATEST(-1, LEAST(1,
                cos(radians(o.lat)) * cos(radians(p.latitude)) *
                cos(radians(p.longitude) - radians(o.lng)) +
                sin(radians(o.lat)) * sin(radians(p.latitude))
              ))
            )
          )::numeric, 2)
        ELSE NULL
      END AS distance_km,
      (p.pincode = $1) AS is_local,
      (p.modalities @> ARRAY['HOME_SAMPLE']::text[]
        AND p.serviced_pincodes IS NOT NULL
        AND $1 = ANY(p.serviced_pincodes)) AS via_serviced
    FROM mv_provider_unified p, origin o
    WHERE p.active
      AND p.kind = $2
      AND $3 = ANY(p.modalities)
      AND (
        p.pincode = $1
        OR (
          p.latitude BETWEEN 6 AND 38 AND p.longitude BETWEEN 67 AND 98
          AND 6371 * acos(
            GREATEST(-1, LEAST(1,
              cos(radians(o.lat)) * cos(radians(p.latitude)) *
              cos(radians(p.longitude) - radians(o.lng)) +
              sin(radians(o.lat)) * sin(radians(p.latitude))
            ))
          ) <= $4
        )
        OR ($3 = 'HOME_SAMPLE' AND p.serviced_pincodes IS NOT NULL AND $1 = ANY(p.serviced_pincodes))
      )
    ORDER BY is_local DESC, distance_km ASC NULLS LAST
    LIMIT 100
  `, [pincode, kind, modality, radiusKm]);
}

// ----------------------------------------------------------------------------
// Gap queue — ranked (pincode × kind × modality) rows with deficit signals.
// A "gap row" is a triplet where there's demand but the coverage count is low.
// ----------------------------------------------------------------------------

export type GapTripleRow = {
  pincode: string;
  city: string | null;
  kind: ProviderKind;
  modality: Modality;
  providers: number;
  orders_l90d: number;
  unserviceable_requests: number;
  gap_score: number;
  events_l30d: number;
  events_l30d_prior: number;
  trend_pct: number | null;
  projected_30d: number;
  urgency_days: number | null;
};

export async function getGapTriples(opts: {
  kinds?: ProviderKind[] | 'ANY';
  modality?: Modality | 'ANY';
  city?: string;
  limit?: number;
}): Promise<GapTripleRow[]> {
  const params: any[] = [];
  const conds: string[] = ['(s.orders_l90d > 0 OR s.unserviceable_requests > 0)'];
  if (opts.kinds && opts.kinds !== 'ANY' && opts.kinds.length > 0) {
    params.push(opts.kinds);
    conds.push(`caps.kind = ANY($${params.length}::text[])`);
  }
  if (opts.modality && opts.modality !== 'ANY') {
    params.push(opts.modality);
    conds.push(`caps.modality = $${params.length}`);
  }
  if (opts.city) {
    params.push(opts.city);
    conds.push(`pc.city = $${params.length}`);
  }
  params.push(opts.limit ?? 60);

  return query<GapTripleRow>(`
    WITH anchor AS (SELECT MAX(week_start) AS ref_date FROM mv_service_line_momentum),
    active_pincodes AS (
      SELECT pincode, orders_l90d, unserviceable_requests
      FROM mv_pincode_summary
      WHERE orders_l90d > 0 OR unserviceable_requests > 0
    ),
    caps AS (
      SELECT DISTINCT kind, modality FROM mv_pincode_coverage
    ),
    triples AS (
      SELECT
        ap.pincode,
        ap.orders_l90d,
        ap.unserviceable_requests,
        caps.kind,
        caps.modality,
        COALESCE(cov.providers, 0) AS providers
      FROM active_pincodes ap
      CROSS JOIN caps
      LEFT JOIN mv_pincode_coverage cov
        ON cov.pincode = ap.pincode AND cov.kind = caps.kind AND cov.modality = caps.modality
    ),
    -- Bring in momentum (forecast) signal — map (kind, modality) → service_line
    momentum_join AS (
      SELECT t.pincode, t.kind, t.modality,
        COALESCE(SUM(m.events) FILTER (WHERE m.week_start >= a.ref_date - INTERVAL '30 days'), 0)::int AS events_l30d,
        COALESCE(SUM(m.events) FILTER (WHERE m.week_start >= a.ref_date - INTERVAL '60 days'
                                         AND m.week_start < a.ref_date - INTERVAL '30 days'), 0)::int AS events_l30d_prior
      FROM triples t CROSS JOIN anchor a
      LEFT JOIN mv_service_line_momentum m ON m.pincode = t.pincode AND (
        (t.kind IN ('LAB','HOSPITAL') AND t.modality = 'HOME_SAMPLE' AND m.service_line = 'LAB_HOME_SAMPLE')
        OR (t.kind IN ('LAB','HOSPITAL') AND t.modality = 'CENTER_VISIT' AND m.service_line = 'LAB_CENTER_VISIT')
        OR (t.kind = 'DOCTOR' AND t.modality = 'CENTER_VISIT' AND m.service_line = 'DOCTOR_CONSULT_CENTER')
        OR (t.kind = 'DOCTOR' AND t.modality = 'HOME_VISIT' AND m.service_line = 'DOCTOR_CONSULT_HOME')
        OR (t.kind = 'NURSE' AND t.modality = 'HOME_VISIT' AND m.service_line = 'NURSING_HOME_VISIT')
        OR (t.kind = 'PHLEBO' AND m.service_line = 'LAB_HOME_SAMPLE')
        OR (t.kind = 'PHARMACY' AND t.modality = 'DELIVERY' AND m.service_line = 'PHARMACY_DELIVERY')
      )
      GROUP BY t.pincode, t.kind, t.modality, a.ref_date
    )
    SELECT
      s.pincode,
      pc.city,
      caps.kind,
      caps.modality::text AS modality,
      t.providers,
      t.orders_l90d,
      t.unserviceable_requests,
      LEAST(100, ROUND(
        (t.orders_l90d + t.unserviceable_requests * 2.0)
        / NULLIF(t.providers + 1, 0)
        / 4.0
      )::int) AS gap_score,
      mj.events_l30d,
      mj.events_l30d_prior,
      CASE WHEN mj.events_l30d_prior > 0
        THEN ROUND(100.0 * (mj.events_l30d - mj.events_l30d_prior) / mj.events_l30d_prior, 0)::int
        ELSE NULL END AS trend_pct,
      -- Project next 30D from max of recent and baseline
      GREATEST(mj.events_l30d, ROUND((t.orders_l90d / 3.0), 0)::int)::int AS projected_30d,
      -- Urgency days: lead time per kind. If projected demand > current capacity threshold (3 per provider per month), flag.
      CASE
        WHEN t.providers = 0 AND mj.events_l30d > 0 THEN 0       -- act now
        WHEN mj.events_l30d > t.providers * 5 THEN 7              -- this week
        WHEN mj.events_l30d > t.providers * 3 THEN 21             -- this sprint
        ELSE NULL END AS urgency_days
    FROM triples t
    JOIN mv_pincode_summary s ON s.pincode = t.pincode
    JOIN caps ON caps.kind = t.kind AND caps.modality = t.modality
    LEFT JOIN mv_pincode_city pc ON pc.pincode = t.pincode
    LEFT JOIN momentum_join mj ON mj.pincode = t.pincode AND mj.kind = t.kind AND mj.modality = t.modality
    WHERE ${conds.join(' AND ')}
    ORDER BY gap_score DESC, projected_30d DESC NULLS LAST, t.providers ASC
    LIMIT $${params.length}
  `, params);
}

// ----------------------------------------------------------------------------
// Heatmap points filtered by (kind, modality) — counts per pincode
// ----------------------------------------------------------------------------

export async function getMapPointsByKindModality(opts: {
  kinds?: ProviderKind[] | 'ANY';
  modality?: Modality | 'ANY';
}) {
  const conds: string[] = ['pl.latitude BETWEEN 6 AND 38', 'pl.longitude BETWEEN 67 AND 98'];
  const params: any[] = [];
  if (opts.kinds && opts.kinds !== 'ANY' && opts.kinds.length > 0) {
    params.push(opts.kinds);
    conds.push(`cov.kind = ANY($${params.length}::text[])`);
  }
  if (opts.modality && opts.modality !== 'ANY') {
    params.push(opts.modality);
    conds.push(`cov.modality = $${params.length}`);
  }
  // Use mv_pincode_geo (with inferred fallbacks) so pincodes lacking exact geocoding still appear
  const condsGeo = ['g.latitude BETWEEN 6 AND 38', 'g.longitude BETWEEN 67 AND 98'];
  if (opts.kinds && opts.kinds !== 'ANY' && opts.kinds.length > 0) {
    condsGeo.push(`cov.kind = ANY($${params.length - 1}::text[])`);  // reuse params
  }
  // Rebuild condsGeo cleanly using only the params we have
  const finalConds: string[] = ['g.latitude BETWEEN 6 AND 38', 'g.longitude BETWEEN 67 AND 98'];
  let i = 0;
  if (opts.kinds && opts.kinds !== 'ANY' && opts.kinds.length > 0) finalConds.push(`cov.kind = ANY($${++i}::text[])`);
  if (opts.modality && opts.modality !== 'ANY') finalConds.push(`cov.modality = $${++i}`);
  return query(`
    SELECT
      cov.pincode,
      g.latitude,
      g.longitude,
      g.geo_source,
      SUM(cov.providers)::int AS network_strength,
      COALESCE(s.orders_all_time, 0) AS orders_all_time,
      COALESCE(s.orders_l30d, 0) AS orders_l30d,
      COALESCE(s.orders_l90d, 0) AS orders_l90d,
      CASE
        WHEN SUM(cov.providers) >= 5 THEN '5_plus'
        WHEN SUM(cov.providers) >= 3 THEN '3_to_4'
        WHEN SUM(cov.providers) = 2 THEN '2'
        WHEN SUM(cov.providers) = 1 THEN '1'
        ELSE '0'
      END AS coverage_bucket
    FROM mv_pincode_coverage cov
    JOIN mv_pincode_geo g ON g.pincode = cov.pincode
    LEFT JOIN mv_pincode_summary s ON s.pincode = cov.pincode
    WHERE ${finalConds.join(' AND ')}
    GROUP BY cov.pincode, g.latitude, g.longitude, g.geo_source, s.orders_all_time, s.orders_l30d, s.orders_l90d
    HAVING SUM(cov.providers) > 0
    LIMIT 8000
  `, params);
}
