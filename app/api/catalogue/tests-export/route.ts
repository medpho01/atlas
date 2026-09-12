import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { getTestRatesForExport, browseTests, listRateLabs } from '@/lib/catalogueQueries';

export const dynamic = 'force-dynamic';

const BANDS: Record<string, { min?: number; max?: number }> = {
  under500: { max: 500 },
  '500-2k': { min: 500, max: 2000 },
  '2k-6k': { min: 2000, max: 6000 },
  over6k: { min: 6000 },
};

/**
 * The rate card behind the catalogue, as a spreadsheet.
 *
 * Built on the server: this is one row per test per lab, which for a wide
 * selection is tens of thousands of rows — not something to assemble in a
 * browser tab, and not something the page should fetch on the off-chance
 * somebody exports.
 *
 * It takes the page's own query string, so the file is what was on screen. Two
 * sheets, because the two questions are different: "what does each lab charge
 * for this test" is the negotiation, and "what is the range" is the quote.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(user, 'catalogue')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const band = BANDS[sp.get('band') ?? ''] ?? {};
  const labIds = (sp.get('labs') ?? '')
    .split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 500);

  const filters = {
    q: sp.get('q') ?? undefined,
    category: sp.get('category') ?? undefined,
    department: sp.get('department') ?? undefined,
    priceMin: band.min,
    priceMax: band.max,
    labIds,
    // Higher than the page's 300: a download is for working offline, and
    // truncating it to what fits on a screen defeats the point.
    limit: 2000,
  };

  const [rates, tests, labs] = await Promise.all([
    getTestRatesForExport(filters),
    browseTests(filters),
    listRateLabs(),
  ]);

  if (!rates.length) {
    return NextResponse.json({ error: 'Nothing to export for these filters' }, { status: 404 });
  }

  const num = (v: string | null) => (v == null ? null : Math.round(Number(v)));

  const rateSheet = rates.map((r) => ({
    'Master ID': r.master_id,
    'LS ID': r.ls_id ?? '',
    // Master name first, lab test name beside it: the first is what makes two
    // labs comparable, the second is what each of them calls it on the rate
    // card you are checking against.
    'Master name': r.test_name,
    'Lab test name': r.lab_test_name ?? '',
    'DOS ID': r.dos_id ?? '',
    Department: r.department?.toLowerCase() ?? '',
    Sample: r.sample ?? '',
    Lab: r.lab_name,
    City: r.lab_city ?? '',
    'API integration': r.api_provider ? r.api_provider.replace(/_/g, ' ') : '',
    MRP: num(r.mrp),
    // The console calls this the lab's B2B rate; the network team says L2L.
    // Named both ways once, here, rather than picked and explained in a chat.
    'Lab cost (B2B / L2L)': num(r.b2b),
    'TAT hours': r.tat_hours ?? '',
    NABL: r.nabl == null ? '' : r.nabl ? 'Yes' : 'No',
  }));

  const testSheet = tests.map((t) => ({
    'Master ID': t.master_id,
    'LS ID': t.ls_id ?? '',
    'Master name': t.test_name,
    'Display name': t.consumer_name ?? '',
    Department: t.department?.toLowerCase() ?? '',
    Sample: t.sample ?? '',
    'Labs offering': t.labs_count,
    'MRP low': num(t.mrp_min),
    'MRP high': num(t.mrp_max),
    'Lab cost low (B2B / L2L)': num(t.b2b_min),
  }));

  const selected = labIds.length
    ? labs.filter((l) => labIds.includes(l.lab_id)).map((l) => ({
        Lab: l.lab_name,
        City: l.lab_city ?? '',
        'API integration': l.api_provider ? l.api_provider.replace(/_/g, ' ') : '',
        'Tests priced': l.tests,
      }))
    : [{ Lab: 'All labs with a rate card', City: '', 'API integration': '', 'Tests priced': labs.length }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rateSheet), 'Rates by lab');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(testSheet), 'Tests');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(selected), 'Labs');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const stamp = new Date().toISOString().slice(0, 10);
  const name = labIds.length ? `atlas-rates-${labIds.length}-labs-${stamp}.xlsx` : `atlas-rates-${stamp}.xlsx`;

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(buf.length),
    },
  });
}
