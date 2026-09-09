import { NextResponse } from 'next/server';
import { getMapPoints } from '@/lib/publicNetwork';

/**
 * Map points, served separately from the page.
 *
 * Inlining ~8,000 (on production ~14,000) points into the RSC payload made the
 * page HTML 846KB, which every visitor paid on every request no matter how
 * well the query itself was cached. Served here instead, the page ships small
 * and the map fills in — and the response is cacheable by the browser and any
 * CDN in front of it, so a returning visitor pays nothing.
 */
// Not prerendered: there is no database at build time. Caching comes from the
// Cache-Control header below (browser and any CDN) and from the 5-minute
// server-side cache around getMapPoints.
export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await getMapPoints();
  // Tuples, not objects, and coordinates to four decimals (~11m — far finer
  // than a pincode centroid deserves). The keys repeated 8,000 times and seven
  // decimals of false precision were most of the payload.
  const points = rows.map((p) => [
    p.pincode,
    Math.round(p.latitude * 1e4) / 1e4,
    Math.round(p.longitude * 1e4) / 1e4,
    p.cv,
    p.hs,
  ]);
  return NextResponse.json(
    { points },
    {
      headers: {
        // Public data, rebuilt nightly. Serve stale while revalidating rather
        // than making anyone wait for a refresh.
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600',
      },
    },
  );
}
