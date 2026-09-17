import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { getLabContext } from '@/lib/fulfilmentQueries';

export const dynamic = 'force-dynamic';

/**
 * The lab situation behind one order, for the desk's drawer.
 *
 * A route rather than a server component so that clicking a row costs a panel
 * and a spinner, not a whole page re-render — the table keeps its scroll
 * position and the filters stay where they were.
 */
export async function GET(req: NextRequest) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(me, 'commitments')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const id = Number(req.nextUrl.searchParams.get('order'));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Bad order' }, { status: 400 });

  return NextResponse.json(await getLabContext(id));
}
