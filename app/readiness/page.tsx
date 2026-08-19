import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Gauge } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { InfoTip } from '@/components/ui/InfoTip';
import { ChipButton } from '@/components/ui/Toggle';
import { CATEGORIES, CATEGORY_LABEL, type Category } from '@/lib/categories';
import { getReadiness } from '@/lib/readinessQueries';
import { readinessBand, gapsFor } from '@/lib/readiness';
import { ReadinessTable } from './ReadinessTable';

export const dynamic = 'force-dynamic';

export default async function ReadinessPage({
  searchParams,
}: {
  searchParams: { category?: string };
}) {
  const gate = await requireView('coverage', '/readiness');
  if (gate.blocked) return <RoleBlocked area="Coverage" detail="every signed-in role" />;

  const category = (CATEGORIES as readonly string[]).includes(searchParams.category ?? '')
    ? (searchParams.category as Category)
    : 'DIAGNOSTICS';

  const rows = await getReadiness(category);
  const withGaps = rows.map((r) => ({ row: r, gaps: gapsFor(r) }));

  const c1 = rows.filter((r) => r.band === 'C1');
  const ready = c1.filter((r) => r.score >= 75).length;

  const href = (c: string) => `/readiness?category=${c}`;

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="City Readiness"
        subtitle="Could we sell into this city tomorrow? One score per city, and the specific gaps behind it."
        actions={
          <InfoTip
            title="City Readiness"
            shows="One score per city per category, 0–100, and the specific gaps behind it."
            computed={
              <>
                Five subscores — coverage, density, integration, SLA and price choice —
                weighted and combined. A subscore with no data is left out and its weight
                redistributed rather than counted as zero, so a gap in our records does not
                read as a gap in the network. Integration, SLA and price are lab-derived and
                therefore apply to diagnostics only.
              </>
            }
            drives={
              <>
                75+ is launch-ready, 50–74 near-ready, below 50 build. Open a row for the gap
                list and the deep links into the gap queue and onboarding pipeline.
              </>
            }
          />
        }
      />

      <div className="flex flex-wrap items-center gap-1.5 my-4">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Category</span>
        {CATEGORIES.map((c) => (
          <ChipButton key={c} href={href(c)} active={category === c}>
            {CATEGORY_LABEL[c]}
          </ChipButton>
        ))}
      </div>

      <Card className="mb-4">
        <CardBody>
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div>
              <div className="text-2xl font-bold text-ink-900 num">
                {ready}<span className="text-ink-400">/{c1.length}</span>
              </div>
              <div className="text-[11px] text-ink-500 mt-0.5">
                C1 cities launch-ready · {CATEGORY_LABEL[category]}
              </div>
            </div>
            {(['C1', 'C2', 'C3'] as const).map((b) => {
              const set = rows.filter((r) => r.band === b);
              if (!set.length) return null;
              const avg = Math.round(set.reduce((s, r) => s + r.score, 0) / set.length);
              const band = readinessBand(avg);
              return (
                <div key={b}>
                  <div className={`text-2xl font-bold num text-${band.tone}-600`}>{avg}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5">
                    {b} average · {set.length} {set.length === 1 ? 'city' : 'cities'}
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`${rows.length} cities · ${CATEGORY_LABEL[category]}`}
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
