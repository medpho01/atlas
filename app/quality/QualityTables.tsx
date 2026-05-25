'use client';

import Link from 'next/link';
import { SortableTable, SortableColumn } from '@/components/ui/SortableTable';
import { HealthBadge } from '@/components/HealthBadge';

type LabRow = any;
type ChainRow = any;

const labCols: SortableColumn<LabRow>[] = [
  { key: 'lab_name', label: 'Lab' },
  { key: 'chain_name', label: 'Chain' },
  { key: 'city', label: 'City' },
  { key: 'orders_total', label: 'Orders', align: 'right' },
  { key: 'cancel_pct', label: 'Cancel%', align: 'right', title: 'Cancellation rate (lower = better)' },
  { key: 'median_tat_hours', label: 'TAT (h)', align: 'right', title: 'Median order → report delivered hours' },
  { key: 'repeat_rate_pct', label: 'Repeat', align: 'right', title: 'Share of customers re-ordering' },
  { key: 'health_score', label: 'Health', align: 'right' },
];

export function LabsTable({ rows }: { rows: LabRow[] }) {
  return (
    <SortableTable
      rows={rows}
      columns={labCols}
      initialSortKey="orders_total"
      initialSortDir="desc"
      rowKey={(r) => r.lab_id}
    >
      {(r) => (
        <tr>
          <td className="font-medium text-ink-900">{r.lab_name}</td>
          <td className="text-ink-600">{r.chain_name ?? '—'}</td>
          <td className="text-ink-700">{r.city ?? '—'}</td>
          <td className="num">{r.orders_total}</td>
          <td className="num">
            <span className={r.cancel_pct >= 20 ? 'text-danger-500 font-semibold' : r.cancel_pct >= 10 ? 'text-warn-500' : 'text-ink-700'}>{r.cancel_pct ?? 0}%</span>
          </td>
          <td className="num">
            <span className={r.median_tat_hours >= 72 ? 'text-danger-500 font-semibold' : r.median_tat_hours >= 36 ? 'text-warn-500' : 'text-ink-700'}>
              {r.median_tat_hours != null ? Number(r.median_tat_hours).toFixed(1) : '—'}
            </span>
          </td>
          <td className="num">
            <span className={r.repeat_rate_pct >= 30 ? 'text-success-700 font-semibold' : r.repeat_rate_pct >= 15 ? 'text-success-700' : 'text-ink-500'}>
              {r.repeat_rate_pct != null ? `${r.repeat_rate_pct}%` : '—'}
            </span>
          </td>
          <td className="num"><HealthBadge score={r.health_score ?? 50} size="md" /></td>
        </tr>
      )}
    </SortableTable>
  );
}

const chainCols: SortableColumn<ChainRow>[] = [
  { key: 'chain_name', label: 'Chain' },
  { key: 'total_branches', label: 'Branches', align: 'right' },
  { key: 'distinct_cities', label: 'Cities', align: 'right' },
  { key: 'home_sample_pincodes_served', label: 'HS Pin', align: 'right' },
  { key: 'orders_total', label: 'Orders', align: 'right' },
  { key: 'orders_l30d', label: 'L30D', align: 'right' },
  { key: 'gmv_share', label: '% of GMV', align: 'right', sortValue: (r: any) => r._gmv_pct ?? 0 },
  { key: 'weighted_cancel_pct', label: 'Cancel%', align: 'right' },
  { key: 'weighted_avg_tat_hours', label: 'TAT (h)', align: 'right' },
  { key: 'chain_repeat_rate_pct', label: 'Repeat', align: 'right' },
  { key: 'weighted_health_score', label: 'Health', align: 'right' },
  { key: 'open', label: '', sortable: false },
];

export function ChainsTable({ rows, totalOrders }: { rows: ChainRow[]; totalOrders: number }) {
  const enriched = rows.map((r) => ({ ...r, _gmv_pct: totalOrders > 0 ? Math.round(100 * (r.orders_total || 0) / totalOrders) : 0 }));
  return (
    <SortableTable
      rows={enriched}
      columns={chainCols}
      initialSortKey="orders_total"
      initialSortDir="desc"
      rowKey={(r) => r.chain_id}
    >
      {(r: any) => (
        <tr>
          <td className="font-medium text-ink-900">{r.chain_name}</td>
          <td className="num">{r.total_branches}</td>
          <td className="num">{r.distinct_cities}</td>
          <td className="num text-ink-600">{r.home_sample_pincodes_served || 0}</td>
          <td className="num font-medium">{(r.orders_total || 0).toLocaleString()}</td>
          <td className="num">{r.orders_l30d || 0}</td>
          <td className="num">
            <div className="flex items-center justify-end gap-1.5">
              <div className="w-12 h-1.5 bg-ink-100 rounded-full overflow-hidden">
                <div className="h-full bg-brand-500 rounded-full" style={{ width: `${r._gmv_pct}%` }} />
              </div>
              <span className="tabular-nums text-[11px] text-ink-500 w-7 text-right">{r._gmv_pct}%</span>
            </div>
          </td>
          <td className="num">
            <span className={r.weighted_cancel_pct >= 20 ? 'text-danger-500 font-semibold' : r.weighted_cancel_pct >= 10 ? 'text-warn-500' : 'text-ink-700'}>
              {r.weighted_cancel_pct ? Number(r.weighted_cancel_pct).toFixed(1) : 0}%
            </span>
          </td>
          <td className="num">{r.weighted_avg_tat_hours != null ? Number(r.weighted_avg_tat_hours).toFixed(1) : '—'}</td>
          <td className="num">{r.chain_repeat_rate_pct != null ? `${r.chain_repeat_rate_pct}%` : '—'}</td>
          <td className="num">{r.weighted_health_score != null ? <HealthBadge score={r.weighted_health_score} size="md" /> : '—'}</td>
          <td className="text-right">
            <Link href={`/chain/${r.chain_id}`} className="row-link inline-flex items-center text-[11px]">Open →</Link>
          </td>
        </tr>
      )}
    </SortableTable>
  );
}
