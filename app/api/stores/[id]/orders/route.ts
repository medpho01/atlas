import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canView } from '@/lib/access';
import { isStage } from '@/lib/stores';
import { getStoreOrders, countStoreOrders, storeExists } from '@/lib/storeOrders';
import { clamp, badDate, idParam } from '../../params';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/[id]/orders — one store's orders.
 *
 * What the collapsible row on /stores fetches when somebody opens it, which is
 * why it exists as a route at all: expanding a store should cost one small
 * request, not a full page render that loses the scroll position and the other
 * rows somebody had open.
 *
 * Also the read endpoint for an integration syncing a partner's book. Same
 * session and same feature gate as the page — see the note in ../../route.ts
 * about why there is no separate API key.
 *
 * Query: q, stage, from, to, delayed=1, flagged=1, limit, offset.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canView(me, 'storeOrders')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const storeId = idParam(params.id);
  if (!storeId) return NextResponse.json({ error: 'Bad store id' }, { status: 400 });

  const sp = req.nextUrl.searchParams;
  const bad = badDate(sp.get('from')) ?? badDate(sp.get('to'));
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });

  const stageRaw = sp.get('stage');
  // An unknown stage is refused rather than ignored. Silently dropping it
  // would answer a question nobody asked with a full, confident list.
  if (stageRaw && !isStage(stageRaw)) {
    return NextResponse.json({ error: `Unknown stage "${stageRaw}"` }, { status: 400 });
  }

  const f = {
    q: sp.get('q')?.trim() || undefined,
    stage: stageRaw && isStage(stageRaw) ? stageRaw : undefined,
    from: sp.get('from') || undefined,
    to: sp.get('to') || undefined,
    delayedOnly: sp.get('delayed') === '1',
    flaggedOnly: sp.get('flagged') === '1',
  };

  const limit = clamp(sp.get('limit'), 50, 1, 500);
  const offset = clamp(sp.get('offset'), 0, 0, 1_000_000);

  const [exists, rows, total] = await Promise.all([
    storeExists(storeId),
    getStoreOrders(storeId, { ...f, limit, offset }),
    countStoreOrders(storeId, f),
  ]);

  // A store that does not exist is a 404, not an empty list. Both would come
  // back as `rows: []`, and a caller syncing a partner's book cannot tell "this
  // store has no orders" from "you have the wrong id" — which is the difference
  // between a quiet day and a broken integration. /export already said 404;
  // this is the two of them agreeing.
  if (!exists) return NextResponse.json({ error: 'No such store' }, { status: 404 });

  return NextResponse.json({
    store_id: storeId, rows, total, limit, offset,
    window: { from: f.from ?? null, to: f.to ?? null },
  });
}
