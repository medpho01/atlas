import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { listNurses, countNurses, NURSE_REACH_RADIUS_KM, type SortKey } from '@/lib/nursesQueries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const filters = {
    q:        sp.get('q') ?? '',
    pincode:  sp.get('pincode') ?? '',
    city:     sp.get('city') ?? '',
    state:    sp.get('state') ?? '',
    // Repeated ?agg= params — multi-select. None = every aggregator.
    aggregators: sp.getAll('agg').filter(Boolean),
    source:   (sp.get('source') || 'all') as 'derived' | 'manual' | 'both' | 'all',
    verifiedOnly: sp.get('verified') === '1',
    nearby:   sp.get('nearby') === '1',
    radiusKm: Number(sp.get('radius')) || NURSE_REACH_RADIUS_KM,
    sortBy:   (sp.get('sort') || undefined) as SortKey | undefined,
    sortDir:  sp.get('dir') === 'asc' ? 'asc' as const : 'desc' as const,
  };

  const [nurses, total] = await Promise.all([
    listNurses(filters, 200, 0),
    countNurses(filters),
  ]);

  return NextResponse.json({ nurses, total });
}
