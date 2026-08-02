import Link from 'next/link';
import { Beaker } from 'lucide-react';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { CatalogueTabs } from '../CatalogueTabs';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ChipButton, Pill } from '@/components/ui/Toggle';
import { browseTests, getCategories, getDepartments } from '@/lib/catalogueQueries';

export const dynamic = 'force-dynamic';

const inr = (v: string | null) =>
  v == null ? '—' : `₹${Math.round(Number(v)).toLocaleString('en-IN')}`;

const BANDS = [
  { key: 'under500', label: 'Under ₹500', min: undefined, max: 500 },
  { key: '500-2k', label: '₹500–2k', min: 500, max: 2000 },
  { key: '2k-6k', label: '₹2k–6k', min: 2000, max: 6000 },
  { key: 'over6k', label: 'Over ₹6k', min: 6000, max: undefined },
] as const;

export default async function TestsPage({
  searchParams,
}: {
  searchParams: { q?: string; category?: string; department?: string; band?: string };
}) {
  const { blocked } = await requireView('catalogue', '/pricing/tests');
  if (blocked) return <RoleBlocked area="Packages & Pricing" detail="the network and admin teams" />;

  const band = BANDS.find((b) => b.key === searchParams.band);
  const [tests, categories, departments] = await Promise.all([
    browseTests({
      q: searchParams.q,
      category: searchParams.category,
      department: searchParams.department,
      priceMin: band?.min,
      priceMax: band?.max,
    }),
    getCategories(),
    getDepartments(),
  ]);

  const withCategories = categories.filter((c) => c.tests > 0);

  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...searchParams, ...patch })) if (v) next.set(k, v);
    const qs = next.toString();
    return `/pricing/tests${qs ? `?${qs}` : ''}`;
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Beaker className="w-5 h-5 text-brand-600" strokeWidth={2.25} />
          <h1 className="text-2xl font-bold text-ink-900">Packages &amp; Pricing</h1>
        </div>
        <p className="text-sm text-ink-600 max-w-3xl">
          Search the sellable catalogue — every test with at least one lab rate. Search matches
          official names and aliases, so a request phrased the client&rsquo;s way still finds the
          test we file under something else.
        </p>
      </div>

      <CatalogueTabs active="/pricing/tests" />

      <form className="flex flex-wrap items-center gap-2 mb-3" action="/pricing/tests">
        {searchParams.category && <input type="hidden" name="category" value={searchParams.category} />}
        {searchParams.department && <input type="hidden" name="department" value={searchParams.department} />}
        {searchParams.band && <input type="hidden" name="band" value={searchParams.band} />}
        <input
          name="q"
          defaultValue={searchParams.q ?? ''}
          placeholder="Search tests and aliases — e.g. vitamin d, microbiome, HbA1c"
          className="w-96 px-2.5 h-8 text-xs rounded-md border border-ink-200 bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
        />
        {searchParams.q && (
          <Link href={href({ q: undefined })} className="text-[11px] text-ink-500 hover:text-ink-900">clear</Link>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">MRP</span>
        <ChipButton href={href({ band: undefined })} active={!searchParams.band}>Any</ChipButton>
        {BANDS.map((b) => (
          <ChipButton key={b.key} href={href({ band: b.key })} active={searchParams.band === b.key}>
            {b.label}
          </ChipButton>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Department</span>
        <ChipButton href={href({ department: undefined })} active={!searchParams.department}>All</ChipButton>
        {departments.map((d) => (
          <ChipButton key={d.department} href={href({ department: d.department })} active={searchParams.department === d.department}>
            {d.department.toLowerCase()} <span className="opacity-60">{d.tests}</span>
          </ChipButton>
        ))}
      </div>

      {withCategories.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Category</span>
          <ChipButton href={href({ category: undefined })} active={!searchParams.category}>All</ChipButton>
          {withCategories.map((c) => (
            <ChipButton key={c.key} href={href({ category: c.key })} active={searchParams.category === c.key}>
              {c.label} <span className="opacity-60">{c.tests}</span>
            </ChipButton>
          ))}
        </div>
      )}

      <Card>
        <CardHeader
          title={`${tests.length} test${tests.length === 1 ? '' : 's'}`}
          subtitle="Widest lab coverage first — the ones we can actually fulfil everywhere."
          icon={<Beaker className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
                  <th className="text-left font-medium px-5 py-2">Test</th>
                  <th className="text-left font-medium px-2 py-2">Department</th>
                  <th className="text-right font-medium px-2 py-2">MRP</th>
                  <th className="text-right font-medium px-2 py-2">Lab cost</th>
                  <th className="text-right font-medium px-5 py-2">Labs</th>
                </tr>
              </thead>
              <tbody>
                {tests.map((t) => (
                  <tr key={t.master_id} className="border-b border-ink-100 last:border-0">
                    <td className="px-5 py-1.5 text-ink-900 max-w-lg">
                      {t.consumer_name ?? t.test_name}
                      {t.consumer_name && t.consumer_name !== t.test_name && (
                        <span className="text-[11px] text-ink-400 ml-1.5">{t.test_name}</span>
                      )}
                      {t.why_it_matters && <div className="text-[11px] text-ink-500">{t.why_it_matters}</div>}
                      <span className="ml-1">
                        {(t.categories ?? []).slice(0, 2).map((c) => (
                          <Pill key={c} tone="info">{c.replace(/_/g, ' ').toLowerCase()}</Pill>
                        ))}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-ink-500">
                      {t.department ? t.department.toLowerCase() : '—'}
                    </td>
                    <td className="px-2 py-1.5 num font-medium">{inr(t.mrp_min)}</td>
                    <td className="px-2 py-1.5 num text-ink-600">{inr(t.b2b_min)}</td>
                    <td className="px-5 py-1.5 num text-ink-600">{t.labs_count}</td>
                  </tr>
                ))}
                {!tests.length && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-sm text-ink-500">
                      Nothing matches. Try a shorter search term, or clear the department filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <p className="mt-4 text-xs text-ink-500">
        Showing at most 300 rows. MRP and lab cost are the lowest across labs carrying the test.
      </p>
    </main>
  );
}
