'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { SortableTable, SortableColumn } from '@/components/ui/SortableTable';
import { SERVICE_LINE_LABEL, SERVICE_LINE_TONE, TONE_COLORS, type ServiceLine } from '@/lib/serviceLines';

type Row = any;

const cols: SortableColumn<Row>[] = [
  { key: 'pincode', label: 'Pincode' },
  { key: 'city', label: 'City' },
  { key: 'service_line', label: 'Service Line', sortValue: (r) => SERVICE_LINE_LABEL[r.service_line as ServiceLine] ?? '' },
  { key: 'events_l30d', label: 'L30D events', align: 'right' },
  { key: 'events_l30d_prior', label: 'Prior 30D', align: 'right' },
  { key: 'growth_pct', label: 'Growth', align: 'right' },
  { key: 'supply_count', label: 'Supply', align: 'right' },
  { key: 'imbalance_score', label: 'Imbalance', align: 'right' },
  { key: 'open', label: '', sortable: false, align: 'right' },
];

export function ImbalanceTable({ rows }: { rows: Row[] }) {
  return (
    <SortableTable
      rows={rows}
      columns={cols}
      initialSortKey="imbalance_score"
      initialSortDir="desc"
      rowKey={(r) => `${r.pincode}-${r.service_line}`}
    >
      {(r: any) => {
        const sl = r.service_line as ServiceLine;
        const tone = SERVICE_LINE_TONE[sl];
        const colors = TONE_COLORS[tone];
        const isNew = r.events_l30d_prior === 0 && r.events_l30d > 0;
        const growthBucket =
          isNew ? 'new' :
          r.growth_pct >= 100 ? 'hot' :
          r.growth_pct >= 50 ? 'good' :
          r.growth_pct >= 0 ? 'neutral' :
          'declining';
        return (
          <tr>
            <td className="font-mono font-semibold text-ink-900">{r.pincode}</td>
            <td className="text-ink-700">{r.city ?? '—'}</td>
            <td>
              <span className="inline-flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                <span className="text-[12px] font-medium text-ink-900">{SERVICE_LINE_LABEL[sl]}</span>
              </span>
            </td>
            <td className="num font-semibold">{r.events_l30d}</td>
            <td className="num text-ink-500">{r.events_l30d_prior}</td>
            <td className="num">
              {isNew ? (
                <span className="text-success-700 font-semibold">new ●</span>
              ) : (
                <span className={
                  growthBucket === 'hot' ? 'text-success-700 font-bold' :
                  growthBucket === 'good' ? 'text-success-700 font-medium' :
                  growthBucket === 'declining' ? 'text-danger-500 font-medium' :
                  'text-ink-600'
                }>
                  {r.growth_pct > 0 ? '+' : ''}{r.growth_pct}%
                </span>
              )}
            </td>
            <td className="num">
              <span className={r.supply_count === 0 ? 'text-danger-500 font-bold' : r.supply_count < 3 ? 'text-warn-500 font-medium' : 'text-ink-600'}>
                {r.supply_count}
              </span>
            </td>
            <td className="num">
              <span className={`tabular-nums font-bold ${r.imbalance_score >= 60 ? 'text-danger-500' : r.imbalance_score >= 30 ? 'text-warn-500' : 'text-ink-600'}`}>
                {r.imbalance_score}
              </span>
            </td>
            <td className="text-right">
              <Link href={`/pincode/${r.pincode}`} className="row-link inline-flex items-center gap-0.5 text-[11px]">
                Open <ExternalLink className="w-3 h-3" />
              </Link>
            </td>
          </tr>
        );
      }}
    </SortableTable>
  );
}
