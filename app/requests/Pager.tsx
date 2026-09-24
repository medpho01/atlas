import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * How to reach the rows that did not fit on this page.
 *
 * `RequestFilters` has carried an `offset` since it was written and the page
 * never set one, so the queue showed the first 150 matches and the rest were
 * not reachable by any route — no pager, no infinite scroll, and a header that
 * said "150 shown of 412" as though that were a complete answer. On the sample
 * data it never bit, because there are 120 requests; on a real book it means a
 * quarter of the queue is invisible to the people working it.
 *
 * Deliberately a link and not a button: every other control on this page is a
 * URL, so a page is bookmarkable and shareable like everything else, and the
 * back button does what it should.
 */
export function Pager({
  page, pageSize, total, shown, hrefForPage,
}: {
  page: number;
  pageSize: number;
  /** Every row matching the filters, not just the ones on this page. */
  total: number;
  /** How many actually rendered, which is less than pageSize on the last page. */
  shown: number;
  hrefForPage: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const first = (page - 1) * pageSize + 1;
  const last = first + shown - 1;
  const prev = page > 1 ? hrefForPage(page - 1) : null;
  const next = page < pages ? hrefForPage(page + 1) : null;

  const arrow = 'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition';
  const on = 'border-ink-200 text-ink-700 hover:bg-ink-100';
  const off = 'border-ink-150 text-ink-300 cursor-not-allowed';

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 pt-3 border-t border-ink-150">
      <span className="text-xs text-ink-500 tabular-nums">
        <b className="text-ink-900">{first.toLocaleString('en-IN')}–{last.toLocaleString('en-IN')}</b>
        {' of '}{total.toLocaleString('en-IN')}
      </span>

      <span className="ml-auto flex items-center gap-2">
        <span className="text-xs text-ink-500 tabular-nums">
          Page {page} of {pages}
        </span>
        {prev
          ? <Link href={prev} rel="prev" className={`${arrow} ${on}`}>
              <ChevronLeft className="w-3.5 h-3.5" />Previous
            </Link>
          : <span aria-disabled className={`${arrow} ${off}`}>
              <ChevronLeft className="w-3.5 h-3.5" />Previous
            </span>}
        {next
          ? <Link href={next} rel="next" className={`${arrow} ${on}`}>
              Next<ChevronRight className="w-3.5 h-3.5" />
            </Link>
          : <span aria-disabled className={`${arrow} ${off}`}>
              Next<ChevronRight className="w-3.5 h-3.5" />
            </span>}
      </span>
    </div>
  );
}
