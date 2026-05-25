import { query, queryOne } from './db';
import type { ServiceLine } from './serviceLines';

// ----------------------------------------------------------------------------
// Service line momentum across cities
// ----------------------------------------------------------------------------

export type ServiceLineCityRow = {
  city: string;
  service_line: ServiceLine;
  events_w0: number;
  events_w1: number;
  events_l30d: number;
  events_l30d_prior: number;
  events_l90d: number;
  events_l180d: number;
  wow_pct: number | null;
  mom_pct: number | null;
};

export type MomentumScope = { asofDays?: number; windowDays?: number };

export async function getServiceLineCityMatrix(opts: MomentumScope = {}): Promise<ServiceLineCityRow[]> {
  const asofDays = opts.asofDays ?? 0;
  const windowDays = opts.windowDays ?? 30;
  // When user uses the default scope (latest week + 30 days) we keep using the
  // pre-aggregated `mv_service_line_city` MV for speed. Otherwise we compute
  // dynamically from `mv_service_line_momentum` joined to pincode→city.
  if (asofDays === 0 && windowDays === 30) {
    return query<ServiceLineCityRow>(`
      SELECT
        city,
        service_line,
        events_w0,
        events_w1,
        events_l30d,
        events_l30d_prior,
        events_l90d,
        events_l180d,
        CASE WHEN events_w1 > 0 THEN ROUND(100.0 * (events_w0 - events_w1) / events_w1, 1) ELSE NULL END AS wow_pct,
        CASE WHEN events_l30d_prior > 0 THEN ROUND(100.0 * (events_l30d - events_l30d_prior) / events_l30d_prior, 1) ELSE NULL END AS mom_pct
      FROM mv_service_line_city
      WHERE city IS NOT NULL AND TRIM(city) <> ''
      ORDER BY events_l30d DESC NULLS LAST
    `);
  }
  return query<ServiceLineCityRow>(`
    WITH anchor AS (
      SELECT (SELECT MAX(week_start) FROM mv_service_line_momentum) - ($1 || ' days')::interval AS ref_date
    ),
    cd AS (
      SELECT pc.city, m.service_line, m.week_start, m.events
      FROM mv_service_line_momentum m
      JOIN mv_pincode_city pc ON pc.pincode = m.pincode
    )
    SELECT
      cd.city,
      cd.service_line,
      COALESCE(SUM(cd.events) FILTER (WHERE cd.week_start > a.ref_date - INTERVAL '7 days' AND cd.week_start <= a.ref_date), 0)::int AS events_w0,
      COALESCE(SUM(cd.events) FILTER (WHERE cd.week_start > a.ref_date - INTERVAL '14 days' AND cd.week_start <= a.ref_date - INTERVAL '7 days'), 0)::int AS events_w1,
      COALESCE(SUM(cd.events) FILTER (WHERE cd.week_start > a.ref_date - ($2 || ' days')::interval AND cd.week_start <= a.ref_date), 0)::int AS events_l30d,
      COALESCE(SUM(cd.events) FILTER (WHERE cd.week_start > a.ref_date - (($2::int * 2) || ' days')::interval AND cd.week_start <= a.ref_date - ($2 || ' days')::interval), 0)::int AS events_l30d_prior,
      COALESCE(SUM(cd.events) FILTER (WHERE cd.week_start > a.ref_date - INTERVAL '90 days' AND cd.week_start <= a.ref_date), 0)::int AS events_l90d,
      COALESCE(SUM(cd.events) FILTER (WHERE cd.week_start <= a.ref_date), 0)::int AS events_l180d,
      CASE WHEN COALESCE(SUM(cd.events) FILTER (WHERE cd.week_start > a.ref_date - INTERVAL '14 days' AND cd.week_start <= a.ref_date - INTERVAL '7 days'), 0) > 0
        THEN ROUND(100.0 * (
          COALESCE(SUM(cd.events) FILTER (WHERE cd.week_start > a.ref_date - INTERVAL '7 days' AND cd.week_start <= a.ref_date), 0)
          - SUM(cd.events) FILTER (WHERE cd.week_start > a.ref_date - INTERVAL '14 days' AND cd.week_start <= a.ref_date - INTERVAL '7 days')
        ) / SUM(cd.events) FILTER (WHERE cd.week_start > a.ref_date - INTERVAL '14 days' AND cd.week_start <= a.ref_date - INTERVAL '7 days'), 1)
        ELSE NULL END AS wow_pct,
      CASE WHEN COALESCE(SUM(cd.events) FILTER (WHERE cd.week_start > a.ref_date - (($2::int * 2) || ' days')::interval AND cd.week_start <= a.ref_date - ($2 || ' days')::interval), 0) > 0
        THEN ROUND(100.0 * (
          COALESCE(SUM(cd.events) FILTER (WHERE cd.week_start > a.ref_date - ($2 || ' days')::interval AND cd.week_start <= a.ref_date), 0)
          - SUM(cd.events) FILTER (WHERE cd.week_start > a.ref_date - (($2::int * 2) || ' days')::interval AND cd.week_start <= a.ref_date - ($2 || ' days')::interval)
        ) / SUM(cd.events) FILTER (WHERE cd.week_start > a.ref_date - (($2::int * 2) || ' days')::interval AND cd.week_start <= a.ref_date - ($2 || ' days')::interval), 1)
        ELSE NULL END AS mom_pct
    FROM cd CROSS JOIN anchor a
    WHERE cd.city IS NOT NULL AND TRIM(cd.city) <> ''
    GROUP BY cd.city, cd.service_line, a.ref_date
    ORDER BY events_l30d DESC NULLS LAST
  `, [String(asofDays), String(windowDays)]);
}

// ----------------------------------------------------------------------------
// Service line — overall momentum (platform-wide)
// ----------------------------------------------------------------------------

export type ServiceLineGlobalRow = {
  service_line: ServiceLine;
  events_w0: number;
  events_w1: number;
  events_l30d: number;
  events_l30d_prior: number;
  events_l90d: number;
  events_l180d: number;
  wow_pct: number | null;
  mom_pct: number | null;
  weekly_series: { week: string; events: number }[];
};

export async function getServiceLineGlobalSummary(opts: MomentumScope = {}): Promise<ServiceLineGlobalRow[]> {
  const asofDays = opts.asofDays ?? 0;
  const windowDays = opts.windowDays ?? 30;
  return query<ServiceLineGlobalRow>(`
    WITH anchor AS (
      SELECT (SELECT MAX(week_start) FROM mv_service_line_momentum) - ($1 || ' days')::interval AS ref_date
    ),
    agg AS (
      SELECT
        m.service_line,
        SUM(m.events) FILTER (WHERE m.week_start > a.ref_date - INTERVAL '7 days'  AND m.week_start <= a.ref_date)::int AS events_w0,
        SUM(m.events) FILTER (WHERE m.week_start > a.ref_date - INTERVAL '14 days' AND m.week_start <= a.ref_date - INTERVAL '7 days')::int AS events_w1,
        SUM(m.events) FILTER (WHERE m.week_start > a.ref_date - ($2 || ' days')::interval AND m.week_start <= a.ref_date)::int AS events_l30d,
        SUM(m.events) FILTER (WHERE m.week_start > a.ref_date - (($2::int * 2) || ' days')::interval AND m.week_start <= a.ref_date - ($2 || ' days')::interval)::int AS events_l30d_prior,
        SUM(m.events) FILTER (WHERE m.week_start > a.ref_date - INTERVAL '90 days' AND m.week_start <= a.ref_date)::int AS events_l90d,
        SUM(m.events) FILTER (WHERE m.week_start <= a.ref_date)::int AS events_l180d
      FROM mv_service_line_momentum m CROSS JOIN anchor a
      GROUP BY m.service_line
    ),
    series AS (
      SELECT service_line,
        jsonb_agg(
          jsonb_build_object('week', to_char(week_start, 'YYYY-MM-DD'), 'events', weekly_events)
          ORDER BY week_start
        ) AS weekly_series
      FROM (
        SELECT m.service_line, m.week_start, SUM(m.events)::int AS weekly_events
        FROM mv_service_line_momentum m CROSS JOIN anchor a
        WHERE m.week_start <= a.ref_date
          AND m.week_start > a.ref_date - INTERVAL '84 days'  -- 12-week sparkline ending at anchor
        GROUP BY m.service_line, m.week_start
      ) x
      GROUP BY service_line
    )
    SELECT
      ag.service_line,
      COALESCE(ag.events_w0, 0)::int AS events_w0,
      COALESCE(ag.events_w1, 0)::int AS events_w1,
      COALESCE(ag.events_l30d, 0)::int AS events_l30d,
      COALESCE(ag.events_l30d_prior, 0)::int AS events_l30d_prior,
      COALESCE(ag.events_l90d, 0)::int AS events_l90d,
      COALESCE(ag.events_l180d, 0)::int AS events_l180d,
      CASE WHEN COALESCE(ag.events_w1, 0) > 0 THEN ROUND(100.0 * (COALESCE(ag.events_w0, 0) - ag.events_w1) / ag.events_w1, 1) ELSE NULL END AS wow_pct,
      CASE WHEN COALESCE(ag.events_l30d_prior, 0) > 0 THEN ROUND(100.0 * (COALESCE(ag.events_l30d, 0) - ag.events_l30d_prior) / ag.events_l30d_prior, 1) ELSE NULL END AS mom_pct,
      COALESCE(s.weekly_series, '[]'::jsonb) AS weekly_series
    FROM agg ag LEFT JOIN series s ON s.service_line = ag.service_line
    WHERE COALESCE(ag.events_l180d, 0) > 0
    ORDER BY COALESCE(ag.events_l30d, 0) DESC
  `, [String(asofDays), String(windowDays)]);
}

// ----------------------------------------------------------------------------
// Demand-supply imbalance watchlist
// Pincodes where demand growth outpaces supply. P1 Feature F.
// ----------------------------------------------------------------------------

export type ImbalanceRow = {
  pincode: string;
  city: string | null;
  service_line: ServiceLine;
  events_l30d: number;
  events_l30d_prior: number;
  growth_pct: number;
  supply_count: number;
  imbalance_score: number;
};

export async function getDemandSupplyImbalances(opts: { minEvents?: number; limit?: number } = {}): Promise<ImbalanceRow[]> {
  const minEvents = opts.minEvents ?? 5;
  const limit = opts.limit ?? 50;
  return query<ImbalanceRow>(`
    WITH anchor AS (SELECT MAX(week_start) AS ref_date FROM mv_service_line_momentum),
    pin_30 AS (
      SELECT m.pincode, m.service_line,
        SUM(m.events) FILTER (WHERE m.week_start >= a.ref_date - INTERVAL '30 days')::int AS events_l30d,
        SUM(m.events) FILTER (WHERE m.week_start >= a.ref_date - INTERVAL '60 days'
                                AND m.week_start < a.ref_date - INTERVAL '30 days')::int AS events_l30d_prior
      FROM mv_service_line_momentum m CROSS JOIN anchor a
      GROUP BY m.pincode, m.service_line
    ),
    -- For each (pincode, service_line) compute supply using SERVICE_LINE_TO_KINDS mapping (mirrored in SQL)
    pin_supply AS (
      SELECT
        p30.pincode,
        p30.service_line,
        COALESCE(SUM(c.providers), 0)::int AS supply_count
      FROM pin_30 p30
      LEFT JOIN mv_pincode_coverage c
        ON c.pincode = p30.pincode
        AND (
          (p30.service_line = 'LAB_HOME_SAMPLE' AND ((c.kind IN ('LAB','HOSPITAL') AND c.modality = 'HOME_SAMPLE') OR (c.kind = 'PHLEBO' AND c.modality = 'HOME_SAMPLE')))
          OR (p30.service_line = 'LAB_CENTER_VISIT' AND c.kind IN ('LAB','HOSPITAL') AND c.modality = 'CENTER_VISIT')
          OR (p30.service_line = 'DOCTOR_CONSULT_CENTER' AND (c.kind = 'DOCTOR' OR c.kind = 'HOSPITAL') AND c.modality = 'CENTER_VISIT')
          OR (p30.service_line = 'DOCTOR_CONSULT_HOME' AND c.kind = 'DOCTOR' AND c.modality = 'HOME_VISIT')
          OR (p30.service_line = 'NURSING_HOME_VISIT' AND c.kind = 'NURSE' AND c.modality = 'HOME_VISIT')
          OR (p30.service_line = 'PHARMACY_DELIVERY' AND c.kind = 'PHARMACY' AND c.modality = 'DELIVERY')
          OR (p30.service_line = 'CAMP_ORDER' AND c.kind IN ('LAB','PHLEBO'))
        )
      GROUP BY p30.pincode, p30.service_line
    )
    SELECT
      p30.pincode,
      pc.city,
      p30.service_line,
      p30.events_l30d,
      p30.events_l30d_prior,
      CASE WHEN p30.events_l30d_prior > 0
        THEN ROUND(100.0 * (p30.events_l30d - p30.events_l30d_prior) / p30.events_l30d_prior, 1)
        ELSE 999.9 END AS growth_pct,
      ps.supply_count,
      -- Imbalance score: weighted ratio of demand to supply, boosted by growth
      LEAST(100, ROUND(
        (p30.events_l30d::numeric * GREATEST(1.0, (p30.events_l30d::numeric / NULLIF(p30.events_l30d_prior, 0))))
        / NULLIF(ps.supply_count + 1, 0) * 2
      )::int) AS imbalance_score
    FROM pin_30 p30
    JOIN pin_supply ps ON ps.pincode = p30.pincode AND ps.service_line = p30.service_line
    LEFT JOIN mv_pincode_city pc ON pc.pincode = p30.pincode
    WHERE p30.events_l30d >= $1
      AND (p30.events_l30d > p30.events_l30d_prior OR ps.supply_count < 2)
    ORDER BY imbalance_score DESC, p30.events_l30d DESC
    LIMIT $2
  `, [minEvents, limit]);
}

// ----------------------------------------------------------------------------
// Demand forecast — simple rolling-avg projection for a (pincode, service_line)
// Used by the gaps queue urgency column.
// ----------------------------------------------------------------------------

export async function getDemandForecastForGaps(limit = 80) {
  return query(`
    WITH pin_recent AS (
      SELECT
        m.pincode,
        m.service_line,
        AVG(m.events) FILTER (WHERE m.week_start >= CURRENT_DATE - INTERVAL '4 weeks') AS avg_recent_weekly,
        AVG(m.events) FILTER (WHERE m.week_start >= CURRENT_DATE - INTERVAL '12 weeks') AS avg_baseline_weekly
      FROM mv_service_line_momentum m
      GROUP BY m.pincode, m.service_line
    )
    SELECT
      pincode,
      service_line,
      ROUND(avg_recent_weekly, 1) AS recent_weekly,
      ROUND(avg_baseline_weekly, 1) AS baseline_weekly,
      ROUND(GREATEST(avg_recent_weekly, avg_baseline_weekly) * 4)::int AS projected_30d
    FROM pin_recent
    WHERE avg_recent_weekly > 0
    ORDER BY projected_30d DESC
    LIMIT $1
  `, [limit]);
}
