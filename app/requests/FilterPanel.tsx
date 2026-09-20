'use client';

import { useState, type ReactNode } from 'react';
import { SlidersHorizontal, ChevronDown } from 'lucide-react';

/**
 * Four rows of filters, and the rest behind a disclosure.
 *
 * The panel had grown to ten rows. Every one of them earns its place for
 * somebody, but all of them at once is a wall — and the three that get used
 * every day were buried among the seven that get used occasionally. The four
 * that stay out are the ones that answer "which of these should I be looking
 * at": when it arrived, where it is in the pipeline, whose account it is, and
 * what order to read it in.
 *
 * It opens by itself when something inside it is on, because a filter you
 * cannot see is a filter you will forget you set, and the count on the button
 * says how many.
 */
export function FilterPanel({
  primary, more, activeCount,
}: {
  primary: ReactNode;
  more: ReactNode;
  activeCount: number;
}) {
  const [open, setOpen] = useState(activeCount > 0);

  return (
    <div className="mb-4 rounded-lg border border-ink-200 bg-surface divide-y divide-ink-100">
      {primary}

      <div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-ink-50 transition-colors"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-ink-400" />
          <span className="text-[12px] font-medium text-ink-700">
            {open ? 'Fewer filters' : 'More filters'}
          </span>
          {activeCount > 0 && (
            <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-brand-600 text-white tabular-nums">
              {activeCount} on
            </span>
          )}
          {!open && activeCount === 0 && (
            <span className="text-[11px] text-ink-400">
              serviceability, dates, order status, closed stages
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-ink-400 ml-auto transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {open && <div className="divide-y divide-ink-100">{more}</div>}
    </div>
  );
}
