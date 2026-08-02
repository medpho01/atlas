import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { getProviderDocs } from '@/lib/crm';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(user, 'providerPipeline')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const providerId = parseInt(req.nextUrl.searchParams.get('provider') ?? '', 10);
  if (!Number.isInteger(providerId)) return NextResponse.json({ docs: [] });
  const docs = await getProviderDocs(providerId);
  return NextResponse.json({ docs });
}
