'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { canWriteCrm, logActivity } from '@/lib/crm';

type R = { ok: boolean; error?: string; id?: number };

async function writer() {
  const me = await getSessionUser();
  if (!me) return { me: null, err: 'unauthenticated' };
  if (!canWriteCrm(me)) return { me: null, err: 'CRM changes need the network or admin role' };
  return { me, err: null };
}

export async function createThread(input: {
  name: string; description?: string; funnelId: number;
  targetCount: number; providerKind?: string; region?: string;
}): Promise<R> {
  const { me, err } = await writer();
  if (err) return { ok: false, error: err };
  if (!input.name.trim()) return { ok: false, error: 'Thread name required' };
  const row = await queryOne<{ id: number }>(
    `INSERT INTO atlas.crm_threads (name, description, funnel_id, target_count, provider_kind, region, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.name.trim(), input.description ?? null, input.funnelId, input.targetCount || 0,
     input.providerKind ?? null, input.region ?? null, me!.id],
  );
  revalidatePath('/crm');
  return { ok: true, id: row!.id };
}

export async function setThreadStatus(threadId: number, status: 'active' | 'paused' | 'done'): Promise<R> {
  const { err } = await writer();
  if (err) return { ok: false, error: err };
  await query(`UPDATE atlas.crm_threads SET status = $1, updated_at = now() WHERE id = $2`, [status, threadId]);
  revalidatePath('/crm');
  return { ok: true };
}

export async function createProvider(input: {
  threadId?: number; name: string; kind: string; city?: string; state?: string;
  pincode?: string; phone?: string; email?: string; contactPerson?: string; notes?: string;
}): Promise<R> {
  const { me, err } = await writer();
  if (err) return { ok: false, error: err };
  if (!input.name.trim()) return { ok: false, error: 'Provider name required' };

  const p = await queryOne<{ id: number }>(
    `INSERT INTO atlas.crm_providers (name, kind, city, state, pincode, phone, email, contact_person, notes, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $10) RETURNING id`,
    [input.name.trim(), input.kind || 'LAB', input.city ?? null, input.state ?? null,
     input.pincode ?? null, input.phone ?? null, input.email ?? null,
     input.contactPerson ?? null, input.notes ?? null, me!.id],
  );
  await logActivity({
    threadId: input.threadId ?? null, providerId: p!.id, authorId: me!.id,
    type: 'provider_created', body: `Added ${input.name.trim()}`,
  });

  if (input.threadId) {
    const t = await queryOne<{ stages: { key: string }[] }>(
      `SELECT f.stages FROM atlas.crm_threads t JOIN atlas.crm_funnels f ON f.id = t.funnel_id WHERE t.id = $1`,
      [input.threadId],
    );
    const firstStage = t?.stages?.[0]?.key ?? 'identified';
    await query(
      `INSERT INTO atlas.crm_thread_providers (thread_id, provider_id, stage_key, added_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT (thread_id, provider_id) DO NOTHING`,
      [input.threadId, p!.id, firstStage, me!.id],
    );
    revalidatePath(`/crm/${input.threadId}`);
  }
  return { ok: true, id: p!.id };
}

export async function moveStage(input: {
  threadId: number; providerId: number; toStage: string; note?: string;
}): Promise<R> {
  const { me, err } = await writer();
  if (err) return { ok: false, error: err };

  const cur = await queryOne<{ stage_key: string }>(
    `SELECT stage_key FROM atlas.crm_thread_providers WHERE thread_id = $1 AND provider_id = $2`,
    [input.threadId, input.providerId],
  );
  if (!cur) return { ok: false, error: 'Provider not in this thread' };

  await query(
    `UPDATE atlas.crm_thread_providers SET stage_key = $1, updated_at = now()
     WHERE thread_id = $2 AND provider_id = $3`,
    [input.toStage, input.threadId, input.providerId],
  );
  await logActivity({
    threadId: input.threadId, providerId: input.providerId, authorId: me!.id,
    type: 'stage_change',
    body: input.note?.trim() || null || undefined,
    meta: { from: cur.stage_key, to: input.toStage },
  });
  revalidatePath(`/crm/${input.threadId}`);
  return { ok: true };
}

export async function assignProvider(input: {
  threadId: number; providerId: number; assigneeId: number | null;
}): Promise<R> {
  const { me, err } = await writer();
  if (err) return { ok: false, error: err };
  await query(
    `UPDATE atlas.crm_thread_providers SET assignee_id = $1, updated_at = now()
     WHERE thread_id = $2 AND provider_id = $3`,
    [input.assigneeId, input.threadId, input.providerId],
  );
  const who = input.assigneeId
    ? (await queryOne<{ name: string }>(`SELECT name FROM atlas.users WHERE id = $1`, [input.assigneeId]))?.name
    : 'nobody';
  await logActivity({
    threadId: input.threadId, providerId: input.providerId, authorId: me!.id,
    type: 'assignment', body: `Assigned to ${who}`,
    meta: { assignee_id: input.assigneeId },
  });
  revalidatePath(`/crm/${input.threadId}`);
  return { ok: true };
}

export async function addNote(input: {
  threadId: number; providerId: number; body: string;
}): Promise<R> {
  const { me, err } = await writer();
  if (err) return { ok: false, error: err };
  if (!input.body.trim()) return { ok: false, error: 'Empty note' };
  await logActivity({
    threadId: input.threadId, providerId: input.providerId, authorId: me!.id,
    type: 'note', body: input.body.trim(),
  });
  revalidatePath(`/crm/${input.threadId}`);
  return { ok: true };
}

export async function updateProvider(input: {
  providerId: number; threadId?: number;
  fields: Partial<{ name: string; kind: string; city: string; state: string; pincode: string;
                    phone: string; email: string; contact_person: string; notes: string; source_lab_id: number | null }>;
}): Promise<R> {
  const { err } = await writer();
  if (err) return { ok: false, error: err };
  const allowed = ['name','kind','city','state','pincode','phone','email','contact_person','notes','source_lab_id'] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) {
    if (k in input.fields) {
      vals.push((input.fields as Record<string, unknown>)[k]);
      sets.push(`${k} = $${vals.length}`);
    }
  }
  if (!sets.length) return { ok: true };
  vals.push(input.providerId);
  await query(`UPDATE atlas.crm_providers SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals);
  if (input.threadId) revalidatePath(`/crm/${input.threadId}`);
  return { ok: true };
}

export async function createFunnel(input: { name: string; stages: { key: string; label: string }[] }): Promise<R> {
  const me = await getSessionUser();
  if (!me || me.role !== 'admin') return { ok: false, error: 'Funnel management is admin-only' };
  if (!input.name.trim()) return { ok: false, error: 'Funnel name required' };
  const stages = (input.stages ?? []).filter((s) => s.label.trim());
  if (stages.length < 2) return { ok: false, error: 'A funnel needs at least 2 stages' };
  // Derive stable keys from labels; ensure uniqueness
  const seen = new Set<string>();
  const norm = stages.map((st) => {
    let key = st.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'stage';
    while (seen.has(key)) key = key + '_2';
    seen.add(key);
    return { key, label: st.label.trim() };
  });
  const row = await queryOne<{ id: number }>(
    `INSERT INTO atlas.crm_funnels (name, stages, created_by) VALUES ($1, $2, $3) RETURNING id`,
    [input.name.trim(), JSON.stringify(norm), me.id],
  );
  revalidatePath('/crm');
  return { ok: true, id: row!.id };
}

export async function updateThread(input: {
  threadId: number;
  fields: Partial<{ name: string; description: string; target_count: number; region: string; status: 'active' | 'paused' | 'done' }>;
}): Promise<R> {
  const { err } = await writer();
  if (err) return { ok: false, error: err };
  const allowed = ['name', 'description', 'target_count', 'region', 'status'] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) {
    if (k in input.fields) {
      vals.push((input.fields as Record<string, unknown>)[k]);
      sets.push(`${k} = $${vals.length}`);
    }
  }
  if (!sets.length) return { ok: true };
  vals.push(input.threadId);
  await query(`UPDATE atlas.crm_threads SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals);
  revalidatePath('/crm');
  revalidatePath(`/crm/${input.threadId}`);
  return { ok: true };
}

export async function bulkCreateProviders(input: {
  threadId: number;
  rows: { name: string; kind?: string; city?: string; state?: string; pincode?: string;
          phone?: string; email?: string; contactPerson?: string; notes?: string }[];
}): Promise<{ ok: boolean; error?: string; created?: number; skipped?: number }> {
  const { me, err } = await writer();
  if (err) return { ok: false, error: err };
  const rows = (input.rows ?? []).filter((r) => r.name?.trim()).slice(0, 2000);
  if (!rows.length) return { ok: false, error: 'No valid rows (name required)' };

  const t = await queryOne<{ stages: { key: string }[] }>(
    `SELECT f.stages FROM atlas.crm_threads t JOIN atlas.crm_funnels f ON f.id = t.funnel_id WHERE t.id = $1`,
    [input.threadId],
  );
  if (!t) return { ok: false, error: 'Thread not found' };
  const firstStage = t.stages?.[0]?.key ?? 'identified';

  let created = 0, skipped = 0;
  for (const r of rows) {
    // Skip exact-name duplicates already in this thread
    const dup = await queryOne(
      `SELECT 1 FROM atlas.crm_thread_providers tp
       JOIN atlas.crm_providers p ON p.id = tp.provider_id
       WHERE tp.thread_id = $1 AND lower(p.name) = lower($2)`,
      [input.threadId, r.name.trim()],
    );
    if (dup) { skipped++; continue; }
    const p = await queryOne<{ id: number }>(
      `INSERT INTO atlas.crm_providers (name, kind, city, state, pincode, phone, email, contact_person, notes, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'import', $10) RETURNING id`,
      [r.name.trim(), r.kind || 'LAB', r.city ?? null, r.state ?? null, r.pincode ?? null,
       r.phone ?? null, r.email ?? null, r.contactPerson ?? null, r.notes ?? null, me!.id],
    );
    await query(
      `INSERT INTO atlas.crm_thread_providers (thread_id, provider_id, stage_key, added_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [input.threadId, p!.id, firstStage, me!.id],
    );
    created++;
  }
  revalidatePath(`/crm/${input.threadId}`);
  return { ok: true, created, skipped };
}

export async function addChecklistItem(input: { threadId: number; label: string; required: boolean }): Promise<R> {
  const { err } = await writer();
  if (err) return { ok: false, error: err };
  if (!input.label.trim()) return { ok: false, error: 'Label required' };
  // First thread-specific item? Copy the global defaults so the thread starts from them.
  const has = await queryOne(`SELECT 1 FROM atlas.crm_checklist_items WHERE thread_id = $1`, [input.threadId]);
  if (!has) {
    await query(
      `INSERT INTO atlas.crm_checklist_items (thread_id, label, required, sort)
       SELECT $1, label, required, sort FROM atlas.crm_checklist_items WHERE thread_id IS NULL`,
      [input.threadId],
    );
  }
  await query(
    `INSERT INTO atlas.crm_checklist_items (thread_id, label, required, sort)
     VALUES ($1, $2, $3, COALESCE((SELECT MAX(sort) + 1 FROM atlas.crm_checklist_items WHERE thread_id = $1), 1))`,
    [input.threadId, input.label.trim(), input.required],
  );
  revalidatePath(`/crm/${input.threadId}`);
  return { ok: true };
}

export async function removeChecklistItem(input: { threadId: number; itemId: number }): Promise<R> {
  const { err } = await writer();
  if (err) return { ok: false, error: err };
  // Same copy-on-write: materialise thread checklist before removing from it
  const has = await queryOne(`SELECT 1 FROM atlas.crm_checklist_items WHERE thread_id = $1`, [input.threadId]);
  if (!has) {
    await query(
      `INSERT INTO atlas.crm_checklist_items (thread_id, label, required, sort)
       SELECT $1, label, required, sort FROM atlas.crm_checklist_items WHERE thread_id IS NULL AND id <> $2`,
      [input.threadId, input.itemId],
    );
  } else {
    await query(`DELETE FROM atlas.crm_checklist_items WHERE id = $1 AND thread_id = $2`, [input.itemId, input.threadId]);
  }
  revalidatePath(`/crm/${input.threadId}`);
  return { ok: true };
}
