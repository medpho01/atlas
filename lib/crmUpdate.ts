import 'server-only';
import { query, queryOne } from './db';
import type { DailyUpdate } from './crmUpdateFormat';

/**
 * The daily update, derived rather than typed.
 *
 * Everyone was writing the same standup by hand out of the same board, which
 * costs time and drifts from what the board says. The numbers here are what
 * the person actually moved that day, read from the activity log.
 *
 * "Moved into a stage today" — not "sits in that stage" — because the update is
 * a record of a day's work. A provider parked in Identified for three weeks is
 * not an accomplishment, and counting current occupancy would report it as one
 * every single day.
 *
 * Dates are Asia/Kolkata: the team's day, not UTC's.
 */

export async function getDailyUpdate(userId: number, day: string): Promise<DailyUpdate> {
  const who = await queryOne<{ name: string }>(
    `SELECT name FROM atlas.users WHERE id = $1`, [userId],
  );

  // Every thread the person is on, whether or not they touched it today — a
  // thread with nothing to report is itself worth reporting.
  const threads = await query<{ thread_id: number; name: string; stages: { key: string; label: string }[] }>(`
    SELECT t.id AS thread_id, t.name, f.stages
    FROM atlas.crm_thread_members m
    JOIN atlas.crm_threads t ON t.id = m.thread_id
    JOIN atlas.crm_funnels f ON f.id = t.funnel_id
    WHERE m.user_id = $1 AND t.status <> 'done'
    ORDER BY t.name
  `, [userId]);

  const moves = await query<{ thread_id: number; stage_key: string; n: number }>(`
    WITH day_activity AS (
      SELECT a.thread_id, a.provider_id, a.type, a.meta
      FROM atlas.crm_activities a
      WHERE a.author_id = $1
        AND (a.created_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date
    ),
    entered AS (
      -- A stage change records where it went. A provider created today entered
      -- the funnel's first stage, which is the same event told differently.
      SELECT thread_id, meta->>'to' AS stage_key, provider_id
      FROM day_activity WHERE type = 'stage_change' AND meta->>'to' IS NOT NULL
      UNION
      SELECT d.thread_id, (f.stages->0->>'key'), d.provider_id
      FROM day_activity d
      JOIN atlas.crm_threads t ON t.id = d.thread_id
      JOIN atlas.crm_funnels f ON f.id = t.funnel_id
      WHERE d.type = 'provider_created'
    )
    SELECT thread_id, stage_key, COUNT(DISTINCT provider_id)::int AS n
    FROM entered WHERE thread_id IS NOT NULL
    GROUP BY thread_id, stage_key
  `, [userId, day]);

  const byThread = new Map<number, Map<string, number>>();
  for (const m of moves) {
    if (!byThread.has(m.thread_id)) byThread.set(m.thread_id, new Map());
    byThread.get(m.thread_id)!.set(m.stage_key, m.n);
  }

  // Requests the person moved on, for threads worked off the request queue.
  const req = await queryOne<{ n: number }>(`
    SELECT COUNT(DISTINCT cm.request_id)::int AS n
    FROM atlas.commitment cm
    WHERE cm.attributed_to = $1
      AND (cm.updated_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date
  `, [userId, day]).catch(() => null);

  return {
    name: who?.name ?? 'Unknown',
    date: day,
    requests_progressed: req?.n ?? 0,
    threads: threads.map((t) => {
      const counts = byThread.get(t.thread_id) ?? new Map();
      const stages = (t.stages ?? []).map((st) => ({
        key: st.key, label: st.label, count: counts.get(st.key) ?? 0,
      }));
      return {
        thread_id: t.thread_id,
        name: t.name,
        stages,
        total: stages.reduce((n, st) => n + st.count, 0),
      };
    }),
  };
}


export * from './crmUpdateFormat';
