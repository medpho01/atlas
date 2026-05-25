'use client';

import Link from 'next/link';
import { SortableTable, SortableColumn } from '@/components/ui/SortableTable';
import { Pill } from '@/components/ui/Toggle';
import { HealthBadge } from '@/components/HealthBadge';

type Row = any;

function labelForCenterType(t?: string) {
  if (t === 'DIAGNOSTIC_CENTER') return 'Diagnostic';
  if (t === 'COLLECTION_CENTER') return 'Collection';
  if (t === 'HOSPITAL') return 'Hospital';
  return '—';
}

const cols: SortableColumn<Row>[] = [
  { key: 'lab_name', label: 'Branch' },
  { key: 'center_type', label: 'Type', sortValue: (r) => labelForCenterType(r.center_type) },
  { key: 'city', label: 'City' },
  { key: 'pincode', label: 'Pincode' },
  { key: 'orders_total', label: 'Orders', align: 'right' },
  { key: 'orders_l30d', label: 'L30D', align: 'right' },
  { key: 'cancel_pct', label: 'Cancel%', align: 'right' },
  { key: 'avg_tat_hours', label: 'TAT (h)', align: 'right' },
  { key: 'repeat_rate_pct', label: 'Repeat', align: 'right' },
  { key: 'health_score', label: 'Health' },
  { key: 'active', label: 'Status', sortValue: (r) => (r.active ? 1 : 0) },
];

export function BranchesTable({ rows }: { rows: Row[] }) {
  return (
    <SortableTable rows={rows} columns={cols} initialSortKey="orders_total" initialSortDir="desc" rowKey={(r) => r.lab_id}>
      {(b) => (
        <tr>
          <td className="font-medium text-ink-900">{b.lab_name}</td>
          <td className="text-ink-600 text-xs">{labelForCenterType(b.center_type)}</td>
          <td className="text-ink-700">{b.city ?? '—'}</td>
          <td className="font-mono text-ink-700">{b.pincode ? <Link href={`/pincode/${b.pincode}`} className="hover:text-brand-500">{b.pincode}</Link> : '—'}</td>
          <td className="num">{b.orders_total}</td>
          <td className="num">{b.orders_l30d}</td>
          <td className="num">{b.cancel_pct ?? 0}%</td>
          <td className="num">{b.avg_tat_hours != null ? Number(b.avg_tat_hours).toFixed(1) : '—'}</td>
          <td className="num">{b.repeat_rate_pct != null ? `${b.repeat_rate_pct}%` : '—'}</td>
          <td>{b.health_score != null && b.orders_total > 0 ? <HealthBadge score={b.health_score} /> : <span className="text-[11px] text-ink-400">no data</span>}</td>
          <td>{b.active ? <Pill tone="good">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}</td>
        </tr>
      )}
    </SortableTable>
  );
}
