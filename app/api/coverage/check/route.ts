import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import {
  checkServiceability, checkServiceabilityWithTests, checkCityServiceability,
  listCentres, resolveCities, parseServices, MAX_PINCODES,
} from '@/lib/serviceabilityQueries';

export const dynamic = 'force-dynamic';

/**
 * Serviceability for pincodes, cities, or both, across a set of (kind ×
 * modality) services, optionally narrowed to providers that offer given tests.
 *
 * `services` is optional — omitted, it answers the Center Visit + Home Sample
 * question this endpoint has always answered.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(user, 'coverage')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const pincodes: string[] = Array.isArray(body?.pincodes)
    ? body.pincodes.map((p: unknown) => String(p).trim()).filter((p: string) => /^\d{6}$/.test(p))
    : [];
  const cities: string[] = Array.isArray(body?.cities)
    ? body.cities.map((c: unknown) => String(c).trim()).filter(Boolean)
    : [];
  const tests: string[] = Array.isArray(body?.tests)
    ? body.tests.map((t: unknown) => String(t).trim()).filter(Boolean)
    : [];

  if (!pincodes.length && !cities.length) {
    return NextResponse.json({ rows: [], cityRows: [], services: [] });
  }

  const services = parseServices(body?.services);

  // Cities contribute their pincodes to the union of centres, so a search
  // spanning six cities answers "every centre across all of them" in one list.
  const cityMatches = cities.length ? await resolveCities(cities) : [];
  const allPincodes = [...new Set([...pincodes, ...cityMatches.flatMap((c) => c.pincodes)])];

  const [rows, cityRows, centres] = await Promise.all([
    pincodes.length
      ? (tests.length
          ? checkServiceabilityWithTests(pincodes, services, tests)
          : checkServiceability(pincodes, services))
      : Promise.resolve([]),
    cities.length ? checkCityServiceability(cities, services, tests) : Promise.resolve([]),
    listCentres(allPincodes, services, tests),
  ]);

  return NextResponse.json({
    rows,
    cityRows,
    centres,
    scannedPincodes: allPincodes.length,
    services,
    tests,
    truncated: new Set(pincodes).size > MAX_PINCODES,
  });
}
