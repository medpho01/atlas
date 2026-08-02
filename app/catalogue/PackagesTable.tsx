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
  tests_priced: number;
  alacarte_low: string | null;
  cost_low: string | null;
  headroom_pct: number | null;
  labs_offering: number;
  lab_quote_low: string | null;
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
  { key: 'test_count', label: 'Tests', align: 'right' },
  { key: 'alacarte_low', label: 'À-la-carte value', align: 'right', sortValue: (p) => num(p.alacarte_low) },
  { key: 'cost_low', label: 'Lab cost', align: 'right', sortValue: (p) => num(p.cost_low) ?? num(p.lab_quote_low) },
  { key: 'headroom_pct', label: 'Headroom', align: 'right', sortValue: (p) => p.headroom_pct },
  { key: 'labs_offering', label: 'Labs', align: 'right' },
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
      initialSortKey="alacarte_low"
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
            {/* The one-line read on who it's for, when the catalogue has been classified. */}
            {p.intent && <div className="text-[11px] text-ink-500 font-normal mt-0.5">{p.intent}</div>}
          </td>
          <td className="num text-ink-700">
            {p.test_count || <span className="text-ink-300">—</span>}
            {/* Flag partial pricing rather than silently understating the value. */}
            {p.test_count > 0 && p.tests_priced < p.test_count && (
              <span className="ml-1 text-[10px] text-warn-500" title={`${p.test_count - p.tests_priced} unpriced`}>
                *
              </span>
            )}
          </td>
          <td className="num font-medium">{inr(p.alacarte_low)}</td>
          <td className="num text-ink-600">
            {p.cost_low != null ? (
              inr(p.cost_low)
            ) : p.lab_quote_low != null ? (
              // Priced as a unit by the lab rather than summed from tests —
              // marked so it isn't read as the same kind of number.
              <span title="Lab's quoted price for the package as a unit — this package has no test-level composition to price from">
                {inr(p.lab_quote_low)}<span className="text-ink-400">†</span>
              </span>
            ) : (
              <span className="text-ink-300">—</span>
            )}
          </td>
          <td className="num">
            {p.headroom_pct == null ? (
              <span className="text-ink-300">—</span>
            ) : (
              <span
                className={
                  p.headroom_pct >= 60
                    ? 'text-success-700 font-semibold'
                    : p.headroom_pct >= 35
                      ? 'text-success-700'
                      : 'text-warn-500'
                }
              >
                {p.headroom_pct}%
              </span>
            )}
          </td>
          <td className="num text-ink-600">{p.labs_offering || <span className="text-ink-300">—</span>}</td>
          <td className="text-xs text-ink-500">
            {(p.order_types ?? []).map((m) => MODALITY_SHORT[m] ?? m).join(' · ') || '—'}
          </td>
        </tr>
      )}
    </SortableTable>
  );
}
