import { Scale, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { InfoTip } from '@/components/ui/InfoTip';
import { ImbalanceTable } from './ImbalanceTable';
import { getDemandSupplyImbalances } from '@/lib/demandQueries';

export const dynamic = 'force-dynamic';

export default async function ImbalancePage() {
  const rows = await getDemandSupplyImbalances({ minEvents: 3, limit: 80 });

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Demand-Supply Imbalance Watchlist"
        subtitle="Pincodes where order demand is sprinting ahead of provider capacity. Ranked by imbalance score."
        actions={
          <InfoTip
            title="Demand-Supply Imbalance"
            shows="Every (pincode × service line) where demand grew but supply is thin. The most urgent ones — pincodes with active demand and 0–2 providers — are at the top."
            computed={
              <>
                Imbalance score: <code className="font-mono text-[10px] bg-ink-100 px-1 rounded">events_l30d × growth_multiplier ÷ (supply + 1)</code>, capped at 100. Surfaces both <em>volume</em> and <em>velocity</em>.
              </>
            }
            drives="Top rows = direct revenue leaks. Open a pincode to see its Coverage Matrix and pick the right provider type to onboard."
          />
        }
      />

      <Card>
        <CardHeader
          title={`${rows.length} pincode × service-line pairs flagged`}
          subtitle="Imbalance = (L30D events × demand-growth multiplier) ÷ (supply + 1). Higher = worse."
          icon={<Scale className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5 overflow-x-auto">
            <ImbalanceTable rows={rows} />
          </div>
        </CardBody>
      </Card>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-ink-500">
        <div className="flex items-start gap-2"><AlertTriangle className="w-3.5 h-3.5 text-warn-500 mt-0.5 shrink-0" /><span><strong className="text-ink-700">Imbalance ≥60:</strong> critical — onboard immediately to avoid leak.</span></div>
        <div className="flex items-start gap-2"><span className="w-2 h-2 rounded-full bg-success-500 mt-1.5 shrink-0" /><span><strong className="text-ink-700">Growth +100%:</strong> demand doubled MoM — rising-star pincode.</span></div>
        <div className="flex items-start gap-2"><span className="w-2 h-2 rounded-full bg-danger-500 mt-1.5 shrink-0" /><span><strong className="text-ink-700">Supply 0:</strong> demand exists but you have no provider — direct revenue leak.</span></div>
      </div>
    </div>
  );
}
