import Link from 'next/link';
import { Briefcase, AlertTriangle, TrendingUp, TrendingDown, Sparkles } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { KpiTile } from '@/components/KpiTile';
import { Pill, ChipButton } from '@/components/ui/Toggle';
import { InfoTip } from '@/components/ui/InfoTip';
import { AccountsTable } from './AccountsTable';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Account = {
  store_id: number;
  store_name: string;
  city: string | null;
  active: boolean;
  mou_end_date: string | null;
  orders_total: number;
  orders_l30d: number;
  orders_l30d_prior: number;
  orders_l90d: number;
  distinct_pincodes_served: number;
  distinct_labs_used: number;
  last_order_at: string | null;
  cancel_pct: number | null;
  wow_growth_pct: number | null;
  account_status: 'GROWING' | 'STABLE' | 'NEW' | 'DECLINING' | 'AT_RISK' | 'CHURNED' | 'INACTIVE';
};

const STATUS_TONE: Record<Account['account_status'], 'good' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  GROWING: 'good',
  STABLE: 'info',
  NEW: 'info',
  DECLINING: 'warn',
  AT_RISK: 'bad',
  CHURNED: 'bad',
  INACTIVE: 'neutral',
};

const STATUS_LABEL: Record<Account['account_status'], string> = {
  GROWING: '↑ Growing',
  STABLE: 'Stable',
  NEW: '★ New',
  DECLINING: '↓ Declining',
  AT_RISK: '⚠ At Risk',
  CHURNED: 'Churned',
  INACTIVE: 'Inactive',
};

export default async function AccountsPage({ searchParams }: { searchParams: { status?: string } }) {
  const status = searchParams.status;
  const filter = status && status !== 'all' ? `WHERE account_status = '${status.toUpperCase()}'` : '';
  const accounts: Account[] = await query(`
    SELECT * FROM mv_store_health ${filter}
    ORDER BY
      CASE account_status
        WHEN 'AT_RISK' THEN 1
        WHEN 'DECLINING' THEN 2
        WHEN 'GROWING' THEN 3
        WHEN 'STABLE' THEN 4
        WHEN 'NEW' THEN 5
        WHEN 'CHURNED' THEN 6
        ELSE 7 END,
      orders_total DESC NULLS LAST
    LIMIT 200
  `);

  const totals = accounts.reduce(
    (acc, a) => {
      acc.gmv += a.orders_total || 0;
      acc[a.account_status] = (acc[a.account_status] || 0) + 1;
      return acc;
    },
    { gmv: 0 } as Record<string, number>
  );

  const atRiskOrders = accounts.filter((a) => a.account_status === 'AT_RISK').reduce((s, a) => s + (a.orders_total || 0), 0);
  const declineOrders = accounts.filter((a) => a.account_status === 'DECLINING').reduce((s, a) => s + (a.orders_total || 0), 0);
  const atRiskGMVPct = totals.gmv > 0 ? Math.round(100 * (atRiskOrders + declineOrders) / totals.gmv) : 0;

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Account Health · B2B Stores"
        subtitle="80 B2B stores route orders through the platform. Surface the at-risk + declining accounts that drive most revenue."
        actions={
          <InfoTip
            title="Account Health"
            shows="Every B2B store partner with their current account status. Status is auto-classified by recency + growth so leadership can spot churn-risk quickly."
            computed={
              <>
                Status logic (in order of precedence):<br/>
                <strong>CHURNED:</strong> last order &gt; 60d ago.<br/>
                <strong>AT_RISK:</strong> orders_l30d = 0 but orders_l30d_prior &gt; 0.<br/>
                <strong>DECLINING:</strong> orders_l30d &lt; 0.5× prior 30D.<br/>
                <strong>GROWING:</strong> orders_l30d &gt; 1.5× prior 30D.<br/>
                <strong>STABLE / NEW / INACTIVE</strong> for the rest.
              </>
            }
            drives="Top of the list = highest revenue at risk. AT_RISK with high total orders = call today. DECLINING = quarterly check-in. The 'At-risk GMV%' tile shows the % of platform orders tied to fragile accounts."
          />
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <KpiTile
          label="Growing"
          value={totals.GROWING ?? 0}
          tone="good"
          info={<InfoTip title="Growing" shows="Accounts where L30D orders are more than 1.5× their prior 30D — clear upward momentum." computed={<>Status assignment from <code className="font-mono text-[10px]">mv_store_health</code>: <code className="font-mono text-[10px]">orders_l30d &gt; 1.5 × orders_l30d_prior</code>.</>} drives="Replicate what's working — service line mix, geography, partner pairing. Surface these as case-study wins in QBRs." />}
        />
        <KpiTile
          label="Stable / New"
          value={(totals.STABLE ?? 0) + (totals.NEW ?? 0)}
          info={<InfoTip title="Stable + New" shows="Accounts holding steady (orders within ±50% of prior 30D) plus accounts onboarded recently and still ramping." computed={<>STABLE: L30D within 0.5–1.5× of prior 30D. NEW: first order in the last 30D and prior period was empty.</>} drives="Stable is the desired 'background' state. NEW deserves a 30-day check-in — first impression sets the relationship." />}
        />
        <KpiTile
          label="Declining"
          value={totals.DECLINING ?? 0}
          tone="warn"
          info={<InfoTip title="Declining" shows="Accounts where L30D orders fell below half of prior 30D. Not yet AT_RISK, but trending the wrong direction." computed={<><code className="font-mono text-[10px]">orders_l30d &lt; 0.5 × orders_l30d_prior</code> (and orders_l30d_prior &gt; 0).</>} drives="Quarterly check-in cadence. Look for cancel-rate spikes or TAT regressions as leading indicators." />}
        />
        <KpiTile
          label="At Risk"
          value={totals.AT_RISK ?? 0}
          tone="bad"
          info={<InfoTip title="At Risk" shows="Accounts that ordered in the prior 30D but went silent in the last 30D. They haven't churned yet but are one cycle from it." computed={<><code className="font-mono text-[10px]">orders_l30d = 0 AND orders_l30d_prior &gt; 0</code>.</>} drives="Call this week. The conversion from AT_RISK → CHURNED happens fast — typically within 30 days of going silent." />}
        />
        <KpiTile
          label="Churned"
          value={totals.CHURNED ?? 0}
          sub="60+ days no orders"
          info={<InfoTip title="Churned" shows="Accounts with no orders in the last 60 days. Treat as lost unless there's an active win-back motion." computed={<><code className="font-mono text-[10px]">last_order_at &lt; NOW() − 60 days</code>.</>} drives="Win-back campaigns: pick a subset with high historical GMV and reach out with refreshed terms. Most won't return without an inducement." />}
        />
        <KpiTile
          label="At-risk GMV%"
          value={`${atRiskGMVPct}%`}
          sub="of platform orders"
          tone={atRiskGMVPct >= 30 ? 'bad' : atRiskGMVPct >= 15 ? 'warn' : 'good'}
          info={<InfoTip title="At-risk GMV %" shows="Share of platform order volume sitting in fragile accounts (AT_RISK + DECLINING)." computed={<>(AT_RISK total orders + DECLINING total orders) ÷ all-accounts total orders × 100. Bad ≥30%, warn ≥15%.</>} drives="The single most important number on this page. ≥30% means a meaningful chunk of revenue is on shaky ground — call top names this week." />}
        />
      </div>

      <div className="flex items-center gap-1.5 mb-4">
        <ChipButton href="/accounts" active={!status || status === 'all'}>All</ChipButton>
        <ChipButton href="/accounts?status=at_risk" active={status === 'at_risk'}>⚠ At Risk</ChipButton>
        <ChipButton href="/accounts?status=declining" active={status === 'declining'}>↓ Declining</ChipButton>
        <ChipButton href="/accounts?status=growing" active={status === 'growing'}>↑ Growing</ChipButton>
        <ChipButton href="/accounts?status=stable" active={status === 'stable'}>Stable</ChipButton>
        <ChipButton href="/accounts?status=churned" active={status === 'churned'}>Churned</ChipButton>
      </div>

      <Card>
        <CardHeader
          title={`${accounts.length} accounts`}
          subtitle="Default sort: status urgency. Click any column to sort."
          icon={<Briefcase className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5 overflow-x-auto">
            <AccountsTable accounts={accounts} />
          </div>
        </CardBody>
      </Card>

      <div className="mt-4 text-xs text-ink-500 flex flex-wrap items-start gap-4">
        <span className="inline-flex items-start gap-1.5"><span className="w-2 h-2 rounded-full bg-success-500 mt-1.5" /><strong className="text-ink-700">Growing:</strong>&nbsp;L30D &gt;1.5× prior 30D.</span>
        <span className="inline-flex items-start gap-1.5"><span className="w-2 h-2 rounded-full bg-warn-500 mt-1.5" /><strong className="text-ink-700">Declining:</strong>&nbsp;L30D &lt;0.5× prior 30D.</span>
        <span className="inline-flex items-start gap-1.5"><span className="w-2 h-2 rounded-full bg-danger-500 mt-1.5" /><strong className="text-ink-700">At Risk:</strong>&nbsp;L30D=0 but had orders before. Time to call.</span>
      </div>
    </div>
  );
}
