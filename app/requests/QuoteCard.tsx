'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { quoteBlock, type RequestRow } from '@/lib/requests';

const inr = (v: string | null) =>
  v == null ? null : '₹' + Math.round(Number(v)).toLocaleString('en-IN');

/**
 * The answer, and the one action on the page.
 *
 * Deliberately a single price and a single date with no alternatives: this is
 * read by someone converting a request under time pressure, and a comparison
 * table would move the decision back onto them. Options belong to the network
 * team's screen.
 */
export function QuoteCard({ row }: { row: RequestRow }) {
  const [done, setDone] = useState(false);
  const price = inr(row.quote_price);
  const date = row.promised_date
    ? new Date(row.promised_date).toLocaleDateString('en-IN',
        { weekday: 'long', day: 'numeric', month: 'short' })
    : null;

  if (row.state === 'SERVICEABLE') {
    return (
      <Card>
        <CardBody>
          <div className="text-sm font-semibold text-success-600 mb-1">Serviceable</div>
          <p className="text-xs text-ink-600">
            A covering lab already offers everything asked for. Convert it to an order in the
            console — there is nothing to quote and nothing for the network team to do.
          </p>
        </CardBody>
      </Card>
    );
  }

  if (!price && !date) {
    return (
      <Card>
        <CardBody>
          <div className="text-sm font-semibold text-danger-500 mb-1">No basis — escalate</div>
          <p className="text-xs text-ink-600">{row.reason}</p>
          <p className="text-xs text-ink-500 mt-2">
            Atlas will not invent a number here. Quoting without a basis is what turns a
            serviceability problem into a broken promise.
          </p>
        </CardBody>
      </Card>
    );
  }

  // A price with no date is not a quote — it is half a quote. The card still
  // shows the number, because the network team needs it, but it stops
  // presenting "send this" as the obvious next action.
  const sendable = Boolean(price && date);

  return (
    <Card>
      <CardBody>
        <div className="text-[11px] uppercase tracking-wide text-ink-400 mb-2">Quote this</div>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-3xl font-bold text-ink-900 num">{price ?? '—'}</span>
          {row.markup_pct && (
            <span className="text-xs text-ink-400">incl. +{Number(row.markup_pct)}%</span>
          )}
        </div>
        <div className="text-sm text-ink-700 mb-3">
          Earliest date{' '}
          {date
            ? <b className="text-ink-900">{date}</b>
            : <b className="text-danger-500">not promised — escalate</b>}
        </div>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(quoteBlock(row));
            setDone(true);
            setTimeout(() => setDone(false), 1800);
          }}
          className={`w-full inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2
            text-xs font-medium transition
            ${done
              ? 'border-success-100 bg-success-50 text-success-600 dark:text-success-700'
              : sendable
                ? 'border-brand-200 dark:border-brand-100 bg-brand-50 text-brand-700 dark:text-brand-400 hover:bg-brand-100'
                // No date to send: a plain button, not the page's main call to
                // action. Copying is still allowed — the number is real — but
                // it should not look like the thing to do next.
                : 'border-ink-200 bg-surface text-ink-600 hover:bg-ink-100'}`}
        >
          {done ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {done ? 'Copied for the console' : sendable ? 'Copy price and date' : 'Copy price only'}
        </button>
        {/* 11px / ink-500, not 10px / ink-400. The smaller pairing measured
            around 3:1 against the card, which is below legible for text this
            size — and this paragraph is the only place the console step is
            explained. */}
        <p className="text-[11px] leading-snug text-ink-500 mt-2">
          {sendable
            ? 'Paste into the LabStack console and mark the request quoted. Once the store accepts, this appears in the Network bucket with a clock on it.'
            : 'No date can be promised for this pincode, so this is not ready to send. Escalate it to the network team, or search for a lab below first.'}
        </p>
      </CardBody>
    </Card>
  );
}
