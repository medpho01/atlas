import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboard, getPlatformLeaderboardTotal } from '@/lib/coverageQueries';
import { parseLens } from '@/lib/coverage';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Middleware only proves a cookie exists — it runs on the edge and can't read
  // the session. Every data route re-checks server-side.
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(user, 'overview')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const mode = (searchParams.get('mode') === 'COVERAGE' ? 'COVERAGE' : 'ORDERS') as 'ORDERS' | 'COVERAGE';
  const lensKey = searchParams.get('lens') ?? 'ANY';
  const { kinds, modality } = parseLens(lensKey);

  const [rows, platformTotal] = await Promise.all([
    getLeaderboard({ mode, kinds, modality, limit: 12 }),
    getPlatformLeaderboardTotal({ mode, kinds, modality }),
  ]);

  return NextResponse.json({ rows, platformTotal });
}
