'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Download } from 'lucide-react';
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
  lab_offers: { lab: string; b2b: number }[] | null;
  orders: number;
  orders_l90d: number;
  sample_types: string[] | null;
  tests_without_sample: number;
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
  { key: '_pick', label: '', sortable: false, className: 'w-8' },
  { key: 'package_name', label: 'Package' },
  { key: 'orders', label: 'Orders', align: 'right' },
  { key: 'test_count', label: 'Tests', align: 'right' },
  { key: 'sample_types', label: 'Sample', sortValue: (p) => (p.sample_types ?? []).join(',') },
  { key: 'tat_hours', label: 'Report in', align: 'right', sortValue: (p) => p.tat_hours },
  { key: 'pkg_cost', label: 'Labs & price', sortValue: (p) => num(p.pkg_cost) },
  { key: 'order_types', label: 'Modality', sortValue: (p) => (p.order_types ?? []).join(',') },
];

export function PackagesTable({ packages }: { packages: PackageRow[] }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const allShown = packages.length > 0 && packages.every((p) => picked.has(p.package_id));

  /**
   * "Packages" is one column per package: the name in row 1, its tests listed
   * down the column. Columns are ragged — a 30-test package and a 3-test one
   * sit side by side and the short one just stops — which is what makes it
   * readable as a comparison.
   *
   * "Summary" keeps the per-package facts (orders, categories) that don't fit
   * a shape whose only axis is tests.
   *
   * "Lab pricing" is one row per package per lab. A package price is only
   * meaningful next to the lab quoting it — the same package is ₹900 at one
   * lab and ₹2,000 at another — and some are quoted by over a thousand labs,
   * which is exactly why this belongs in a file rather than on screen.
   */
  const download = async (ids: number[]) => {
    setDownloading(true); setErr(null);
    try {
      const res = await fetch('/api/catalogue/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packageIds: ids }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Export failed');
      const { rows, labs } = await res.json();

      const XLSX = await import('xlsx');
      const money = (v: string | null) => (v == null ? '' : Math.round(Number(v)));

      const seen = new Set<number>();
      const summary = rows.filter((r: Record<string, unknown>) => {
        const id = r.package_id as number;
        if (seen.has(id)) return false;
        seen.add(id); return true;
      }).map((r: Record<string, any>) => ({
        'Package': r.package_name,
        'Custom': r.is_custom ? 'Yes' : 'No',
        'Tests': rows.filter((x: Record<string, unknown>) => x.package_id === r.package_id && x.test_name).length,
        'Who it is for': r.intent ?? '',
        'Categories': (r.categories ?? []).map((c: string) => c.replace(/_/g, ' ').toLowerCase()).join(', '),
        'Modality': r.modality ?? '',
        'Sample': r.sample_types ?? '',
        'Report in (hrs)': r.tat_hours ?? '',
        'Cheapest price': money(r.pkg_cost),
        'Cheapest lab': r.best_lab_name ?? '',
        'Labs quoting': (labs ?? []).filter((x: Record<string, unknown>) => x.package_id === r.package_id).length,
        'Orders': r.orders ?? 0,
      }));

      // One column per package, tests down the column, in the order picked.
      const columns: { name: string; tests: string[] }[] = [];
      const byId = new Map<number, number>();
      for (const r of rows as Record<string, any>[]) {
        let at = byId.get(r.package_id);
        if (at === undefined) {
          at = columns.push({ name: r.package_name, tests: [] }) - 1;
          byId.set(r.package_id, at);
        }
        if (r.test_name) columns[at].tests.push(r.test_name);
      }
      const deepest = columns.reduce((n, c) => Math.max(n, c.tests.length), 0);
      const grid = [
        columns.map((c) => c.name),
        ...Array.from({ length: deepest }, (_, i) => columns.map((c) => c.tests[i] ?? '')),
      ];

      const wb = XLSX.utils.book_new();
      const s1 = XLSX.utils.aoa_to_sheet(grid);
      s1['!cols'] = columns.map(() => ({ wch: 42 }));
      XLSX.utils.book_append_sheet(wb, s1, 'Packages');

      const s2 = XLSX.utils.json_to_sheet(summary);
      s2['!cols'] = [{ wch: 34 }, { wch: 8 }, { wch: 7 }, { wch: 46 }, { wch: 28 }, { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 13 }, { wch: 26 }, { wch: 12 }, { wch: 9 }];
      XLSX.utils.book_append_sheet(wb, s2, 'Summary');

      const pricing = (labs ?? []).map((x: Record<string, any>) => ({
        'Package': x.package_name,
        'Lab': x.lab_name,
        'City': x.lab_city ?? '',
        'State': x.lab_state ?? '',
        'Pincode': x.lab_pincode ?? '',
        'City tier': x.city_tier ?? 'not classified',
        // MRP omitted: populated on 15 of 4,870 lab-package rows at source,
        // so a column of blanks that looks like missing data rather than
        // absent data.
        'Price': money(x.b2b),
      }));
      const s3 = XLSX.utils.json_to_sheet(
        pricing.length ? pricing : [{ Package: 'No lab has a quote above ₹10 for the selected packages' }],
      );
      s3['!cols'] = [{ wch: 34 }, { wch: 34 }, { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, s3, 'Lab pricing');

      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `labstack-packages-${stamp}.xlsx`);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setDownloading(false); }
  };

  if (!packages.length) {
    return (
      <p className="px-5 py-8 text-sm text-ink-500">
        No packages match these filters. Widen the value band, or clear the search.
      </p>
    );
  }

  const targets = picked.size ? [...picked] : packages.map((p) => p.package_id);

  return (
    <>
    {/* Always present. The sticky bar below only appears once something is
        picked, which left no way to say "all of them" without picking one
        first — so downloading a whole filtered set meant a pointless click. */}
    <div className="mx-5 mb-3 flex flex-wrap items-center gap-3 border-b border-ink-100 pb-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={allShown}
          onChange={() => setPicked(allShown ? new Set() : new Set(packages.map((p) => p.package_id)))}
          className="sr-only"
        />
        <span className={`inline-flex w-3.5 h-3.5 items-center justify-center rounded border transition ${
          allShown ? 'bg-brand-600 border-brand-600' : 'border-ink-300 bg-surface'
        }`}>
          {allShown && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />}
        </span>
        <span className="text-xs text-ink-600">
          {allShown ? 'Deselect all' : `Select all ${packages.length}`}
        </span>
      </label>

      <button
        onClick={() => download(targets)}
        disabled={downloading}
        className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition"
      >
        <Download className="w-3.5 h-3.5" />
        {downloading
          ? 'Building…'
          : picked.size
            ? `Download ${picked.size} selected`
            : `Download all ${packages.length}`}
      </button>

      {picked.size > 0 && (
        <button onClick={() => setPicked(new Set())} className="text-xs text-ink-500 hover:text-ink-900">
          Clear
        </button>
      )}
      {err && <span className="text-xs text-danger-500">{err}</span>}
    </div>

    {picked.size > 0 && (
      <div className="sticky bottom-3 z-30 mx-5 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/40 bg-surface shadow-lg px-3 py-2">
        <span className="text-[13px] font-semibold text-ink-900">{picked.size} selected</span>
        <button
          onClick={() => download([...picked])}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 px-3 h-8 text-xs font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition"
        >
          <Download className="w-3.5 h-3.5" />
          {downloading ? 'Building…' : `Download ${picked.size} package${picked.size === 1 ? '' : 's'}`}
        </button>
        <button
          onClick={() => setPicked(allShown ? new Set() : new Set(packages.map((p) => p.package_id)))}
          className="text-xs text-ink-600 hover:text-ink-900"
        >
          {allShown ? 'Deselect all' : `Select all ${packages.length} shown`}
        </button>
        {err && <span className="text-xs text-danger-500">{err}</span>}
        <button onClick={() => setPicked(new Set())} className="ml-auto text-xs text-ink-500 hover:text-ink-900">Clear</button>
      </div>
    )}
    <SortableTable<PackageRow>
      rows={packages}
      columns={columns}
      initialSortKey="orders"
      initialSortDir="desc"
      rowKey={(p) => p.package_id}
    >
      {(p) => (
        <tr className={picked.has(p.package_id) ? 'bg-brand-500/5' : ''}>
          <td className="pl-5 pr-0">
            <label className="flex items-center cursor-pointer">
              <input type="checkbox" checked={picked.has(p.package_id)}
                onChange={() => toggle(p.package_id)} className="sr-only" />
              <span className={`inline-flex w-3.5 h-3.5 items-center justify-center rounded border transition ${
                picked.has(p.package_id) ? 'bg-brand-600 border-brand-600' : 'border-ink-300 bg-surface'
              }`}>
                {picked.has(p.package_id) && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />}
              </span>
            </label>
          </td>
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
          <td className="text-xs text-ink-700 whitespace-nowrap">
            {p.sample_types?.length
              ? p.sample_types.join(' + ')
              : <span className="text-ink-300">—</span>}
            {p.tests_without_sample > 0 && p.test_count > 0 && (
              <span
                className="text-[10px] text-warn-600 ml-1"
                title={`${p.tests_without_sample} of ${p.test_count} tests have no sample type recorded at source`}
              >
                +?
              </span>
            )}
          </td>
          <td className="num text-ink-600">
            {p.tat_hours ? `${p.tat_hours}h` : <span className="text-ink-300">—</span>}
          </td>
          <td className="text-xs max-w-[20rem]">
            {p.lab_offers?.length ? (
              <>
                {p.lab_offers.map((o) => (
                  <div key={o.lab} className="flex items-baseline gap-1.5 leading-snug">
                    <span className="text-ink-700 truncate" title={o.lab}>{o.lab}</span>
                    <span className="text-ink-300">—</span>
                    <span className="num font-medium text-ink-900">
                      ₹{Math.round(o.b2b).toLocaleString('en-IN')}
                    </span>
                  </div>
                ))}
                {p.labs_quoting > p.lab_offers.length && (
                  <div className="text-[11px] text-ink-400 mt-0.5">
                    +{p.labs_quoting - p.lab_offers.length} more lab
                    {p.labs_quoting - p.lab_offers.length === 1 ? '' : 's'}
                  </div>
                )}
              </>
            ) : (
              <span className="text-ink-300">no quote</span>
            )}
          </td>
          <td className="text-xs text-ink-500">
            {(p.order_types ?? []).map((m) => MODALITY_SHORT[m] ?? m).join(' · ') || '—'}
          </td>
        </tr>
      )}
    </SortableTable>
    </>
  );
}
