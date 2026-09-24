'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, CalendarClock, Check, Loader2, X, Phone, Info,
} from 'lucide-react';
import { runAction } from '../../requests/runAction';
import { useActionFlash } from '@/components/ui/useActionFlash';
import {
  STAGE_LABEL, STAGE_TONE, TONE_CHIP, dateTime, humanHours, lateness, statusLabel,
} from '@/lib/stores';
import type { OrderRow } from '@/lib/storeOrders';
import { flagOrdersForReschedule, clearRescheduleFlags } from '../actions';

/**
 * One store's orders, with the two bulk actions this screen can honestly
 * offer.
 *
 * Neither of them moves an appointment. Atlas reads LabStack and does not
 * write it, so "reschedule these twelve" is recorded here as a decision —
 * which orders, why, who decided, when — and carried out in the console. The
 * bar says so in as many words, because a button labelled "Reschedule" that
 * quietly did not would be worse than no button at all.
 */
export function OrdersTable({
  storeId, rows, canEdit, pageSize,
}: { storeId: number; rows: OrderRow[]; canEdit: boolean; pageSize: number }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  // Not useState: a successful action revalidates, which unmounts this
  // component before the update lands. See useActionFlash.
  const [note, setNote] = useActionFlash(`store-orders-${storeId}`);

  const ids = useMemo(() => rows.map((r) => r.order_id), [rows]);
  const chosen = useMemo(() => ids.filter((i) => picked.has(i)), [ids, picked]);
  const allOnPage = chosen.length > 0 && chosen.length === ids.length;

  // How many of the selection are already flagged, so the bar can offer the
  // right action rather than both and let the server refuse one.
  const flaggedChosen = useMemo(
    () => rows.filter((r) => picked.has(r.order_id) && r.flagged_for_reschedule).length,
    [rows, picked]);

  const toggle = (id: number) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const clearSelection = () => { setPicked(new Set()); setNote(null); };

  const flag = () => start(async () => {
    const r = await runAction(() => flagOrdersForReschedule(storeId, chosen, reason));
    if (r.ok) {
      const n = (r as { flagged?: number }).flagged ?? chosen.length;
      setNote({ kind: 'ok', text: `Marked ${n} order${n === 1 ? '' : 's'}. Move the dates in the console — this is the list.` });
      setReason('');
      setPicked(new Set());
    } else {
      setNote({ kind: 'bad', text: r.error ?? 'That did not work' });
    }
  });

  const unflag = () => start(async () => {
    const r = await runAction(() => clearRescheduleFlags(storeId, chosen));
    if (r.ok) {
      const n = (r as { cleared?: number }).cleared ?? chosen.length;
      setNote({ kind: 'ok', text: `Cleared ${n} flag${n === 1 ? '' : 's'}.` });
      setPicked(new Set());
    } else {
      setNote({ kind: 'bad', text: r.error ?? 'That did not work' });
    }
  });

  if (rows.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-ink-500">
        No order matches these filters.{' '}
        <Link href={`/stores/${storeId}`} className="text-brand-600 hover:underline">
          Clear them
        </Link>
      </p>
    );
  }

  return (
    <div>
      {canEdit && chosen.length > 0 && (
        <div className="mx-5 mb-3 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-[13px] font-semibold text-ink-900">
              {chosen.length} selected
              {/* Said plainly, because with a pager "all" is ambiguous and the
                  ambiguity only bites once there are two pages. */}
              {allOnPage && ids.length === pageSize && ' — all on this page'}
            </span>
            <button type="button" onClick={clearSelection}
                    className="text-[12px] text-ink-500 hover:underline">
              Clear
            </button>
          </div>

          {flaggedChosen === chosen.length ? (
            <div className="flex flex-wrap items-center gap-3 mt-2.5">
              <p className="text-[12px] text-ink-700">
                All {chosen.length} already carry a flag.
              </p>
              <button
                type="button"
                onClick={unflag}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-3 py-1.5
                           text-[12px] font-medium text-white hover:bg-ink-800 disabled:opacity-50"
              >
                {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                Clear the flag
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3 mt-2.5">
              <label className="flex-1 min-w-[260px]">
                <span className="block text-[11px] uppercase tracking-wide text-ink-500 mb-1">
                  Why do these need a new date?
                </span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Phlebo unavailable in this pincode this week"
                  maxLength={400}
                  className="w-full rounded-md border border-ink-200 bg-surface px-2 py-1.5
                             text-[13px] text-ink-900 placeholder:text-ink-400 outline-none
                             focus:border-brand-500"
                />
              </label>
              <button
                type="button"
                onClick={flag}
                disabled={pending || !reason.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5
                           text-[12px] font-medium text-white hover:bg-brand-700
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pending
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <CalendarClock className="w-3 h-3" />}
                Mark {chosen.length} as needing a new date
              </button>
            </div>
          )}

          <p className="flex items-start gap-1.5 text-[11px] text-ink-500 mt-2">
            <Info className="w-3 h-3 shrink-0 mt-px" />
            This records the decision and shows on the export. It does not change the
            appointment — that is done in the console.
          </p>

          {note && (
            <p className={`text-[12px] mt-2 ${note.kind === 'ok' ? 'text-success-700' : 'text-danger-500'}`}>
              {note.text}
            </p>
          )}
        </div>
      )}

      {note && chosen.length === 0 && (
        <p className={`mx-5 mb-3 text-[12px] ${note.kind === 'ok' ? 'text-success-700' : 'text-danger-500'}`}>
          {note.text}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px] tabular-nums min-w-[1180px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-ink-400 text-left
                           border-b border-ink-200">
              {canEdit && (
                <th className="w-9 px-5 py-2">
                  <input
                    type="checkbox"
                    checked={allOnPage}
                    // Without this the box reads unchecked while three rows are
                    // ticked, which makes clicking it look like it does nothing.
                    ref={(el) => {
                      if (el) el.indeterminate = chosen.length > 0 && !allOnPage;
                    }}
                    onChange={(e) =>
                      setPicked(e.target.checked ? new Set(ids) : new Set())}
                    aria-label="Select every order on this page"
                    className="accent-brand-600"
                  />
                </th>
              )}
              <th className="font-medium px-2 py-2">Order</th>
              <th className="font-medium px-2 py-2">Patient</th>
              <th className="font-medium px-2 py-2">Appointment</th>
              <th className="font-medium px-2 py-2">Stage</th>
              <th className="font-medium px-2 py-2">Phlebo</th>
              <th className="font-medium px-2 py-2">Lab</th>
              <th className="font-medium px-2 py-2 text-right">Turnaround</th>
              <th className="font-medium px-5 py-2">Flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const isPicked = picked.has(o.order_id);
              return (
                <tr
                  key={o.order_id}
                  className={`border-b border-ink-100 last:border-0
                              ${isPicked ? 'bg-brand-50' : 'hover:bg-ink-50'}`}
                >
                  {canEdit && (
                    <td className="px-5 py-2">
                      <input
                        type="checkbox"
                        checked={isPicked}
                        onChange={() => toggle(o.order_id)}
                        aria-label={`Select order ${o.order_id}`}
                        className="accent-brand-600"
                      />
                    </td>
                  )}

                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className="font-medium text-ink-900 num">#{o.order_id}</span>
                    {o.reference_id && (
                      <span className="block text-[10px] text-ink-400">{o.reference_id}</span>
                    )}
                    {o.request_id && (
                      <Link href={`/requests/${o.request_id}`}
                            className="block text-[10px] text-brand-600 hover:underline">
                        from request {o.request_id}
                      </Link>
                    )}
                  </td>

                  <td className="px-2 py-2">
                    <span className="text-ink-900">{o.patient_name ?? '—'}</span>
                    {(o.patient_city || o.patient_pincode) && (
                      <span className="block text-[10px] text-ink-400">
                        {[o.patient_city, o.patient_pincode].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </td>

                  <td className="px-2 py-2 whitespace-nowrap">
                    <span className="text-ink-700">{dateTime(o.appointment_at)}</span>
                    {o.delayed && (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-danger-500">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        {lateness(o.hours_since_appointment) ?? 'past the promise'}
                      </span>
                    )}
                  </td>

                  <td className="px-2 py-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-px
                                  text-[10px] font-medium whitespace-nowrap
                                  ${TONE_CHIP[STAGE_TONE[o.stage]]}`}
                      title={o.order_status ? `${statusLabel(o.order_status)} in LabStack` : undefined}
                    >
                      {STAGE_LABEL[o.stage]}
                    </span>
                    {o.cancel_reason && (
                      <span className="block text-[10px] text-ink-400 mt-0.5 max-w-[150px] truncate"
                            title={o.cancel_reason}>
                        {o.cancel_reason}
                      </span>
                    )}
                  </td>

                  <td className="px-2 py-2">
                    {o.phlebo_name ? (
                      <>
                        <span className="text-ink-700">{o.phlebo_name}</span>
                        {o.phlebo_number && (
                          <a href={`tel:${o.phlebo_number}`}
                             className="flex items-center gap-1 text-[10px] text-brand-600 hover:underline">
                            <Phone className="w-2.5 h-2.5" />{o.phlebo_number}
                          </a>
                        )}
                      </>
                    ) : <span className="text-ink-400">not assigned</span>}
                  </td>

                  <td className="px-2 py-2">
                    <span className="text-ink-700">{o.lab_name ?? '—'}</span>
                    {o.lab_city && (
                      <span className="block text-[10px] text-ink-400">{o.lab_city}</span>
                    )}
                  </td>

                  <td className="px-2 py-2 text-right text-ink-700">
                    {humanHours(o.turnaround_hours)}
                  </td>

                  <td className="px-5 py-2">
                    {o.flagged_for_reschedule ? (
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-medium
                          ${o.reschedule_stale ? 'text-ink-400' : 'text-warn-700'}`}
                        title={[o.reschedule_reason, o.flagged_by_name && `— ${o.flagged_by_name}`]
                          .filter(Boolean).join(' ')}
                      >
                        {o.reschedule_stale ? <Check className="w-3 h-3" /> : <CalendarClock className="w-3 h-3" />}
                        {/* A flag the order has outrun. Saying so is the point:
                            it is work already done, not work outstanding. */}
                        {o.reschedule_stale ? 'moved on — clear it' : 'needs a date'}
                      </span>
                    ) : <span className="text-ink-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
