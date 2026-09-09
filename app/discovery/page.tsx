import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { ListOrdered, MapPin } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, FilterInput } from '@/components/ui/FilterBar';
import { InfoTip } from '@/components/ui/InfoTip';
import { Pill } from '@/components/ui/Toggle';
import { LeadActions } from '../requests/LeadActions';
import { getDiscoveryCandidates, describeArea } from '@/lib/discoveryQueries';
import { rankProviders, type RankableProvider } from '@/lib/providerRanking';

export const dynamic = 'force-dynamic';

type Search = { area?: string; services?: string };

export default async function DiscoveryRankingPage({ searchParams }: { searchParams: Search }) {
  const gate = await requireView('directory', '/discovery');
  if (gate.blocked) return <RoleBlocked area="Provider ranking" detail="every signed-in role" />;

  const area = (searchParams.area ?? '').trim();
  const requestedServices = (searchParams.services ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const candidates = area ? await getDiscoveryCandidates(area) : [];

  // discovered_lab has no services/accreditation/review columns yet (see
  // lib/discoveryQueries.ts) — every candidate is genuinely unknown on those
  // three signals. Proximity is the one real signal available today.
  const rankable: (RankableProvider & { id: number; crm_provider_id: number | null; confidence: number | null; source_url: string | null })[] =
    candidates.map((c) => ({
      id: c.id,
      name: c.name,
      address: [c.address, c.city, c.pincode].filter(Boolean).join(', ') || null,
      phone: c.phone,
      services: null,
      accredited: null,
      distanceKm: c.distance_km,
      reviewScore: null,
      crm_provider_id: c.crm_provider_id,
      confidence: c.confidence,
      source_url: c.source_url,
    }));

  const ranked = area ? rankProviders(rankable, requestedServices) : [];

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Provider ranking"
        subtitle="Rank the unverified leads found for a pincode or city, with a plain-English reason for the order."
        actions={
          <InfoTip
            title="Provider ranking"
            shows="Ranks atlas.discovered_lab candidates for a pincode or city — the same leads shown on a request's 'Labs found on the open web' card, but across a whole area and ordered by score instead of confidence."
            computed={
              <>
                Weighted: accreditation 0.40, proximity 0.30, service match 0.20, reviews 0.10.
                A signal with no data is dropped and the rest renormalised, then scaled down by how
                much of the weight budget was actually observed (floor 0.6) — thin evidence can't
                top the list on one or two flattering signals alone.
              </>
            }
            drives="Use this before assigning a network-team callback list for a newly-discovered pincode or city — closest, most-complete leads first."
            notes={
              <>
                Only <strong>proximity</strong> is real today, computed from atlas.pincode_directory.
                Accreditation, services offered and review score don't exist on discovered_lab yet, so
                every candidate is marked <em>unknown</em> on those — never scored as if they failed.
              </>
            }
          />
        }
      />

      <div className="mb-5">
        <FilterBar
          searchName="area"
          searchPlaceholder="Pincode (560034) or city (Bengaluru)…"
          searchDefault={area}
          applyLabel="Rank"
          clearHref={area || requestedServices.length ? '/discovery' : undefined}
          meta={area ? `${ranked.length} candidate(s)` : undefined}
        >
          <FilterInput
            name="services"
            defaultValue={searchParams.services}
            placeholder="services, e.g. mri,ct"
            width="w-48"
          />
        </FilterBar>
      </div>

      <Card>
        <CardHeader
          title={area ? `Candidates for ${area}` : 'Search a pincode or city'}
          subtitle={
            area
              ? `Matched as a ${describeArea(area)}${requestedServices.length ? ` · filtered to: ${requestedServices.join(', ')}` : ''}`
              : 'Enter a pincode or city above to rank its unverified discovery leads.'
          }
          icon={<ListOrdered className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          {!area ? (
            <p className="text-sm text-ink-400 py-2">Nothing to show yet.</p>
          ) : ranked.length === 0 ? (
            <p className="text-sm text-ink-500 py-2">
              Nothing on file for {area}. Widen the search, or run discovery from the pincode's
              request page first.
            </p>
          ) : (
            <ul className="text-sm divide-y divide-ink-100">
              {ranked.map((s) => {
                const p = s.provider;
                return (
                  <li key={p.id} className="py-3">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full
                                       bg-ink-100 text-ink-700 text-[11px] font-semibold shrink-0">
                        {s.rank}
                      </span>
                      <span className="font-medium text-ink-900">{p.name}</span>
                      <span className="text-[11px] text-ink-400 tabular-nums">[{s.score.toFixed(3)}]</span>
                      {p.confidence != null && (
                        <span className="text-[10px] text-ink-400">discovery confidence {p.confidence.toFixed(2)}</span>
                      )}
                      <span className="ml-auto">
                        <LeadActions leadId={p.id} promoted={!!p.crm_provider_id} />
                      </span>
                    </div>
                    {p.address && (
                      <div className="text-xs text-ink-600 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-ink-300 shrink-0" /> {p.address}
                      </div>
                    )}
                    {p.phone && <div className="text-xs text-ink-700 num">{p.phone}</div>}
                    <div className="text-xs text-ink-700 mt-1">{s.explanation}</div>
                    {s.missing.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {s.missing.map((m) => (
                          <Pill key={m} tone="neutral">Unknown: {m.replace('_', ' ')}</Pill>
                        ))}
                      </div>
                    )}
                    {p.source_url && (
                      <div className="text-[10px] text-ink-400 truncate mt-0.5">{p.source_url}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
