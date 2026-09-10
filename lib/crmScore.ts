import 'server-only';
import { query, queryOne } from './db';

/**
 * The onboarding scoreboard.
 *
 * Moving a provider forward earns the stage's points, once per provider.
 * Leaving one sitting past the stage's allowance costs a multiple of the same
 * points, again on every further allowance, up to a cap — so neglect is
 * expensive but not unbounded, and a month's number stays a number about that
 * month. All of it is rows in atlas.crm_stage_points and crm_score_settings,
 * because the first month of running this will show that some of them are
 * wrong; none of it is compiled in here.
 *
 * The arithmetic lives in SQL (sql/init/19_crm_points.sql) rather than here:
 * the month-end incentive has to be reproducible from the database alone, by
 * someone who does not have this application running.
 */

/** A calendar month, as the two instants that bound it. */
export function monthBounds(month?: string | null): { from: string; to: string; label: string; key: string } {
  const now = new Date();
  const m = /^\d{4}-\d{2}$/.test(month ?? '')
    ? new Date(`${month}-01T00:00:00Z`)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const from = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), 1));
  const to = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    key: from.toISOString().slice(0, 7),
    label: from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

/** Shift a YYYY-MM key by n months. */
export function shiftMonth(key: string, n: number): string {
  const d = new Date(`${key}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

export type ScoreRow = {
  user_id: number;
  name: string;
  earned: number;
  penalty: number;
  net: number;
  target: number;
  pct: number;
  payout: string;
};

export async function getScoreboard(from: string, to: string): Promise<ScoreRow[]> {
  return query<ScoreRow>(`SELECT * FROM atlas.crm_score($1::timestamptz, $2::timestamptz)`, [from, to]);
}

export type EarnedByStage = {
  stage_key: string;
  stage_label: string;
  moves: number;
  points: number;
};

/** What a person's earned points were actually for. */
export async function getEarnedByStage(userId: number, from: string, to: string): Promise<EarnedByStage[]> {
  return query<EarnedByStage>(`
    SELECT e.stage_key,
           COALESCE(MAX(st.value ->> 'label'), e.stage_key) AS stage_label,
           COUNT(*)::int AS moves,
           SUM(e.points)::int AS points
    FROM atlas.crm_points_earned($2::timestamptz, $3::timestamptz) e
    JOIN atlas.crm_threads t ON t.id = e.thread_id
    JOIN atlas.crm_funnels f ON f.id = t.funnel_id
    LEFT JOIN LATERAL jsonb_array_elements(f.stages) st ON st.value ->> 'key' = e.stage_key
    WHERE e.user_id = $1
    GROUP BY e.stage_key
    ORDER BY points DESC
  `, [userId, from, to]);
}

export type PenaltyRow = {
  thread_id: number;
  provider_id: number;
  provider_name: string;
  thread_name: string;
  stage_key: string;
  stage_label: string;
  periods: number;
  points: number;
  days_sitting: number;
};

/** Which cards cost a person points, worst first — the list to go and work. */
export async function getPenalties(userId: number, from: string, to: string): Promise<PenaltyRow[]> {
  return query<PenaltyRow>(`
    SELECT d.thread_id, d.provider_id, p.name AS provider_name, t.name AS thread_name,
           d.stage_key,
           COALESCE(st.value ->> 'label', d.stage_key) AS stage_label,
           d.periods, d.points, d.days_sitting
    FROM atlas.crm_points_penalty($2::timestamptz, $3::timestamptz) d
    JOIN atlas.crm_providers p ON p.id = d.provider_id
    JOIN atlas.crm_threads t ON t.id = d.thread_id
    JOIN atlas.crm_funnels f ON f.id = t.funnel_id
    LEFT JOIN LATERAL jsonb_array_elements(f.stages) st ON st.value ->> 'key' = d.stage_key
    WHERE d.user_id = $1
    ORDER BY d.points DESC, d.days_sitting DESC
  `, [userId, from, to]);
}

export type StagePoint = {
  funnel_id: number;
  funnel_name: string;
  stage_key: string;
  stage_label: string;
  sort: number;
  points: number;
  sla_days: number | null;
};

/**
 * The ladder itself, in funnel order.
 *
 * Read from the funnel rather than from the points table, so a stage someone
 * adds to a funnel shows up here priced at nothing instead of silently
 * scoring nothing with no way to notice.
 */
export async function getStagePoints(): Promise<StagePoint[]> {
  return query<StagePoint>(`
    SELECT f.id AS funnel_id, f.name AS funnel_name,
           st.value ->> 'key' AS stage_key,
           COALESCE(st.value ->> 'label', st.value ->> 'key') AS stage_label,
           (st.ord - 1)::int AS sort,
           COALESCE(sp.points, 0) AS points,
           sp.sla_days
    FROM atlas.crm_funnels f
    CROSS JOIN LATERAL jsonb_array_elements(f.stages) WITH ORDINALITY st(value, ord)
    LEFT JOIN atlas.crm_stage_points sp
           ON sp.funnel_id = f.id AND sp.stage_key = st.value ->> 'key'
    ORDER BY f.id, st.ord
  `);
}

export type ScoreSettings = {
  penalty_multiplier: string;
  default_target: number;
  incentive_pot: string;
  bonus_per_point: string;
  max_payout_pct: number;
  max_penalty_periods: number;
};

export async function getScoreSettings(): Promise<ScoreSettings> {
  const row = await queryOne<ScoreSettings>(`SELECT * FROM atlas.crm_score_settings WHERE id`);
  return row!;
}

export type Slab = { min_pct: number; payout_pct: number };

export async function getSlabs(): Promise<Slab[]> {
  return query<Slab>(`SELECT min_pct, payout_pct FROM atlas.crm_incentive_slabs ORDER BY min_pct`);
}

export type TargetRow = { user_id: number; name: string; target_points: number; is_override: boolean };

/** Everyone who can score this month, with the target that applies to them. */
export async function getTargets(month: string): Promise<TargetRow[]> {
  return query<TargetRow>(`
    SELECT u.id AS user_id, u.name,
           COALESCE(t.target_points, s.default_target) AS target_points,
           (t.user_id IS NOT NULL) AS is_override
    FROM atlas.users u
    CROSS JOIN atlas.crm_score_settings s
    LEFT JOIN atlas.crm_point_targets t
           ON t.user_id = u.id AND t.month = $1::date
    WHERE u.active AND u.role IN ('network', 'network_lead')
    ORDER BY u.name
  `, [`${month}-01`]);
}

/**
 * What one full journey is worth, and what a month's target implies.
 *
 * Quoted next to the target because a target in points means nothing on its
 * own — "100 points" is only legible as "about three providers all the way
 * through, or more of them part-way".
 */
export async function getJourneyValue(): Promise<{ funnel_name: string; full_journey: number }[]> {
  return query(`
    SELECT f.name AS funnel_name, COALESCE(SUM(sp.points), 0)::int AS full_journey
    FROM atlas.crm_funnels f
    JOIN atlas.crm_stage_points sp ON sp.funnel_id = f.id
    WHERE sp.points > 0
      AND (f.success_stage_key IS NULL OR sp.stage_key <> '__none__')
    GROUP BY f.id, f.name
    ORDER BY f.id
  `);
}
