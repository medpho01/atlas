import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { getRatesForTests } from '@/lib/pricingQueries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(user, 'pricing')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const idsParam = req.nextUrl.searchParams.get('ids') ?? '';
  const ids = idsParam
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0);

  const rates = await getRatesForTests(ids);
  return NextResponse.json({ rates });
}
