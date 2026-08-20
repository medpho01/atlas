'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Check, ChevronRight } from 'lucide-react';
import {
  STATE_SHORT, STATE_TONE, STATE_OWNER, TONE_CHIP,
  quoteBlock, type RequestRow,
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
  const router = useRouter();

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
          <th className="text-left font-medium px-2 py-2">Store</th>
          <th className="text-left font-medium px-2 py-2">Where</th>
          <th className="text-left font-medium px-2 py-2 min-w-[220px]">Asked for</th>
          <th className="text-left font-medium px-2 py-2 w-[120px]">State</th>
          <th className="text-left font-medium px-2 py-2 min-w-[200px]">Labs / what&apos;s missing</th>
          <th className="text-right font-medium px-2 py-2">Quote</th>
          <th className="text-left font-medium px-2 py-2">Earliest</th>
          <th className="text-left font-medium px-5 py-2 w-20">Console</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const tone = STATE_TONE[r.state] ?? 'ink';
          const owner = STATE_OWNER[r.state];
          const items = r.item_names ?? [];
          const ready = r.labs_ready ?? [];
          const covering = r.labs_covering ?? [];
          return (
              <tr
                key={r.request_id}
                onClick={() => router.push(`/requests/${r.request_id}`)}
                className="border-b border-ink-100 last:border-0 cursor-pointer hover:bg-ink-100/40 align-top"
              >
                <td className="px-5 py-2.5 font-medium text-ink-900 whitespace-nowrap">
                  <ChevronRight className="inline w-3.5 h-3.5 mr-1 text-ink-400" />
                  #{r.request_id}
                  <span className="block text-[10px] text-ink-400 font-normal ml-4.5">
                    {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    {' · '}{r.status.toLowerCase().replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-ink-700 text-xs">
                  {r.store_name ?? <span className="text-ink-400">—</span>}
                </td>
                <td className="px-2 py-2.5 text-ink-700">
                  {r.city ?? <span className="text-ink-400">—</span>}
                  <span className="block text-[10px] text-ink-400">
                    {r.pincode ?? 'no pincode'}
                    {r.nearest_km && <> · lab {r.nearest_km} km</>}
                  </span>
                </td>
                {/* The ask, spelled out. "1 item" told nobody anything. */}
                <td className="px-2 py-2.5 text-xs">
                  {items.length === 0 ? (
                    <span className="text-ink-400">nothing identifiable</span>
                  ) : (
                    <>
                      <span className="text-ink-800">{items.slice(0, 2).join(', ')}</span>
                      {items.length > 2 && (
                        <span className="text-ink-400"> +{items.length - 2} more</span>
                      )}
                      {(r.unnamed ?? 0) > 0 && (
                        <span className="block text-[10px] text-warn-600">
                          {r.unnamed} not in catalogue
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap">
                  <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${TONE_CHIP[tone]}`}>
                    {STATE_SHORT[r.state] ?? r.state}
                  </span>
                  {/* One sub-label at most. Stacking "convert in console" over
                      "console disagrees" doubled every serviceable row's
                      height for a note that repeats on thousands of rows. */}
                  {!r.src_flag && r.state === 'SERVICEABLE' ? (
                    <span className="block text-[10px] text-warn-600 mt-0.5">console disagrees</span>
                  ) : owner === 'console' ? (
                    <span className="block text-[10px] text-ink-400 mt-0.5">convert in console</span>
                  ) : null}
                </td>
                {/* Who can serve it and what they lack — the negotiation, in the row. */}
                <td className="px-2 py-2.5 text-xs">
                  {ready.length > 0 ? (
                    <span className="text-success-600">{ready.slice(0, 2).join(', ')}</span>
                  ) : covering.length > 0 ? (
                    <>
                      <span className="text-ink-700">{covering.slice(0, 2).join(', ')}</span>
                      {r.missing_items && (
                        <span className="block text-[10px] text-warn-600">
                          missing: {r.missing_items.length > 60
                            ? r.missing_items.slice(0, 60) + '…'
                            : r.missing_items}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-danger-500">no lab covers this pincode</span>
                  )}
                  {covering.length > 2 && (
                    <span className="text-[10px] text-ink-400"> +{r.covering_labs - 2} more</span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right whitespace-nowrap">
                  {inr(r.quote_price)
                    ? <span className="font-semibold text-ink-900">{inr(r.quote_price)}</span>
                    : <span className="text-[11px] text-ink-400">—</span>}
                  {r.quote_price && r.markup_pct && (
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
          );
        })}
      </tbody>
    </table>
  );
}
