import 'server-only';
import { query, queryOne } from './db';
import type { User } from './auth';

/** Roles allowed to mutate CRM state. Everyone logged-in can read. */
export const CRM_WRITE_ROLES: User['role'][] = ['admin', 'network'];
export const canWriteCrm = (u: User | null): boolean => !!u && CRM_WRITE_ROLES.includes(u.role);
export type FunnelStage = { key: string; label: string };
export type Funnel = { id: number; name: string; stages: FunnelStage[]; is_default: boolean; success_stage_key: string | null };

export type Thread = {
  id: number;
  name: string;
  description: string | null;
  funnel_id: number;
  target_count: number;
  provider_kind: string | null;
  region: string | null;
  status: 'active' | 'paused' | 'done';
  created_at: string;
  provider_total: number;
  onboarded_count: number;
  stages: FunnelStage[];
  success_stage_key: string | null;
  stage_counts: Record<string, number>;
};

export type ThreadStats = {
  stage_counts: { stage_key: string; n: number }[];
  /** Movement + wins over rolling windows, for velocity read-out */
  velocity: { days: number; added: number; moves: number; onboarded: number }[];
};

export type Provider = {
  id: number;
  name: string;
  kind: string;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  contact_person: string | null;
  notes: string | null;
  source: string;
  source_lab_id: number | null;
};

export type ThreadProvider = Provider & {
  tp_id: number;
  stage_key: string;
  assignee_id: number | null;
  assignee_name: string | null;
  updated_at: string;
  docs_count: number;
  last_activity: string | null;
};

export type Activity = {
  id: number;
  type: string;
  body: string | null;
  meta: Record<string, unknown> | null;
  author_name: string | null;
  created_at: string;
};

export type ChecklistItem = { id: number; label: string; required: boolean; sort: number };
export type ProviderDoc = {
  id: number;
  checklist_item_id: number | null;
  filename: string;
  mime: string | null;
  size_bytes: number | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
};

export async function listFunnels(): Promise<Funnel[]> {
  return query<Funnel>(`SELECT id, name, stages, is_default, success_stage_key FROM atlas.crm_funnels ORDER BY is_default DESC, name`);
}

export async function listThreads(): Promise<Thread[]> {
  return query<Thread>(`
    SELECT t.id, t.name, t.description, t.funnel_id, t.target_count, t.provider_kind,
           t.region, t.status, t.created_at, f.stages, f.success_stage_key,
           COALESCE(SUM(tp.n), 0)::int AS provider_total,
           COALESCE(SUM(tp.n) FILTER (WHERE tp.stage_key = f.success_stage_key), 0)::int AS onboarded_count,
           COALESCE(jsonb_object_agg(tp.stage_key, tp.n) FILTER (WHERE tp.stage_key IS NOT NULL), '{}'::jsonb) AS stage_counts
    FROM atlas.crm_threads t
    JOIN atlas.crm_funnels f ON f.id = t.funnel_id
    LEFT JOIN LATERAL (
      SELECT stage_key, COUNT(*)::int AS n
      FROM atlas.crm_thread_providers WHERE thread_id = t.id GROUP BY stage_key
    ) tp ON true
    GROUP BY t.id, f.stages, f.success_stage_key
    ORDER BY (t.status = 'active') DESC, t.created_at DESC
  `);
}

export async function getThread(id: number): Promise<Thread | null> {
  return queryOne<Thread>(`
    SELECT t.id, t.name, t.description, t.funnel_id, t.target_count, t.provider_kind,
           t.region, t.status, t.created_at, f.stages, f.success_stage_key,
           (SELECT COUNT(*) FROM atlas.crm_thread_providers tp WHERE tp.thread_id = t.id)::int AS provider_total,
           (SELECT COUNT(*) FROM atlas.crm_thread_providers tp
             WHERE tp.thread_id = t.id AND tp.stage_key = f.success_stage_key)::int AS onboarded_count,
           '{}'::jsonb AS stage_counts
    FROM atlas.crm_threads t
    JOIN atlas.crm_funnels f ON f.id = t.funnel_id
    WHERE t.id = $1
  `, [id]);
}

export async function getThreadProviders(threadId: number): Promise<ThreadProvider[]> {
  return query<ThreadProvider>(`
    SELECT p.id, p.name, p.kind, p.city, p.state, p.pincode, p.phone, p.email,
           p.contact_person, p.notes, p.source, p.source_lab_id,
           tp.id AS tp_id, tp.stage_key, tp.assignee_id, u.name AS assignee_name, tp.updated_at,
           (SELECT COUNT(*) FROM atlas.crm_provider_docs d WHERE d.provider_id = p.id)::int AS docs_count,
           (SELECT MAX(a.created_at)::text FROM atlas.crm_activities a WHERE a.provider_id = p.id) AS last_activity
    FROM atlas.crm_thread_providers tp
    JOIN atlas.crm_providers p ON p.id = tp.provider_id
    LEFT JOIN atlas.users u ON u.id = tp.assignee_id
    WHERE tp.thread_id = $1
    ORDER BY tp.updated_at DESC
  `, [threadId]);
}

export async function getProviderActivities(providerId: number, threadId?: number): Promise<Activity[]> {
  return query<Activity>(`
    SELECT a.id, a.type, a.body, a.meta, u.name AS author_name, a.created_at
    FROM atlas.crm_activities a
    LEFT JOIN atlas.users u ON u.id = a.author_id
    WHERE a.provider_id = $1 AND ($2::int IS NULL OR a.thread_id = $2 OR a.thread_id IS NULL)
    ORDER BY a.created_at DESC
    LIMIT 100
  `, [providerId, threadId ?? null]);
}

export async function getChecklist(threadId: number): Promise<ChecklistItem[]> {
  // Thread-specific checklist if defined, else the global default (thread_id IS NULL)
  const specific = await query<ChecklistItem>(
    `SELECT id, label, required, sort FROM atlas.crm_checklist_items WHERE thread_id = $1 ORDER BY sort`, [threadId]);
  if (specific.length) return specific;
  return query<ChecklistItem>(
    `SELECT id, label, required, sort FROM atlas.crm_checklist_items WHERE thread_id IS NULL ORDER BY sort`);
}

export async function getProviderDocs(providerId: number): Promise<ProviderDoc[]> {
  return query<ProviderDoc>(`
    SELECT d.id, d.checklist_item_id, d.filename, d.mime, d.size_bytes,
           u.name AS uploaded_by_name, d.uploaded_at
    FROM atlas.crm_provider_docs d
    LEFT JOIN atlas.users u ON u.id = d.uploaded_by
    WHERE d.provider_id = $1
    ORDER BY d.uploaded_at DESC
  `, [providerId]);
}

export async function getThreadStats(threadId: number): Promise<ThreadStats> {
  const [stage_counts, velocity] = await Promise.all([
    query<{ stage_key: string; n: number }>(
      `SELECT stage_key, COUNT(*)::int AS n
       FROM atlas.crm_thread_providers WHERE thread_id = $1
       GROUP BY stage_key`, [threadId]),
    query<{ days: number; added: number; moves: number; onboarded: number }>(
      `WITH w(days) AS (VALUES (7), (15), (30)),
       fx AS (SELECT f.success_stage_key AS sk
              FROM atlas.crm_threads t JOIN atlas.crm_funnels f ON f.id = t.funnel_id
              WHERE t.id = $1)
       SELECT w.days,
         (SELECT COUNT(*)::int FROM atlas.crm_thread_providers tp
           WHERE tp.thread_id = $1 AND tp.created_at >= now() - (w.days || ' days')::interval) AS added,
         (SELECT COUNT(*)::int FROM atlas.crm_activities a
           WHERE a.thread_id = $1 AND a.type = 'stage_change'
             AND a.created_at >= now() - (w.days || ' days')::interval) AS moves,
         (SELECT COUNT(DISTINCT a.provider_id)::int FROM atlas.crm_activities a, fx
           WHERE a.thread_id = $1 AND a.type = 'stage_change'
             AND a.meta->>'to' = fx.sk
             AND a.created_at >= now() - (w.days || ' days')::interval) AS onboarded
       FROM w ORDER BY w.days`, [threadId]),
  ]);
  return { stage_counts, velocity };
}

export async function listTeam(): Promise<{ id: number; name: string; role: string }[]> {
  return query(`SELECT id, name, role FROM atlas.users WHERE active ORDER BY name`);
}

export async function logActivity(input: {
  threadId: number | null; providerId: number; authorId: number;
  type: string; body?: string; meta?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO atlas.crm_activities (thread_id, provider_id, author_id, type, body, meta)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.threadId, input.providerId, input.authorId, input.type, input.body ?? null,
     input.meta ? JSON.stringify(input.meta) : null],
  );
}

/**
 * Work assigned to one person, across every thread.
 *
 * The board is organised by thread, but work is done by person — so anything
 * sitting in a thread someone doesn't open regularly is invisible to them.
 * This is the same rows the board shows, pivoted to the unit the work is
 * actually done in.
 *
 * "Open" means not in the funnel's success stage. Nothing else is terminal:
 * a stalled or dropped provider is precisely the kind of thing worth
 * resurfacing, so it stays in the queue.
 *
 * Staleness is measured from the last activity, falling back to when the
 * assignment row last changed — a provider nobody has touched since it was
 * added has been sitting exactly that long.
 */
export type QueueRow = {
  provider_id: number;
  provider_name: string;
  kind: string;
  city: string | null;
  thread_id: number;
  thread_name: string;
  stage_key: string;
  stage_label: string;
  assignee_id: number | null;
  assignee_name: string | null;
  last_touch: string;
  days_stale: number;
};

export async function getQueue(opts: {
  assigneeId?: number | null;
  /** true → only rows with no owner. Overrides assigneeId. */
  unassigned?: boolean;
  /** Narrow to one campaign, the way the thread board does. */
  threadId?: number | null;
  /**
   * Hide rows in the funnel's success stage.
   *
   * Off by default. It used to be forced on, which made this view disagree
   * with the thread board about the same providers: onboarded ones simply
   * weren't here, so a stage that read 3 on one screen read 0 on the other.
   * Callers that genuinely want only unfinished work ask for it.
   */
  openOnly?: boolean;
  limit?: number;
} = {}): Promise<QueueRow[]> {
  const params: unknown[] = [];
  // Seeded so an unfiltered call still produces a valid WHERE clause.
  const where: string[] = ['TRUE'];

  if (opts.openOnly) where.push('tp.stage_key IS DISTINCT FROM f.success_stage_key');
  if (opts.threadId) {
    params.push(opts.threadId);
    where.push(`t.id = $${params.length}`);
  }

  if (opts.unassigned) {
    where.push('tp.assignee_id IS NULL');
  } else if (opts.assigneeId != null) {
    params.push(opts.assigneeId);
    where.push(`tp.assignee_id = $${params.length}`);
  }
  params.push(opts.limit ?? 500);

  return query<QueueRow>(`
    WITH touch AS (
      SELECT thread_id, provider_id, MAX(created_at) AS last_activity
      FROM atlas.crm_activities GROUP BY thread_id, provider_id
    )
    SELECT
      p.id AS provider_id, p.name AS provider_name, p.kind, p.city,
      t.id AS thread_id, t.name AS thread_name,
      tp.stage_key,
      COALESCE(st.value ->> 'label', tp.stage_key) AS stage_label,
      tp.assignee_id, u.name AS assignee_name,
      GREATEST(tp.updated_at, COALESCE(tc.last_activity, tp.updated_at))::text AS last_touch,
      EXTRACT(DAY FROM now() - GREATEST(tp.updated_at, COALESCE(tc.last_activity, tp.updated_at)))::int AS days_stale
    FROM atlas.crm_thread_providers tp
    JOIN atlas.crm_threads t ON t.id = tp.thread_id AND t.status = 'active'
    JOIN atlas.crm_funnels f ON f.id = t.funnel_id
    JOIN atlas.crm_providers p ON p.id = tp.provider_id
    LEFT JOIN atlas.users u ON u.id = tp.assignee_id
    LEFT JOIN touch tc ON tc.thread_id = tp.thread_id AND tc.provider_id = tp.provider_id
    LEFT JOIN LATERAL jsonb_array_elements(f.stages) st ON st.value ->> 'key' = tp.stage_key
    WHERE ${where.join(' AND ')}
    ORDER BY days_stale DESC, p.name
    LIMIT $${params.length}
  `, params);
}

export type QueueFunnelStage = {
  stage_key: string;
  stage_label: string;
  is_success: boolean;
  n: number;
};

export type QueueFunnel = {
  stages: QueueFunnelStage[];
  total: number;
  open: number;
  onboarded: number;
  threads: number;
};

/**
 * The same person's work as getQueue, counted by stage — including the
 * terminal stage, which getQueue deliberately excludes.
 *
 * A funnel without its bottom isn't a funnel: the whole question it answers is
 * "how much of what I picked up actually landed". So this counts everything
 * assigned, and the table below it stays open-only.
 *
 * One person can hold providers on threads running different funnels, so the
 * stages here are the union of those funnels' stages, ordered by the earliest
 * position the stage holds in any of them. Two funnels that disagree about
 * ordering will produce an order that is right for one of them — visible in
 * the labels, and better than refusing to draw anything.
 */
export async function getQueueFunnel(opts: {
  assigneeId?: number | null;
  unassigned?: boolean;
  threadId?: number | null;
} = {}): Promise<QueueFunnel> {
  const params: unknown[] = [];
  const where: string[] = ["t.status = 'active'"];

  // Must take the same narrowing as getQueue, or the summary counts a wider
  // set than the board beneath it draws.
  if (opts.threadId) {
    params.push(opts.threadId);
    where.push(`t.id = $${params.length}`);
  }

  if (opts.unassigned) {
    where.push('tp.assignee_id IS NULL');
  } else if (opts.assigneeId != null) {
    params.push(opts.assigneeId);
    where.push(`tp.assignee_id = $${params.length}`);
  }

  const rows = await query<QueueFunnelStage & { threads: number }>(`
    WITH scoped AS (
      SELECT tp.stage_key, t.funnel_id, tp.thread_id
      FROM atlas.crm_thread_providers tp
      JOIN atlas.crm_threads t ON t.id = tp.thread_id
      WHERE ${where.join(' AND ')}
    ),
    stage_order AS (
      SELECT st.value ->> 'key'                                   AS stage_key,
             MIN(COALESCE(st.value ->> 'label', st.value ->> 'key')) AS stage_label,
             MIN(st.ord)                                          AS pos,
             bool_or(f.success_stage_key = st.value ->> 'key')    AS is_success
      FROM atlas.crm_funnels f
      CROSS JOIN LATERAL jsonb_array_elements(f.stages) WITH ORDINALITY AS st(value, ord)
      WHERE f.id IN (SELECT funnel_id FROM scoped)
      GROUP BY 1
    )
    SELECT so.stage_key, so.stage_label, so.is_success,
           COUNT(s.stage_key)::int                        AS n,
           (SELECT COUNT(DISTINCT thread_id) FROM scoped)::int AS threads
    FROM stage_order so
    LEFT JOIN scoped s ON s.stage_key = so.stage_key
    GROUP BY so.stage_key, so.stage_label, so.is_success, so.pos
    ORDER BY so.pos
  `, params);

  const stages = rows.map(({ stage_key, stage_label, is_success, n }) => ({
    stage_key, stage_label, is_success, n,
  }));
  const onboarded = stages.filter((s) => s.is_success).reduce((t, s) => t + s.n, 0);
  const total = stages.reduce((t, s) => t + s.n, 0);

  return { stages, total, open: total - onboarded, onboarded, threads: rows[0]?.threads ?? 0 };
}

export type WorkloadRow = {
  assignee_id: number | null;
  assignee_name: string | null;
  role: string | null;
  open_count: number;
  threads: number;
  oldest_days: number;
  stale_count: number;
};

/**
 * One row per person, plus a row for work nobody owns.
 *
 * Unassigned is included deliberately: an unowned provider is the one most
 * reliably missed, and a team view that only lists people hides it.
 */
export async function getTeamWorkload(staleAfterDays = 7): Promise<WorkloadRow[]> {
  return query<WorkloadRow>(`
    WITH touch AS (
      SELECT thread_id, provider_id, MAX(created_at) AS last_activity
      FROM atlas.crm_activities GROUP BY thread_id, provider_id
    ),
    open_work AS (
      SELECT tp.assignee_id, tp.thread_id,
             EXTRACT(DAY FROM now() - GREATEST(tp.updated_at, COALESCE(tc.last_activity, tp.updated_at)))::int AS days_stale
      FROM atlas.crm_thread_providers tp
      JOIN atlas.crm_threads t ON t.id = tp.thread_id AND t.status = 'active'
      JOIN atlas.crm_funnels f ON f.id = t.funnel_id
      LEFT JOIN touch tc ON tc.thread_id = tp.thread_id AND tc.provider_id = tp.provider_id
      WHERE tp.stage_key IS DISTINCT FROM f.success_stage_key
    )
    SELECT w.assignee_id, u.name AS assignee_name, u.role,
           COUNT(*)::int                                             AS open_count,
           COUNT(DISTINCT w.thread_id)::int                           AS threads,
           COALESCE(MAX(w.days_stale), 0)::int                        AS oldest_days,
           COUNT(*) FILTER (WHERE w.days_stale >= $1)::int            AS stale_count
    FROM open_work w
    LEFT JOIN atlas.users u ON u.id = w.assignee_id
    GROUP BY w.assignee_id, u.name, u.role
    ORDER BY (w.assignee_id IS NULL) DESC, COUNT(*) FILTER (WHERE w.days_stale >= $1) DESC, COUNT(*) DESC
  `, [staleAfterDays]);
}
