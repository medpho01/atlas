'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { canWriteCrm, canLeadCrm, logActivity } from '@/lib/crm';
import { normalizeProviderKind } from '@/lib/providerKinds';

type R = { ok: boolean; error?: string; id?: number };

async function writer() {
  const me = await getSessionUser();
  if (!me) return { me: null, err: 'unauthenticated' };
  if (!canWriteCrm(me)) return { me: null, err: 'CRM changes need the network or admin role' };
  return { me, err: null };
}

/**
 * Running the campaign, as opposed to working it.
 *
 * Creating threads, renaming them, choosing who is on them and deleting them
 * are the lead's calls. These were open to anyone with a CRM login, so a
 * member could rename a campaign they were not on or drop someone from it.
 */
async function lead() {
  const me = await getSessionUser();
  if (!me) return { me: null, err: 'unauthenticated' as const };
  if (!canLeadCrm(me)) return { me, err: 'Only a network lead or admin can do this' as const };
  return { me, err: null };
}

/**
 * Members act on their own work. Enforced here rather than only in the UI —
 * a server action is a public endpoint, and hiding a button hides nothing.
 * Unassigned cards are fair game: picking up unowned work is the point of the
 * Unassigned filter.
 */
async function canActOnProviders(me: { id: number; role: string }, threadId: number, providerIds: number[]) {
  if (canLeadCrm(me as never)) return true;
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM atlas.crm_thread_providers
      WHERE thread_id = $1 AND provider_id = ANY($2::int[])
        AND assignee_id IS NOT NULL AND assignee_id <> $3`,
    [threadId, providerIds, me.id],
  );
  return (rows[0]?.n ?? 0) === 0;
}

export async function createThread(input: {
  name: string; description?: string; funnelId: number;
  targetCount: number; providerKind?: string; region?: string;
}): Promise<R> {
  const { me, err } = await lead();
  if (err) return { ok: false, error: err };
  // Threads are the CRM's top-level structure and deleting one cascades to
  // every provider link, activity and checklist item on it. Creating them is
  // an admin decision, not day-to-day network work.
  if (me!.role !== 'admin') return { ok: false, error: 'Only an admin can create a thread' };
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
  const { err } = await lead();
  if (err) return { ok: false, error: err };
  await query(`UPDATE atlas.crm_threads SET status = $1, updated_at = now() WHERE id = $2`, [status, threadId]);
  revalidatePath('/crm');
  return { ok: true };
}

/**
 * The TypeScript twin of atlas.crm_name_key. Kept in step with it — the SQL
 * one is what the index and the merge script use.
 */
function crmNameKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function createProvider(input: {
  threadId?: number; name: string; kind: string; city?: string; state?: string;
  pincode?: string; phone?: string; email?: string; contactPerson?: string; notes?: string;
}): Promise<R> {
  const { me, err } = await writer();
  if (err) return { ok: false, error: err };
  if (!input.name.trim()) return { ok: false, error: 'Provider name required' };

  const name = input.name.trim();

  // Reuse the directory record if this organisation is already known, the same
  // way the importer does. Two rows for one hospital split its history across
  // records that no longer look like the same provider.
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM atlas.crm_providers WHERE atlas.crm_name_key(name) = atlas.crm_name_key($1) ORDER BY id LIMIT 1`,
    [name],
  );

  const p = existing ?? await queryOne<{ id: number }>(
    `INSERT INTO atlas.crm_providers (name, kind, city, state, pincode, phone, email, contact_person, notes, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $10) RETURNING id`,
    [name, normalizeProviderKind(input.kind) || 'LAB', input.city ?? null, input.state ?? null,
     input.pincode ?? null, input.phone ?? null, input.email ?? null,
     input.contactPerson ?? null, input.notes ?? null, me!.id],
  );
  await logActivity({
    threadId: input.threadId ?? null, providerId: p!.id, authorId: me!.id,
    type: 'provider_created',
    body: existing ? `Added ${name} from the directory` : `Added ${name}`,
  });

  if (input.threadId) {
    const t = await queryOne<{ stages: { key: string }[] }>(
      `SELECT f.stages FROM atlas.crm_threads t JOIN atlas.crm_funnels f ON f.id = t.funnel_id WHERE t.id = $1`,
      [input.threadId],
    );
    const firstStage = t?.stages?.[0]?.key ?? 'identified';
    // A network person adding a provider is picking up that work, so it lands
    // owned rather than in the unassigned pile someone has to notice and
    // distribute. Admins are excluded: they add on other people's behalf, and
    // auto-owning it would hide the row from whoever should act on it.
    const owner = me!.role === 'admin' ? null : me!.id;
    await query(
      `INSERT INTO atlas.crm_thread_providers (thread_id, provider_id, stage_key, added_by, assignee_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (thread_id, provider_id) DO NOTHING`,
      [input.threadId, p!.id, firstStage, me!.id, owner],
    );
    revalidatePath(`/crm/${input.threadId}`);
  }
  return { ok: true, id: p!.id };
}

/**
 * Who works this thread.
 *
 * Replaces the whole roster in one call rather than adding and removing one at
 * a time: the UI edits a list, and a diffing endpoint would let two people
 * editing at once leave the roster in a state neither of them chose.
 */
/**
 * Retire a thread, optionally moving its providers somewhere else first.
 *
 * A campaign that is finished or was created by mistake should not sit on the
 * board forever, but deleting it would take its cards with it — crm_thread_
 * providers cascades — and with them every stage anyone had moved a provider
 * to. So the move happens first and the delete only proceeds once the cards
 * are safe. Providers themselves are never deleted: the record is shared and
 * its history belongs to the organisation, not to one campaign.
 */
export async function deleteThread(input: {
  threadId: number; reassignToThreadId?: number | null;
}): Promise<{ ok: boolean; error?: string; moved?: number }> {
  const { me, err } = await writer();
  if (err) return { ok: false, error: err };
  if (me!.role !== 'admin') return { ok: false, error: 'Only an admin can delete a thread' };
  if (input.reassignToThreadId === input.threadId) {
    return { ok: false, error: 'Pick a different thread to move providers into' };
  }

  let moved = 0;
  if (input.reassignToThreadId) {
    const target = await queryOne<{ stages: { key: string }[] }>(
      `SELECT f.stages FROM atlas.crm_threads t JOIN atlas.crm_funnels f ON f.id = t.funnel_id WHERE t.id = $1`,
      [input.reassignToThreadId],
    );
    if (!target) return { ok: false, error: 'Target thread not found' };
    const firstStage = target.stages?.[0]?.key ?? 'identified';

    // Carry the stage across where the target funnel has the same stage key,
    // otherwise start at the beginning. Guessing an equivalent stage between
    // two different funnels would silently move someone's work.
    const rows = await query<{ n: number }>(
      `INSERT INTO atlas.crm_thread_providers (thread_id, provider_id, stage_key, added_by, assignee_id)
       SELECT $2,
              tp.provider_id,
              CASE WHEN EXISTS (
                SELECT 1 FROM atlas.crm_threads t2
                JOIN atlas.crm_funnels f2 ON f2.id = t2.funnel_id
                WHERE t2.id = $2
                  AND f2.stages @> jsonb_build_array(jsonb_build_object('key', tp.stage_key))
              ) THEN tp.stage_key ELSE $3 END,
              $4, tp.assignee_id
       FROM atlas.crm_thread_providers tp
       WHERE tp.thread_id = $1
       ON CONFLICT (thread_id, provider_id) DO NOTHING
       RETURNING 1 AS n`,
      [input.threadId, input.reassignToThreadId, firstStage, me!.id],
    );
    moved = rows.length;

    // Keep the journey readable: activities pointed at the old thread would
    // otherwise be orphaned when it goes.
    await query(`UPDATE atlas.crm_activities SET thread_id = $2 WHERE thread_id = $1`,
      [input.threadId, input.reassignToThreadId]);
  }

  await query(`DELETE FROM atlas.crm_threads WHERE id = $1`, [input.threadId]);
  revalidatePath('/crm/threads');
  revalidatePath('/crm');
  return { ok: true, moved };
}

export async function renameThread(input: { threadId: number; name: string }): Promise<R> {
  const { err } = await lead();
  if (err) return { ok: false, error: err };
  if (!input.name.trim()) return { ok: false, error: 'Name required' };
  await query(`UPDATE atlas.crm_threads SET name = $1, updated_at = now() WHERE id = $2`,
    [input.name.trim(), input.threadId]);
  revalidatePath('/crm/threads');
  revalidatePath('/crm');
  return { ok: true };
}

export async function setThreadMembers(input: {
  threadId: number; userIds: number[];
}): Promise<R> {
  const { me, err } = await lead();
  if (err) return { ok: false, error: err };
  const ids = Array.from(new Set(input.userIds.filter((n) => Number.isFinite(n))));

  await query(`DELETE FROM atlas.crm_thread_members WHERE thread_id = $1 AND NOT (user_id = ANY($2::int[]))`,
    [input.threadId, ids]);
  if (ids.length) {
    await query(
      `INSERT INTO atlas.crm_thread_members (thread_id, user_id, added_by)
       SELECT $1, u, $3 FROM unnest($2::int[]) u
       ON CONFLICT (thread_id, user_id) DO NOTHING`,
      [input.threadId, ids, me!.id],
    );
  }
  revalidatePath('/crm/threads');
  revalidatePath('/crm');
  return { ok: true };
}

/**
 * Put existing provider cards on a thread.
 *
 * The provider record is shared, so this adds a thread membership rather than
 * moving anything: a hospital can be worked in two campaigns at once and its
 * history stays on one card. Cards already on the thread are left where they
 * are — re-adding must not reset someone's stage back to the start.
 */
export async function addProvidersToThread(input: {
  providerIds: number[]; threadId: number; assigneeId?: number | null;
}): Promise<{ ok: boolean; error?: string; added?: number; already?: number }> {
  const { me, err } = await writer();
  if (err) return { ok: false, error: err };
  const ids = Array.from(new Set(input.providerIds.filter((n) => Number.isFinite(n))));
  if (!ids.length) return { ok: false, error: 'Pick at least one provider' };

  const t = await queryOne<{ stages: { key: string }[] }>(
    `SELECT f.stages FROM atlas.crm_threads t JOIN atlas.crm_funnels f ON f.id = t.funnel_id WHERE t.id = $1`,
    [input.threadId],
  );
  if (!t) return { ok: false, error: 'Thread not found' };
  const firstStage = t.stages?.[0]?.key ?? 'identified';

  const before = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM atlas.crm_thread_providers
      WHERE thread_id = $1 AND provider_id = ANY($2::int[])`,
    [input.threadId, ids],
  );

  await query(
    `INSERT INTO atlas.crm_thread_providers (thread_id, provider_id, stage_key, added_by, assignee_id)
     SELECT $1, p, $2, $3, $4 FROM unnest($5::int[]) p
     ON CONFLICT (thread_id, provider_id) DO NOTHING`,
    [input.threadId, firstStage, me!.id, input.assigneeId ?? null, ids],
  );

  for (const providerId of ids) {
    await logActivity({
      threadId: input.threadId, providerId, authorId: me!.id,
      type: 'thread_added', body: 'Added to this thread',
    });
  }
  revalidatePath(`/crm/${input.threadId}`);
  revalidatePath('/crm');
  const already = before?.n ?? 0;
  return { ok: true, added: ids.length - already, already };
}

export async function moveStage(input: {
  threadId: number; providerId: number; toStage: string; note?: string;
}): Promise<R> {
  const { me, err } = await writer();
  if (err) return { ok: false, error: err };
  if (!(await canActOnProviders(me!, input.threadId, [input.providerId]))) {
    return { ok: false, error: 'That provider is assigned to someone else' };
  }

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
  if (!(await canActOnProviders(me!, input.threadId, [input.providerId]))) {
    return { ok: false, error: 'That provider is assigned to someone else' };
  }
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
  if (!(await canActOnProviders(me!, input.threadId, [input.providerId]))) {
    return { ok: false, error: 'That provider is assigned to someone else' };
  }
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
      const v = (input.fields as Record<string, unknown>)[k];
      vals.push(k === 'kind' ? normalizeProviderKind(v as string) || 'LAB' : v);
      sets.push(`${k} = $${vals.length}`);
    }
  }
  if (!sets.length) return { ok: true };
  vals.push(input.providerId);
  await query(`UPDATE atlas.crm_providers SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals);
  if (input.threadId) revalidatePath(`/crm/${input.threadId}`);
  return { ok: true };
}

export async function createFunnel(input: { name: string; stages: { key: string; label: string }[]; successIndex?: number }): Promise<R> {
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
  // Success stage: explicit pick, else last stage mentioning "onboard", else last.
  const idx = input.successIndex;
  const successKey =
    (idx != null && idx >= 0 && idx < norm.length) ? norm[idx].key
    : ([...norm].reverse().find((st) => /onboard/i.test(st.key + st.label))?.key ?? norm[norm.length - 1].key);
  const row = await queryOne<{ id: number }>(
    `INSERT INTO atlas.crm_funnels (name, stages, success_stage_key, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.name.trim(), JSON.stringify(norm), successKey, me.id],
  );
  revalidatePath('/crm');
  return { ok: true, id: row!.id };
}

export async function updateThread(input: {
  threadId: number;
  fields: Partial<{ name: string; description: string; target_count: number; region: string; status: 'active' | 'paused' | 'done' }>;
}): Promise<R> {
  const { err } = await lead();
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

export type DupStatus = 'new' | 'in_thread' | 'in_directory' | 'in_file';

/**
 * Classify names against what already exists, before anything is written.
 *
 * Returns one status per distinct name — repeats within the uploaded file are
 * the caller's business, because only it knows row order. Keying the result by
 * name here would collapse the two rows of a repeated name into one status and
 * mark both as repeats, losing the first occurrence that should have imported.
 */
export async function checkProviderDuplicates(input: {
  threadId: number; names: string[];
}): Promise<{ ok: boolean; error?: string; statuses?: Record<string, DupStatus>;
              similar?: Record<string, string[]> }> {
  const { err } = await lead();
  if (err) return { ok: false, error: err };

  const names = (input.names ?? []).map((n) => (n ?? '').trim()).filter(Boolean);
  if (!names.length) return { ok: true, statuses: {} };

  // Match on the normalised name, not lower(name): "Apollo Hospitals Pvt. Ltd."
  // and "apollo  hospitals pvt ltd" are one organisation, and treating them as
  // two is how a note ends up as a second card.
  const keys = names.map(crmNameKey);

  const onThread = await query<{ k: string }>(
    `SELECT atlas.crm_name_key(p.name) AS k FROM atlas.crm_thread_providers tp
     JOIN atlas.crm_providers p ON p.id = tp.provider_id
     WHERE tp.thread_id = $1 AND atlas.crm_name_key(p.name) = ANY($2::text[])`,
    [input.threadId, keys],
  );
  const inDirectory = await query<{ k: string }>(
    `SELECT DISTINCT atlas.crm_name_key(name) AS k FROM atlas.crm_providers
     WHERE atlas.crm_name_key(name) = ANY($1::text[])`,
    [keys],
  );

  const thread = new Set(onThread.map((r) => r.k));
  const directory = new Set(inDirectory.map((r) => r.k));
  const statuses: Record<string, DupStatus> = {};

  // Keyed by the caller's own string. It used to be keyed by the lowercased
  // name while the caller looked it up by what the user typed, so the warning
  // never appeared for anything with a capital letter in it.
  for (const n of names) {
    const k = crmNameKey(n);
    statuses[n] = thread.has(k) ? 'in_thread' : directory.has(k) ? 'in_directory' : 'new';
  }
  // Near-duplicates. An exact key cannot catch "RXDX Labs" vs "RxDx" or
  // "Ekaiva Diagnostics" vs "Ekiava", which is how the same provider ends up
  // on the board twice. Compared on the core name — the descriptor words
  // stripped — because on the full string a shared "Hospitals" outweighs the
  // part that actually names the organisation.
  const similar: Record<string, string[]> = {};
  const unresolved = names.filter((n) => statuses[n] === 'new');
  if (unresolved.length) {
    const near = await query<{ input: string; name: string }>(
      `SELECT i.input, p.name
       FROM unnest($1::text[]) AS i(input)
       JOIN atlas.crm_providers p
         ON atlas.crm_core_name(p.name) <> ''
        AND atlas.crm_core_name(i.input) <> ''
        -- Anything matching on the full key is already reported above.
        AND atlas.crm_name_key(p.name) <> atlas.crm_name_key(i.input)
        AND (
          -- Same organisation, different descriptor: "RxDx" / "RXDX Labs".
          atlas.crm_core_name(p.name) = atlas.crm_core_name(i.input)
          OR similarity(atlas.crm_core_name(p.name), atlas.crm_core_name(i.input)) >= 0.6
          -- A typo or transposition: "Ekiava" / "Ekaiva". Six characters is
          -- the floor — at five, "kanva" and "ekaiva" are two edits apart and
          -- the warning starts naming unrelated providers.
          OR (length(atlas.crm_core_name(i.input)) >= 6
              AND levenshtein(atlas.crm_core_name(p.name), atlas.crm_core_name(i.input)) <= 2)
        )
       ORDER BY i.input,
                levenshtein(atlas.crm_core_name(p.name), atlas.crm_core_name(i.input)),
                p.name
       LIMIT 40`,
      [unresolved],
    );
    for (const r of near) (similar[r.input] ??= []).push(r.name);
  }

  return { ok: true, statuses, similar };
}

export async function bulkCreateProviders(input: {
  threadId: number;
  rows: { name: string; kind?: string; city?: string; state?: string; pincode?: string;
          phone?: string; email?: string; contactPerson?: string; notes?: string }[];
}): Promise<{ ok: boolean; error?: string; created?: number; linked?: number; skipped?: number }> {
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

  // Same rule as the single-provider path: whoever imports the list owns the
  // rows, unless they're an admin loading it for someone else.
  const importOwner = me!.role === 'admin' ? null : me!.id;

  let created = 0, linked = 0, skipped = 0;
  // A file listing the same hospital twice would otherwise add it once and
  // report the second as an existing provider, which reads like a bug.
  const seenInFile = new Set<string>();

  for (const r of rows) {
    const name = r.name.trim();
    const key = crmNameKey(name);
    if (seenInFile.has(key)) { skipped++; continue; }
    seenInFile.add(key);

    const dup = await queryOne(
      `SELECT 1 FROM atlas.crm_thread_providers tp
       JOIN atlas.crm_providers p ON p.id = tp.provider_id
       WHERE tp.thread_id = $1 AND atlas.crm_name_key(p.name) = $2`,
      [input.threadId, key],
    );
    if (dup) { skipped++; continue; }

    // Reuse the directory record when the organisation is already known.
    // Creating a second row for the same hospital splits its history across
    // two records that no longer look like the same provider.
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM atlas.crm_providers WHERE atlas.crm_name_key(name) = $1 ORDER BY id LIMIT 1`,
      [key],
    );

    let providerId = existing?.id;
    if (providerId) {
      linked++;
    } else {
      const p = await queryOne<{ id: number }>(
        `INSERT INTO atlas.crm_providers (name, kind, city, state, pincode, phone, email, contact_person, notes, source, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'import', $10) RETURNING id`,
        [name, normalizeProviderKind(r.kind) || 'LAB', r.city ?? null, r.state ?? null, r.pincode ?? null,
         r.phone ?? null, r.email ?? null, r.contactPerson ?? null, r.notes ?? null, me!.id],
      );
      providerId = p!.id;
      created++;
    }

    await query(
      `INSERT INTO atlas.crm_thread_providers (thread_id, provider_id, stage_key, added_by, assignee_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [input.threadId, providerId, firstStage, me!.id, importOwner],
    );
  }
  revalidatePath(`/crm/${input.threadId}`);
  return { ok: true, created, linked, skipped };
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

export async function setFunnelSuccessStage(input: { funnelId: number; stageKey: string }): Promise<R> {
  const me = await getSessionUser();
  if (!me || me.role !== 'admin') return { ok: false, error: 'Funnel management is admin-only' };
  const f = await queryOne<{ stages: { key: string }[] }>(
    `SELECT stages FROM atlas.crm_funnels WHERE id = $1`, [input.funnelId]);
  if (!f) return { ok: false, error: 'Funnel not found' };
  if (!f.stages.some((s) => s.key === input.stageKey)) return { ok: false, error: 'Stage not in this funnel' };
  await query(`UPDATE atlas.crm_funnels SET success_stage_key = $1 WHERE id = $2`, [input.stageKey, input.funnelId]);
  revalidatePath('/crm');
  return { ok: true };
}

/**
 * Take a provider off this thread.
 *
 * Only the thread membership goes: the provider stays in atlas.crm_providers,
 * so it can be added back or worked in another thread. Removing the record of
 * the organisation itself because it was added to one funnel by mistake would
 * be a much larger action than the button implies.
 *
 * Activities and documents are kept. They are provider-scoped and invisible
 * while the provider isn't on the thread, but if it comes back the journey
 * comes back with it — including the removal itself, which is worth being able
 * to see. Deleting them would quietly destroy the record of work already done.
 */
export async function removeFromThread(input: {
  threadId: number; providerId: number;
}): Promise<R> {
  const { me, err } = await writer();
  if (err) return { ok: false, error: err };
  if (me!.role !== 'admin') {
    return { ok: false, error: 'Only an admin can remove a provider from a thread' };
  }

  const p = await queryOne<{ name: string }>(
    `SELECT name FROM atlas.crm_providers WHERE id = $1`, [input.providerId],
  );
  if (!p) return { ok: false, error: 'Provider not found' };

  const gone = await query(
    `DELETE FROM atlas.crm_thread_providers
     WHERE thread_id = $1 AND provider_id = $2 RETURNING provider_id`,
    [input.threadId, input.providerId],
  );
  if (!gone.length) return { ok: false, error: 'Not on this thread' };

  await logActivity({
    threadId: input.threadId, providerId: input.providerId, authorId: me!.id,
    type: 'removal', body: 'Removed from this thread', meta: {},
  }).catch(() => {});
  revalidatePath(`/crm/${input.threadId}`);
  return { ok: true };
}

/**
 * Apply one change to many providers at once.
 *
 * Assign, move and remove share a shape — a set of thread members and one
 * instruction — so they share an action rather than three that drift apart.
 * Each provider is logged individually, so a bulk change reads the same as
 * the equivalent one-at-a-time changes in every journey.
 */
export async function bulkUpdateProviders(input: {
  threadId: number;
  providerIds: number[];
  op: 'assign' | 'move' | 'remove';
  assigneeId?: number | null;
  toStage?: string;
}): Promise<R & { affected?: number }> {
  const { me, err } = await writer();
  if (err) return { ok: false, error: err };

  const ids = [...new Set((input.providerIds ?? []).filter((n) => Number.isFinite(n)))];
  if (!ids.length) return { ok: false, error: 'Nothing selected' };
  if (ids.length > 500) return { ok: false, error: 'Too many at once — 500 max' };

  if (input.op === 'remove') {
    // Checked here as well as inside removeFromThread: this loop ignores each
    // call's result, so without it a non-admin would be told 500 providers
    // were removed while nothing happened.
    if (me!.role !== 'admin') {
      return { ok: false, error: 'Only an admin can remove providers from a thread' };
    }
    for (const providerId of ids) await removeFromThread({ threadId: input.threadId, providerId });
    return { ok: true, affected: ids.length };
  }

  if (input.op === 'assign') {
    const who = input.assigneeId
      ? (await queryOne<{ name: string }>(`SELECT name FROM atlas.users WHERE id = $1`, [input.assigneeId]))?.name
      : 'nobody';
    await query(
      `UPDATE atlas.crm_thread_providers SET assignee_id = $1, updated_at = now()
       WHERE thread_id = $2 AND provider_id = ANY($3::int[])`,
      [input.assigneeId ?? null, input.threadId, ids],
    );
    for (const providerId of ids) {
      await logActivity({
        threadId: input.threadId, providerId, authorId: me!.id,
        type: 'assignment', body: `Assigned to ${who}`,
        meta: { assignee_id: input.assigneeId ?? null, bulk: true },
      }).catch(() => {});
    }
    revalidatePath(`/crm/${input.threadId}`);
    return { ok: true, affected: ids.length };
  }

  if (!input.toStage) return { ok: false, error: 'No stage given' };
  // Only rows actually changing stage are logged, so a bulk move doesn't fill
  // journeys with "moved to the stage it was already in".
  const changing = await query<{ provider_id: number; stage_key: string }>(
    `SELECT provider_id, stage_key FROM atlas.crm_thread_providers
     WHERE thread_id = $1 AND provider_id = ANY($2::int[]) AND stage_key <> $3`,
    [input.threadId, ids, input.toStage],
  );
  await query(
    `UPDATE atlas.crm_thread_providers SET stage_key = $1, updated_at = now()
     WHERE thread_id = $2 AND provider_id = ANY($3::int[])`,
    [input.toStage, input.threadId, ids],
  );
  for (const row of changing) {
    await logActivity({
      threadId: input.threadId, providerId: row.provider_id, authorId: me!.id,
      type: 'stage_move', body: `Moved from ${row.stage_key} to ${input.toStage}`,
      meta: { from: row.stage_key, to: input.toStage, bulk: true },
    }).catch(() => {});
  }
  revalidatePath(`/crm/${input.threadId}`);
  return { ok: true, affected: changing.length };
}
