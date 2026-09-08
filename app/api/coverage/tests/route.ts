import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { searchTests, getTestCatalogueCoverage } from '@/lib/serviceabilityQueries';

export const dynamic = 'force-dynamic';

/** Typeahead over the master test catalogue, for the serviceability filter. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(user, 'coverage')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const q = req.nextUrl.searchParams.get('q') ?? '';
  const [tests, coverage] = await Promise.all([searchTests(q), getTestCatalogueCoverage()]);
  return NextResponse.json({ tests, coverage });
}
