'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { SortableTable, SortableColumn } from '@/components/ui/SortableTable';
import { KIND_SHORT, MODALITY_LABEL } from '@/lib/coverage';

type Row = any;

const cols: SortableColumn<Row>[] = [
  { key: 'pincode', label: 'Pincode' },
  { key: 'city', label: 'City' },
  { key: 'kind', label: 'Need', sortValue: (r) => `${r.kind}|${r.modality}` },
  { key: 'providers', label: 'Providers', align: 'right' },
  { key: 'events_l30d', label: 'L30D demand', align: 'right' },
  { key: 'trend_pct', label: 'Trend', align: 'right' },
  { key: 'projected_30d', label: '30D forecast', align: 'right' },
  { key: 'gap_score', label: 'Gap', align: 'right' },
  {
    key: 'urgency_days',
    label: 'Urgency',
    sortValue: (r) => (r.urgency_days === null || r.urgency_days === undefined ? 999 : r.urgency_days),
  },
  { key: 'open', label: '', sortable: false, align: 'right' },
];

export function GapsTable({ rows }: { rows: Row[] }) {
  return (
    <SortableTable
      rows={rows}
      columns={cols}
      initialSortKey="gap_score"
      initialSortDir="desc"
      rowKey={(r) => `${r.pincode}-${r.kind}-${r.modality}`}
    >
      {(g) => (
        <tr>
          <td className="font-mono font-semibold text-ink-900">{g.pincode}</td>
          <td className="text-ink-700">{g.city ?? '—'}</td>
          <td>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-ink-900 font-semibold text-[13px]">+{KIND_SHORT[g.kind as keyof typeof KIND_SHORT]}</span>
              <span className="text-ink-300 text-xs">·</span>
              <span className="text-ink-600 text-[12px]">{MODALITY_LABEL[g.modality as keyof typeof MODALITY_LABEL]}</span>
            </span>
          </td>
          <td className="num">
            <span className={g.providers === 0 ? 'text-danger-500 font-bold' : g.providers < 3 ? 'text-warn-600 font-semibold' : 'text-ink-600'}>
              {g.providers}
            </span>
          </td>
          <td className="num">{g.events_l30d ?? 0}</td>
          <td className="num">
            {g.trend_pct !== null && g.trend_pct !== undefined ? (
              <span className={
                g.trend_pct >= 50 ? 'text-success-700 font-semibold' :
                g.trend_pct >= 15 ? 'text-success-700' :
                g.trend_pct <= -25 ? 'text-danger-500 font-semibold' :
                g.trend_pct <= -10 ? 'text-warn-500' : 'text-ink-500'
              }>
                {g.trend_pct > 0 ? '+' : ''}{g.trend_pct}%
              </span>
            ) : <span className="text-ink-300">—</span>}
          </td>
          <td className="num font-medium">{g.projected_30d}</td>
          <td className="num">
            <span className={`font-bold ${g.gap_score >= 50 ? 'text-danger-500' : g.gap_score >= 20 ? 'text-warn-600' : 'text-ink-500'}`}>
              {g.gap_score}
            </span>
          </td>
          <td>
            {g.urgency_days === 0 ? <span className="text-[11px] font-bold text-danger-500">▲ act now</span> :
             g.urgency_days === 7 ? <span className="text-[11px] font-semibold text-warn-500">this week</span> :
             g.urgency_days === 21 ? <span className="text-[11px] text-ink-600">this sprint</span> :
             <span className="text-[11px] text-ink-400">later</span>}
          </td>
          <td className="text-right">
            <Link href={`/pincode/${g.pincode}`} className="row-link inline-flex items-center gap-0.5 text-[11px]">
              Open <ExternalLink className="w-3 h-3" />
            </Link>
          </td>
        </tr>
      )}
    </SortableTable>
  );
}
