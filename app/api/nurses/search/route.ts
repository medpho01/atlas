import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { listNurses, countNurses, NURSE_REACH_RADIUS_KM, type SortKey } from '@/lib/nursesQueries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(user, 'directory')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

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
    interest: sp.get('interest') ?? '',
    slot:     sp.get('slot') ?? '',
    nearby:   sp.get('nearby') !== '0',   // absent means ON, which is what the
                                     // page sends and what page.tsx already assumed
    radiusKm: Number(sp.get('radius')) || NURSE_REACH_RADIUS_KM,
    sortBy:   (sp.get('sort') || undefined) as SortKey | undefined,
    // Left undefined when the URL says nothing, so each sort key can pick its
    // own sensible direction — distance counts up, everything else counts down.
    sortDir:  sp.get('dir') === 'asc' ? 'asc' as const
            : sp.get('dir') === 'desc' ? 'desc' as const : undefined,
  };

  const [nurses, total] = await Promise.all([
    listNurses(filters, 200, 0),
    countNurses(filters),
  ]);

  return NextResponse.json({ nurses, total });
}
