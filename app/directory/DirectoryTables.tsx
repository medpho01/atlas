'use client';

import { SortableTable, SortableColumn } from '@/components/ui/SortableTable';
import { Pill } from '@/components/ui/Toggle';
import { HealthBadge } from '@/components/HealthBadge';

/**
 * An MOU end date, formatted the same on both sides of hydration.
 *
 * `toLocaleDateString()` with no arguments uses the runtime's locale, and the
 * server's is not the browser's — Node rendered 29/9/2027 while Chrome rendered
 * 9/29/2027, React saw the mismatch and threw away the server HTML for the
 * whole table. Naming the locale and the fields fixes it, and matches how every
 * other date in Atlas is written.
 *
 * Only the date part is parsed. These are timestamps, and letting the browser
 * apply its own offset to one moves it across midnight for anyone west of the
 * server — a contract that ends on the 1st reading as the 30th.
 */
function mouDate(v: string | Date | null | undefined): string {
  if (!v) return '—';
  // Either shape. The query sends text, but a Date survives the boundary if a
  // caller forgets the cast, and rendering a dash over a real contract date is
  // worse than the formatting problem this function exists to solve.
  const iso = v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v).slice(0, 10);
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

type LabRow = any;
type ProvRow = any;

function labelForCenterType(t?: string) {
  if (t === 'DIAGNOSTIC_CENTER') return 'Diagnostic';
  if (t === 'COLLECTION_CENTER') return 'Collection';
  if (t === 'HOSPITAL') return 'Hospital';
  return '—';
}

const labCols: SortableColumn<LabRow>[] = [
  { key: 'lab_name', label: 'Lab' },
  { key: 'center_type', label: 'Type', sortValue: (r) => labelForCenterType(r.center_type) },
  { key: 'modalities', label: 'Modalities', sortable: false },
  { key: 'chain_name', label: 'Chain' },
  { key: 'city', label: 'City' },
  { key: 'pincode', label: 'Pincode' },
  { key: 'pincodes_serviced_count', label: 'Serv.Pin', align: 'right' },
  { key: 'orders_total', label: 'Orders', align: 'right' },
  { key: 'orders_l30d', label: 'L30D', align: 'right' },
  { key: 'cancel_pct', label: 'Cancel%', align: 'right' },
  { key: 'health_score', label: 'Health' },
  { key: 'mou_end_date', label: 'MOU', sortValue: (r) => (r.mou_end_date ? new Date(r.mou_end_date).getTime() : 0) },
  { key: 'active', label: 'Status', sortValue: (r) => (r.active ? 1 : 0) },
];

export function LabsDirTable({ rows }: { rows: LabRow[] }) {
  return (
    <SortableTable rows={rows} columns={labCols} initialSortKey="orders_total" initialSortDir="desc" rowKey={(r) => r.id}>
      {(l) => (
        <tr>
          <td className="font-medium text-ink-900">{l.lab_name}</td>
          <td className="text-ink-600 text-xs">{labelForCenterType(l.center_type)}</td>
          <td>
            <div className="flex flex-wrap gap-1">
              {l.center_visit && <Pill tone="info">Center</Pill>}
              {l.home_collection && <Pill tone="good">Home Sample</Pill>}
              {!l.center_visit && !l.home_collection && <span className="text-[11px] text-ink-300">—</span>}
            </div>
          </td>
          <td className="text-ink-600">{l.chain_name ?? '—'}</td>
          <td className="text-ink-700">{l.city ?? '—'}</td>
          <td className="font-mono text-ink-700">{l.pincode ?? '—'}</td>
          <td className="num">{l.pincodes_serviced_count}</td>
          <td className="num">{l.orders_total}</td>
          <td className="num">{l.orders_l30d}</td>
          <td className="num">{l.cancel_pct}%</td>
          <td><HealthBadge score={l.health_score} /></td>
          <td className="text-[11px] text-ink-500">{mouDate(l.mou_end_date)}</td>
          <td>{l.active ? <Pill tone="good">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}</td>
        </tr>
      )}
    </SortableTable>
  );
}

const provCols: SortableColumn<ProvRow>[] = [
  { key: 'name', label: 'Name' },
  { key: 'type_name', label: 'Type' },
  { key: 'modalities', label: 'Modalities', sortable: false },
  { key: 'city', label: 'City' },
  { key: 'pincode', label: 'Pincode' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'email', label: 'Email' },
  { key: 'is_verified', label: 'Verified', sortValue: (r) => (r.is_verified ? 1 : 0) },
];

export function ProvidersDirTable({ rows }: { rows: ProvRow[] }) {
  return (
    <SortableTable rows={rows} columns={provCols} initialSortKey="name" initialSortDir="asc" rowKey={(r) => r.id}>
      {(p) => (
        <tr>
          <td className="font-medium text-ink-900">{p.name}</td>
          <td className="text-ink-700">{p.type_name}</td>
          <td>
            <div className="flex flex-wrap gap-1">
              {p.type_name === 'Doctor' && (<><Pill tone="info">Center</Pill><Pill tone="warn">Home Visit</Pill></>)}
              {p.type_name === 'Phlebotomist' && <Pill tone="good">Home Sample</Pill>}
              {p.type_name === 'Nurse' && <Pill tone="warn">Home Visit</Pill>}
            </div>
          </td>
          <td className="text-ink-700">{p.city ?? '—'}</td>
          <td className="font-mono text-ink-700">{p.pincode ?? '—'}</td>
          <td className="text-ink-600">{p.mobile ?? '—'}</td>
          <td className="text-ink-500 text-xs">{p.email ?? '—'}</td>
          <td>{p.is_verified ? <Pill tone="good">✓</Pill> : <span className="text-[11px] text-ink-400">unverified</span>}</td>
        </tr>
      )}
    </SortableTable>
  );
}
