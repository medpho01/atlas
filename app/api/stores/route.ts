import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canView } from '@/lib/access';
import {
  getStoreRows, countStores, STORE_SORTS, type StoreSort,
} from '@/lib/storeOrders';
import { clamp, badDate } from './params';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stores — the store list, as JSON.
 *
 * Read-only, and the same functions the page renders from, so an integration
 * can never see a number the screen disagrees with.
 *
 * Authenticated with the ordinary Atlas session and gated on the same feature
 * as the page. There is no API key and no service account: this endpoint is
 * for the browser and for scripts run by a person who already has a login.
 * Anything machine-to-machine wants a token with its own scope and its own
 * expiry, which is a decision about how Atlas is operated rather than a thing
 * to quietly invent in a route handler — see docs/STORES-AND-ORDERS.md.
 *
 * Query: q, from, to, active=0, tracked=1, attention=1, sort, limit, offset.
 *
 * With no from/to this counts every order ever, which is what a sync wants and
 * is NOT what /stores shows — that page defaults to the last ninety days,
 * because a rate or an average without a window cannot be compared between two
 * partners. The window actually used comes back in the response so a caller
 * comparing a figure against the screen can see which question it answered.
 */
export async function GET(req: NextRequest) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canView(me, 'storeOrders')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const bad = badDate(sp.get('from')) ?? badDate(sp.get('to'));
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });

  const sortRaw = sp.get('sort') ?? '';
  const sort: StoreSort = (STORE_SORTS as readonly string[]).includes(sortRaw)
    ? (sortRaw as StoreSort) : 'orders';

  const f = {
    q: sp.get('q')?.trim() || undefined,
    from: sp.get('from') || undefined,
    to: sp.get('to') || undefined,
    // Same default as the page: active only unless asked otherwise.
    activeOnly: sp.get('active') !== '0',
    trackedOnly: sp.get('tracked') === '1',
    needsAttention: sp.get('attention') === '1',
    sort,
  };

  const limit = clamp(sp.get('limit'), 25, 1, 200);
  const offset = clamp(sp.get('offset'), 0, 0, 1_000_000);

  const [rows, total] = await Promise.all([
    getStoreRows({ ...f, limit, offset }),
    countStores(f),
  ]);

  return NextResponse.json({
    rows, total, limit, offset,
    window: { from: f.from ?? null, to: f.to ?? null },
  });
}
