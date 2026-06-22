import { NextResponse } from 'next/server';
import { getPincodeNetwork } from '@/lib/publicNetwork';

/**
 * Public JSON endpoint for the customer network coverage page.
 *
 *   GET /api/public/pincode?p=560102
 *
 * Returns the labs serving that pincode for Center Visit and Home Sample
 * Collection. No auth required. Only public-safe fields (name, kind, city) —
 * no internal IDs, revenue, quality, or relationship metadata.
 *
 * Cache for 5 minutes at the CDN/proxy edge so the same pincode lookup
 * doesn't hit the DB on every keypress.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const pincode = (url.searchParams.get('p') ?? '').trim();

  if (!/^\d{6}$/.test(pincode)) {
    return NextResponse.json(
      { error: 'Provide ?p=<6-digit pincode>' },
      { status: 400 },
    );
  }

  try {
    const data = await getPincodeNetwork(pincode);
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Lookup failed', detail: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
