'use client';

import { useState, useEffect, useTransition } from 'react';
import Link from 'next/link';
import { ChevronRight, ExternalLink, Loader2, Phone, Trash2 } from 'lucide-react';
import { startNav } from '@/components/ui/NavProgress';
import { runAction } from '../requests/runAction';
import { setStoreTracked } from './actions';
import { RemoveStore } from './[id]/RemoveStore';
import { STAGE_LABEL, STAGE_TONE, TONE_CHIP, dateTime, statusLabel, type Stage } from '@/lib/stores';
import type { StoreRow, OrderRow } from '@/lib/storeOrders';

/**
 * The stores, and the orders behind each one.
 *
 * A plain table with a visible header, because the previous version put six
 * figures on a flex row whose labels were hidden below 1280px — so on a laptop
 * the row read "4 · 101 · 47h · 44" with nothing saying which was which. A
 * number without its column name is worse than no number at all.
 *
 * Only what the spec asks for: whether we track the store, who it is, and its
 * two queues. Turnaround, cancellation rate, the stage bar and the last-order
 * date live on the store's own page now, where there is room to say what they
 * mean. This screen answers "which partners, and what is waiting" — everything
 * else was competing with that.
 */
export function StoreList({ rows, canEdit }: { rows: StoreRow[]; canEdit: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  const tracked = rows.filter((r) => r.in_tracking).length;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums min-w-[720px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-ink-400 text-left
                           border-b border-ink-200">
              {canEdit && (
                <th className="font-medium pl-5 pr-2 py-2 w-14">Track</th>
              )}
              <th className="font-medium px-2 py-2">Store</th>
              <th className="font-medium px-3 py-2 text-right w-[104px]">Needs a lab</th>
              <th className="font-medium px-3 py-2 text-right w-[108px]">Pickup today</th>
              <th className="font-medium px-3 py-2 text-right w-20">Orders</th>
              <th className="font-medium px-5 py-2 w-28" />
            </tr>
          </thead>

          <tbody>
            {rows.map((s) => (
              <StoreRowView
                key={s.store_id}
                store={s}
                canEdit={canEdit}
                open={open === s.store_id}
                removing={removing === s.store_id}
                onToggleOpen={() => setOpen((cur) => (cur === s.store_id ? null : s.store_id))}
                onRemove={() => setRemoving((cur) => (cur === s.store_id ? null : s.store_id))}
              />
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <p className="px-5 pt-3 text-[11px] text-ink-400">
          {tracked} of {rows.length} tracked. Only tracked stores are counted in the two
          queues — unticking one deletes nothing.
        </p>
      )}
    </div>
  );
}

function StoreRowView({
  store: s, canEdit, open, removing, onToggleOpen, onRemove,
}: {
  store: StoreRow;
  canEdit: boolean;
  open: boolean;
  removing: boolean;
  onToggleOpen: () => void;
  onRemove: () => void;
}) {
  const panelId = `store-orders-${s.store_id}`;
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const toggleTracked = () => start(async () => {
    const r = await runAction(() => setStoreTracked(s.store_id, !s.in_tracking));
    setErr(r.ok ? null : (r.error ?? 'That did not work'));
  });

  const cols = canEdit ? 6 : 5;

  return (
    <>
      <tr className={`border-b border-ink-100 ${open || removing ? 'bg-ink-50' : 'hover:bg-ink-50/60'}`}>
        {canEdit && (
          <td className="pl-5 pr-2 py-2.5">
            <span className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={s.in_tracking}
                disabled={pending}
                onChange={toggleTracked}
                aria-label={`Track ${s.name}`}
                title={s.in_tracking
                  ? 'Tracked. Untick to stop counting its orders here — nothing is deleted.'
                  : 'Tick to track this store and count its orders here.'}
                className="accent-brand-600 disabled:opacity-50"
              />
              {pending && <Loader2 className="w-3 h-3 animate-spin text-ink-400" />}
            </span>
          </td>
        )}

        <td className="px-2 py-2.5">
          <Link
            href={`/stores/${s.store_id}`}
            onClick={() => startNav()}
            className="font-medium text-ink-900 hover:underline rounded-sm
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {s.name}
          </Link>
          <span className="block text-[11px] text-ink-500">
            {[s.city, s.state].filter(Boolean).join(', ') || 'No address'}
            {!s.active && ' · closed in LabStack'}
            {s.source === 'atlas' && ' · added in Atlas'}
          </span>
          {err && <span className="block text-[11px] text-danger-500">{err}</span>}
        </td>

        {/* Untracked means nothing is being counted for this store, so a dash
            is the true answer where a zero would be a claim. */}
        <td className="px-3 py-2.5 text-right align-top">
          {s.in_tracking
            ? <Count n={s.needs_lab}
                     note={s.needs_lab_tomorrow ? `${s.needs_lab_tomorrow} tomorrow` : null} />
            : <span className="text-[11px] text-ink-300">not tracked</span>}
        </td>

        <td className="px-3 py-2.5 text-right align-top">
          {s.in_tracking
            ? <Count n={s.pickup_today}
                     note={s.pickup_no_lab ? `${s.pickup_no_lab} no lab` : null} bad />
            : <span className="text-ink-300">—</span>}
        </td>

        <td className="px-3 py-2.5 text-right align-top text-ink-700">
          {s.total.toLocaleString('en-IN')}
        </td>

        <td className="px-5 py-2.5 align-top">
          <span className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={onToggleOpen}
              aria-expanded={open}
              aria-controls={panelId}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px]
                         text-ink-500 hover:text-ink-900 hover:bg-ink-100
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
              Orders
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove ${s.name}`}
                title="Remove this store"
                className="rounded-md p-1 text-ink-300 hover:text-danger-500 hover:bg-ink-100
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </span>
        </td>
      </tr>

      {removing && (
        <tr className="border-b border-ink-100 bg-ink-50">
          <td colSpan={cols} className="px-5 py-3">
            {/* The same control the store's own page uses, so "remove" means
                the same thing in both places and the dependency check is not
                written twice. */}
            <RemoveStore storeId={s.store_id} storeName={s.name} autoOpen />
          </td>
        </tr>
      )}

      {open && (
        <tr id={panelId} className="border-b border-ink-100 bg-ink-50">
          <td colSpan={cols} className="px-5 py-3">
            <OrderPreview storeId={s.store_id} storeName={s.name} />
          </td>
        </tr>
      )}
    </>
  );
}

/** A queue count, with the pressing part of it named underneath. */
function Count({ n, note, bad }: { n: number; note: string | null; bad?: boolean }) {
  if (n === 0) return <span className="text-ink-300">—</span>;
  return (
    <>
      <span className="font-semibold text-ink-900">{n.toLocaleString('en-IN')}</span>
      {note && (
        <span className={`block text-[10px] ${bad ? 'font-semibold text-danger-500' : 'text-ink-400'}`}>
          {note}
        </span>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The drill-down
// ---------------------------------------------------------------------------

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: OrderRow[]; total: number };

/**
 * The store's most recent orders, fetched when the row is opened.
 *
 * Ten rows, not the whole book: this is the glance that decides whether to
 * open the store properly, and the store's own page is one click away with the
 * filters, the pager and the export on it.
 */
function OrderPreview({ storeId, storeName }: { storeId: number; storeName: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const ac = new AbortController();
    setState({ status: 'loading' });
    fetch(`/api/stores/${storeId}/orders?limit=10`,
          { credentials: 'same-origin', signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(r.status === 403
            ? 'Not available for your role'
            : `Could not load orders (${r.status})`);
        }
        return r.json();
      })
      .then((d: { rows?: OrderRow[]; total?: number }) => {
        setState({ status: 'ready', rows: d.rows ?? [], total: d.total ?? 0 });
      })
      .catch((e: Error) => {
        // Aborting is this row closing, not a failure to report.
        if (e.name !== 'AbortError') setState({ status: 'error', message: e.message });
      });
    return () => ac.abort();
  }, [storeId]);

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 text-[12px] text-ink-500 py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading {storeName}&apos;s recent orders…
      </p>
    );
  }

  if (state.status === 'error') {
    return <p className="text-[12px] text-danger-500 py-2">{state.message}</p>;
  }

  if (state.rows.length === 0) {
    return <p className="text-[12px] text-ink-500 py-2">This store has no orders at all.</p>;
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] tabular-nums min-w-[760px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-ink-400 text-left">
              <th className="font-medium py-1.5 pr-3">Order</th>
              <th className="font-medium py-1.5 pr-3">Patient</th>
              <th className="font-medium py-1.5 pr-3">Appointment</th>
              <th className="font-medium py-1.5 pr-3">Stage</th>
              <th className="font-medium py-1.5 pr-3">Phlebo</th>
              <th className="font-medium py-1.5 pr-3">Lab</th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((o) => (
              <tr key={o.order_id} className="border-t border-ink-150/70">
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  <span className="font-medium text-ink-900">#{o.order_id}</span>
                  {o.reference_id && (
                    <span className="block text-[10px] text-ink-400">{o.reference_id}</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-ink-700">
                  {o.patient_name ?? '—'}
                  {o.patient_city && (
                    <span className="block text-[10px] text-ink-400">{o.patient_city}</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap text-ink-700">
                  {dateTime(o.appointment_at)}
                  {o.delayed && (
                    <span className="block text-[10px] font-semibold text-danger-500">
                      past the promise
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3">
                  <StageChip stage={o.stage} status={o.order_status} />
                </td>
                <td className="py-1.5 pr-3 text-ink-700">
                  {o.phlebo_name
                    ? (
                      <span className="inline-flex items-center gap-1">
                        {o.phlebo_name}
                        {o.phlebo_number && <Phone className="w-2.5 h-2.5 text-ink-400" />}
                      </span>
                    )
                    : <span className="text-ink-400">not assigned</span>}
                </td>
                <td className="py-1.5 pr-3 text-ink-700">{o.lab_name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Link
        href={`/stores/${storeId}`}
        onClick={() => startNav()}
        className="inline-flex items-center gap-1 mt-2 text-[12px] font-medium
                   text-brand-600 hover:underline rounded-sm focus:outline-none
                   focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {state.total > state.rows.length
          ? `All ${state.total.toLocaleString('en-IN')} orders, with filters and export`
          : 'Open the store'}
        <ExternalLink className="w-3 h-3" />
      </Link>
    </>
  );
}

export function StageChip({ stage, status }: { stage: Stage; status: string | null }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-px text-[10px]
                  font-medium whitespace-nowrap ${TONE_CHIP[STAGE_TONE[stage]]}`}
      // The stage is the grouping; the raw status is the fact. Anyone on a call
      // with the console needs the second, so it is never thrown away.
      title={status ? `${statusLabel(status)} in LabStack` : undefined}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}
