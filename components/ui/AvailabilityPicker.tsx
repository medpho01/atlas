'use client';

import { useState, useTransition } from 'react';
import { setProviderAvailability } from '@/app/providers/interestActions';

export type Slot = 'morning' | 'afternoon' | 'evening';

const SLOTS: { key: Slot; short: string; label: string }[] = [
  { key: 'morning', short: 'M', label: 'Morning' },
  { key: 'afternoon', short: 'A', label: 'Afternoon' },
  { key: 'evening', short: 'E', label: 'Evening' },
];

/**
 * When they can work: morning, afternoon, evening, any combination.
 *
 * One letter each rather than three words, because this sits on every row of a
 * directory of five thousand and the full words would push the actions off the
 * screen. The letters carry a title and an aria-label with the whole word, so
 * nothing is hidden from a screen reader or a hover.
 *
 * Ticking everything off clears the record — "nobody asked" and "available at
 * no time" are different answers, and only the first is true of a person
 * nobody has rung.
 */
export function AvailabilityPicker({
  kind, phone, value, canSet,
}: {
  kind: 'phlebo' | 'nurse';
  phone: string;
  value: Slot[];
  canSet: boolean;
}) {
  const [shown, setShown] = useState<Slot[]>(value);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (s: Slot) => {
    if (!canSet || pending) return;
    const next = shown.includes(s) ? shown.filter((x) => x !== s) : [...shown, s];
    const before = shown;
    setShown(next); setErr(null);
    start(async () => {
      const r = await setProviderAvailability({ kind, phone, slots: next });
      if (!r.ok) { setShown(before); setErr(r.error ?? 'Could not save'); }
    });
  };

  const none = shown.length === 0;

  return (
    <span className="inline-flex flex-col gap-0.5" title={err ?? undefined}>
      <span className="inline-flex gap-0.5">
        {SLOTS.map((s) => {
          const on = shown.includes(s.key);
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={on}
              aria-label={`${s.label}${on ? ' — available, press to clear' : ' — mark available'}`}
              title={canSet
                ? `${s.label}${on ? ' — press again to clear' : ''}`
                : `${s.label}${on ? ' — available' : ''}`}
              disabled={!canSet || pending}
              onClick={() => toggle(s.key)}
              className={`w-6 h-6 rounded text-[10px] font-bold border transition
                ${on
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-ink-200 text-ink-400 hover:text-ink-700 hover:bg-ink-100'}
                ${canSet ? '' : 'opacity-50 cursor-not-allowed'}`}
            >
              {s.short}
            </button>
          );
        })}
      </span>
      {none && (
        <span className="text-[9px] text-ink-400 leading-none">not asked</span>
      )}
      {err && <span className="text-[9px] text-danger-500 leading-tight max-w-[90px]">{err}</span>}
    </span>
  );
}
