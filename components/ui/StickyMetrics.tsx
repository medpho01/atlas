'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/** The app header's height, which is what the row parks under. */
const HEADER_HEIGHT = 56;

/**
 * Keeps a page's headline figures on screen once you scroll past them.
 *
 * Scrolling a dashboard to read the table underneath used to take the numbers
 * with it, so the thing you were comparing against was gone by the time you
 * had something to compare. The row stays, and shrinks to a single line of
 * label-and-figure while it is stuck — same tiles, same DOM, less of them.
 *
 * The compaction is CSS on [data-stuck='true'] (see globals.css) rather than a
 * second set of elements, so there is nothing to keep in sync: a figure can
 * never read one thing in the row and another in the strip.
 *
 * "Is this element stuck" is not a question CSS can answer, so the row's own
 * position is measured against the header — the same measurement whether the
 * scroll handler or the observer asks for it.
 */
export function StickyMetrics({
  children,
  /** Shown in the compact strip, so the numbers keep their page. */
  title,
  className = '',
}: {
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = row.current;
      if (!el) return;
      // Within a pixel of its parking spot under the app header.
      setStuck(el.getBoundingClientRect().top <= HEADER_HEIGHT + 1);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);

    // Belt and braces. An observer is the cheaper watcher and the usual one
    // for this, but both it and rAF get throttled in enough situations —
    // background tabs, embedded views, reduced-motion engines — that having
    // one wake the other is worth eight lines. Both end in the same measure,
    // so they cannot disagree about whether the row is stuck.
    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined' && row.current) {
      io = new IntersectionObserver(measure, {
        rootMargin: `-${HEADER_HEIGHT + 1}px 0px 0px 0px`,
        threshold: [0, 1],
      });
      io.observe(row.current);
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      io?.disconnect();
    };
  }, []);

  return (
    <div
      ref={row}
      data-stuck={stuck}
      className={`sticky top-14 z-20 -mx-6 px-6 lg:-mx-8 lg:px-8 py-3 transition-shadow
        data-[stuck=true]:bg-ink-50/95 data-[stuck=true]:backdrop-blur-sm
        data-[stuck=true]:border-b data-[stuck=true]:border-ink-150
        data-[stuck=true]:shadow-sm ${className}`}
    >
      {stuck && title && (
        <div className="text-[11px] uppercase tracking-wider text-ink-400 font-semibold mb-1.5">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
