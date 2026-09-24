'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ChevronRight, AlertTriangle, CalendarClock, Loader2, ExternalLink, Phone,
} from 'lucide-react';
import { startNav } from '@/components/ui/NavProgress';
import {
  STAGES, STAGE_LABEL, STAGE_TONE, TONE_BAR, TONE_CHIP,
  humanHours, pct, shortDate, dateTime, statusLabel, type Stage,
} from '@/lib/stores';
import type { StoreRow, OrderRow } from '@/lib/storeOrders';

/**
 * One collapsible panel per store.
 *
 * Collapsed by default and collapsed for everybody: forty stores each showing
 * their last ten orders is four hundred rows nobody asked for, and the first
 * question is always which store, not which order. Opening one fetches that
 * store's most recent orders and nothing else — so the page costs one query
 * for the list however many stores are on it, and a second only when somebody
 * actually wants to look inside.
 */
export function StoreList({ rows }: { rows: StoreRow[] }) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div>
      {/* A header row so the numbers down the page have names. Hidden on
          narrow screens, where the cards stack and the labels come back
          inline. */}
      <div className="hidden xl:flex items-center gap-4 px-5 pb-2 text-[10px]
                      uppercase tracking-wide text-ink-400 border-b border-ink-150">
        <span className="w-5" />
        <span className="flex-1 min-w-0">Store</span>
        <span className="w-[260px]">Orders by stage</span>
        <span className="w-16 text-right">Orders</span>
        <span className="w-20 text-right">Turnaround</span>
        <span className="w-20 text-right">Cancelled</span>
        <span className="w-24 text-right">Last order</span>
      </div>

      <ul>
        {rows.map((s) => (
          <StorePanel
            key={s.store_id}
            store={s}
            open={open === s.store_id}
            onToggle={() => setOpen((cur) => (cur === s.store_id ? null : s.store_id))}
          />
        ))}
      </ul>
    </div>
  );
}

function StorePanel({
  store: s, open, onToggle,
}: { store: StoreRow; open: boolean; onToggle: () => void }) {
  const panelId = `store-orders-${s.store_id}`;
  const needsAttention = s.delayed > 0 || s.flagged > 0 || s.pending_over_limit;

  return (
    <li className="border-b border-ink-100 last:border-0">
      <div className={`flex flex-wrap xl:flex-nowrap items-center gap-x-4 gap-y-2 px-5 py-3
                       ${open ? 'bg-ink-50' : 'hover:bg-ink-50/60'}`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="w-5 shrink-0 text-ink-400 hover:text-ink-800 rounded-sm
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <ChevronRight className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="sr-only">
            {open ? 'Hide' : 'Show'} recent orders for {s.name}
          </span>
        </button>

        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/stores/${s.store_id}`}
              onClick={() => startNav()}
              className="font-medium text-ink-900 hover:underline rounded-sm
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {s.name}
            </Link>
            {!s.active && (
              <span className="text-[10px] uppercase tracking-wide rounded border
                               border-ink-200 bg-ink-100 text-ink-500 px-1.5 py-px">
                Closed
              </span>
            )}
            {!s.tracked && (
              <span className="text-[10px] uppercase tracking-wide rounded border
                               border-warn-100 bg-warn-50 text-warn-700 px-1.5 py-px">
                Not in the queue
              </span>
            )}
          </div>
          <div className="text-[11px] text-ink-500 mt-0.5 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
            <span>{[s.city, s.state].filter(Boolean).join(', ') || 'No address'}</span>
            {s.pincode && <span className="num">{s.pincode}</span>}
            {s.store_type && <span className="text-ink-400">{s.store_type.toLowerCase()}</span>}
            {s.ops_owner_name && <span className="text-ink-400">· {s.ops_owner_name}</span>}
          </div>

          {needsAttention && (
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {s.delayed > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-danger-500">
                  <AlertTriangle className="w-3 h-3" />
                  {s.delayed} past the promise
                </span>
              )}
              {s.flagged > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-warn-600">
                  <CalendarClock className="w-3 h-3" />
                  {s.flagged} waiting on a new date
                </span>
              )}
              {s.pending_over_limit && s.pending > 0 && (
                <span className="text-[11px] text-warn-600">
                  {s.pending} not scheduled yet
                </span>
              )}
            </div>
          )}
        </div>

        <StageBar store={s} />

        <span className="w-16 text-right num text-sm font-semibold text-ink-900">
          {s.total.toLocaleString('en-IN')}
        </span>
        <span className="w-20 text-right num text-sm text-ink-700">
          {humanHours(s.avg_turnaround_hours)}
        </span>
        <span className={`w-20 text-right num text-sm
          ${(s.cancellation_rate ?? 0) >= 0.2 ? 'text-danger-500 font-semibold' : 'text-ink-700'}`}>
          {pct(s.cancellation_rate)}
        </span>
        <span className="w-24 text-right text-[11px] text-ink-500">
          {shortDate(s.last_order_at)}
        </span>
      </div>

      {open && <OrderPreview storeId={s.store_id} storeName={s.name} panelId={panelId} />}
    </li>
  );
}

/**
 * The stage mix as one bar.
 *
 * Six numbers in a row is six things to read; the same six as proportions of a
 * bar is one. The counts stay available on hover and in full on the store's
 * own page — this is for spotting the store whose bar is half red from across
 * the desk, which is the only thing a list of forty is good for.
 */
function StageBar({ store: s }: { store: StoreRow }) {
  const counts: Record<Stage, number> = {
    pending: s.pending, scheduled: s.scheduled, rescheduled: s.rescheduled,
    in_progress: s.in_progress, completed: s.completed, cancelled: s.cancelled,
  };
  const total = STAGES.reduce((n, k) => n + counts[k], 0);

  if (total === 0) {
    return (
      <span className="w-[260px] text-[11px] text-ink-400">
        No orders in this window
      </span>
    );
  }

  return (
    <span className="w-[260px] shrink-0">
      <span className="flex h-2 rounded-full overflow-hidden bg-ink-100" role="img"
            aria-label={STAGES.filter((k) => counts[k] > 0)
              .map((k) => `${counts[k]} ${STAGE_LABEL[k].toLowerCase()}`).join(', ')}>
        {STAGES.map((k) => counts[k] > 0 && (
          <span
            key={k}
            className={TONE_BAR[STAGE_TONE[k]]}
            // A percentage width cannot be a Tailwind class — the scanner only
            // finds literal names, so a computed one compiles to nothing.
            style={{ width: `${(counts[k] / total) * 100}%` }}
            title={`${counts[k]} ${STAGE_LABEL[k].toLowerCase()}`}
          />
        ))}
      </span>
      <span className="flex gap-2 mt-1 text-[10px] text-ink-500 flex-wrap">
        {STAGES.filter((k) => counts[k] > 0).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${TONE_BAR[STAGE_TONE[k]]}`} />
            <span className="num">{counts[k]}</span>
            <span className="text-ink-400">{STAGE_LABEL[k].toLowerCase()}</span>
          </span>
        ))}
      </span>
    </span>
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
 * Ten rows, not the whole book: this is the "what is going on here" glance
 * that decides whether to open the store properly, and the store's own page
 * is one click away with the filters and the pager on it.
 */
function OrderPreview({
  storeId, storeName, panelId,
}: { storeId: number; storeName: string; panelId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  // The panel is mounted only while it is open, so mounting IS the moment to
  // fetch. Written as an effect and not a callback ref because React 18
  // ignores what a callback ref returns — the cleanup would never have run,
  // and closing a row mid-request would have resolved into a dead component.
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
        // Aborting is this component going away, not a failure to report.
        if (e.name !== 'AbortError') setState({ status: 'error', message: e.message });
      });
    return () => ac.abort();
  }, [storeId]);

  return (
    <div id={panelId} className="bg-ink-50 border-t border-ink-150 px-5 py-3">
      {state.status === 'loading' && (
        <p className="flex items-center gap-2 text-[12px] text-ink-500 py-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading {storeName}&apos;s recent orders…
        </p>
      )}

      {state.status === 'error' && (
        <p className="text-[12px] text-danger-500 py-3">{state.message}</p>
      )}

      {state.status === 'ready' && state.rows.length === 0 && (
        <p className="text-[12px] text-ink-500 py-3">
          This store has no orders at all.
        </p>
      )}

      {state.status === 'ready' && state.rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] tabular-nums min-w-[820px]">
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
                      <span className="font-medium text-ink-900 num">#{o.order_id}</span>
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
      )}
    </div>
  );
}

export function StageChip({ stage, status }: { stage: Stage; status: string | null }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-px text-[10px]
                  font-medium whitespace-nowrap ${TONE_CHIP[STAGE_TONE[stage]]}`}
      // The stage is the grouping; the raw status is the fact. Anyone on a
      // call with the console needs the second, so it is never thrown away.
      title={status ? `${statusLabel(status)} in LabStack` : undefined}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}
