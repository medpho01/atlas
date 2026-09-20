import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { getTaskNotes, TASK_KINDS, type TaskKind } from '@/lib/orderTracking';

export const dynamic = 'force-dynamic';

/**
 * The notes on one task.
 *
 * A route rather than part of the page render, so opening the drawer costs a
 * panel and a spinner instead of a whole page round-trip that would lose the
 * table's scroll position and the rows somebody had selected.
 */
export async function GET(req: NextRequest) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(me, 'orderTracking')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const id = Number(req.nextUrl.searchParams.get('order'));
  const kind = req.nextUrl.searchParams.get('kind') ?? '';
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Bad order' }, { status: 400 });
  if (!(TASK_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: 'Bad queue' }, { status: 400 });
  }

  return NextResponse.json(await getTaskNotes(id, kind as TaskKind));
}
