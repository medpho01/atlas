import 'server-only';
import { query, queryOne } from './db';
import type { User } from './auth';

/** Roles allowed to mutate CRM state. Everyone logged-in can read. */
export const CRM_WRITE_ROLES: User['role'][] = ['admin', 'network'];
export const canWriteCrm = (u: User | null): boolean => !!u && CRM_WRITE_ROLES.includes(u.role);

export type FunnelStage = { key: string; label: string };
export type Funnel = { id: number; name: string; stages: FunnelStage[]; is_default: boolean };

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
  return query<Funnel>(`SELECT id, name, stages, is_default FROM atlas.crm_funnels ORDER BY is_default DESC, name`);
}

export async function listThreads(): Promise<Thread[]> {
  return query<Thread>(`
    SELECT t.id, t.name, t.description, t.funnel_id, t.target_count, t.provider_kind,
           t.region, t.status, t.created_at, f.stages,
           COUNT(tp.id)::int AS provider_total,
           COUNT(tp.id) FILTER (WHERE tp.stage_key = 'onboarded')::int AS onboarded_count
    FROM atlas.crm_threads t
    JOIN atlas.crm_funnels f ON f.id = t.funnel_id
    LEFT JOIN atlas.crm_thread_providers tp ON tp.thread_id = t.id
    GROUP BY t.id, f.stages
    ORDER BY (t.status = 'active') DESC, t.created_at DESC
  `);
}

export async function getThread(id: number): Promise<Thread | null> {
  return queryOne<Thread>(`
    SELECT t.id, t.name, t.description, t.funnel_id, t.target_count, t.provider_kind,
           t.region, t.status, t.created_at, f.stages,
           (SELECT COUNT(*) FROM atlas.crm_thread_providers tp WHERE tp.thread_id = t.id)::int AS provider_total,
           (SELECT COUNT(*) FROM atlas.crm_thread_providers tp
             WHERE tp.thread_id = t.id AND tp.stage_key = 'onboarded')::int AS onboarded_count
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
