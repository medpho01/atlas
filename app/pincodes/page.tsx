import Link from 'next/link';
import { MapPin, Building2, BarChart3, MapPinned, AlertTriangle, Globe2 } from 'lucide-react';
import { query, queryOne } from '@/lib/db';
import { enrichRowsWithCity } from '@/lib/pincodeDirectory';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, FilterInput, FilterSelect } from '@/components/ui/FilterBar';
import { ChipButton } from '@/components/ui/Toggle';
import { InfoTip } from '@/components/ui/InfoTip';
import { KpiTile } from '@/components/KpiTile';
import { PincodesTable } from './PincodesTable';

export const dynamic = 'force-dynamic';

type Search = { q?: string; city?: string; state?: string; bucket?: string };

const BUCKET_FILTERS: { key: string; label: string; sql: string }[] = [
  { key: 'all', label: 'All', sql: '' },
  { key: '5_plus', label: '≥5 providers', sql: "AND s.coverage_bucket = '5_plus'" },
  { key: '2_to_4', label: '2–4 providers', sql: "AND s.coverage_bucket IN ('2','3_to_4')" },
  { key: '1', label: 'Single provider', sql: "AND s.coverage_bucket = '1'" },
  { key: '0', label: 'Zero providers', sql: "AND s.coverage_bucket = '0'" },
];

async function searchPincodes(s: Search) {
  const filters: string[] = [];
  const params: any[] = [];
  if (s.q && /^\d+$/.test(s.q)) {
    params.push(s.q);
    filters.push(`s.pincode LIKE $${params.length} || '%'`);
  } else {
    filters.push(`(s.orders_all_time > 0 OR s.network_strength > 0)`);
  }
  if (s.city) {
    params.push(s.city);
    filters.push(`LOWER(pc.city) = LOWER($${params.length})`);
  }
  if (s.state) {
    params.push(s.state);
    filters.push(`LOWER(pc.state) = LOWER($${params.length})`);
  }
  const bucket = BUCKET_FILTERS.find((b) => b.key === s.bucket);
  const bucketSql = bucket?.sql ?? '';
  const rows = await query<any>(`
    SELECT s.pincode, pc.city, pc.state,
           s.network_strength, s.labs_local, s.providers_total, s.pharmacies,
           s.orders_l90d, s.orders_all_time, s.coverage_bucket, s.gap_score
    FROM mv_pincode_summary s
    LEFT JOIN mv_pincode_city pc ON pc.pincode = s.pincode
    WHERE ${filters.join(' AND ')}
    ${bucketSql}
    ORDER BY s.orders_all_time DESC NULLS LAST, s.network_strength DESC
    LIMIT 200
  `, params);
  // Backfill city/state from the India Post directory (lives in app DB) for
  // rows where Lab/Provider/Profile didn't tell us. Top-cities aggregation
  // still runs against the source-DB MV only — that's the known regression of
  // the app-side enrichment approach.
  return enrichRowsWithCity(rows);
}

async function getPincodeDistribution(s: Search) {
  const filters: string[] = [`(s.orders_all_time > 0 OR s.network_strength > 0)`];
  const params: any[] = [];
  if (s.city) { params.push(s.city); filters.push(`LOWER(pc.city) = LOWER($${params.length})`); }
  if (s.state) { params.push(s.state); filters.push(`LOWER(pc.state) = LOWER($${params.length})`); }
  return queryOne<{
    total: number;
    well_served: number;
    mid: number;
    single: number;
    zero: number;
    with_l30d: number;
    demand_no_supply: number;
    distinct_cities: number;
    distinct_states: number;
  }>(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE s.coverage_bucket = '5_plus')::int AS well_served,
      COUNT(*) FILTER (WHERE s.coverage_bucket IN ('2','3_to_4'))::int AS mid,
      COUNT(*) FILTER (WHERE s.coverage_bucket = '1')::int AS single,
      COUNT(*) FILTER (WHERE s.coverage_bucket = '0')::int AS zero,
      COUNT(*) FILTER (WHERE s.orders_l30d > 0)::int AS with_l30d,
      COUNT(*) FILTER (WHERE s.coverage_bucket = '0' AND s.orders_l90d > 0)::int AS demand_no_supply,
      COUNT(DISTINCT pc.city) FILTER (WHERE pc.city IS NOT NULL)::int AS distinct_cities,
      COUNT(DISTINCT pc.state) FILTER (WHERE pc.state IS NOT NULL)::int AS distinct_states
    FROM mv_pincode_summary s
    LEFT JOIN mv_pincode_city pc ON pc.pincode = s.pincode
    WHERE ${filters.join(' AND ')}
  `, params);
}

async function getTopCities(s: Search) {
  const filters: string[] = [`pc.city IS NOT NULL`, `(s.orders_all_time > 0 OR s.network_strength > 0)`];
  const params: any[] = [];
  if (s.state) { params.push(s.state); filters.push(`LOWER(pc.state) = LOWER($${params.length})`); }
  return query<{
    city: string;
    state: string | null;
    pincodes: number;
    well_served: number;
    single_provider: number;
    demand_no_supply: number;
    orders_l30d: number;
    orders_all_time: number;
  }>(`
    SELECT
      pc.city,
      MAX(pc.state) AS state,
      COUNT(*)::int AS pincodes,
      COUNT(*) FILTER (WHERE s.coverage_bucket = '5_plus')::int AS well_served,
      COUNT(*) FILTER (WHERE s.coverage_bucket = '1')::int AS single_provider,
      COUNT(*) FILTER (WHERE s.coverage_bucket = '0' AND s.orders_l90d > 0)::int AS demand_no_supply,
      SUM(s.orders_l30d)::int AS orders_l30d,
      SUM(s.orders_all_time)::int AS orders_all_time
    FROM mv_pincode_summary s
    JOIN mv_pincode_city pc ON pc.pincode = s.pincode
    WHERE ${filters.join(' AND ')}
    GROUP BY pc.city
    ORDER BY pincodes DESC, orders_all_time DESC
    LIMIT 12
  `, params);
}

async function getTopStates() {
  return query<{ state: string; pincodes: number; orders_all_time: number }>(`
    SELECT pc.state, COUNT(*)::int AS pincodes, SUM(s.orders_all_time)::int AS orders_all_time
    FROM mv_pincode_summary s
    JOIN mv_pincode_city pc ON pc.pincode = s.pincode
    WHERE pc.state IS NOT NULL AND (s.orders_all_time > 0 OR s.network_strength > 0)
    GROUP BY pc.state
    ORDER BY pincodes DESC
    LIMIT 8
  `);
}

function buildHref(current: Search, next: Partial<Search>) {
  const merged = { ...current, ...next };
  const params = new URLSearchParams();
  if (merged.q) params.set('q', merged.q);
  if (merged.city) params.set('city', merged.city);
  if (merged.state) params.set('state', merged.state);
  if (merged.bucket && merged.bucket !== 'all') params.set('bucket', merged.bucket);
  const qs = params.toString();
  return `/pincodes${qs ? `?${qs}` : ''}`;
}

export default async function PincodesPage({ searchParams }: { searchParams: Search }) {
  const s = searchParams;
  const bucketKey = s.bucket ?? 'all';
  const [rows, dist, topCities, topStates] = await Promise.all([
    searchPincodes(s),
    getPincodeDistribution(s),
    getTopCities(s),
    getTopStates(),
  ]);
  const distTotal = dist?.total ?? 0;
  const pctWellServed = distTotal > 0 ? Math.round(100 * (dist?.well_served ?? 0) / distTotal) : 0;
  const pctFragile = distTotal > 0 ? Math.round(100 * ((dist?.single ?? 0) + (dist?.zero ?? 0)) / distTotal) : 0;
  const filterActive = s.city || s.state || s.bucket || s.q;

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Pincodes"
        subtitle={
          s.city ? `Pincodes in ${s.city}${s.state ? `, ${s.state}` : ''}`
          : s.state ? `Pincodes in ${s.state}`
          : "Coverage distribution and geographic breakdown of every pincode you touch."
        }
        actions={
          <InfoTip
            title="Pincodes — distribution & geography"
            shows="Coverage shape (how many pincodes have 0 / 1 / 2-4 / 5+ providers), city rollups, and a filterable directory. Use it to decide where to densify and where you're concentrated."
            computed={
              <>
                Distribution from <code className="font-mono text-[10px]">mv_pincode_summary</code>. City+state from <code className="font-mono text-[10px]">mv_pincode_city</code>. KPI tiles show absolute counts; the Coverage Distribution card shows shape as % of footprint.<br/>
                A pincode is "active" if <code className="font-mono text-[10px]">orders_all_time &gt; 0 OR providers_total &gt; 0</code>.
              </>
            }
            drives="Filter by state/city to localise the analysis. Sort the cities card by 'Single' or 'Zero' to find concentration-risk geographies. Top cities → click → focus the table to that city."
          />
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <KpiTile
          label="Pincodes in scope"
          value={distTotal.toLocaleString()}
          sub={filterActive ? 'filtered' : 'platform-wide'}
          icon={<MapPinned className="w-4 h-4" />}
          info={<InfoTip title="Pincodes in scope" shows="Distinct active pincodes matching the current filters (city/state/bucket if set)." computed={<>Active = <code className="font-mono text-[10px]">orders_all_time &gt; 0 OR network_strength &gt; 0</code>.</>} drives="Apply state/city filters to drill in. The table below is capped at 200 rows for performance." />}
        />
        <KpiTile
          label="Well-served"
          value={`${(dist?.well_served ?? 0).toLocaleString()}`}
          sub={`${pctWellServed}% of scope`}
          tone="good"
          info={<InfoTip title="Well-served (≥5 providers)" shows="Pincodes deep enough to absorb a single partner loss. Aim to grow this as a share of footprint." computed={<>Pincodes with <code className="font-mono text-[10px]">coverage_bucket = '5_plus'</code>.</>} drives="High share = resilient network. Low share = redundancy gap." />}
        />
        <KpiTile
          label="2–4 providers"
          value={(dist?.mid ?? 0).toLocaleString()}
          sub="moderate depth"
          info={<InfoTip title="2–4 providers" shows="The middle of the network. Each one is two onboarding steps from 'well-served'." computed={<>Pincodes with <code className="font-mono text-[10px]">coverage_bucket IN ('2','3_to_4')</code>.</>} drives="The highest-leverage segment for BD — adding one provider here often pushes the pincode to ≥5." />}
        />
        <KpiTile
          label="Single provider"
          value={(dist?.single ?? 0).toLocaleString()}
          sub="concentration risk"
          tone="warn"
          info={<InfoTip title="Single provider" shows="Pincodes where one provider failing wipes out coverage. Especially urgent if they have active orders." computed={<>Pincodes with <code className="font-mono text-[10px]">coverage_bucket = '1'</code>.</>} drives="Onboard a second provider — start with the ones that have L30D orders." />}
        />
        <KpiTile
          label="Zero providers"
          value={(dist?.zero ?? 0).toLocaleString()}
          sub={`${(dist?.demand_no_supply ?? 0).toLocaleString()} with demand`}
          tone="bad"
          info={<InfoTip title="Zero providers" shows="Pincodes with no verified provider. Most are inactive (no demand); the subset with L90D orders is the direct revenue leak." computed={<>Pincodes with <code className="font-mono text-[10px]">coverage_bucket = '0'</code>. Sub-figure: those with <code className="font-mono text-[10px]">orders_l90d &gt; 0</code>.</>} drives="The 'with demand' subset is the priority queue — see the Gaps page for the ranked list." />}
        />
        <KpiTile
          label="L30D active"
          value={(dist?.with_l30d ?? 0).toLocaleString()}
          sub="recent orders"
          info={<InfoTip title="L30D active" shows="Pincodes that received at least one order in the last 30 days — your current live demand surface." computed={<>Pincodes with <code className="font-mono text-[10px]">orders_l30d &gt; 0</code>.</>} drives="Compare to 'Pincodes in scope' to see what % of the footprint is actually firing right now." />}
        />
      </div>

      {/* Insight row: distribution bar + top cities */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-5">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Coverage distribution"
            subtitle={`${pctFragile}% of pincodes have 0–1 providers`}
            icon={<BarChart3 className="w-4 h-4" strokeWidth={2.25} />}
            info={<InfoTip title="Coverage distribution" shows="The shape of network density across the in-scope pincodes." computed="Stacked bar of pincodes by coverage_bucket. Click a band to filter the table." drives="A healthy network has a fat ≥5 band. A fat 0/1 band = densification work." />}
          />
          <CardBody className="pt-1">
            <DistributionBar dist={dist} total={distTotal} current={s} />
            <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-ink-500">
              <span><strong className="text-ink-800">{dist?.distinct_cities ?? 0}</strong> distinct cities</span>
              <span><strong className="text-ink-800">{dist?.distinct_states ?? 0}</strong> distinct states</span>
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Top cities by pincode count"
            subtitle="Click a city to filter the table"
            icon={<Building2 className="w-4 h-4" strokeWidth={2.25} />}
            info={<InfoTip title="Top cities" shows="The 12 cities with the most active pincodes in scope. Each row breaks down the coverage shape of that city." computed={<>Aggregated from <code className="font-mono text-[10px]">mv_pincode_summary</code> joined to <code className="font-mono text-[10px]">mv_pincode_city</code>. State filter narrows the list.</>} drives="A city with many pincodes but few well-served = expansion opportunity. A city with many 'demand-no-supply' = direct revenue leak." />}
          />
          <CardBody className="pt-0">
            <div className="-mx-5 overflow-x-auto">
              <table className="lk">
                <thead>
                  <tr>
                    <th>City</th>
                    <th>State</th>
                    <th className="text-right">Pincodes</th>
                    <th className="text-right">Well-served</th>
                    <th className="text-right">Single</th>
                    <th className="text-right">Demand-no-supply</th>
                    <th className="text-right">L30D orders</th>
                  </tr>
                </thead>
                <tbody>
                  {topCities.map((c) => {
                    const active = s.city?.toLowerCase() === c.city.toLowerCase();
                    return (
                      <tr key={c.city} className={active ? 'bg-brand-50/40' : ''}>
                        <td>
                          <Link href={buildHref(s, { city: active ? undefined : c.city })} className={`font-medium ${active ? 'text-brand-600' : 'text-ink-900 hover:text-brand-600'}`}>
                            {c.city}
                          </Link>
                        </td>
                        <td className="text-ink-500 text-[12px]">{c.state ?? '—'}</td>
                        <td className="num font-semibold">{c.pincodes.toLocaleString()}</td>
                        <td className="num text-success-700">{c.well_served.toLocaleString()}</td>
                        <td className={`num ${c.single_provider > 0 ? 'text-warn-600' : 'text-ink-400'}`}>{c.single_provider.toLocaleString()}</td>
                        <td className={`num ${c.demand_no_supply > 0 ? 'text-danger-500 font-semibold' : 'text-ink-400'}`}>{c.demand_no_supply.toLocaleString()}</td>
                        <td className="num">{c.orders_l30d.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* State chips — quick filter */}
      {topStates.length > 0 && (
        <div className="mb-3 flex items-center gap-1.5 flex-wrap">
          <Globe2 className="w-3.5 h-3.5 text-ink-500" strokeWidth={2.25} />
          <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mr-1">State</span>
          <ChipButton href={buildHref(s, { state: undefined, city: undefined })} active={!s.state}>All</ChipButton>
          {topStates.map((st) => (
            <ChipButton key={st.state} href={buildHref(s, { state: st.state, city: undefined })} active={s.state?.toLowerCase() === st.state.toLowerCase()}>
              {st.state} <span className="opacity-60 ml-0.5">{st.pincodes.toLocaleString()}</span>
            </ChipButton>
          ))}
        </div>
      )}

      {/* Coverage bucket chips */}
      <div className="mb-3 flex items-center gap-1.5 flex-wrap">
        <BarChart3 className="w-3.5 h-3.5 text-ink-500" strokeWidth={2.25} />
        <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mr-1">Coverage</span>
        {BUCKET_FILTERS.map((b) => (
          <ChipButton key={b.key} href={buildHref(s, { bucket: b.key === 'all' ? undefined : b.key })} active={bucketKey === b.key}>
            {b.label}
          </ChipButton>
        ))}
      </div>

      {/* Search + city/state filter */}
      <div className="mb-4">
        <FilterBar
          searchName="q"
          searchPlaceholder="Search by pincode prefix (e.g. 5601)"
          searchDefault={s.q}
          clearHref={filterActive ? '/pincodes' : undefined}
          meta={`${rows.length} pincodes shown`}
          hidden={{
            ...(s.bucket && s.bucket !== 'all' ? { bucket: s.bucket } : {}),
          }}
        >
          <FilterInput name="city" defaultValue={s.city} placeholder="City filter" />
          <FilterInput name="state" defaultValue={s.state} placeholder="State filter" />
        </FilterBar>
      </div>

      <Card>
        <CardHeader
          title={s.q ? `Search results` : s.city ? `Pincodes in ${s.city}` : s.state ? `Pincodes in ${s.state}` : `Top active pincodes`}
          subtitle={`${rows.length} pincodes shown · click any column to sort`}
          icon={<MapPin className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5 overflow-x-auto">
            <PincodesTable rows={rows} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function DistributionBar({ dist, total, current }: { dist: any; total: number; current: Search }) {
  if (!dist || total === 0) return <div className="text-sm text-ink-500">No data in scope.</div>;
  const bands: { key: string; label: string; count: number; cls: string; bucketKey?: string }[] = [
    { key: '5_plus', label: '≥5', count: dist.well_served, cls: 'bg-success-500', bucketKey: '5_plus' },
    { key: 'mid', label: '2–4', count: dist.mid, cls: 'bg-brand-500', bucketKey: '2_to_4' },
    { key: '1', label: '1', count: dist.single, cls: 'bg-warn-500', bucketKey: '1' },
    { key: '0', label: '0', count: dist.zero, cls: 'bg-danger-500', bucketKey: '0' },
  ];
  return (
    <div>
      <div className="flex h-7 rounded-md overflow-hidden border border-ink-150">
        {bands.map((b) => {
          const w = total > 0 ? (b.count / total) * 100 : 0;
          if (w === 0) return null;
          return (
            <Link
              key={b.key}
              href={`/pincodes?${new URLSearchParams({
                ...(current.city ? { city: current.city } : {}),
                ...(current.state ? { state: current.state } : {}),
                ...(b.bucketKey ? { bucket: b.bucketKey } : {}),
              }).toString()}`}
              style={{ width: `${w}%` }}
              className={`${b.cls} hover:opacity-80 transition flex items-center justify-center text-[10px] font-semibold text-white tabular-nums`}
              title={`${b.label} providers — ${b.count.toLocaleString()} pincodes (${Math.round(w)}%)`}
            >
              {w >= 8 ? `${Math.round(w)}%` : ''}
            </Link>
          );
        })}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-[11px]">
        {bands.map((b) => (
          <div key={b.key} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-sm ${b.cls}`} />
            <span className="text-ink-700"><strong>{b.label}</strong></span>
            <span className="text-ink-500 tabular-nums ml-auto">{b.count.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
