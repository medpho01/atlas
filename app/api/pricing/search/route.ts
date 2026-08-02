import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { searchTests } from '@/lib/pricingQueries';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(user, 'catalogue')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const q = req.nextUrl.searchParams.get('q') ?? '';
  const tests = await searchTests(q);
  return NextResponse.json({ tests });
}
