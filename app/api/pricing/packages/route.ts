import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getLabPackages } from '@/lib/pricingQueries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const labId = parseInt(sp.get('lab') ?? '', 10);
  const ids = (sp.get('ids') ?? '')
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (!Number.isInteger(labId) || !ids.length) {
    return NextResponse.json({ packages: [] });
  }

  const packages = await getLabPackages(labId, ids);
  return NextResponse.json({ packages });
}
