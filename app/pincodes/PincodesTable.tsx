'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { SortableTable, SortableColumn } from '@/components/ui/SortableTable';
import { CoverageBadge } from '@/components/HealthBadge';

type Row = any;

const cols: SortableColumn<Row>[] = [
  { key: 'pincode', label: 'Pincode' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'coverage_bucket', label: 'Coverage', sortValue: (r) => ({ '5_plus': 5, '3_to_4': 3, '2': 2, '1': 1, '0': 0 } as any)[r.coverage_bucket] ?? -1 },
  { key: 'labs_local', label: 'Labs', align: 'right' },
  { key: 'providers_total', label: 'Providers', align: 'right' },
  { key: 'pharmacies', label: 'Pharmacy', align: 'right' },
  { key: 'orders_all_time', label: 'Orders', align: 'right' },
  { key: 'orders_l90d', label: 'L90D', align: 'right' },
  { key: 'gap_score', label: 'Gap', align: 'right' },
  { key: 'open', label: '', sortable: false, align: 'right' },
];

export function PincodesTable({ rows }: { rows: Row[] }) {
  return (
    <SortableTable
      rows={rows}
      columns={cols}
      initialSortKey="orders_all_time"
      initialSortDir="desc"
      rowKey={(r) => r.pincode}
    >
      {(r) => (
        <tr>
          <td className="font-mono font-semibold text-ink-900">{r.pincode}</td>
          <td className="text-ink-800">{r.city ?? <span className="text-ink-400">—</span>}</td>
          <td className="text-ink-500 text-[12px]">{r.state ?? <span className="text-ink-400">—</span>}</td>
          <td><CoverageBadge bucket={r.coverage_bucket} /></td>
          <td className="num">{r.labs_local}</td>
          <td className="num">{r.providers_total}</td>
          <td className="num">{r.pharmacies}</td>
          <td className="num font-medium">{r.orders_all_time.toLocaleString()}</td>
          <td className="num">{r.orders_l90d.toLocaleString()}</td>
          <td className="num">
            <span className={r.gap_score >= 50 ? 'text-danger-500 font-bold' : r.gap_score >= 20 ? 'text-warn-600 font-semibold' : 'text-ink-500'}>{r.gap_score}</span>
          </td>
          <td className="text-right">
            <Link className="row-link inline-flex items-center gap-0.5 text-[11px]" href={`/pincode/${r.pincode}`}>
              Open <ExternalLink className="w-3 h-3" />
            </Link>
          </td>
        </tr>
      )}
    </SortableTable>
  );
}
