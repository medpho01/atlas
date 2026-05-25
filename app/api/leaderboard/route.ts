import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboard, getPlatformLeaderboardTotal } from '@/lib/coverageQueries';
import { parseLens } from '@/lib/coverage';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
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
