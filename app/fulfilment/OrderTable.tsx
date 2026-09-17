'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Sparkles, AlertTriangle, MoveRight, X, Phone, ExternalLink } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import type { DayRow, LabContext } from '@/lib/fulfilmentQueries';

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The server hands back an IST wall clock as text. Reading it through Date
 * would shift it again by whatever timezone the browser is in, so the string
 * is formatted as written.
 */
export function time(t: string | null) {
  const m = t?.match(/ (\d{2}):(\d{2})/);
  if (!m) return '—';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

const date = (t: string | null) =>
  t ? new Date(`${t.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB',
    { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';

const num = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN');
const inr = (v: string | null) => (v == null ? '—' : '₹' + Math.round(Number(v)).toLocaleString('en-IN'));

const STATUS_TONE: Record<string, { label: string; chip: string }> = {
  REPORT_DELIVERED: { label: 'delivered', chip: 'bg-success-50 text-success-600 border-success-100' },
  SAMPLE_PROCESSED: { label: 'processed', chip: 'bg-success-50 text-success-600 border-success-100' },
  SAMPLE_COLLECTED: { label: 'collected', chip: 'bg-brand-50 text-brand-700 border-brand-100' },
  SAMPLE_DELIVERED: { label: 'at lab', chip: 'bg-brand-50 text-brand-700 border-brand-100' },
  PHLEBO_ASSIGNED: { label: 'phlebo assigned', chip: 'bg-brand-50 text-brand-700 border-brand-100' },
  ORDER_SCHEDULED: { label: 'scheduled', chip: 'bg-ink-100 text-ink-600 border-ink-200' },
  CREATED: { label: 'created', chip: 'bg-ink-100 text-ink-600 border-ink-200' },
  PENDING: { label: 'pending', chip: 'bg-warn-50 text-warn-600 border-warn-100' },
  RESCHEDULED: { label: 'rescheduled', chip: 'bg-warn-50 text-warn-600 border-warn-100' },
  CANCELED: { label: 'cancelled', chip: 'bg-danger-50 text-danger-500 border-danger-100' },
  PATIENT_MISSED: { label: 'patient missed', chip: 'bg-danger-50 text-danger-500 border-danger-100' },
};

function Status({ s }: { s: string | null }) {
  if (!s) return <span className="text-ink-300">—</span>;
  const t = STATUS_TONE[s] ?? { label: s.toLowerCase().replace(/_/g, ' '), chip: 'bg-ink-100 text-ink-600 border-ink-200' };
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap ${t.chip}`}>{t.label}</span>;
}

/** Why this row is where it is. The sort is the advice; this is the reason. */
function Why({ row }: { row: DayRow }) {
  if (row.attention === 'no_lab') return (
    <span className="inline-flex items-center gap-1 rounded border border-danger-100 bg-danger-50 px-1.5 py-0.5 text-[11px] font-medium text-danger-500">
      <AlertTriangle className="w-3 h-3" /> no lab assigned
    </span>
  );
  if (row.attention === 'first_order') return (
    <span className="inline-flex items-center gap-1 rounded border border-warn-100 bg-warn-50 px-1.5 py-0.5 text-[11px] font-medium text-warn-600">
      <Sparkles className="w-3 h-3" /> first order
    </span>
  );
  if (row.attention === 'new_lab') return (
    <span className="text-[11px] text-warn-600">{num(row.lab_orders_all_time)} orders ever</span>
  );
  if (row.attention === 'moved') return (
    <span className="inline-flex items-center gap-1 text-[11px] text-ink-500">
      <MoveRight className="w-3 h-3" /> moved from {date(row.prev_appointment_time)}
    </span>
  );
  return <span className="text-[11px] text-ink-300">—</span>;
}

/* -------------------------------------------------------------------------- */
/* The table                                                                   */
/* -------------------------------------------------------------------------- */

export function OrderTable({ rows }: { rows: DayRow[] }) {
  const [open, setOpen] = useState<DayRow | null>(null);

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-500">
        Nothing matches. Widen the filters, or try another day.
      </p>
    );
  }

  return (
    <>
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full text-sm min-w-[920px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
              <th className="text-left font-medium px-5 py-2">Request</th>
              <th className="text-left font-medium px-2 py-2">Order</th>
              <th className="text-left font-medium px-2 py-2">Appointment</th>
              <th className="text-left font-medium px-2 py-2">Lab assigned</th>
              <th className="text-right font-medium px-2 py-2">Fulfilled</th>
              <th className="text-left font-medium px-2 py-2">Needs attention</th>
              <th className="text-left font-medium px-5 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.order_id}
                onClick={() => setOpen(r)}
                className={`border-b border-ink-100 last:border-0 cursor-pointer hover:bg-ink-50 transition-colors ${
                  r.attention === 'no_lab' ? 'bg-danger-50/30' : r.attention === 'first_order' ? 'bg-warn-50/30' : ''
                }`}
              >
                <td className="px-5 py-2">
                  {r.request_id ? (
                    <span className="num font-medium text-ink-900">#{r.request_id}</span>
                  ) : (
                    <span className="text-[12px] text-ink-400">{r.store_name ?? 'direct'}</span>
                  )}
                  {r.request_pincode && (
                    <span className="block text-[11px] text-ink-400 num">{r.request_pincode}</span>
                  )}
                </td>
                <td className="px-2 py-2 num text-ink-700">#{r.order_id}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <span className="text-ink-900">{date(r.appointment_time)}</span>
                  <span className="block text-[11px] text-ink-400 num">{time(r.appointment_time)}</span>
                </td>
                <td className="px-2 py-2 text-ink-800 max-w-xs">
                  {/* The placeholder lab has a name and a city of its own.
                      Showing them would read as an assignment. */}
                  {r.on_placeholder || !r.lab_id ? (
                    <span className="text-danger-500 font-medium">not assigned</span>
                  ) : (
                    <>
                      {r.lab_name ?? '—'}
                      {r.lab_city && <span className="block text-[11px] text-ink-400">{r.lab_city}</span>}
                    </>
                  )}
                </td>
                <td className="px-2 py-2 text-right num text-ink-600 whitespace-nowrap">
                  {r.on_placeholder || !r.lab_id ? '—' : (
                    <>
                      {num(r.lab_delivered)}
                      <span className="block text-[11px] text-ink-400">of {num(r.lab_orders_all_time)}</span>
                    </>
                  )}
                </td>
                <td className="px-2 py-2"><Why row={r} /></td>
                <td className="px-5 py-2"><Status s={r.order_status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && <LabDrawer row={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The drawer                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The lab situation for one order.
 *
 * Opens immediately with what the row already knows and fills in the rest,
 * because the useful thing about clicking a row is that it happens now. The
 * panel is portalled to the body: the table scrolls sideways inside its own
 * container, and a fixed element inside a transformed ancestor is not fixed to
 * the window at all.
 */
function LabDrawer({ row, onClose }: { row: DayRow; onClose: () => void }) {
  const [ctx, setCtx] = useState<LabContext | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    setCtx(null); setFailed(false);
    fetch(`/api/fulfilment/context?order=${row.order_id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setCtx(d))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [row.order_id]);

  const assigned = !row.on_placeholder && row.lab_id;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink-900/30" onClick={onClose} />
      <aside className="relative w-full max-w-[560px] h-full bg-surface border-l border-ink-200 shadow-2xl overflow-y-auto">
        <header className="sticky top-0 bg-surface border-b border-ink-150 px-5 py-3.5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-ink-900">
              {row.request_id ? `Request #${row.request_id}` : (row.store_name ?? 'Direct order')}
              <span className="text-ink-400 font-normal"> · Order #{row.order_id}</span>
            </h2>
            <p className="text-[12px] text-ink-500 mt-0.5">
              {[
                `${date(row.appointment_time)}, ${time(row.appointment_time)}`,
                [row.request_city, row.request_pincode].filter(Boolean).join(' '),
                row.quoted_price ? `${inr(row.quoted_price)} quoted` : '',
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
                  className="p-1 rounded hover:bg-ink-100 text-ink-500 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-5 py-4 space-y-5">
          {/* Who is on it */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-ink-400 mb-2">Lab assigned</h3>
            {!assigned ? (
              <div className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2.5">
                <p className="text-sm font-medium text-danger-500">No lab assigned</p>
                <p className="text-[12px] text-ink-600 mt-0.5">
                  The order sits on the placeholder lab. Somebody has to pick one of the labs
                  below, or this appointment has nobody behind it.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-ink-150 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/lab/${row.lab_id}`} className="text-sm font-medium text-brand-700 dark:text-brand-400 hover:underline">
                    {row.lab_name}
                  </Link>
                  <span className="text-[12px] text-ink-500 num shrink-0">
                    {num(row.lab_delivered)} delivered of {num(row.lab_orders_all_time)}
                    {(row.lab_failed ?? 0) > 0 && <span className="text-danger-500"> · {num(row.lab_failed)} failed</span>}
                  </span>
                </div>
                {row.lab_city && <p className="text-[11px] text-ink-400 mt-0.5">{row.lab_city}</p>}
                {row.is_first_order && (
                  <p className="text-[12px] text-warn-600 mt-1.5 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> This is the first order this lab has ever taken.
                  </p>
                )}
                {row.appointment_moves > 0 && (
                  <p className="text-[12px] text-ink-500 mt-1 flex items-center gap-1">
                    <MoveRight className="w-3 h-3" /> Moved {row.appointment_moves}× — last from {date(row.prev_appointment_time)}.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Who else could be */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-ink-400 mb-2">
              Labs that can collect here
            </h3>
            {failed ? (
              <p className="text-[12px] text-danger-500">Could not load the lab context. Reopen the row to try again.</p>
            ) : !ctx ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : !row.request_id ? (
              <p className="text-[12px] text-ink-500">
                This order did not come from a request, so there is no pincode to search against.
              </p>
            ) : ctx.covering.length === 0 ? (
              <p className="text-[12px] text-ink-500">
                No lab in the network reaches this pincode for home collection. Onboarding one is
                the only way this gets served.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
                    <th className="text-left font-medium py-1.5">Lab</th>
                    <th className="text-left font-medium py-1.5">Missing</th>
                    <th className="text-right font-medium py-1.5">Track record</th>
                  </tr>
                </thead>
                <tbody>
                  {ctx.covering.map((l) => (
                    <tr key={l.lab_id} className={`border-b border-ink-100 last:border-0 ${
                      l.lab_id === row.lab_id ? 'bg-brand-50/50' : ''}`}>
                      <td className="py-1.5 pr-2">
                        <Link href={`/lab/${l.lab_id}`} className="text-brand-700 dark:text-brand-400 hover:underline">
                          {l.lab_name}
                        </Link>
                        <span className="block text-[10px] text-ink-400">
                          {l.city}{l.lab_id === row.lab_id && ' · assigned'}
                        </span>
                      </td>
                      <td className="py-1.5 text-xs pr-2">
                        {l.missing == null
                          ? <span className="text-ink-400">unknown — nothing identifiable requested</span>
                          : l.missing === 0
                            ? <span className="text-success-600">nothing — can serve today</span>
                            : <span className="text-warn-600">
                                {l.missing_items.slice(0, 2).join(', ')}
                                {l.missing_items.length > 2 && ` +${l.missing_items.length - 2}`}
                              </span>}
                      </td>
                      <td className="py-1.5 text-right text-[11px] text-ink-500 num whitespace-nowrap">
                        {(l.orders_all_time ?? 0) === 0
                          ? <span className="text-warn-600">never used</span>
                          : <>{num(l.delivered)} of {num(l.orders_all_time)}</>}
                        {l.cost && <span className="block text-ink-400">{inr(l.cost)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-[11px] text-ink-400 mt-2">
              Web search for labs outside the network is being rebuilt, and is off for now.
            </p>
          </section>

          {/* Evidence for the assigned lab */}
          {ctx && ctx.recent.length > 0 && (
            <section>
              <h3 className="text-[11px] uppercase tracking-wide text-ink-400 mb-2">
                {row.lab_name}&rsquo;s last orders
              </h3>
              <ul className="space-y-1">
                {ctx.recent.map((o) => (
                  <li key={o.order_id} className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="num text-ink-500">#{o.order_id}</span>
                    <span className="text-ink-500">{date(o.appointment_time)}</span>
                    <Status s={o.order_status} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="flex flex-wrap items-center gap-3 pt-1">
            {row.request_id && (
              <Link href={`/requests/${row.request_id}`}
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 dark:text-brand-400 hover:underline">
                Open the full request <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            )}
            {row.requester_mobile && (
              <a href={`tel:${row.requester_mobile.replace(/[^\d+]/g, '')}`}
                 className="inline-flex items-center gap-1.5 text-[13px] text-ink-600 hover:text-ink-900 num">
                <Phone className="w-3.5 h-3.5" /> {row.requester_mobile}
              </a>
            )}
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
