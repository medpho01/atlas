import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { lastDiscoveryRun } from '@/lib/discoverLabs';
import { isSearchRunning } from '@/lib/labDiscovery';

export const dynamic = 'force-dynamic';

/**
 * Has the search for this pincode finished?
 *
 * The card polls this while a search runs. It exists because the search is no
 * longer awaited by the browser: the action starts it and returns, so
 * something has to say when there is a result to re-read.
 *
 * One row, no work — cheap enough to ask every few seconds.
 */
export async function GET(req: NextRequest) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(me, 'requests')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const pincode = req.nextUrl.searchParams.get('pincode') ?? '';
  if (!/^\d{6}$/.test(pincode)) return NextResponse.json({ error: 'Bad pincode' }, { status: 400 });

  const run = await lastDiscoveryRun(pincode);
  return NextResponse.json({
    running: isSearchRunning(run),
    ran_at: run?.ran_at ?? null,
    found: run?.found ?? null,
    error: run?.error ?? null,
  });
}
