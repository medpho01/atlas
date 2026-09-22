'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Copy, Check, ChevronRight, Phone, Download, X, Rows3, Rows4,
} from 'lucide-react';
import {
  STATE_SHORT, STATE_TONE, STATE_OWNER, TONE_CHIP, STAGE_TONE, stageLabel,
  OWNER_LABEL, OWNER_ACTION, OWNER_TONE, slaLevel, slaReason,
  quoteBlock, type RequestRow, type SlaLevel,
} from '@/lib/requests';
import { startNav } from '@/components/ui/NavProgress';

const inr = (v: string | null) =>
  v == null ? null : '₹' + Math.round(Number(v)).toLocaleString('en-IN');

/** "Sat, 20 Sep" — the weekday earns its place on a date somebody has to keep. */
const day = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : null;

/** "20 Sep" — for dates that are a fact rather than an appointment. */
const shortDay = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;

const Blank = () => <span className="text-ink-300">—</span>;

/**
 * The rail down the left of a row, and the colour the age reads in.
 *
 * One scale, used in both places, because they are the same statement: this
 * has been sitting longer than the stage allows. Written out rather than
 * interpolated — Tailwind's scanner never finds a built class name.
 */
const SLA_RAIL: Record<SlaLevel, string> = {
  late: 'border-l-danger-500',
  due: 'border-l-warn-500',
  ok: 'border-l-success-600/40',
  none: 'border-l-transparent',
};

const SLA_TEXT: Record<SlaLevel, string> = {
  late: 'text-danger-500 font-semibold',
  due: 'text-warn-600 font-medium',
  ok: 'text-ink-700',
  none: 'text-ink-500',
};

const OWNER_CHIP: Record<'brand' | 'warn' | 'ink', string> = {
  brand: 'bg-brand-50 text-brand-600 border-brand-100',
  warn: 'bg-warn-50 text-warn-600 border-warn-100',
  ink: 'bg-ink-100 text-ink-500 border-ink-200',
};

/**
 * How long it has sat, against how long that stage is allowed.
 *
 * The number on its own was a fact nobody had an opinion about — twelve days
 * is either fine or a fire depending on which queue you are in, and the reader
 * was left to know which. The tone carries the threshold, so the eye sorts the
 * column before the reader has finished the first row.
 */
function Age({ days, status }: { days: number | null; status: string | null }) {
  if (days == null) return <Blank />;
  const level = slaLevel(status, days);
  // The colour says late; the word said it again, thirty times, on a morning
  // where most of the queue is behind. How many are late is a fact about the
  // queue rather than about any one row, so it is stated once, in the strip
  // above, and the column is left to rank.
  return (
    <span className={SLA_TEXT[level]} title={slaReason(status, days)}>
      {days === 0 ? 'Today' : `${days}d`}
    </span>
  );
}

/**
 * The appointment clock, already in IST as text. Reading it through Date would
 * shift it again by whatever timezone the browser is in.
 */
const appointmentTime = (t: string | null) => {
  const m = t?.match(/ (\d{2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
};

/**
 * The copy button is the whole point of the ops screen: the answer is computed
 * here and recorded in the console, so the handoff has to be one click and the
 * text has to survive a paste into a plain input.
 */
function CopyQuote({ row }: { row: RequestRow }) {
  const [done, setDone] = useState(false);
  const disabled = row.quote_price == null && row.promised_date == null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(quoteBlock(row));
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition
        ${disabled
          ? 'border-ink-200 text-ink-400 cursor-not-allowed'
          : done
            ? 'border-success-100 bg-success-50 text-success-600'
            : 'border-ink-200 text-ink-700 hover:bg-ink-100'}`}
      title={disabled ? 'Nothing to quote — see the reason' : 'Copy price and date for the console'}
    >
      {done ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

/** The columns an export carries, in the order a spreadsheet wants them. */
const CSV_COLUMNS: { header: string; value: (r: RequestRow) => string }[] = [
  { header: 'Request', value: (r) => String(r.request_id) },
  { header: 'Stage', value: (r) => stageLabel(r.status) },
  { header: 'Serviceability', value: (r) => STATE_SHORT[r.state] ?? r.state },
  { header: 'Owner', value: (r) => OWNER_LABEL[STATE_OWNER[r.state]] ?? '' },
  { header: 'Waiting days', value: (r) => (r.waiting_days == null ? '' : String(r.waiting_days)) },
  { header: 'Store', value: (r) => r.store_name ?? '' },
  { header: 'Requester', value: (r) => r.requester_name ?? '' },
  { header: 'Mobile', value: (r) => r.requester_mobile ?? '' },
  { header: 'City', value: (r) => r.city ?? '' },
  { header: 'Pincode', value: (r) => r.pincode ?? '' },
  { header: 'Requested items', value: (r) => (r.packages?.length ? r.packages : r.item_names ?? []).join('; ') },
  { header: 'Covering labs', value: (r) => (r.labs_covering ?? []).join('; ') },
  { header: 'Missing items', value: (r) => r.missing_items ?? '' },
  { header: 'Quote', value: (r) => (r.quote_price == null ? '' : String(Math.round(Number(r.quote_price)))) },
  { header: 'Created', value: (r) => r.created_date ?? '' },
  { header: 'Requested date', value: (r) => r.requested_date ?? '' },
  { header: 'Earliest available', value: (r) => r.committed_date ?? r.promised_date ?? '' },
  { header: 'Order', value: (r) => (r.order_id == null ? '' : String(r.order_id)) },
];

/**
 * Excel opens a .csv by double-click and reads a leading `=`, `+`, `-` or `@`
 * as a formula, so a lab called "-Northwind" arrives as an error cell. Prefix
 * those with an apostrophe and quote everything else the usual way.
 */
function csvCell(v: string): string {
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

function toCsv(rows: RequestRow[]): string {
  const head = CSV_COLUMNS.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(c.value(r))).join(','));
  // A BOM, because the whole point of the export is that somebody opens it in
  // Excel, and without one every lab name with an accent in it arrives broken.
  return '﻿' + [head, ...body].join('\r\n');
}

/**
 * What to do with several requests at once.
 *
 * The queue's unit of work was always one row — one Copy button, one paste
 * into the console — and the queue's unit of arrival is a morning's worth.
 * Thirty-four requests needing a price meant thirty-four round trips between
 * two windows, in an order nobody was tracking. Selecting is the cheap half of
 * the fix: the copy is one block with every request in it, and the export is
 * for the half of this work that happens in a spreadsheet and comes back as a
 * bulk update.
 */
function BulkBar({
  selected, onClear,
}: {
  selected: RequestRow[];
  onClear: () => void;
}) {
  const [copied, setCopied] = useState<'quotes' | 'ids' | null>(null);
  const n = selected.length;
  const quotable = selected.filter((r) => r.quote_price != null || r.promised_date != null);

  const flash = (what: 'quotes' | 'ids') => {
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };

  const copyQuotes = () => {
    navigator.clipboard.writeText(quotable.map(quoteBlock).join('\n\n'));
    flash('quotes');
  };

  const copyIds = () => {
    navigator.clipboard.writeText(selected.map((r) => r.request_id).join(', '));
    flash('ids');
  };

  const download = () => {
    const blob = new Blob([toCsv(selected)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `requests-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    // Revoked on the next tick rather than immediately: Safari has not started
    // reading the blob by the time click() returns, and an early revoke lands
    // as a silent no-download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="sticky bottom-0 z-20 -mx-5 px-5 py-2.5 border-t border-ink-200
                    bg-surface/95 backdrop-blur flex flex-wrap items-center gap-2">
      <span className="text-[13px] font-semibold text-ink-900 tabular-nums">
        {n} selected
      </span>
      <span className="w-px h-4 bg-ink-200" />

      <button
        type="button"
        onClick={copyQuotes}
        disabled={quotable.length === 0}
        title={quotable.length === 0
          ? 'None of these has a price or a date yet — there is nothing to paste.'
          : 'Copy one block per request, ready to paste into the console.'}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition
          ${quotable.length === 0
            ? 'border-ink-200 text-ink-400 cursor-not-allowed'
            : copied === 'quotes'
              ? 'border-success-100 bg-success-50 text-success-600'
              : 'border-ink-200 text-ink-700 hover:bg-ink-100'}`}
      >
        {copied === 'quotes' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied === 'quotes' ? 'Copied' : `Copy ${quotable.length} quote${quotable.length === 1 ? '' : 's'}`}
      </button>

      <button
        type="button"
        onClick={copyIds}
        title="Copy just the request ids, for a console search or a message."
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition
          ${copied === 'ids'
            ? 'border-success-100 bg-success-50 text-success-600'
            : 'border-ink-200 text-ink-700 hover:bg-ink-100'}`}
      >
        {copied === 'ids' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied === 'ids' ? 'Copied' : 'Copy ids'}
      </button>

      <button
        type="button"
        onClick={download}
        title="Download these rows as CSV."
        className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 px-2.5 py-1
                   text-xs font-medium text-ink-700 hover:bg-ink-100 transition"
      >
        <Download className="w-3.5 h-3.5" />
        Export CSV
      </button>

      {/* Said out loud, because a bulk copy that quietly dropped rows is worse
          than one that refused: the person pastes it and believes it covered
          everything they ticked. */}
      {quotable.length < n && (
        <span className="text-[11px] text-ink-500">
          {n - quotable.length} of these {n - quotable.length === 1 ? 'has' : 'have'} no price
          or date yet and {n - quotable.length === 1 ? 'is' : 'are'} left out of the quote block.
        </span>
      )}

      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900"
      >
        <X className="w-3.5 h-3.5" />
        Clear
      </button>
    </div>
  );
}

export function RequestsTable({
  rows, windowLabel, widenHref, emptyQueue, showStage = true, showOrder = true,
}: {
  rows: RequestRow[];
  /** The active arrival window, so an empty result can name what hid the rows. */
  windowLabel?: string;
  /** One click to the same filters over all time. */
  widenHref?: string;
  /** Inside a queue, what an empty one means — which is good news, not a filter problem. */
  emptyQueue?: string;
  /**
   * Inside a queue every row is at the same stage and none has converted, so
   * both columns print the same value thirty times or nothing at all. The tab
   * above is the stage filter; repeating its answer in a column costs the
   * width that the dates and the price need.
   */
  showStage?: boolean;
  showOrder?: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [dense, setDense] = useState(false);

  // Density survives the navigation, because every filter click is a full page
  // load and a preference that resets on each one is not a preference.
  useEffect(() => {
    try {
      setDense(localStorage.getItem('atlas.requests.dense') === '1');
    } catch { /* private mode, or storage switched off — the default is fine. */ }
  }, []);
  const setDensity = (v: boolean) => {
    setDense(v);
    try { localStorage.setItem('atlas.requests.dense', v ? '1' : '0'); } catch { /* as above */ }
  };

  // A selection is only meaningful for rows that are still on screen. Filter
  // it against the current page rather than clearing it, so paging back and
  // forth does not silently throw the selection away.
  const byId = useMemo(() => new Map(rows.map((r) => [r.request_id, r])), [rows]);
  const selected = useMemo(
    () => [...picked].map((id) => byId.get(id)).filter((r): r is RequestRow => !!r),
    [picked, byId],
  );

  const allPicked = rows.length > 0 && selected.length === rows.length;
  const toggleAll = () =>
    setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.request_id)));
  const toggleOne = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // An empty queue is a finished queue. The generic empty state explains which
  // filters might be hiding rows, which inside a queue is both wrong — the
  // window is already off — and the opposite of what happened.
  if (!rows.length && emptyQueue) {
    return (
      <div className="px-5 py-12 text-center">
        <p className="text-sm font-semibold text-ink-900">Nothing here.</p>
        <p className="mt-1 text-sm text-ink-500">{emptyQueue}</p>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="px-5 py-10 text-sm text-ink-500 text-center">
        <p>No requests match these filters.</p>
        {/* The arrival window is applied even when it is not in the URL, so a
            filter that looks like it returned nothing may just be intersecting
            an empty window. Say so, and offer the way out — this read as
            "the filters are broken" otherwise. */}
        {windowLabel && widenHref && (
          <p className="mt-2 text-ink-600">
            The <b>Created</b> filter is set to <b>{windowLabel}</b> and applies on top of
            everything else.{' '}
            <Link href={widenHref} className="text-brand-600 hover:underline">
              Search all time instead →
            </Link>
          </p>
        )}
        <p className="mt-2 text-[11px] text-ink-400">
          Ordered, discharged, cancelled, denied and wrong-number requests are hidden by
          default. Use “Include ordered &amp; closed” to show them.
        </p>
      </div>
    );
  }

  // Padding alone barely moved the row: most of its height is the two and
  // three line cells inside it, so compact tightens the leading as well. Same
  // information either way — a density control that hides columns is a column
  // chooser wearing the wrong label.
  const pad = dense ? 'py-1 leading-[1.15]' : 'py-2.5';
  // Wide enough for the columns actually on screen, and no wider. The full
  // surface still scrolls; a queue no longer has to.
  const minWidth = showStage && showOrder ? 'min-w-[1720px]' : 'min-w-[1270px]';

  return (
    <>
      {/* The density control sits with the table rather than in the filter bar:
          it changes how this list reads, not which rows are in it, and a filter
          bar that mixes the two teaches people that every control costs a page
          load. This one costs nothing. */}
      <div className="flex items-center justify-end gap-1 px-5 pb-1.5">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Rows</span>
        {([[false, 'Comfortable', Rows3], [true, 'Compact', Rows4]] as const).map(([v, label, Icon]) => (
          <button
            key={label}
            type="button"
            onClick={() => setDensity(v)}
            title={label}
            aria-pressed={dense === v}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition
              ${dense === v
                ? 'border-ink-300 bg-ink-100 text-ink-900'
                : 'border-ink-200 text-ink-500 hover:bg-ink-100'}`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* The columns have real minimum widths, so at anything under a wide
          desktop the table is wider than the card. Without a scroll container
          it simply drew over the card's edge — the rounded corner clipped the
          last column and there was no way to reach it. */}
      <div className="overflow-x-auto">
      <table className={`w-full text-sm tabular-nums ${minWidth}`}>
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
            <th className="w-9 pl-5 pr-0 py-2">
              <input
                type="checkbox"
                checked={allPicked}
                onChange={toggleAll}
                aria-label={allPicked ? 'Clear selection' : 'Select every row shown'}
                title={allPicked ? 'Clear selection' : 'Select every row shown'}
                className="align-middle accent-brand-600 cursor-pointer"
              />
            </th>
            <th className="text-left font-medium px-2 py-2 w-[104px]">Request</th>
            {/* The sort key, and until now the column that fell off the right
                edge: the queue opens sorted by longest wait and the number it
                was sorted by was the one you had to scroll to see. */}
            <th className="text-left font-medium px-2 py-2 w-[88px]">Age</th>
            <th className="text-left font-medium px-2 py-2 min-w-[176px]">Store &amp; requester</th>
            {showStage && <th className="text-left font-medium px-2 py-2 w-[120px]">Request status</th>}
            <th className="text-left font-medium px-2 py-2 w-[132px]">Location</th>
            <th className="text-left font-medium px-2 py-2 min-w-[196px]">Requested items</th>
            <th className="text-left font-medium px-2 py-2 w-[148px]">Serviceability</th>
            <th className="text-left font-medium px-2 py-2 min-w-[190px]">Covering labs</th>
            <th className="text-right font-medium px-2 py-2 w-[92px]">Quote</th>
            {/* Asked for and offered, in one cell. They are only ever read
                against each other — the question is whether we can do the day
                they wanted — and two columns put a lab name between them. */}
            <th className="text-left font-medium px-2 py-2 w-[150px]">Wanted → offered</th>
            {showOrder && <th className="text-left font-medium px-2 py-2 min-w-[150px]">Order</th>}
            {/* Pinned, because it is the action. Scrolling sideways to reach
                the Copy button would make the one thing this page exists for
                the hardest thing on it. */}
            <th className="text-left font-medium px-5 py-2 w-20 sticky right-0 bg-surface
                           border-l border-ink-150">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const tone = STATE_TONE[r.state] ?? 'ink';
            const owner = STATE_OWNER[r.state];
            const items = r.item_names ?? [];
            const ready = r.labs_ready ?? [];
            const covering = r.labs_covering ?? [];
            const level = slaLevel(r.status, r.waiting_days);
            const isPicked = picked.has(r.request_id);
            return (
                <tr
                  key={r.request_id}
                  onClick={() => { startNav(); router.push(`/requests/${r.request_id}`); }}
                  className={`group border-b border-ink-100 last:border-0 cursor-pointer align-top
                              transition-colors ${isPicked ? 'bg-brand-50/60' : 'hover:bg-ink-100/40'}`}
                >
                  {/* The rail carries the deadline. It is the only thing on the
                      row that can be read without reading anything — which is
                      what a list of thirty needs before it needs detail. */}
                  <td className={`w-9 pl-5 pr-0 ${pad} border-l-[3px] ${SLA_RAIL[level]}`}
                      onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isPicked}
                      onChange={() => toggleOne(r.request_id)}
                      aria-label={`Select request ${r.request_id}`}
                      className="align-middle accent-brand-600 cursor-pointer"
                    />
                  </td>
                  <td className={`px-2 ${pad} font-medium text-ink-900 whitespace-nowrap`}>
                    <ChevronRight className="inline w-3.5 h-3.5 mr-1 text-ink-400" />
                    #{r.request_id}
                    {/* Arrival, under the id. It was its own column for a date
                        nobody sorts by and everybody wants beside the age. */}
                    <span className="block text-[10px] text-ink-400 pl-[18px]">
                      {shortDay(r.created_date ?? r.created_at) ?? '—'}
                    </span>
                  </td>
                  <td className={`px-2 ${pad} whitespace-nowrap`}>
                    <Age days={r.waiting_days} status={r.status} />
                  </td>
                  {/* Whose account it is and who to ring, in one cell. They are
                      one question — who is waiting on this — and they were two
                      columns because they came from two tables. */}
                  <td className={`px-2 ${pad} text-xs`} onClick={(e) => e.stopPropagation()}>
                    <span className="block text-ink-700 truncate max-w-[176px]">
                      {r.store_name ?? <span className="text-ink-400">—</span>}
                    </span>
                    <span className="block text-ink-800 truncate max-w-[176px]">
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
                  {/* The console's stage, beside Atlas's verdict. A request can
                      be Quoted here and a supply gap there — that pairing is the
                      whole point of the network bucket. */}
                  {showStage && (
                    <td className={`px-2 ${pad} whitespace-nowrap`}>
                      <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px]
                                        ${TONE_CHIP[STAGE_TONE[r.status] ?? 'ink']}`}>
                        {stageLabel(r.status)}
                      </span>
                    </td>
                  )}
                  <td className={`px-2 ${pad} text-ink-700`}>
                    {r.city ?? <span className="text-ink-400">—</span>}
                    <span className="block text-[10px] text-ink-400">
                      {r.pincode ?? 'no pincode'}
                      {r.nearest_km && <> · lab {r.nearest_km} km</>}
                    </span>
                  </td>
                  {/* The package, where the request is a package. Listing its
                      component tests said less in more words — "LS SF Onboarding
                      Package" is the thing the store ordered and the thing a lab
                      quotes against. Individual tests only show when there is no
                      package to name. */}
                  <td className={`px-2 ${pad} text-xs`}>
                    {(() => {
                      const packages = r.packages ?? [];
                      const shown = packages.length > 0 ? packages : items;
                      if (shown.length === 0) return <span className="text-ink-400">Not identified</span>;
                      return (
                        <>
                          <span className="text-ink-800">{shown.slice(0, 2).join(', ')}</span>
                          {shown.length > 2 && (
                            <span className="text-ink-400"> +{shown.length - 2} more</span>
                          )}
                          {packages.length > 0 && (r.tests?.length ?? 0) > 0 && (
                            <span className="block text-[10px] text-ink-400">
                              + {r.tests!.length} individual test{r.tests!.length === 1 ? '' : 's'}
                            </span>
                          )}
                          {(r.unnamed ?? 0) > 0 && (
                            <span className="block text-[10px] text-warn-600">
                              {r.unnamed} not in catalogue
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </td>
                  <td className={`px-2 ${pad} whitespace-nowrap`}>
                    <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${TONE_CHIP[tone]}`}>
                      {STATE_SHORT[r.state] ?? r.state}
                    </span>
                    {/* Who has to act, which the state model has always known
                        and the row has never said. "Convert in console" was the
                        same sentence printed on every serviceable row; the
                        three states that are not ops' work said nothing at all. */}
                    {owner && (
                      <span
                        className={`block w-fit mt-0.5 rounded border px-1 py-px text-[10px] ${OWNER_CHIP[OWNER_TONE[owner]]}`}
                        title={OWNER_ACTION[owner]}
                      >
                        {OWNER_LABEL[owner]}
                      </span>
                    )}
                  </td>
                  {/* Who can serve it and what they lack — the negotiation, in the row. */}
                  <td className={`px-2 ${pad} text-xs`}>
                    {ready.length > 0 ? (
                      <span className="text-success-600">{ready.slice(0, 2).join(', ')}</span>
                    ) : covering.length > 0 ? (
                      <>
                        <span className="text-ink-700">{covering.slice(0, 2).join(', ')}</span>
                        {r.missing_items && (
                          <span className="block text-[10px] text-warn-600">
                            Missing: {r.missing_items.length > 60
                              ? r.missing_items.slice(0, 60) + '…'
                              : r.missing_items}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-danger-500">No covering lab</span>
                    )}
                    {covering.length > 2 && (
                      <span className="text-[10px] text-ink-400"> +{r.covering_labs - 2} more</span>
                    )}
                  </td>
                  <td className={`px-2 ${pad} text-right whitespace-nowrap`}>
                    {inr(r.quote_price)
                      ? <span className="font-semibold text-ink-900">{inr(r.quote_price)}</span>
                      : <span className="text-[11px] text-ink-400">—</span>}
                    {r.quote_price && r.markup_pct && (
                      <span className="block text-[10px] text-ink-400">+{Number(r.markup_pct)}%</span>
                    )}
                  </td>
                  {/* The date they asked for and the date we can do, stacked so
                      the comparison is vertical and costs no eye movement. */}
                  <td className={`px-2 ${pad} whitespace-nowrap text-xs`}>
                    <span className="block text-ink-500">
                      {day(r.requested_date) ?? <Blank />}
                    </span>
                    <span className="block text-ink-800">
                      {day(r.committed_date ?? r.promised_date)
                        ?? <span className="text-danger-500">Not available</span>}
                      {/* What was actually promised, where it differs from what
                          Atlas would offer today. A commitment is a date somebody
                          has already been given. */}
                      {r.committed_date && r.committed_date !== r.promised_date && (
                        <span className="ml-1 text-[10px] text-ink-400">committed</span>
                      )}
                    </span>
                  </td>
                  {/* Converted, and what happened next. Until now the queue could
                      say a request became an order but not which one, who is
                      serving it, or when — so every follow-up meant opening the
                      console to find out. */}
                  {showOrder && (
                    <td className={`px-2 ${pad} text-xs`}>
                      {r.order_id ? (
                        <>
                          <span className="text-ink-900 font-medium">#{r.order_id}</span>
                          {r.order_appointment && (
                            <span className="block text-[10px] text-ink-600">
                              {day(r.order_appointment.slice(0, 10))}
                              {appointmentTime(r.order_appointment) && (
                                <span className="text-ink-400"> · {appointmentTime(r.order_appointment)}</span>
                              )}
                            </span>
                          )}
                          <span className="block text-[10px] text-ink-500 truncate max-w-[150px]">
                            {r.order_lab_name ?? <span className="text-danger-500">No lab assigned</span>}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </td>
                  )}
                  <td className={`px-5 ${pad} sticky right-0 bg-surface group-hover:bg-ink-100
                                 border-l border-ink-150`}
                      onClick={(e) => e.stopPropagation()}>
                    <CopyQuote row={r} />
                  </td>
                </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {selected.length > 0 && (
        <BulkBar selected={selected} onClear={() => setPicked(new Set())} />
      )}
    </>
  );
}
