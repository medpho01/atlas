import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export type CoverageRow = {
  pincode: string;
  city: string | null;
  state: string | null;
  cv_providers: number;        // radius-aware (10 km)
  cv_local_providers: number;  // physically at the pincode
  cv_top_labs: string[] | null;
  hs_providers: number;
  hs_top_labs: string[] | null;
};

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(user, 'coverage')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const pincodes: string[] = Array.isArray(body?.pincodes)
    ? body.pincodes.map((p: unknown) => String(p).trim()).filter((p: string) => /^\d{6}$/.test(p))
    : [];
  if (!pincodes.length) return NextResponse.json({ rows: [] });
  const unique = Array.from(new Set(pincodes)).slice(0, 2000);

  const rows = await query<CoverageRow>(
    `
    WITH wanted AS (SELECT unnest($1::text[]) AS pincode)
    SELECT
      w.pincode,
      pc.city,
      pc.state,
      -- CV: radius-aware totals from mv_pincode_coverage (LOCAL + RADIUS)
      COALESCE(cv.providers, 0)::int        AS cv_providers,
      COALESCE(cv.local_providers, 0)::int  AS cv_local_providers,
      -- Top-3 nearest CV labs with distance baked into the name
      (SELECT array_agg(x.n) FROM (
         SELECT r.name || CASE WHEN r.distance_km > 0
                  THEN ' (' || ROUND(r.distance_km::numeric, 1) || ' km)' ELSE '' END AS n
         FROM analytics.mv_pincode_cv_reach r
         WHERE r.covered_pincode = w.pincode AND r.distance_km <= 10
         ORDER BY r.distance_km ASC LIMIT 3
       ) x)                                  AS cv_top_labs,
      COALESCE(hs.providers, 0)::int        AS hs_providers,
      (SELECT array_agg(x.n) FROM (
         SELECT pu.name AS n
         FROM analytics.mv_provider_unified pu
         WHERE pu.active
           AND pu.kind IN ('LAB','HOSPITAL')
           AND 'HOME_SAMPLE' = ANY(pu.modalities)
           AND pu.serviced_pincodes IS NOT NULL
           AND w.pincode = ANY(pu.serviced_pincodes)
         ORDER BY pu.name LIMIT 3
       ) x)                                  AS hs_top_labs
    FROM wanted w
    LEFT JOIN analytics.mv_pincode_city pc ON pc.pincode = w.pincode
    LEFT JOIN analytics.mv_pincode_coverage cv
      ON cv.pincode = w.pincode AND cv.kind IN ('LAB','HOSPITAL') AND cv.modality = 'CENTER_VISIT'
    LEFT JOIN LATERAL (
      SELECT SUM(c2.providers)::int AS providers
      FROM analytics.mv_pincode_coverage c2
      WHERE c2.pincode = w.pincode AND c2.kind IN ('LAB','HOSPITAL') AND c2.modality = 'HOME_SAMPLE'
    ) hs ON true
    ORDER BY w.pincode
    `,
    [unique],
  );

  return NextResponse.json({ rows });
}
