import Link from 'next/link';
import { Map } from 'lucide-react';
import MapClient from '@/components/MapClient';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedControl } from '@/components/ui/Toggle';
import { FilterBar, FilterSelect } from '@/components/ui/FilterBar';
import { InfoTip } from '@/components/ui/InfoTip';
import { TopPincodesTable } from './TopPincodesTable';
import { getMapPoints } from '@/lib/queries';
import { getMapPointsByKindModality } from '@/lib/coverageQueries';
import { LENS_OPTIONS, parseLens } from '@/lib/coverage';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function HeatmapPage({ searchParams }: { searchParams: { mode?: string; lens?: string } }) {
  const mode = (searchParams.mode as 'supply' | 'demand' | 'gap') ?? 'demand';
  const lensKey = searchParams.lens ?? 'ANY';
  const { kinds, modality } = parseLens(lensKey);
  const isFilteredSupply = lensKey !== 'ANY';

  const [points, topPincodes] = await Promise.all([
    isFilteredSupply ? getMapPointsByKindModality({ kinds, modality }) : getMapPoints({ minOrders: 1 }),
    query(`
      SELECT s.pincode, s.orders_all_time, s.orders_l30d, s.home_sample, s.camp, s.center_visit,
             s.providers_total, s.labs_local, s.gap_score
      FROM mv_pincode_summary s
      WHERE s.orders_all_time > 0
      ORDER BY s.orders_all_time DESC LIMIT 25
    `),
  ]);

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Order Origin Heatmap"
        subtitle="Where orders come from, and where you're weak. Toggle Supply/Demand/Gap to see the network from different lenses."
        actions={
          <div className="flex items-center gap-2">
            <InfoTip
              title="Order Origin Heatmap"
              shows="A geographic view of every pincode you've touched. Three lenses — Demand (where orders come from), Supply (where providers exist), Gap (demand ÷ supply ratio)."
              computed={
                <>
                  Marker locations come from <code className="font-mono text-[10px]">mv_pincode_geo</code> (prefix-inferred for pincodes without lat/long — covers 7,907 of 7,912 active pincodes).<br/>
                  <strong>Demand</strong>: marker colour ramps red→amber→green by orders volume.<br/>
                  <strong>Supply</strong>: marker colour ramps by provider count for the active Lens.<br/>
                  <strong>Gap</strong>: marker colour ramps by demand ÷ (supply + 1).
                </>
              }
              drives="Switch to Gap to see crisis pincodes at a glance. Apply the Lens filter to see a specific provider kind/modality — e.g. Lens=Nursing reveals where nursing demand is hot but supply is thin."
            />
            <SegmentedControl
              options={[
                { label: 'Demand', href: buildHref({ mode: 'demand', lens: lensKey }), active: mode === 'demand' },
                { label: 'Supply', href: buildHref({ mode: 'supply', lens: lensKey }), active: mode === 'supply' },
                { label: 'Gap', href: buildHref({ mode: 'gap', lens: lensKey }), active: mode === 'gap' },
              ]}
            />
          </div>
        }
      />

      <div className="mb-4">
        <FilterBar
          searchName="pin_lookup"
          searchPlaceholder="Jump to pincode…"
          hidden={{ mode }}
          clearHref={lensKey !== 'ANY' ? buildHref({ mode, lens: 'ANY' }) : undefined}
          meta={`${points.length.toLocaleString()} pincodes`}
        >
          <FilterSelect name="lens" defaultValue={lensKey}>
            {LENS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </FilterSelect>
        </FilterBar>
      </div>

      <Card className="mb-5 overflow-hidden">
        <CardHeader
          title="India coverage map"
          subtitle={
            mode === 'demand' ? 'Marker colour = order volume (red = highest)'
            : mode === 'supply' ? (lensKey === 'ANY' ? 'Marker colour = total provider count' : `Marker colour = ${LENS_OPTIONS.find((o) => o.key === lensKey)?.label} count`)
            : 'Marker colour = demand ÷ supply ratio (red = critical gap)'
          }
          icon={<Map className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <MapClient points={points} colorMode={mode} height="520px" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Top 25 origin pincodes" subtitle="Highest-volume pincodes by all-time orders · click any column to sort" />
        <CardBody className="pt-0">
          <div className="-mx-5 overflow-x-auto">
            <TopPincodesTable rows={topPincodes} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function buildHref({ mode, lens }: { mode: string; lens: string }) {
  const params = new URLSearchParams();
  if (mode !== 'demand') params.set('mode', mode);
  if (lens && lens !== 'ANY') params.set('lens', lens);
  const qs = params.toString();
  return `/heatmap${qs ? `?${qs}` : ''}`;
}
