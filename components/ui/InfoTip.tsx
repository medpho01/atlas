'use client';

import { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { HoverPopover } from './HoverPopover';

type Props = {
  /** Short label of the section being explained (popover header). */
  title: string;
  /** One-line summary of what the section shows. */
  shows: ReactNode;
  /** Optional: how the values are computed. Formulas, weights, etc. */
  computed?: ReactNode;
  /** Optional: what action this section drives for the operator. */
  drives?: ReactNode;
  /** Optional: extra notes (caveats, data quality, etc). */
  notes?: ReactNode;
  /** Popover width in px. */
  width?: number;
};

/**
 * Small "i" icon button. On hover, shows a structured popover with three sections:
 * What it shows · How it's computed · Action it drives.
 *
 * Designed to drop into a CardHeader so users can self-discover what every metric means.
 */
export function InfoTip({ title, shows, computed, drives, notes, width = 320 }: Props) {
  return (
    <HoverPopover
      width={width}
      content={
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold text-brand-500 mb-1.5">{title}</div>
          <div className="text-[12px] leading-relaxed text-ink-800">{shows}</div>
          {computed && (
            <div className="mt-2.5 pt-2.5 border-t border-ink-100">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-1">How it's computed</div>
              <div className="text-[11px] leading-relaxed text-ink-700">{computed}</div>
            </div>
          )}
          {drives && (
            <div className="mt-2.5 pt-2.5 border-t border-ink-100">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-1">Action</div>
              <div className="text-[11px] leading-relaxed text-ink-700">{drives}</div>
            </div>
          )}
          {notes && (
            <div className="mt-2.5 pt-2.5 border-t border-ink-100">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-1">Notes</div>
              <div className="text-[11px] leading-relaxed text-ink-500">{notes}</div>
            </div>
          )}
        </div>
      }
    >
      <span
        className="inline-flex w-4 h-4 items-center justify-center rounded-full text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition cursor-help"
        aria-label={`About ${title}`}
      >
        <Info className="w-3 h-3" strokeWidth={2.5} />
      </span>
    </HoverPopover>
  );
}
