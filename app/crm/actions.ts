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
