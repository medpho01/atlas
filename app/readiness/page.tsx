import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Gauge } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { InfoTip } from '@/components/ui/InfoTip';
import { ChipButton } from '@/components/ui/Toggle';
import {
  SEGMENTS, PRIMARY_SEGMENTS, SEGMENT_LABEL, CITY_FILTERS, CITY_FILTER_LABEL,
  getSegmentRows, getSegmentSummary, getFilterCounts,
  type Segment, type CityFilter,
} from '@/lib/readinessSegments';
import { gapsFor } from '@/lib/readiness';
import { ReadinessTable } from './ReadinessTable';

export const dynamic = 'force-dynamic';

const SECONDARY = SEGMENTS.filter((s) => !PRIMARY_SEGMENTS.includes(s));

export default async function ReadinessPage({
  searchParams,
}: {
  searchParams: { segment?: string; cities?: string };
}) {
  const gate = await requireView('coverage', '/readiness');
  if (gate.blocked) return <RoleBlocked area="Coverage" detail="every signed-in role" />;

  const segment: Segment = (SEGMENTS as readonly string[]).includes(searchParams.segment ?? '')
    ? (searchParams.segment as Segment)
    : 'ALL';
  const filter: CityFilter = (CITY_FILTERS as readonly string[]).includes(searchParams.cities ?? '')
    ? (searchParams.cities as CityFilter)
    : 'all';

  const [rows, summary, counts] = await Promise.all([
    getSegmentRows(segment, filter),
    getSegmentSummary(segment, filter),
    getFilterCounts(segment),
  ]);
  const withGaps = rows.map((r) => ({ row: r, gaps: gapsFor(r) }));
  const openGaps = withGaps.reduce((n, r) => n + r.gaps.length, 0);

  const href = (patch: { segment?: string; cities?: string }) => {
    const q = new URLSearchParams();
    const s = patch.segment ?? segment;
    const c = patch.cities ?? filter;
    if (s !== 'ALL') q.set('segment', s);
    if (c !== 'all') q.set('cities', c);
    const qs = q.toString();
    return `/readiness${qs ? `?${qs}` : ''}`;
  };

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      {/* Title, segments, filters and the KPI strip stay put while the table
          scrolls — the filters are what you change to read the numbers below
          them, and scrolling back up to reach them is the whole friction. */}
      <div className="sticky top-0 z-30 -mx-6 lg:-mx-8 px-6 lg:px-8 pt-1 pb-3 bg-ink-50/95 backdrop-blur-sm border-b border-ink-150">
        <PageHeader
          title="City Readiness"
          actions={
            <InfoTip
              title="City Readiness"
              shows="One score per city per segment, 0–100, and the specific gaps behind it."
              computed={
                <>
                  Five subscores — coverage, density, catalogue integration, SLA and price
                  choice — weighted per <code>atlas.readiness_weights</code>. A subscore with no
                  data is left out and its weight redistributed, so the score reads as
                  &ldquo;of what we can measure&rdquo; rather than scoring zero for a missing record.
                </>
              }
              drives="Where the network team opens supply next, and which cities sales can quote today."
            />
          }
        />

        <div className="flex flex-wrap items-center gap-1.5 mb-2 -mt-2">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Segment</span>
          {PRIMARY_SEGMENTS.map((s) => (
            <ChipButton key={s} href={href({ segment: s })} active={segment === s}>
              {SEGMENT_LABEL[s]}
            </ChipButton>
          ))}
          <span className="text-ink-300 px-1">|</span>
          {SECONDARY.map((s) => (
            <ChipButton key={s} href={href({ segment: s })} active={segment === s}>
              {SEGMENT_LABEL[s]}
            </ChipButton>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Cities</span>
          {CITY_FILTERS.map((f) => (
            <ChipButton key={f} href={href({ cities: f })} active={filter === f}>
              {CITY_FILTER_LABEL[f]}
              <span className="ml-1.5 text-ink-400 num">{counts[f] ?? 0}</span>
            </ChipButton>
          ))}
        </div>

        {/* KPIs follow the filter, so "2 of 8 metros" means the eight on screen. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Kpi
            value={summary.metros ? `${summary.metros_ready}/${summary.metros}` : '—'}
            label="Metros launch-ready"
          />
          <Kpi value={summary.avg_score ?? '—'} label="Average score" />
          <Kpi value={summary.providers.toLocaleString('en-IN')} label="Providers" />
          <Kpi value={openGaps.toLocaleString('en-IN')} label="Open gaps" />
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader
          title={`${rows.length} ${rows.length === 1 ? 'city' : 'cities'} · ${SEGMENT_LABEL[segment]}`}
          subtitle="C1 first, then by score. Open a row for the gaps behind it."
          icon={<Gauge className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5">
            <ReadinessTable rows={withGaps} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Kpi({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-lg border border-ink-200 bg-surface px-3 py-2">
      <div className="text-xl font-bold num text-ink-900">{value}</div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mt-0.5">
        {label}
      </div>
    </div>
  );
}
