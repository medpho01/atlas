import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { getPackagesForExport, getPackageLabPricing } from '@/lib/catalogueQueries';

/**
 * Package export, built server-side.
 *
 * The browser only holds the summary rows; test composition isn't loaded until
 * a package is opened. Building the file here means the export carries the full
 * test list without the list page having to fetch every package's contents up
 * front just in case someone exports.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(user, 'catalogue')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.packageIds)
    ? body.packageIds.map(Number).filter((n: number) => Number.isFinite(n) && n > 0).slice(0, 1000)
    : [];
  if (!ids.length) return NextResponse.json({ error: 'No packages selected' }, { status: 400 });

  const [rows, labs] = await Promise.all([
    getPackagesForExport(ids),
    getPackageLabPricing(ids),
  ]);
  return NextResponse.json({ rows, labs });
}
