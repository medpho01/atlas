import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { canWriteCrm, logActivity } from '@/lib/crm';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB per file
const BLOCKED_EXT = new Set(['exe', 'sh', 'bat', 'cmd', 'js', 'html', 'svg']);

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(user, 'providerPipeline') || !canWriteCrm(user)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'bad form' }, { status: 400 });

  const file = form.get('file');
  const providerId = parseInt(String(form.get('provider_id') ?? ''), 10);
  const threadId = parseInt(String(form.get('thread_id') ?? ''), 10);
  const checklistRaw = String(form.get('checklist_item_id') ?? '');
  const checklistItemId = checklistRaw ? parseInt(checklistRaw, 10) : null;

  if (!(file instanceof File)) return NextResponse.json({ error: 'file missing' }, { status: 400 });
  if (!Number.isInteger(providerId)) return NextResponse.json({ error: 'provider_id missing' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large (max 20 MB)' }, { status: 413 });

  const orig = file.name || 'document';
  const ext = (orig.split('.').pop() ?? '').toLowerCase();
  if (BLOCKED_EXT.has(ext)) return NextResponse.json({ error: 'file type not allowed' }, { status: 400 });

  const provider = await queryOne(`SELECT 1 FROM atlas.crm_providers WHERE id = $1`, [providerId]);
  if (!provider) return NextResponse.json({ error: 'unknown provider' }, { status: 404 });

  // provider-scoped subdir, random filename, original name kept in DB only
  const sub = `provider-${providerId}`;
  const stored = `${crypto.randomBytes(12).toString('hex')}${ext ? '.' + ext : ''}`;
  const rel = path.join(sub, stored);
  const dir = path.join(UPLOADS_DIR, sub);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, stored), Buffer.from(await file.arrayBuffer()));

  const row = await queryOne<{ id: number }>(
    `INSERT INTO atlas.crm_provider_docs (provider_id, checklist_item_id, filename, mime, size_bytes, storage_path, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [providerId, checklistItemId, orig, file.type || null, file.size, rel, user.id],
  );

  const itemLabel = checklistItemId
    ? (await queryOne<{ label: string }>(`SELECT label FROM atlas.crm_checklist_items WHERE id = $1`, [checklistItemId]))?.label
    : null;
  await logActivity({
    threadId: Number.isInteger(threadId) ? threadId : null,
    providerId, authorId: user.id, type: 'doc_upload',
    body: itemLabel ? `Uploaded ${orig} for “${itemLabel}”` : `Uploaded ${orig}`,
    meta: { doc_id: row!.id },
  });

  return NextResponse.json({ ok: true, id: row!.id });
}
