import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { checkServiceability, parseServices, MAX_PINCODES } from '@/lib/serviceabilityQueries';

export const dynamic = 'force-dynamic';

/**
 * Serviceability for a set of pincodes across a set of (kind × modality)
 * services. `services` is optional — omitted, it answers the Center Visit +
 * Home Sample question this endpoint has always answered.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(user, 'coverage')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const pincodes: string[] = Array.isArray(body?.pincodes)
    ? body.pincodes.map((p: unknown) => String(p).trim()).filter((p: string) => /^\d{6}$/.test(p))
    : [];
  if (!pincodes.length) return NextResponse.json({ rows: [], services: [] });

  const services = parseServices(body?.services);
  const rows = await checkServiceability(pincodes, services);

  return NextResponse.json({
    rows,
    services,
    truncated: new Set(pincodes).size > MAX_PINCODES,
  });
}
