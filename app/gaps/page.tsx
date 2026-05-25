import Link from 'next/link';
import { Crosshair } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, FilterInput, FilterSelect } from '@/components/ui/FilterBar';
import { InfoTip } from '@/components/ui/InfoTip';
import { GapsTable } from './GapsTable';
import { getGapTriples } from '@/lib/coverageQueries';
import { LENS_OPTIONS, parseLens } from '@/lib/coverage';

export const dynamic = 'force-dynamic';

export default async function GapsPage({ searchParams }: { searchParams: { lens?: string; city?: string } }) {
  const lensKey = searchParams.lens ?? 'ANY';
  const { kinds, modality } = parseLens(lensKey);
  const rows = await getGapTriples({ kinds, modality, city: searchParams.city, limit: 80 });

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Network Gaps & Onboarding Queue"
        subtitle="Ranked by gap score per (pincode × kind × modality). Each row is a specific onboarding need."
        actions={
          <InfoTip
            title="Gap Queue"
            shows="Every (pincode × provider-kind × modality) where there's measurable demand but thin or zero supply. The single most actionable view for the Head of Networks."
            computed={
              <>
                <strong>Gap score:</strong> <code className="font-mono text-[10px]">(orders_l90d + unserviced × 2) ÷ (providers + 1) ÷ 4</code>, capped at 100.<br/>
                <strong>Trend %</strong> = (events_l30d − events_l30d_prior) / events_l30d_prior. <strong>30D forecast</strong> = max(recent, baseline) × 4 weeks. <strong>Urgency</strong> classifies into act-now / this week / this sprint / later based on demand-to-provider ratio.
              </>
            }
            drives="Sort by Urgency or Trend. 'Act now' rows = providers = 0 with active demand → onboard this week. Lens filter narrows to a specific service line you're prioritising."
          />
        }
      />

      <div className="mb-4">
        <FilterBar
          searchName="pin_lookup"
          searchPlaceholder="Jump to pincode…"
          clearHref={lensKey !== 'ANY' || searchParams.city ? '/gaps' : undefined}
          meta={`${rows.length} gaps in scope`}
        >
          <FilterSelect name="lens" defaultValue={lensKey}>
            {LENS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </FilterSelect>
          <FilterInput name="city" defaultValue={searchParams.city} placeholder="City filter" width="w-36" />
        </FilterBar>
      </div>

      <Card>
        <CardHeader
          title="Prioritised gaps"
          subtitle="Sort: gap score descending — highest urgency first"
          icon={<Crosshair className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5 overflow-x-auto">
            <GapsTable rows={rows} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
