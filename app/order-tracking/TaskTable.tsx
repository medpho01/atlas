'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Phone, Mail, Sparkles, X, Check } from 'lucide-react';
import type { TaskRow, TaskKind, TaskNote } from '@/lib/orderTracking';
import { assignTasks, addTaskNote } from './actions';

type Person = { id: number; name: string; role: string };

const day = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB',
    { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';

/** IST wall clock, formatted from the text rather than re-parsed through Date. */
const clock = (t: string | null) => {
  const m = t?.match(/ (\d{2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
};

const num = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN');
const inr = (v: string | null) => (v == null ? '—' : '₹' + Math.round(Number(v)).toLocaleString('en-IN'));

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** How a deadline reads once it has passed. */
function Due({ row }: { row: TaskRow }) {
  if (row.kind === 'chase_report') {
    if (!row.overdue) return <span className="text-ink-700">Due today</span>;
    const late = Math.abs(row.days_left ?? 0);
    return <span className="font-bold text-danger-500">{late === 0 ? 'Today' : `${late} day${late === 1 ? '' : 's'}`}</span>;
  }
  if (row.overdue) return <span className="font-bold text-danger-500">Overdue</span>;
  if (row.days_left === 0) return <span className="font-semibold text-danger-500">Today</span>;
  if (row.days_left === 1) return <span className="font-semibold text-warn-600">Tomorrow</span>;
  return <span className="text-ink-700">In {row.days_left} days</span>;
}

/** The lab's own record — the reason this queue exists. */
function LabRecord({ row }: { row: TaskRow }) {
  const n = row.lab_orders_all_time;
  return (
    <>
      <span className={`text-xs font-semibold ${n <= 1 ? 'text-danger-500' : n < 5 ? 'text-warn-600' : 'text-success-600'}`}>
        {num(n)} order{n === 1 ? '' : 's'} ever
      </span>
      <span className="block text-[11px] text-ink-400">
        {row.lab_failed > 0
          ? <span className="text-danger-500">{num(row.lab_failed)} failed</span>
          : `${num(row.lab_delivered)} delivered`}
      </span>
    </>
  );
}

/**
 * How to reach the lab. The task is a phone call, so a number is offered as
 * one; an address is all some labs have on file, and saying so beats dressing
 * it up as a number that cannot be dialled.
 */
function Contact({ row, big }: { row: TaskRow; big?: boolean }) {
  const cls = big
    ? 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-600 '
      + 'text-[13px] font-semibold text-brand-700 dark:text-brand-400'
    : 'inline-flex items-center gap-1 text-[12px] text-brand-700 dark:text-brand-400 hover:underline';
  if (row.lab_phone) {
    return (
      <a href={`tel:${row.lab_phone.replace(/[^\d+]/g, '')}`} className={`${cls} num`}>
        <Phone className={big ? 'w-3.5 h-3.5' : 'w-3 h-3'} /> {row.lab_phone}
      </a>
    );
  }
  if (row.lab_email) {
    return (
      <a href={`mailto:${row.lab_email}`} className={cls}>
        <Mail className={big ? 'w-3.5 h-3.5' : 'w-3 h-3'} /> {row.lab_email}
      </a>
    );
  }
  return <span className="text-[11px] text-ink-400">no contact on file</span>;
}

const STATUS_LABEL: Record<string, string> = {
  CREATED: 'Created', PENDING: 'Pending', ORDER_SCHEDULED: 'Scheduled',
  RESCHEDULED: 'Rescheduled', PHLEBO_ASSIGNED: 'Phlebo assigned',
  SAMPLE_COLLECTED: 'Sample collected', SAMPLE_DELIVERED: 'Sample delivered',
  SAMPLE_PROCESSED: 'Sample processed', REPORT_DELIVERED: 'Report delivered',
  KIT_DISPATCHED: 'Kit dispatched',
};

function Status({ s }: { s: string | null }) {
  if (!s) return <span className="text-ink-300">—</span>;
  const collected = s.startsWith('SAMPLE') || s === 'REPORT_DELIVERED';
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap ${
      collected ? 'bg-brand-50 text-brand-700 border-brand-100' : 'bg-ink-100 text-ink-600 border-ink-200'}`}>
      {STATUS_LABEL[s] ?? s.toLowerCase().replace(/_/g, ' ')}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

export function TaskTable({
  kind, rows, people, canAssign, meId,
}: {
  kind: TaskKind;
  rows: TaskRow[];
  people: Person[];
  /** Handing work out is a lead's call; everyone else sees who holds it. */
  canAssign: boolean;
  meId: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkTo, setBulkTo] = useState<string>('');
  const [open, setOpen] = useState<TaskRow | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: number) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const assign = (orderIds: number[], assigneeId: number | null) => {
    setError(null);
    start(async () => {
      const res = await assignTasks({ orderIds, kind, assigneeId });
      if (!res.ok) setError(res.error ?? 'Could not assign');
      else { setSelected(new Set()); setBulkTo(''); router.refresh(); }
    });
  };

  if (rows.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <p className="text-sm text-ink-600 font-medium">Nothing in this queue.</p>
        <p className="text-[12px] text-ink-400 mt-1">
          Rows appear here on their own when the order data says work is due.
        </p>
      </div>
    );
  }

  return (
    <>
      {canAssign && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-2.5 bg-brand-50 border-b border-brand-100">
          <span className="text-xs font-bold text-brand-700 dark:text-brand-400">{selected.size} selected</span>
          <select
            aria-label="Assign the selected orders to"
            value={bulkTo}
            onChange={(e) => setBulkTo(e.target.value)}
            className="h-7 px-2 rounded-md border border-brand-100 bg-surface text-xs text-ink-900"
          >
            <option value="">Assign to…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="none">Unassign</option>
          </select>
          <button
            type="button"
            disabled={!bulkTo || pending}
            onClick={() => assign([...selected], bulkTo === 'none' ? null : Number(bulkTo))}
            className="h-7 px-3 rounded-md bg-brand-600 text-white text-xs font-semibold
                       disabled:opacity-40 hover:bg-brand-700 transition"
          >
            {pending ? 'Assigning…' : 'Assign'}
          </button>
          <button type="button" onClick={() => setSelected(new Set())}
                  className="h-7 px-2 text-xs text-ink-500 hover:text-ink-800">Clear</button>
          {error && <span className="text-xs text-danger-500">{error}</span>}
        </div>
      )}

      <div className="-mx-5 overflow-x-auto">
        <table className="w-full text-sm min-w-[1530px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
              {canAssign && (
                <th className="text-left font-medium pl-5 pr-1 py-2 w-9">
                  <input
                    type="checkbox"
                    aria-label="Select every row in this queue"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.order_id)) : new Set())}
                  />
                </th>
              )}
              <th className={`text-left font-medium py-2 w-[108px] ${canAssign ? 'px-2' : 'pl-5 pr-2'}`}>
                {kind === 'chase_report' ? 'Late by' : kind === 'confirm_pickup' ? 'Time' : 'Deadline'}
              </th>
              <th className="text-left font-medium px-2 py-2 w-[124px]">Order</th>
              <th className="text-left font-medium px-2 py-2 w-[130px]">Store</th>
              <th className="text-left font-medium px-2 py-2 min-w-[146px]">Requester</th>
              {kind === 'needs_lab' ? (
                <>
                  <th className="text-left font-medium px-2 py-2 w-[150px]">Appointment</th>
                  <th className="text-left font-medium px-2 py-2">Where</th>
                  <th className="text-left font-medium px-2 py-2 w-[176px]">Lab</th>
                  <th className="text-left font-medium px-2 py-2 w-[130px]">Labs in range</th>
                  <th className="text-right font-medium px-2 py-2 w-[88px]">Quote</th>
                </>
              ) : (
                <>
                  {kind === 'chase_report' && <th className="text-left font-medium px-2 py-2 w-[140px]">Collected</th>}
                  <th className="text-left font-medium px-2 py-2">Lab</th>
                  <th className="text-left font-medium px-2 py-2 w-[150px]">Contact</th>
                  <th className="text-left font-medium px-2 py-2 w-[136px]">Lab record</th>
                  {kind === 'confirm_pickup' && <th className="text-left font-medium px-2 py-2 w-[140px]">Order status</th>}
                </>
              )}
              <th className="text-left font-medium px-2 pr-5 py-2 w-[168px]">Assigned to</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.order_id}
                  className={`border-b border-ink-100 last:border-0 hover:bg-ink-50 transition-colors
                              ${r.overdue ? 'bg-danger-50/30' : ''}`}>
                {canAssign && (
                  <td className="pl-5 pr-1 py-2.5">
                    <input type="checkbox" aria-label={`Select order ${r.order_id}`}
                           checked={selected.has(r.order_id)} onChange={() => toggle(r.order_id)} />
                  </td>
                )}
                <td className={`py-2.5 whitespace-nowrap ${canAssign ? 'px-2' : 'pl-5 pr-2'}`}>
                  {kind === 'confirm_pickup'
                    ? <><span className="font-semibold text-ink-900">{clock(r.appointment_at)}</span>
                        <span className="block text-[11px] text-ink-400">today</span></>
                    : <Due row={r} />}
                  {kind !== 'confirm_pickup' && (
                    <span className="block text-[11px] text-ink-400">{day(r.due_date)}</span>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  <button type="button" onClick={() => setOpen(r)}
                          className="num font-medium text-ink-900 hover:text-brand-600">
                    #{r.order_id}
                  </button>
                  {r.request_id && (
                    <Link href={`/requests/${r.request_id}`}
                          className="block text-[11px] text-brand-700 dark:text-brand-400 hover:underline">
                      request #{r.request_id}
                    </Link>
                  )}
                </td>
                <td className="px-2 py-2.5 text-xs text-ink-700">
                  <span className="block truncate max-w-[130px]">
                    {r.store_name ?? <span className="text-ink-400">—</span>}
                  </span>
                </td>

                <td className="px-2 py-2.5 text-xs">
                  <span className="block text-ink-800 truncate max-w-[146px]">
                    {r.requester_name ?? <span className="text-ink-400">no name</span>}
                  </span>
                  {r.requester_mobile ? (
                    <a href={`tel:${r.requester_mobile.replace(/[^\d+]/g, '')}`}
                       className="inline-flex items-center gap-1 text-[11px] text-brand-700 dark:text-brand-400 num hover:underline">
                      <Phone className="w-2.5 h-2.5" />{r.requester_mobile}
                    </a>
                  ) : (
                    <span className="block text-[11px] text-ink-400">no number</span>
                  )}
                </td>
                {kind === 'needs_lab' ? (
                  <>
                    <td className="px-2 py-2.5 whitespace-nowrap text-ink-700">
                      {day(r.appointment_date)}
                      <span className="block text-[11px] text-ink-400">{clock(r.appointment_at)}</span>
                    </td>
                    {/* The lab on the row is the placeholder, so its city is
                        not where this order happens. Only the request knows. */}
                    <td className="px-2 py-2.5">
                      {r.request_pincode ? (
                        <>
                          <span className="text-ink-900">{r.request_city ?? '—'}</span>
                          <span className="block text-[11px] text-ink-400 num">{r.request_pincode}</span>
                        </>
                      ) : (
                        <span className="text-[12px] text-ink-400">no request behind it</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-danger-500">
                        <AlertTriangle className="w-3 h-3" /> LabStack Networks
                      </span>
                      <span className="block text-[11px] text-ink-400">the placeholder, not a real lab</span>
                    </td>
                    <td className="px-2 py-2.5">
                      {r.labs_in_range == null ? (
                        <span className="text-[11px] text-ink-400">no pincode</span>
                      ) : r.labs_in_range === 0 ? (
                        <>
                          <span className="text-xs font-bold text-danger-500">None in range</span>
                          <span className="block text-[11px] text-ink-400">onboarding, not allocation</span>
                        </>
                      ) : (
                        <span className={`text-xs font-semibold ${r.labs_in_range === 1 ? 'text-warn-600' : 'text-success-600'}`}>
                          {r.labs_in_range} in range
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right num text-ink-700">{inr(r.quoted_price)}</td>
                  </>
                ) : (
                  <>
                    {kind === 'chase_report' && (
                      <td className="px-2 py-2.5 whitespace-nowrap text-ink-700">
                        {day(r.collected_at)}
                        <span className="block text-[11px] text-ink-400">{clock(r.collected_at)}</span>
                      </td>
                    )}
                    <td className="px-2 py-2.5">
                      <span className="text-ink-900">{r.lab_name ?? '—'}</span>
                      <span className="block text-[11px] text-ink-400">
                        {[r.lab_city, r.lab_pincode].filter(Boolean).join(' ')}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <Contact row={r} />
                    </td>
                    <td className="px-2 py-2.5"><LabRecord row={r} /></td>
                    {kind === 'confirm_pickup' && (
                      <td className="px-2 py-2.5"><Status s={r.order_status} /></td>
                    )}
                  </>
                )}

                <td className="px-2 pr-5 py-2.5">
                  {r.assignee_name ? (
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[9px] font-bold
                                       flex items-center justify-center shrink-0">
                        {initials(r.assignee_name)}
                      </span>
                      <span className={`text-[12px] ${r.assignee_id === meId ? 'font-semibold text-ink-900' : 'text-ink-600'}`}>
                        {r.assignee_id === meId ? 'You' : r.assignee_name}
                      </span>
                    </div>
                  ) : canAssign ? (
                    <select
                      aria-label={`Assign order ${r.order_id}`}
                      defaultValue=""
                      disabled={pending}
                      onChange={(e) => e.target.value && assign([r.order_id], Number(e.target.value))}
                      className="h-7 px-2 rounded-md border border-brand-600 bg-surface text-xs font-semibold
                                 text-brand-700 dark:text-brand-400"
                    >
                      <option value="">Assign to…</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  ) : (
                    <span className="text-[12px] text-ink-400">Unassigned</span>
                  )}
                  {r.note_count > 0 && (
                    <span className="block text-[11px] text-ink-400 mt-0.5">
                      {r.note_count} note{r.note_count === 1 ? '' : 's'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <TaskDrawer
          row={open}
          kind={kind}
          people={people}
          canAssign={canAssign}
          onClose={() => { setOpen(null); router.refresh(); }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The drawer                                                                  */
/* -------------------------------------------------------------------------- */

function TaskDrawer({
  row, kind, people, canAssign, onClose,
}: {
  row: TaskRow; kind: TaskKind; people: Person[]; canAssign: boolean; onClose: () => void;
}) {
  const [notes, setNotes] = useState<TaskNote[] | null>(null);
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/order-tracking/notes?order=${row.order_id}&kind=${kind}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((n) => live && setNotes(n))
      .catch(() => live && setNotes([]));
    return () => { live = false; };
  }, [row.order_id, kind]);

  const submit = () => {
    if (!body.trim()) return;
    start(async () => {
      const res = await addTaskNote({ orderId: row.order_id, kind, body });
      if (res.ok) {
        setBody('');
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
        const fresh = await fetch(`/api/order-tracking/notes?order=${row.order_id}&kind=${kind}`)
          .then((r) => (r.ok ? r.json() : []));
        setNotes(fresh);
      }
    });
  };

  const closesOn = kind === 'needs_lab'
    ? 'a real lab is put on the order'
    : kind === 'confirm_pickup'
      ? 'the order reaches Sample collected'
      : 'the order reaches Report delivered';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink-900/30" onClick={onClose} />
      <aside className="relative w-full max-w-[560px] h-full bg-surface border-l border-ink-200
                        shadow-2xl overflow-y-auto">
        <header className="sticky top-0 bg-surface border-b border-ink-150 px-5 py-3.5 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
                row.overdue ? 'bg-danger-50 text-danger-500 border-danger-100'
                            : 'bg-warn-50 text-warn-600 border-warn-100'}`}>
                {kind === 'needs_lab' ? 'Needs a lab' : kind === 'confirm_pickup' ? 'Pickup today' : 'Report outstanding'}
              </span>
              {row.overdue && <span className="text-[12px] font-bold text-danger-500">Overdue</span>}
            </div>
            <h2 className="text-sm font-semibold text-ink-900 mt-2">
              Order #{row.order_id}
              {row.request_id && <span className="text-ink-400 font-normal"> · request #{row.request_id}</span>}
            </h2>
            <p className="text-[12px] text-ink-500 mt-0.5">
              {[
                `${day(row.appointment_date)}${clock(row.appointment_at) ? `, ${clock(row.appointment_at)}` : ''}`,
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
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-ink-400 mb-2">Lab</h3>
            {row.on_placeholder ? (
              <div className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2.5">
                <p className="text-sm font-medium text-danger-500 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> No lab assigned
                </p>
                <p className="text-[12px] text-ink-600 mt-0.5">
                  The order is on the placeholder lab.
                  {row.labs_in_range === 0
                    ? ' No lab in the network reaches this pincode — this one is an onboarding job.'
                    : row.labs_in_range != null && ` ${row.labs_in_range} lab${row.labs_in_range === 1 ? '' : 's'} in the network reach this pincode.`}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-ink-150 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/lab/${row.lab_id}`}
                        className="text-sm font-medium text-brand-700 dark:text-brand-400 hover:underline">
                    {row.lab_name}
                  </Link>
                  <span className="text-[12px] text-ink-500 num shrink-0">
                    {num(row.lab_delivered)} of {num(row.lab_orders_all_time)} delivered
                    {row.lab_failed > 0 && <span className="text-danger-500"> · {num(row.lab_failed)} failed</span>}
                  </span>
                </div>
                <p className="text-[11px] text-ink-400 mt-0.5">
                  {[row.lab_city, row.lab_pincode].filter(Boolean).join(' ')}
                </p>
                {row.lab_orders_all_time <= 1 && (
                  <p className="text-[12px] text-warn-600 mt-1.5 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> This is one of the first orders this lab has taken.
                  </p>
                )}
                <div className="mt-2.5"><Contact row={row} big /></div>
              </div>
            )}
          </section>

          <section className="border-t border-ink-100 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[11px] uppercase tracking-wide text-ink-400 mb-1.5">Assigned to</h3>
                {row.assignee_name ? (
                  <>
                    <p className="text-sm font-medium text-ink-900">{row.assignee_name}</p>
                    <p className="text-[11px] text-ink-400">
                      {row.assigned_by_name ? `assigned by ${row.assigned_by_name}` : 'assigned'}
                      {row.assigned_at && `, ${day(row.assigned_at)}`}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-ink-500">Nobody yet</p>
                )}
              </div>
              {canAssign && (
                <AssignPicker orderId={row.order_id} kind={kind} people={people}
                              current={row.assignee_id} />
              )}
            </div>
          </section>

          <section className="border-t border-ink-100 pt-4">
            <h3 className="text-[11px] uppercase tracking-wide text-ink-400 mb-2">What happened</h3>
            {notes === null ? (
              <p className="text-[12px] text-ink-400">Loading…</p>
            ) : notes.length === 0 ? (
              <p className="text-[12px] text-ink-400">Nothing recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-lg bg-ink-50 px-3 py-2">
                    <p className="text-[12px] text-ink-900 whitespace-pre-line">{n.body}</p>
                    <p className="text-[11px] text-ink-400 mt-1">
                      {n.author_name ?? 'someone'} · {new Date(n.created_at).toLocaleString('en-IN',
                        { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-2 mt-3">
              <label htmlFor="note" className="sr-only">Add a note</label>
              <input
                id="note" value={body} onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="What did the lab say?"
                className="flex-1 h-9 px-3 rounded-lg border border-ink-200 bg-surface text-sm
                           focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-500"
              />
              <button type="button" onClick={submit} disabled={pending || !body.trim()}
                      className="h-9 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold
                                 disabled:opacity-40 hover:bg-brand-700 transition">
                {saved ? <Check className="w-4 h-4" /> : pending ? 'Saving…' : 'Add'}
              </button>
            </div>
          </section>

          <p className="text-[11px] text-ink-500 border-t border-ink-100 pt-3">
            This task closes on its own when {closesOn}. Nobody ticks it off.
          </p>
        </div>
      </aside>
    </div>
  );
}

function AssignPicker({
  orderId, kind, people, current,
}: { orderId: number; kind: TaskKind; people: Person[]; current: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Assign this task"
      defaultValue={current ?? ''}
      disabled={pending}
      onChange={(e) => start(async () => {
        await assignTasks({
          orderIds: [orderId], kind,
          assigneeId: e.target.value === '' ? null : Number(e.target.value),
        });
        router.refresh();
      })}
      className="h-8 px-2 rounded-lg border border-ink-200 bg-surface text-xs font-semibold text-ink-900"
    >
      <option value="">Unassigned</option>
      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}
