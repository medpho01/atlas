import 'server-only';
import { query, queryOne } from './db';

import type { ReadinessRow } from './readiness';

export async function getReadiness(category?: string): Promise<ReadinessRow[]> {
  const params: unknown[] = [];
  let where = '';
  if (category) { params.push(category); where = `WHERE category = $${params.length}`; }
  return query<ReadinessRow>(`
    SELECT * FROM analytics.mv_city_readiness ${where}
    ORDER BY (band = 'C1') DESC, (band = 'C2') DESC, score DESC, city
  `, params);
}

export async function getCityReadiness(cityKey: string): Promise<ReadinessRow[]> {
  return query<ReadinessRow>(`
    SELECT * FROM analytics.mv_city_readiness WHERE city_key = $1 ORDER BY category
  `, [cityKey]);
}

/** Overview KPI: how many C1 cities clear the launch bar for a category. */
export async function getC1LaunchReady(category = 'DIAGNOSTICS') {
  return queryOne<{ ready: number; total: number }>(`
    SELECT COUNT(*) FILTER (WHERE score >= 75)::int AS ready, COUNT(*)::int AS total
    FROM analytics.mv_city_readiness WHERE band = 'C1' AND category = $1
  `, [category]);
}
