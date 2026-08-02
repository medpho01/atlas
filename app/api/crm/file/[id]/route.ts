import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(user, 'providerPipeline')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  const docId = parseInt(id, 10);
  if (!Number.isInteger(docId)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const doc = await queryOne<{ filename: string; mime: string | null; storage_path: string }>(
    `SELECT filename, mime, storage_path FROM atlas.crm_provider_docs WHERE id = $1`, [docId],
  );
  if (!doc) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Resolve inside UPLOADS_DIR only — reject traversal
  const abs = path.resolve(UPLOADS_DIR, doc.storage_path);
  if (!abs.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  try {
    const buf = await readFile(abs);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'content-type': doc.mime || 'application/octet-stream',
        'content-disposition': `attachment; filename="${doc.filename.replace(/[^\w.\- ]/g, '_')}"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'file missing on disk' }, { status: 410 });
  }
}
