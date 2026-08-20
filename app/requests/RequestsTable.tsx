'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Copy, Check } from 'lucide-react';
import {
  STATE_SHORT, STATE_TONE, STATE_OWNER, TONE_CHIP, BASIS_LABEL, BASIS_STRENGTH,
  quoteBlock, type RequestRow, type RequestState,
} from '@/lib/requests';

const inr = (v: string | null) =>
  v == null ? null : '₹' + Math.round(Number(v)).toLocaleString('en-IN');

const day = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : null;

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

export function RequestsTable({ rows }: { rows: RequestRow[] }) {
  const [open, setOpen] = useState<number | null>(null);

  if (!rows.length) {
    return (
      <p className="px-5 py-10 text-sm text-ink-500 text-center">
        Nothing matches these filters. Clear a filter, or include settled requests.
      </p>
    );
  }

  return (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
          <th className="text-left font-medium px-5 py-2">Request</th>
          <th className="text-left font-medium px-2 py-2">Where</th>
          <th className="text-right font-medium px-2 py-2">Asked</th>
          <th className="text-left font-medium px-2 py-2">State</th>
          <th className="text-right font-medium px-2 py-2">Quote</th>
          <th className="text-left font-medium px-2 py-2">Earliest</th>
          <th className="text-left font-medium px-5 py-2 w-20">Console</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isOpen = open === r.request_id;
          const tone = STATE_TONE[r.state] ?? 'ink';
          const owner = STATE_OWNER[r.state];
          return (
            <Fragment key={r.request_id}>
              <tr
                onClick={() => setOpen(isOpen ? null : r.request_id)}
                className="border-b border-ink-100 last:border-0 cursor-pointer hover:bg-ink-100/40"
              >
                <td className="px-5 py-2.5 font-medium text-ink-900 whitespace-nowrap">
                  <ChevronRight
                    className={`inline w-3.5 h-3.5 mr-1 text-ink-400 transition ${isOpen ? 'rotate-90' : ''}`}
                  />
                  #{r.request_id}
                  <span className="block text-[10px] text-ink-400 font-normal ml-4.5">
                    {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    {' · '}{r.status.toLowerCase().replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-ink-700">
                  {r.city ?? <span className="text-ink-400">—</span>}
                  <span className="block text-[10px] text-ink-400">{r.pincode ?? 'no pincode'}</span>
                </td>
                <td className="px-2 py-2.5 text-right text-ink-700">
                  {r.items_resolvable}
                  {r.items_unresolved > 0 && (
                    <span className="text-[10px] text-warn-600"> +{r.items_unresolved}?</span>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${TONE_CHIP[tone]}`}>
                    {STATE_SHORT[r.state] ?? r.state}
                  </span>
                  {owner === 'console' && (
                    <span className="block text-[10px] text-ink-400 mt-0.5">convert in console</span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right whitespace-nowrap">
                  {inr(r.quote_price)
                    ? <span className="font-semibold text-ink-900">{inr(r.quote_price)}</span>
                    : <span className="text-[11px] text-ink-400">—</span>}
                  {r.markup_pct && (
                    <span className="block text-[10px] text-ink-400">+{Number(r.markup_pct)}%</span>
                  )}
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap text-ink-700">
                  {day(r.promised_date) ?? <span className="text-[11px] text-danger-500">escalate</span>}
                </td>
                <td className="px-5 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <CopyQuote row={r} />
                </td>
              </tr>

              {isOpen && (
                <tr className="border-b border-ink-100 bg-ink-100/30">
                  <td colSpan={7} className="px-5 py-3">
                    <p className="text-xs text-ink-700 mb-2">{r.reason}</p>
                    <div className="flex flex-wrap gap-x-8 gap-y-1 text-[11px] text-ink-600 mb-3">
                      <span>Covering labs: <b className="text-ink-900">{r.covering_labs}</b></span>
                      <span>Can do the whole ask: <b className="text-ink-900">{r.full_labs}</b></span>
                      {r.nearest_km && <span>Nearest lab: <b className="text-ink-900">{r.nearest_km} km</b></span>}
                      <span>
                        Price basis:{' '}
                        <b className={BASIS_STRENGTH[r.price_basis] === 'strong' ? 'text-success-600'
                          : BASIS_STRENGTH[r.price_basis] === 'moderate' ? 'text-warn-600' : 'text-danger-500'}>
                          {BASIS_LABEL[r.price_basis] ?? r.price_basis}
                        </b>
                      </span>
                      {!r.src_flag && r.state === 'SERVICEABLE' && (
                        <span className="text-warn-600">
                          Console says not serviceable — Atlas disagrees
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs">
                      <Link href={`/requests/${r.request_id}`} className="text-brand-600 hover:underline">
                        Open the full request →
                      </Link>
                      {r.pincode && (
                        <Link href={`/pincode/${r.pincode}`} className="text-brand-600 hover:underline">
                          Coverage in {r.pincode} →
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
