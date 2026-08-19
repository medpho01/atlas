'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { SortableTable, SortableColumn } from '@/components/ui/SortableTable';
import type { CityMapPoint } from '@/lib/queries';

const cols: SortableColumn<CityMapPoint>[] = [
  { key: 'city', label: 'City' },
  { key: 'pincodes', label: 'Pincodes', align: 'right' },
  { key: 'orders_all_time', label: 'Orders', align: 'right' },
  { key: 'orders_l30d', label: 'L30D', align: 'right' },
  { key: 'providers_total', label: 'Providers', align: 'right' },
  { key: 'labs_local', label: 'Labs', align: 'right' },
  { key: 'network_strength', label: 'Strength', align: 'right' },
  { key: 'gap_pincodes', label: 'Unserved pincodes', align: 'right' },
  { key: 'open', label: '', sortable: false, align: 'right' },
];

/**
 * Cities, not pincodes.
 *
 * Strength is averaged across the city's pincodes rather than summed: a city
 * with one strong pincode and forty empty ones is not strong, and a sum would
 * say it was.
 *
 * "Unserved" counts pincodes with orders but no local provider — the demand we
 * are already fulfilling from somewhere else, and the most direct read of where
 * a city needs supply.
 */
export function TopCitiesTable({ rows }: { rows: CityMapPoint[] }) {
  return (
    <SortableTable
      rows={rows}
      columns={cols}
      initialSortKey="orders_all_time"
      initialSortDir="desc"
      rowKey={(r) => r.city_key}
    >
      {(r) => (
        <tr className="border-b border-ink-100 last:border-0">
          <td className="px-5 py-2 font-medium text-ink-900">{r.city}</td>
          <td className="px-2 py-2 num text-ink-600">{r.pincodes.toLocaleString('en-IN')}</td>
          <td className="px-2 py-2 num font-medium">{r.orders_all_time.toLocaleString('en-IN')}</td>
          <td className="px-2 py-2 num text-ink-600">{r.orders_l30d.toLocaleString('en-IN')}</td>
          <td className="px-2 py-2 num text-ink-700">{r.providers_total.toLocaleString('en-IN')}</td>
          <td className="px-2 py-2 num text-ink-700">{r.labs_local.toLocaleString('en-IN')}</td>
          <td className="px-2 py-2 num text-ink-600">{r.network_strength}</td>
          <td className="px-2 py-2 num">
            <span className={
              r.gap_pincodes >= r.pincodes * 0.5 ? 'text-danger-500 font-medium'
              : r.gap_pincodes > 0 ? 'text-warn-600' : 'text-success-600'
            }>
              {r.gap_pincodes}
            </span>
            <span className="text-[10px] text-ink-400">/{r.pincodes}</span>
          </td>
          <td className="px-5 py-2 text-right">
            <Link
              href={`/readiness?category=DIAGNOSTICS`}
              className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
            >
              Readiness <ExternalLink className="w-3 h-3" />
            </Link>
          </td>
        </tr>
      )}
    </SortableTable>
  );
}
