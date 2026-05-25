'use client';

import { Pill } from '@/components/ui/Toggle';
import { SortableTable, SortableColumn } from '@/components/ui/SortableTable';

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

const STATUS_TONE = {
  GROWING: 'good',
  STABLE: 'info',
  NEW: 'info',
  DECLINING: 'warn',
  AT_RISK: 'bad',
  CHURNED: 'bad',
  INACTIVE: 'neutral',
} as const;

const STATUS_LABEL = {
  GROWING: '↑ Growing',
  STABLE: 'Stable',
  NEW: '★ New',
  DECLINING: '↓ Declining',
  AT_RISK: '⚠ At Risk',
  CHURNED: 'Churned',
  INACTIVE: 'Inactive',
};

const STATUS_RANK = {
  AT_RISK: 1,
  DECLINING: 2,
  GROWING: 3,
  STABLE: 4,
  NEW: 5,
  CHURNED: 6,
  INACTIVE: 7,
};

const columns: SortableColumn<Account>[] = [
  { key: 'store_name', label: 'Store' },
  { key: 'city', label: 'City' },
  { key: 'orders_total', label: 'Total orders', align: 'right' },
  { key: 'orders_l30d', label: 'L30D', align: 'right' },
  { key: 'orders_l30d_prior', label: 'Prior 30D', align: 'right' },
  {
    key: 'wow_growth_pct',
    label: 'Growth',
    align: 'right',
    sortValue: (a) => (a.wow_growth_pct === null || a.wow_growth_pct === undefined ? null : a.wow_growth_pct),
  },
  { key: 'distinct_pincodes_served', label: 'Pincodes', align: 'right' },
  { key: 'distinct_labs_used', label: 'Labs used', align: 'right' },
  {
    key: 'last_order_at',
    label: 'Last order',
    sortValue: (a) => (a.last_order_at ? new Date(a.last_order_at).getTime() : 0),
  },
  {
    key: 'account_status',
    label: 'Status',
    sortValue: (a) => STATUS_RANK[a.account_status] ?? 99,
  },
];

export function AccountsTable({ accounts }: { accounts: Account[] }) {
  return (
    <SortableTable<Account>
      rows={accounts}
      columns={columns}
      initialSortKey="account_status"
      initialSortDir="asc"
      rowKey={(a) => a.store_id}
    >
      {(a) => {
        const last = a.last_order_at ? new Date(a.last_order_at) : null;
        const daysSince = last ? Math.floor((Date.now() - last.getTime()) / 86400000) : null;
        return (
          <tr>
            <td className="font-medium text-ink-900">
              {a.store_name}
              {!a.active && <span className="ml-2 text-[10px] text-ink-400">(inactive)</span>}
            </td>
            <td className="text-ink-700">{a.city ?? '—'}</td>
            <td className="num font-medium">{(a.orders_total || 0).toLocaleString()}</td>
            <td className="num">{a.orders_l30d || 0}</td>
            <td className="num text-ink-500">{a.orders_l30d_prior || 0}</td>
            <td className="num">
              {a.wow_growth_pct === null || a.wow_growth_pct === undefined ? (
                <span className="text-ink-300">—</span>
              ) : (
                <span
                  className={
                    a.wow_growth_pct >= 50
                      ? 'text-success-700 font-semibold'
                      : a.wow_growth_pct >= 0
                        ? 'text-success-700'
                        : a.wow_growth_pct <= -50
                          ? 'text-danger-500 font-semibold'
                          : 'text-warn-500'
                  }
                >
                  {a.wow_growth_pct > 0 ? '+' : ''}{a.wow_growth_pct}%
                </span>
              )}
            </td>
            <td className="num text-ink-600">{a.distinct_pincodes_served || 0}</td>
            <td className="num text-ink-600">{a.distinct_labs_used || 0}</td>
            <td className="text-xs text-ink-500">
              {daysSince === null
                ? '—'
                : daysSince === 0
                  ? 'today'
                  : daysSince < 30
                    ? `${daysSince}d ago`
                    : daysSince < 365
                      ? `${Math.floor(daysSince / 30)}mo ago`
                      : `${Math.floor(daysSince / 365)}y ago`}
            </td>
            <td>
              <Pill tone={STATUS_TONE[a.account_status]}>{STATUS_LABEL[a.account_status]}</Pill>
            </td>
          </tr>
        );
      }}
    </SortableTable>
  );
}
