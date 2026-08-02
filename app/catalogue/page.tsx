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

/** Price bands, against what the cheapest lab quotes for the package. */
const BANDS = [
  { key: 'under1k', label: 'Under ₹1k', min: undefined, max: 1000 },
  { key: '1k-3k', label: '₹1k–3k', min: 1000, max: 3000 },
  { key: '3k-8k', label: '₹3k–8k', min: 3000, max: 8000 },
  { key: 'over8k', label: 'Over ₹8k', min: 8000, max: undefined },
] as const;

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: { q?: string; category?: string; modality?: string; band?: string; minTests?: string; proven?: string };
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
      priceMin: band?.min,
      priceMax: band?.max,
      provenOnly: searchParams.proven === '1',
    }),
    getCategories(),
    getEnrichmentState(),
  ]);

  const withCategories = categories.filter((c) => c.packages > 0);
  const proven = packages.filter((p) => p.orders > 0).length;
  const peopleServed = packages.reduce((s, p) => s + p.patients, 0);

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
          instead of designing from scratch — sorted by how many people have actually been
          through each one. To model an actual quote, use Packages &amp; Pricing.
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
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Price</span>
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
        <ChipButton
          href={href({ proven: searchParams.proven === '1' ? undefined : '1' })}
          active={searchParams.proven === '1'}
        >
          ✓ Ordered before
        </ChipButton>
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
            proven > 0
              ? `${proven} of them have been ordered before, by ${peopleServed.toLocaleString('en-IN')} people. Click any column to sort.`
              : 'None of these have recorded orders yet. Click any column to sort.'
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
          <span className="font-medium text-ink-700">People taken</span> is how many patients have
          been through the package — the strongest thing you can put in front of a client. A
          package showing <span className="italic">not yet</span> has simply never been ordered.
        </span>
        <span>
          <span className="font-medium text-ink-700">Price</span> is one lab&rsquo;s quote for the
          whole package, at the cheapest lab that quotes it. A package is fulfilled at a single
          lab, so prices from different labs are alternatives, never something to add together.
        </span>
        {enrichment.last_run && (
          <span>Catalogue last classified {new Date(enrichment.last_run).toLocaleDateString('en-IN')}.</span>
        )}
      </div>
    </main>
  );
}
