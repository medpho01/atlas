import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * How to reach the rows that did not fit on this page.
 *
 * Deliberately links and not buttons: every other control on these screens is
 * a URL, so a page stays bookmarkable and shareable like everything else, the
 * back button does what it should, and a server component can render it
 * without shipping any JavaScript to do it.
 *
 * Renders nothing when everything fits, so a caller can place it
 * unconditionally and not end up with a lone "Page 1 of 1" under a short list.
 */
export function Pager({
  page, pageSize, total, shown, hrefForPage, unit = 'rows',
}: {
  page: number;
  pageSize: number;
  /** Everything matching the filters, not just what is on this page. */
  total: number;
  /** How many actually rendered — fewer than pageSize on the last page. */
  shown: number;
  hrefForPage: (page: number) => string;
  /** What is being counted, for the screen-reader label. */
  unit?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const first = (page - 1) * pageSize + 1;
  const last = first + shown - 1;
  const prev = page > 1 ? hrefForPage(page - 1) : null;
  const next = page < pages ? hrefForPage(page + 1) : null;

  const base = 'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition';
  const on = 'border-ink-200 text-ink-700 hover:bg-ink-100';
  const off = 'border-ink-150 text-ink-300 cursor-not-allowed';

  return (
    <nav
      aria-label={`${unit} pagination`}
      className="flex flex-wrap items-center gap-3 px-5 pt-3 border-t border-ink-150"
    >
      <span className="text-xs text-ink-500 tabular-nums">
        <b className="text-ink-900">{first.toLocaleString('en-IN')}–{last.toLocaleString('en-IN')}</b>
        {' of '}{total.toLocaleString('en-IN')} {unit}
      </span>

      <span className="ml-auto flex items-center gap-2">
        <span className="text-xs text-ink-500 tabular-nums">Page {page} of {pages}</span>
        {prev
          ? <Link href={prev} rel="prev" className={`${base} ${on}`}>
              <ChevronLeft className="w-3.5 h-3.5" />Previous
            </Link>
          : <span aria-disabled className={`${base} ${off}`}>
              <ChevronLeft className="w-3.5 h-3.5" />Previous
            </span>}
        {next
          ? <Link href={next} rel="next" className={`${base} ${on}`}>
              Next<ChevronRight className="w-3.5 h-3.5" />
            </Link>
          : <span aria-disabled className={`${base} ${off}`}>
              Next<ChevronRight className="w-3.5 h-3.5" />
            </span>}
      </span>
    </nav>
  );
}
