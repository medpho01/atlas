'use client';

import Link from 'next/link';
import { Pill } from '@/components/ui/Toggle';
import { SortableTable, SortableColumn } from '@/components/ui/SortableTable';

type PackageRow = {
  package_id: number;
  package_name: string;
  is_custom: boolean;
  order_types: string[] | null;
  test_count: number;
  department_count: number;
  tat_hours: number | null;
  pkg_cost: string | null;
  best_lab_name: string | null;
  labs_quoting: number;
  orders: number;
  orders_l90d: number;
  categories: string[] | null;
  intent: string | null;
};

const MODALITY_SHORT: Record<string, string> = {
  HOME_SAMPLE: 'Home',
  CENTER_VISIT: 'Center',
  CAMP: 'Camp',
  KIT_BASED: 'Kit',
};

const num = (v: string | null) => (v == null ? null : Number(v));
const inr = (v: string | null) =>
  v == null ? '—' : `₹${Math.round(Number(v)).toLocaleString('en-IN')}`;

const columns: SortableColumn<PackageRow>[] = [
  { key: 'package_name', label: 'Package' },
  { key: 'orders', label: 'Orders', align: 'right' },
  { key: 'test_count', label: 'Tests', align: 'right' },
  { key: 'tat_hours', label: 'Report in', align: 'right', sortValue: (p) => p.tat_hours },
  { key: 'pkg_cost', label: 'Price', align: 'right', sortValue: (p) => num(p.pkg_cost) },
  { key: 'best_lab_name', label: 'From' },
  { key: 'order_types', label: 'Modality', sortValue: (p) => (p.order_types ?? []).join(',') },
];

export function PackagesTable({ packages }: { packages: PackageRow[] }) {
  if (!packages.length) {
    return (
      <p className="px-5 py-8 text-sm text-ink-500">
        No packages match these filters. Widen the value band, or clear the search.
      </p>
    );
  }

  return (
    <SortableTable<PackageRow>
      rows={packages}
      columns={columns}
      initialSortKey="orders"
      initialSortDir="desc"
      rowKey={(p) => p.package_id}
    >
      {(p) => (
        <tr>
          <td className="font-medium text-ink-900 max-w-md">
            <Link
              href={`/catalogue/${p.package_id}`}
              className="hover:text-brand-700 dark:hover:text-brand-400 hover:underline"
            >
              {p.package_name}
            </Link>
            {p.is_custom && <span className="ml-2 text-[10px] text-ink-400">custom</span>}
            {p.intent && <div className="text-[11px] text-ink-500 font-normal mt-0.5">{p.intent}</div>}
          </td>
          <td className="num">
            {p.orders > 0 ? (
              <>
                <span className="font-medium text-success-700">{p.orders.toLocaleString('en-IN')}</span>
                {/* Recent activity separates a package selling now from one that
                    sold well once and stopped. */}
                {p.orders_l90d > 0 && (
                  <span className="text-[10px] text-ink-400 ml-1">{p.orders_l90d} in 90d</span>
                )}
              </>
            ) : (
              // Never booked is a fact worth stating, not a blank.
              <span className="text-ink-300" title="This package has never been booked">not yet</span>
            )}
          </td>
          <td className="num text-ink-700">
            {p.test_count || <span className="text-ink-300">—</span>}
            {p.department_count > 1 && (
              <span className="text-[10px] text-ink-400 ml-1">/{p.department_count} depts</span>
            )}
          </td>
          <td className="num text-ink-600">
            {p.tat_hours ? `${p.tat_hours}h` : <span className="text-ink-300">—</span>}
          </td>
          <td className="num font-medium">{inr(p.pkg_cost)}</td>
          <td className="text-xs text-ink-600 max-w-[11rem] truncate">
            {p.best_lab_name ?? <span className="text-ink-300">no quote</span>}
            {p.labs_quoting > 1 && <span className="text-ink-400"> +{p.labs_quoting - 1}</span>}
          </td>
          <td className="text-xs text-ink-500">
            {(p.order_types ?? []).map((m) => MODALITY_SHORT[m] ?? m).join(' · ') || '—'}
          </td>
        </tr>
      )}
    </SortableTable>
  );
}
