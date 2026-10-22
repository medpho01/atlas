'use client';

import { useState, useTransition } from 'react';
import { ThumbsUp, ThumbsDown, Loader2 } from 'lucide-react';
import { setProviderInterest } from '@/app/providers/interestActions';

export type Interest = 'interested' | 'not_interested' | null;

/**
 * Two buttons: did they want to work with us, or not.
 *
 * Pressed is a toggle rather than a third button, because "clear" is a rare
 * correction and a third control on every row of a directory of five thousand
 * is three thousand pixels spent on it. Pressing the state a row is already in
 * clears it, and the title says so.
 *
 * The answer is written where it is read — in the row, by the person who has
 * just put the phone down — so it updates optimistically and only rolls back
 * if the server disagrees. A call that takes a second should not make somebody
 * wait before dialling the next number.
 */
export function InterestButton({
  kind, phone, value, canSet, onChange,
}: {
  kind: 'phlebo' | 'nurse';
  phone: string;
  value: Interest;
  canSet: boolean;
  /** So the list can keep its own copy in step without a refetch. */
  onChange?: (next: Interest) => void;
}) {
  const [shown, setShown] = useState<Interest>(value);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const press = (want: Exclude<Interest, null>) => {
    if (!canSet || pending) return;
    const next: Interest = shown === want ? null : want;
    const before = shown;
    setShown(next);
    setErr(null);
    onChange?.(next);
    start(async () => {
      const r = await setProviderInterest({ kind, phone, status: next });
      if (!r.ok) { setShown(before); onChange?.(before); setErr(r.error ?? 'Could not save'); }
    });
  };

  const base = 'inline-flex items-center justify-center w-7 h-7 rounded-md border transition';
  const idle = 'border-ink-200 text-ink-400 hover:text-ink-700 hover:bg-ink-100';

  return (
    <span className="inline-flex items-center gap-1" title={err ?? undefined}>
      <button
        type="button"
        aria-label={shown === 'interested' ? 'Interested — press to clear' : 'Mark interested'}
        aria-pressed={shown === 'interested'}
        title={canSet
          ? (shown === 'interested' ? 'Interested — press again to clear' : 'Mark interested')
          : 'Read-only: needs the network role'}
        disabled={!canSet || pending}
        onClick={() => press('interested')}
        className={`${base} ${shown === 'interested'
          ? 'border-success-600 bg-success-600 text-white'
          : idle} ${canSet ? '' : 'opacity-50 cursor-not-allowed'}`}
      >
        {pending && shown === 'interested'
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <ThumbsUp className="w-3.5 h-3.5" />}
      </button>

      <button
        type="button"
        aria-label={shown === 'not_interested' ? 'Not interested — press to clear' : 'Mark not interested'}
        aria-pressed={shown === 'not_interested'}
        title={canSet
          ? (shown === 'not_interested' ? 'Not interested — press again to clear' : 'Mark not interested')
          : 'Read-only: needs the network role'}
        disabled={!canSet || pending}
        onClick={() => press('not_interested')}
        className={`${base} ${shown === 'not_interested'
          ? 'border-danger-500 bg-danger-500 text-white'
          : idle} ${canSet ? '' : 'opacity-50 cursor-not-allowed'}`}
      >
        {pending && shown === 'not_interested'
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <ThumbsDown className="w-3.5 h-3.5" />}
      </button>

      {err && <span className="text-[10px] text-danger-500 max-w-[120px] leading-tight">{err}</span>}
    </span>
  );
}
