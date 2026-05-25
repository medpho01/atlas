import Link from 'next/link';
import { Activity, Building2, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChipButton, SegmentedControl } from '@/components/ui/Toggle';
import { InfoTip } from '@/components/ui/InfoTip';
import { LabsTable, ChainsTable } from './QualityTables';
import { getQualityList, getChainList } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function QualityPage({ searchParams }: { searchParams: { tab?: string; health?: string } }) {
  const tab = searchParams.tab ?? 'labs';
  const health = (searchParams.health as 'red' | 'amber' | 'green' | 'all') ?? 'all';

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Quality Watchtower"
        subtitle="Composite health: 30% delivery rate + 25% (100 − 2×cancel%) + 20% TAT score + 25% repeat rate."
        actions={
          <div className="flex items-center gap-2">
            <InfoTip
              title="Quality Watchtower"
              shows="Per-lab and per-chain health scores blending four signals so the 'best/worst partners' aren't ambiguous. Two tabs: Labs (every branch individually) and Chains (branch-weighted rollup)."
              computed={
                <>
                  <strong>health_score_v2 = </strong><br/>
                  · 30% × delivered_pct (orders reaching REPORT_DELIVERED)<br/>
                  · 25% × max(0, 100 − cancel_pct × 2) (penalises cancellations)<br/>
                  · 20% × TAT score (median order→delivery hours, capped at 48h)<br/>
                  · 25% × repeat-order rate (customers ordering ≥2x — quality proxy)<br/>
                  Buckets: 🟢 ≥75 · 🟡 50–74 · 🔴 &lt;50.
                </>
              }
              drives="Filter to 🔴 Red to see immediate problem labs. Click any chain in the Chains tab to drill into its branches and concentration risk."
            />
            <SegmentedControl
              options={[
                { label: 'Labs', href: '/quality?tab=labs', active: tab === 'labs' },
                { label: 'Chains', href: '/quality?tab=chains', active: tab === 'chains' },
              ]}
            />
          </div>
        }
      />

      {tab === 'labs' && <LabsView health={health} />}
      {tab === 'chains' && <ChainsView />}
    </div>
  );
}

async function LabsView({ health }: { health: 'red' | 'amber' | 'green' | 'all' }) {
  const rows: any[] = await getQualityList({ health, limit: 200 });
  return (
    <>
      <div className="flex items-center gap-1.5 mb-4">
        <ChipButton href="/quality?tab=labs" active={health === 'all'}>All</ChipButton>
        <ChipButton href="/quality?tab=labs&health=red" active={health === 'red'}>🔴 Red</ChipButton>
        <ChipButton href="/quality?tab=labs&health=amber" active={health === 'amber'}>🟡 Amber</ChipButton>
        <ChipButton href="/quality?tab=labs&health=green" active={health === 'green'}>🟢 Green</ChipButton>
      </div>

      <Card>
        <CardHeader
          title="Lab Health Scorecard"
          subtitle={`${rows.length} labs · click any column to sort`}
          icon={<Activity className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5 overflow-x-auto">
            <LabsTable rows={rows} />
          </div>
        </CardBody>
      </Card>
    </>
  );
}

async function ChainsView() {
  const rows: any[] = await getChainList();
  const totalOrders = rows.reduce((s, r) => s + (r.orders_total || 0), 0);
  return (
    <Card>
      <CardHeader
        title="Chain Health Rollup"
        subtitle="Branch-weighted scores across all labs in each chain. Useful for MOU-level decisions."
        icon={<Building2 className="w-4 h-4" strokeWidth={2.25} />}
      />
      <CardBody className="pt-0">
        <div className="-mx-5 overflow-x-auto">
          <ChainsTable rows={rows} totalOrders={totalOrders} />
        </div>
        <div className="mt-3 text-xs text-ink-500">
          <AlertTriangle className="w-3.5 h-3.5 text-warn-500 inline-block mr-1 -mt-0.5" />
          A chain with high <strong>Branches</strong> but low <strong>Orders</strong> = onboarded but underutilised (concentration opportunity).
          High <strong>% of GMV</strong> = single-MOU dependence.
        </div>
      </CardBody>
    </Card>
  );
}
