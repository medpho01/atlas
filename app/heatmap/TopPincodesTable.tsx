'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { SortableTable, SortableColumn } from '@/components/ui/SortableTable';

type Row = any;

const cols: SortableColumn<Row>[] = [
  { key: 'pincode', label: 'Pincode' },
  { key: 'orders_all_time', label: 'Orders', align: 'right' },
  { key: 'orders_l30d', label: 'L30D', align: 'right' },
  { key: 'home_sample', label: 'Home Sample', align: 'right' },
  { key: 'camp', label: 'Camp', align: 'right' },
  { key: 'center_visit', label: 'Center', align: 'right' },
  { key: 'providers_total', label: 'Providers', align: 'right' },
  { key: 'labs_local', label: 'Labs', align: 'right' },
  { key: 'gap_score', label: 'Gap', align: 'right' },
  { key: 'open', label: '', sortable: false, align: 'right' },
];

export function TopPincodesTable({ rows }: { rows: Row[] }) {
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
          <td className="num font-medium">{r.orders_all_time.toLocaleString()}</td>
          <td className="num">{r.orders_l30d.toLocaleString()}</td>
          <td className="num text-ink-600">{r.home_sample.toLocaleString()}</td>
          <td className="num text-ink-600">{r.camp.toLocaleString()}</td>
          <td className="num text-ink-600">{r.center_visit.toLocaleString()}</td>
          <td className="num">{r.providers_total}</td>
          <td className="num">{r.labs_local}</td>
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
