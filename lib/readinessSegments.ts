import 'server-only';
import { query } from './db';
import type { ReadinessRow } from './readiness';

/**
 * Readiness by segment.
 *
 * "Diagnostics" folds home collection, imaging centres and hospital labs into
 * one score, and those are different networks with different gaps — a city can
 * be thick with imaging centres and have nobody who will collect at home.
 * Segment membership comes from each provider's own configuration, so nothing
 * here is inferred.
 */

export {
  SEGMENTS, SEGMENT_LABEL, PRIMARY_SEGMENTS, type Segment,
} from './segmentLabels';
import { SEGMENTS } from './segmentLabels';
import type { Segment } from './segmentLabels';

export const CITY_FILTERS = [
  'all', 'metro', 'non_metro', 'tier2', 'tier3', 'demand', 'ready', 'needs_work',
] as const;
export type CityFilter = (typeof CITY_FILTERS)[number];

export const CITY_FILTER_LABEL: Record<CityFilter, string> = {
  all: 'All', metro: 'Metro', non_metro: 'Non-metro',
  tier2: 'Tier 2', tier3: 'Tier 3',
  demand: 'Has demand', ready: 'Launch-ready', needs_work: 'Needs work',
};

/**
 * Shaped as a ReadinessRow so the existing table and gap logic can render it
 * unchanged. `category` carries the segment: gapsFor's one category-specific
 * rule is the centre-vs-home split, which is exactly what a segment already
 * is, so it correctly never fires here.
 */
export type SegmentRow = ReadinessRow & {
  city_tier: string;
  orders_all_time: number;
};

/**
 * The filter is applied in SQL rather than in the page so the counts beside
 * each chip and the rows below them can never disagree.
 */
function whereFor(filter: CityFilter): string {
  switch (filter) {
    case 'metro':      return `r.city_tier = 'Tier 1'`;
    case 'non_metro':  return `r.city_tier <> 'Tier 1'`;
    case 'tier2':      return `r.city_tier = 'Tier 2'`;
    case 'tier3':      return `r.city_tier = 'Tier 3'`;
    case 'demand':     return `COALESCE(cr.orders_all_time, 0) > 0`;
    case 'ready':      return `r.score >= 75`;
    case 'needs_work': return `r.score < 55`;
    default:           return `TRUE`;
  }
}

// Aggregate the rollup BEFORE joining. It has a row per raw city name, so
// "Delhi" and "New Delhi" both resolve to the same canonical key and joining
// it directly emitted the city twice — Delhi appeared as two identical rows.
const FROM = `
  FROM analytics.mv_city_readiness_segment r
  LEFT JOIN (
    SELECT atlas.city_key(city) AS city_key, SUM(orders_all_time)::int AS orders_all_time
    FROM analytics.mv_city_rollup
    GROUP BY 1
  ) cr ON cr.city_key = r.city_key
  WHERE r.segment = $1
`;

export async function getSegmentRows(
  segment: Segment, filter: CityFilter = 'all',
): Promise<SegmentRow[]> {
  return query<SegmentRow>(`
    SELECT r.*, r.segment AS category,
           COALESCE(cr.orders_all_time, 0)::int AS orders_all_time
    ${FROM} AND ${whereFor(filter)}
    -- C1 first: a metro that is not ready is the expensive problem, and it
    -- should not be buried under small cities that happen to score well.
    ORDER BY CASE r.band WHEN 'C1' THEN 0 WHEN 'C2' THEN 1 ELSE 2 END,
             r.score DESC, r.city
  `, [segment]);
}

export type SegmentSummary = {
  cities: number;
  ready: number;
  avg_score: number | null;
  providers: number;
  metros: number;
  metros_ready: number;
};

export async function getSegmentSummary(
  segment: Segment, filter: CityFilter = 'all',
): Promise<SegmentSummary> {
  const rows = await query<SegmentSummary>(`
    SELECT COUNT(*)::int                                            AS cities,
           COUNT(*) FILTER (WHERE r.score >= 75)::int                AS ready,
           ROUND(AVG(r.score))::int                                  AS avg_score,
           COALESCE(SUM(r.providers), 0)::int                        AS providers,
           COUNT(*) FILTER (WHERE r.city_tier = 'Tier 1')::int       AS metros,
           COUNT(*) FILTER (WHERE r.city_tier = 'Tier 1' AND r.score >= 75)::int AS metros_ready
    ${FROM} AND ${whereFor(filter)}
  `, [segment]);
  return rows[0] ?? { cities: 0, ready: 0, avg_score: null, providers: 0, metros: 0, metros_ready: 0 };
}

/** Chip counts, so each filter says how many cities it would leave. */
export async function getFilterCounts(segment: Segment): Promise<Record<CityFilter, number>> {
  const [row] = await query<Record<CityFilter, number>>(`
    SELECT COUNT(*)::int AS all,
           COUNT(*) FILTER (WHERE r.city_tier = 'Tier 1')::int   AS metro,
           COUNT(*) FILTER (WHERE r.city_tier <> 'Tier 1')::int  AS non_metro,
           COUNT(*) FILTER (WHERE r.city_tier = 'Tier 2')::int   AS tier2,
           COUNT(*) FILTER (WHERE r.city_tier = 'Tier 3')::int   AS tier3,
           COUNT(*) FILTER (WHERE COALESCE(cr.orders_all_time,0) > 0)::int AS demand,
           COUNT(*) FILTER (WHERE r.score >= 75)::int            AS ready,
           COUNT(*) FILTER (WHERE r.score < 55)::int             AS needs_work
    ${FROM}
  `, [segment]);
  return row ?? ({} as Record<CityFilter, number>);
}
