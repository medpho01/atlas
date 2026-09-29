'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2, Plus, Search, Store as StoreIcon, X } from 'lucide-react';
import { startNav } from '@/components/ui/NavProgress';
import { runAction } from '../requests/runAction';
import { setStoreTracked } from './actions';
import type { StoreQueue } from '@/lib/orderTracking';

type Option = { store_id: number; name: string; city: string | null; tracked: boolean; orders: number };

/**
 * The stores, and what each one has waiting.
 *
 * The spec is written store by store — "all orders originating from store X
 * with appointment today" — and that is the order the questions actually come
 * in. Which partner has the pile is the first thing somebody needs; which
 * orders is the second, and it is one click away on the queue tabs below.
 *
 * Stores with nothing still show, reading zero. A partner who has gone quiet
 * is precisely what a list of only-the-busy-ones cannot show you, and on this
 * screen a store that suddenly reads zero is worth a phone call.
 */
export function StoreQueues({
  rows, options, canEdit, activeStore, carry,
}: {
  rows: StoreQueue[];
  options: Option[];
  canEdit: boolean;
  /** The store currently filtered to, if any. */
  activeStore: number | null;
  /**
   * Every other search param, so clicking a store keeps the tab and the
   * filters. A function would read better, but this component runs on the
   * client and a server component cannot hand one over — the same reason
   * StorePicker takes an object.
   */
  carry: Record<string, string>;
}) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const track = (id: number, on: boolean) => start(async () => {
    const r = await runAction(() => setStoreTracked(id, on));
    if (!r.ok) setError(r.error ?? 'That did not work');
    else { setError(null); setAdding(false); setQ(''); }
  });

  /** Clicking a store filters every queue to it; clicking it again clears. */
  const hrefForStore = (id: number | null) => {
    const p = new URLSearchParams(carry);
    if (id == null) p.delete('store'); else p.set('store', String(id));
    const q = p.toString();
    return `/order-tracking${q ? `?${q}` : ''}`;
  };

  const untracked = options.filter((o) => !o.tracked);
  const shown = q
    ? untracked.filter((o) =>
      `${o.name} ${o.city ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    : untracked;

  return (
    <div className="rounded-xl border border-ink-150 bg-surface shadow-card mb-5">
      <div className="flex items-start justify-between gap-3 flex-wrap px-5 pt-4 pb-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center
                          justify-center shrink-0">
            <StoreIcon className="w-4 h-4" strokeWidth={2.25} />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-ink-900 text-[15px] leading-tight">
              {rows.length} store{rows.length === 1 ? '' : 's'} tracked
            </h2>
            <p className="text-xs text-ink-500 mt-0.5">
              Every order from these partners is tracked, whether or not it came from a
              request.
            </p>
          </div>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-200
                       px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100"
          >
            {adding ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {adding ? 'Done' : 'Track a store'}
          </button>
        )}
      </div>

      {adding && (
        <div className="mx-5 mb-3 rounded-lg border border-ink-200 bg-ink-50 p-3">
          <div className="flex items-center gap-1.5 rounded-md border border-ink-200
                          bg-surface px-2 py-1 mb-2">
            <Search className="w-3.5 h-3.5 text-ink-400 shrink-0" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a store to track"
              className="w-full bg-transparent text-[12px] text-ink-900
                         placeholder:text-ink-400 outline-none"
            />
          </div>
          <div className="max-h-[220px] overflow-y-auto">
            {shown.length === 0 ? (
              <p className="text-[12px] text-ink-500 px-1 py-2">
                {untracked.length === 0
                  ? 'Every active store is already tracked.'
                  : `No store matches “${q}”.`}
              </p>
            ) : shown.slice(0, 40).map((o) => (
              <button
                key={o.store_id}
                type="button"
                disabled={pending}
                onClick={() => track(o.store_id, true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md
                           hover:bg-surface text-left disabled:opacity-50"
              >
                <Plus className="w-3 h-3 text-brand-600 shrink-0" />
                <span className="text-[12px] text-ink-900 flex-1 truncate">{o.name}</span>
                {o.city && <span className="text-[11px] text-ink-400">{o.city}</span>}
                <span className="text-[11px] text-ink-400 num">
                  {o.orders.toLocaleString('en-IN')} orders
                </span>
              </button>
            ))}
          </div>
          {error && <p className="text-[12px] text-danger-500 mt-2">{error}</p>}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-ink-500">
          No store is being tracked, so every queue below is empty.{' '}
          {canEdit
            ? 'Track a store to start.'
            : 'A network lead or admin can add one.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums min-w-[860px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-ink-400 text-left
                             border-y border-ink-150">
                <th className="font-medium px-5 py-2">Store</th>
                <th className="font-medium px-3 py-2 text-right">Needs a lab</th>
                <th className="font-medium px-3 py-2 text-right">Pickup today</th>
                <th className="font-medium px-3 py-2 text-right">Report outstanding</th>
                <th className="font-medium px-3 py-2 text-right">Unassigned</th>
                {canEdit && <th className="font-medium px-5 py-2 w-8" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const on = activeStore === s.store_id;
                return (
                  <tr
                    key={s.store_id}
                    className={`border-b border-ink-100 last:border-0
                                ${on ? 'bg-brand-50' : 'hover:bg-ink-50'}`}
                  >
                    <td className="px-5 py-2.5">
                      {/* Clicking a store filters every queue to it, which is
                          what "orders originating from store X" means. */}
                      <Link
                        href={hrefForStore(on ? null : s.store_id)}
                        onClick={() => startNav()}
                        className="font-medium text-ink-900 hover:underline rounded-sm
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        {s.store_name}
                      </Link>
                      <span className="block text-[11px] text-ink-400">
                        {s.city ?? 'No city'}
                        {!s.active && ' · closed in LabStack'}
                        {on && ' · showing only this store'}
                      </span>
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <Count n={s.needs_lab} bad={s.needs_lab_overdue} />
                      {s.needs_lab_tomorrow > 0 && (
                        <span className="block text-[10px] text-ink-400">
                          {s.needs_lab_tomorrow} tomorrow
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <Count n={s.pickup_today} bad={s.pickup_no_lab} />
                      {/* The overlap of the two queues, and the worst row on
                          the screen: happening today, no lab named. */}
                      {s.pickup_no_lab > 0 && (
                        <span className="block text-[10px] font-semibold text-danger-500">
                          {s.pickup_no_lab} with no lab
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-2.5 text-right">
                      <Count n={s.chase_report} bad={s.chase_report_late} />
                      {s.chase_report_late > 0 && (
                        <span className="block text-[10px] text-warn-600">
                          {s.chase_report_late} past 48h
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-2.5 text-right text-ink-600">
                      {s.unassigned > 0 ? s.unassigned : <span className="text-ink-300">—</span>}
                    </td>

                    {canEdit && (
                      <td className="px-5 py-2.5 text-right">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => track(s.store_id, false)}
                          aria-label={`Stop tracking ${s.store_name}`}
                          title="Stop tracking this store. Nothing is deleted."
                          className="text-ink-300 hover:text-danger-500 disabled:opacity-50"
                        >
                          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <X className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {error && !adding && (
        <p className="px-5 pb-3 text-[12px] text-danger-500 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />{error}
        </p>
      )}
    </div>
  );
}

/** A count, with the pressing part of it called out underneath. */
function Count({ n, bad }: { n: number; bad: number }) {
  if (n === 0) return <span className="text-ink-300">—</span>;
  return (
    <span className={`font-semibold ${bad > 0 ? 'text-ink-900' : 'text-ink-700'}`}>
      {n.toLocaleString('en-IN')}
    </span>
  );
}
