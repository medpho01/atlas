import { notFound } from 'next/navigation';
import { Building2, MapPin } from 'lucide-react';
import { KpiTile } from '@/components/KpiTile';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pill } from '@/components/ui/Toggle';
import { HealthBadge } from '@/components/HealthBadge';
import { InfoTip } from '@/components/ui/InfoTip';
import { BranchesTable } from './BranchesTable';
import { getChainDetail, getChainBranches } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function ChainPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (Number.isNaN(id)) notFound();
  const [chain, branches] = await Promise.all([
    getChainDetail(id),
    getChainBranches(id),
  ]);
  if (!chain) notFound();

  const c = chain as any;
  const totalGmvShare = c.orders_total > 0 ? c.orders_total : 0;

  // Concentration metrics
  const dormantBranches = branches.filter((b: any) => b.orders_total === 0).length;
  const activeBranches = branches.filter((b: any) => b.orders_total > 0).length;
  const topBranchOrders = Math.max(0, ...branches.map((b: any) => b.orders_total || 0));
  const topBranchSharePct = c.orders_total > 0 ? Math.round(100 * topBranchOrders / c.orders_total) : 0;

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      <PageHeader
        title={c.chain_name}
        subtitle={`Chain rollup · ${c.total_branches} branches · ${c.distinct_cities} cities`}
        breadcrumbs={[
          { label: 'Directory', href: '/directory' },
          { label: 'Chains', href: '/quality?tab=chains' },
          { label: c.chain_name },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {c.weighted_health_score != null && <HealthBadge score={c.weighted_health_score} size="md" />}
            {topBranchSharePct >= 60 && <Pill tone="bad">⚠ Single-branch dependence</Pill>}
            {dormantBranches > activeBranches && <Pill tone="warn">{dormantBranches} dormant branches</Pill>}
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <KpiTile
          label="Active branches"
          value={c.active_branches?.toLocaleString() ?? 0}
          sub={`of ${c.total_branches}`}
          info={<InfoTip title="Active branches" shows="Branches that produced at least one order in the chain's reporting window." computed={<>Branches with <code className="font-mono text-[10px]">orders_total &gt; 0</code> across all time, divided by total onboarded branches.</>} drives="Big gap between active and total = MOU signed but most locations dormant — BD activation opportunity." />}
        />
        <KpiTile
          label="Cities"
          value={c.distinct_cities?.toLocaleString() ?? 0}
          sub="distinct"
          info={<InfoTip title="Cities served" shows="Distinct cities where this chain has at least one branch." computed={<>Distinct <code className="font-mono text-[10px]">city</code> values across active branches.</>} drives="Geographic spread proxy. A chain with many branches but few cities is a regional player; many cities = national footprint." />}
        />
        <KpiTile
          label="HS Pincodes"
          value={(c.home_sample_pincodes_served || 0).toLocaleString()}
          sub="home sample reach"
          info={<InfoTip title="Home-sample pincodes" shows="Total distinct pincodes the chain claims to service via home sample collection — summed across branches." computed={<>Union of <code className="font-mono text-[10px]">pincodesServiced</code> across branches with home-sample modality.</>} drives="≥1000 pincodes claimed by one chain = likely mass-claim; verify ground reach via actual orders. Mass-claim labs are capped in coverage rollups." />}
        />
        <KpiTile
          label="Orders"
          value={(c.orders_total || 0).toLocaleString()}
          sub={`${c.orders_l30d || 0} L30D`}
          info={<InfoTip title="Chain orders" shows="All-time order count across all branches, with L30D in the subtitle for recent momentum." computed={<>Sum of <code className="font-mono text-[10px]">orders_total</code> and <code className="font-mono text-[10px]">orders_l30d</code> across branches in <code className="font-mono text-[10px]">mv_chain_summary</code>.</>} drives="If L30D × 12 is far below all-time / months-active, the chain is decelerating — check the branch table for which locations are dropping." />}
        />
        <KpiTile
          label="Avg TAT"
          value={c.weighted_avg_tat_hours ? `${Number(c.weighted_avg_tat_hours).toFixed(1)}h` : '—'}
          sub="weighted across branches"
          tone={c.weighted_avg_tat_hours >= 72 ? 'bad' : c.weighted_avg_tat_hours >= 36 ? 'warn' : 'good'}
          info={<InfoTip title="Weighted TAT" shows="Median order → REPORT_DELIVERED hours, weighted by branch order volume so high-volume branches dominate the chain-level number." computed={<>Per-branch median TAT × branch order share, summed. Bad ≥72h, warn ≥36h, good &lt;36h.</>} drives="The customer-facing speed of the chain. Above 48h on diagnostics generally hurts repeat rate materially." />}
        />
        <KpiTile
          label="Repeat rate"
          value={c.chain_repeat_rate_pct != null ? `${c.chain_repeat_rate_pct}%` : '—'}
          sub="customers re-ordering"
          tone={c.chain_repeat_rate_pct >= 30 ? 'good' : c.chain_repeat_rate_pct >= 15 ? 'warn' : 'bad'}
          info={<InfoTip title="Repeat rate" shows="Share of unique customers who placed ≥2 orders with this chain. Best proxy for chain-level quality we have." computed={<>Distinct customers with ≥2 orders ÷ total distinct customers. Good ≥30%, warn ≥15%, bad &lt;15%.</>} drives="Low repeat = quality, TAT, or customer-experience issue regardless of volume. Cross-reference with TAT and cancel%." />}
        />
      </div>

      {/* Strategic insights */}
      <Card className="mb-5">
        <CardHeader
          title="Strategic snapshot"
          subtitle="What's interesting about this chain in 30 seconds"
          icon={<Building2 className="w-4 h-4" strokeWidth={2.25} />}
          info={
            <InfoTip
              title="Strategic snapshot"
              shows="A four-quadrant qualitative read on this chain: Utilisation (are branches actually firing), Concentration (is one branch carrying it), Quality (health + cancel + TAT), Coverage breadth (how many pincodes claimed)."
              computed={
                <>
                  <strong>Utilisation</strong> = active branches ÷ total branches. Warn when &lt;50%.<br/>
                  <strong>Concentration risk</strong> = top branch orders ÷ chain total. Bad ≥60%, warn ≥35%.<br/>
                  <strong>Coverage breadth</strong> ≥1000 pincodes = mass-claim flag; reach is likely overstated.
                </>
              }
              drives="A chain with low utilisation + low concentration = onboarded broadly but unused → BD activation. High concentration → diversify or risk a single point of failure."
            />
          }
        />
        <CardBody className="pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Insight title="Utilisation" tone={activeBranches < c.total_branches / 2 ? 'warn' : 'good'}>
              {activeBranches} of {c.total_branches} branches generated orders ({Math.round(100 * activeBranches / Math.max(1, c.total_branches))}%).
              {dormantBranches > c.total_branches / 2 && ' Most branches are dormant — relationship may be underused.'}
            </Insight>
            <Insight title="Concentration risk" tone={topBranchSharePct >= 60 ? 'bad' : topBranchSharePct >= 35 ? 'warn' : 'good'}>
              Top branch accounts for {topBranchSharePct}% of chain orders.
              {topBranchSharePct >= 60 && ' One branch failing collapses most volume — diversify.'}
            </Insight>
            <Insight title="Quality" tone={c.weighted_health_score >= 75 ? 'good' : c.weighted_health_score >= 50 ? 'warn' : 'bad'}>
              Weighted health score {c.weighted_health_score ?? '—'} / 100.
              Cancel {c.weighted_cancel_pct ? Number(c.weighted_cancel_pct).toFixed(1) : 0}%, TAT {c.weighted_avg_tat_hours ? Number(c.weighted_avg_tat_hours).toFixed(1) : '—'}h.
            </Insight>
            <Insight title="Coverage breadth" tone={c.home_sample_pincodes_served >= 500 ? 'warn' : 'good'}>
              Serves {c.home_sample_pincodes_served || 0} pincodes via home collection across {c.distinct_cities} cities.
              {c.home_sample_pincodes_served >= 1000 && ' Likely a mass-claim partner — verify operational reach.'}
            </Insight>
          </div>
        </CardBody>
      </Card>

      {/* Branches */}
      <Card>
        <CardHeader
          title={`Branches (${branches.length})`}
          subtitle="Per-location performance · click any column to sort"
          icon={<MapPin className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5 overflow-x-auto">
            <BranchesTable rows={branches} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Insight({ title, tone, children }: { title: string; tone: 'good' | 'warn' | 'bad'; children: React.ReactNode }) {
  const toneCls = {
    good: 'border-success-100 bg-success-50/40 text-success-700',
    warn: 'border-warn-100 bg-warn-50/40 text-warn-500',
    bad: 'border-danger-100 bg-danger-50/40 text-danger-500',
  }[tone];
  return (
    <div className={`rounded-lg border ${toneCls} px-3.5 py-3`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold mb-1">{title}</div>
      <div className="text-sm text-ink-800 leading-snug">{children}</div>
    </div>
  );
}

function labelForCenterType(t?: string) {
  if (t === 'DIAGNOSTIC_CENTER') return 'Diagnostic';
  if (t === 'COLLECTION_CENTER') return 'Collection';
  if (t === 'HOSPITAL') return 'Hospital';
  return '—';
}
