import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { listPhlebos, countPhlebos, PHLEBO_REACH_RADIUS_KM, type SortKey } from '@/lib/phlebosQueries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const filters = {
    q:         sp.get('q') ?? '',
    pincode:   sp.get('pincode') ?? '',
    city:      sp.get('city') ?? '',
    state:     sp.get('state') ?? '',
    lab:       sp.get('lab') ?? '',
    source:    (sp.get('source') || 'all') as 'derived' | 'manual' | 'both' | 'all',
    nearby:    sp.get('nearby') === '1',
    radiusKm:  Number(sp.get('radius')) || PHLEBO_REACH_RADIUS_KM,
    minOrders: Number(sp.get('min')) || 0,
    sortBy:    (sp.get('sort') || undefined) as SortKey | undefined,
    sortDir:   sp.get('dir') === 'asc' ? 'asc' as const : 'desc' as const,
  };

  const [phlebos, total] = await Promise.all([
    listPhlebos(filters, 200, 0),
    countPhlebos(filters),
  ]);

  return NextResponse.json({ phlebos, total });
}
