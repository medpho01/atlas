'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { startNav } from '@/components/ui/NavProgress';

/**
 * Find supply near a pincode, used by both reference screens.
 *
 * Typing a pincode into the ordinary search box matches it literally, which
 * almost never finds anything useful: a request in 110016 is served by a lab
 * in 110017. This measures instead — enter the request's pincode, get what is
 * within the radius, nearest first.
 *
 * The radius buttons only appear once a pincode is applied, because they mean
 * nothing on their own and an unexplained row of numbers is worse than no row.
 */
export function NearPincode({
  basePath, initial, radius, choices, defaultRadius,
}: {
  basePath: string;
  initial?: string;
  radius?: number;
  choices: number[];
  defaultRadius: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pin, setPin] = useState(initial ?? '');

  const valid = /^\d{6}$/.test(pin.trim());
  const active = !!initial;
  const current = radius ?? defaultRadius;

  const go = (nextPin: string, nextRadius?: number) => {
    const next = new URLSearchParams(params.toString());
    if (/^\d{6}$/.test(nextPin.trim())) {
      next.set('near', nextPin.trim());
      next.set('radius', String(nextRadius ?? current));
    } else {
      next.delete('near');
      next.delete('radius');
    }
    next.delete('page');
    startNav();
    const qs = next.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ''}`);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <form
        onSubmit={(e) => { e.preventDefault(); if (valid) go(pin); }}
        className="relative w-[190px]"
      >
        <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400" />
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="Near pincode"
          inputMode="numeric"
          aria-label="Find centres near a pincode"
          className="w-full pl-8 pr-7 py-1.5 text-[13px] rounded-lg border border-ink-200
                     bg-surface placeholder:text-ink-400 focus:outline-none
                     focus:ring-2 focus:ring-brand-200 focus:border-brand-300"
        />
        {pin && (
          <button
            type="button"
            onClick={() => { setPin(''); go(''); }}
            aria-label="Clear pincode"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </form>

      {active && (
        <div className="inline-flex items-center gap-1">
          <span className="text-[11px] text-ink-500 mr-0.5">within</span>
          {choices.map((km) => (
            <button
              key={km}
              type="button"
              onClick={() => go(initial!, km)}
              className={`px-2 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                current === km
                  ? 'bg-brand-50 border-brand-300 text-brand-700'
                  : 'bg-surface border-ink-200 text-ink-500 hover:text-ink-800'
              }`}
            >
              {km} km
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
