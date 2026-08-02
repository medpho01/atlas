import { Package as PackageIcon, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { CatalogueTabs } from './CatalogueTabs';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ChipButton, Pill } from '@/components/ui/Toggle';
import { PackagesTable } from './PackagesTable';
import {
  browsePackages, getCategories, getEnrichmentState, MODALITIES, MODALITY_LABEL,
} from '@/lib/catalogueQueries';

export const dynamic = 'force-dynamic';

const inr = (v: string | null) =>
  v == null ? null : `₹${Math.round(Number(v)).toLocaleString('en-IN')}`;

/** Value bands, in à-la-carte rupees. The bands a quote conversation uses. */
const BANDS = [
  { key: 'under2k', label: 'Under ₹2k', min: undefined, max: 2000 },
  { key: '2k-5k', label: '₹2k–5k', min: 2000, max: 5000 },
  { key: '5k-15k', label: '₹5k–15k', min: 5000, max: 15000 },
  { key: 'over15k', label: 'Over ₹15k', min: 15000, max: undefined },
] as const;

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: { q?: string; category?: string; modality?: string; band?: string; minTests?: string };
}) {
  const { blocked } = await requireView('catalogue', '/catalogue');
  if (blocked) return <RoleBlocked area="The catalogue" detail="the network, accounts and admin teams" />;

  const band = BANDS.find((b) => b.key === searchParams.band);
  const [packages, categories, enrichment] = await Promise.all([
    browsePackages({
      q: searchParams.q,
      category: searchParams.category,
      modality: searchParams.modality,
      minTests: searchParams.minTests ? Number(searchParams.minTests) : undefined,
      valueMin: band?.min,
      valueMax: band?.max,
    }),
    getCategories(),
    getEnrichmentState(),
  ]);

  const withCategories = categories.filter((c) => c.packages > 0);
  const totalValue = packages.reduce((s, p) => s + Number(p.alacarte_low ?? 0), 0);

  // Preserve the other filters when toggling one.
  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { ...searchParams, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const qs = next.toString();
    return `/catalogue${qs ? `?${qs}` : ''}`;
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <PackageIcon className="w-5 h-5 text-brand-600" strokeWidth={2.25} />
          <h1 className="text-2xl font-bold text-ink-900">Catalogue</h1>
        </div>
        <p className="text-sm text-ink-600 max-w-3xl">
          Everything already built and sellable, so a new client can be shown what exists
          instead of designing from scratch. Value is the à-la-carte total of a package&rsquo;s
          tests against what the labs charge us — the basis for a quote, not a quoted price.
          To model an actual quote, use Packages &amp; Pricing.
        </p>
      </div>

      <CatalogueTabs active="/catalogue" />

      <form className="flex flex-wrap items-center gap-2 mb-3" action="/catalogue">
        {searchParams.category && <input type="hidden" name="category" value={searchParams.category} />}
        {searchParams.modality && <input type="hidden" name="modality" value={searchParams.modality} />}
        {searchParams.band && <input type="hidden" name="band" value={searchParams.band} />}
        <input
          name="q"
          defaultValue={searchParams.q ?? ''}
          placeholder="Search packages by name"
          className="w-72 px-2.5 h-8 text-xs rounded-md border border-ink-200 bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
        />
        {searchParams.q && (
          <Link href={href({ q: undefined })} className="text-[11px] text-ink-500 hover:text-ink-900">clear</Link>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Value</span>
        <ChipButton href={href({ band: undefined })} active={!searchParams.band}>Any</ChipButton>
        {BANDS.map((b) => (
          <ChipButton key={b.key} href={href({ band: b.key })} active={searchParams.band === b.key}>
            {b.label}
          </ChipButton>
        ))}
        <span className="text-[11px] uppercase tracking-wide text-ink-400 ml-3 mr-1">Modality</span>
        <ChipButton href={href({ modality: undefined })} active={!searchParams.modality}>Any</ChipButton>
        {MODALITIES.map((m) => (
          <ChipButton key={m} href={href({ modality: m })} active={searchParams.modality === m}>
            {MODALITY_LABEL[m]}
          </ChipButton>
        ))}
      </div>

      {withCategories.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Category</span>
          <ChipButton href={href({ category: undefined })} active={!searchParams.category}>All</ChipButton>
          {withCategories.map((c) => (
            <ChipButton key={c.key} href={href({ category: c.key })} active={searchParams.category === c.key}>
              {c.label} <span className="opacity-60">{c.packages}</span>
            </ChipButton>
          ))}
        </div>
      ) : (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-brand-200 bg-brand-50/60 dark:bg-brand-500/5 px-3 py-2">
          <Sparkles className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" strokeWidth={2.25} />
          <p className="text-xs text-ink-700">
            <span className="font-medium text-ink-900">Categories not built yet.</span>{' '}
            Nutrition, AHC, gut health and genetics aren&rsquo;t recorded in LabStack — the source
            has only ROUTINE / NON_ROUTINE, and just 27% of tests carry a clinical department.
            Run <code className="font-mono text-[11px]">npm run catalogue:enrich</code> to classify
            the catalogue; everything below works without it.
          </p>
        </div>
      )}

      <Card>
        <CardHeader
          title={`${packages.length} package${packages.length === 1 ? '' : 's'}`}
          subtitle={
            totalValue > 0
              ? `${inr(String(totalValue))} of à-la-carte value on this list. Click any column to sort.`
              : 'Click any column to sort.'
          }
          icon={<PackageIcon className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5 overflow-x-auto">
            <PackagesTable packages={packages} />
          </div>
        </CardBody>
      </Card>

      <div className="mt-4 flex flex-wrap items-start gap-4 text-xs text-ink-500">
        <span>
          <Pill tone="neutral">Custom</Pill> built for a specific client — reusable as a starting point.
        </span>
        <span>
          Headroom is à-la-carte value less lab cost, as a percentage. It sets the discount you can
          offer, and is not a booked margin.
        </span>
        <span>
          <span className="text-ink-400">†</span> priced by the lab as a unit. Kit and imaging
          packages have no test-level composition, so there is nothing to sum a value or headroom
          from — the quoted price is all they carry.
        </span>
        {enrichment.last_run && (
          <span>Catalogue last classified {new Date(enrichment.last_run).toLocaleDateString('en-IN')}.</span>
        )}
      </div>
    </main>
  );
}
