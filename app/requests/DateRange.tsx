import Link from 'next/link';
import { X } from 'lucide-react';

/**
 * A from/to pair that submits as a GET, carrying every other active filter
 * with it as hidden fields so applying a date range never silently drops the
 * store, stage or sort the user had chosen.
 */
export function DateRange({
  fromName, toName, params,
}: {
  fromName: string;
  toName: string;
  params: Record<string, string | undefined>;
}) {
  const from = params[fromName] ?? '';
  const to = params[toName] ?? '';
  const others = Object.entries(params).filter(
    ([k, v]) => v && k !== fromName && k !== toName,
  );
  const clearHref = (() => {
    const p = new URLSearchParams();
    for (const [k, v] of others) p.set(k, v!);
    const q = p.toString();
    return `/requests${q ? `?${q}` : ''}`;
  })();

  const field =
    'h-[26px] px-2 rounded-md border border-ink-200 bg-surface text-xs text-ink-800 ' +
    'focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-500';

  return (
    <form className="inline-flex items-center gap-1.5">
      {others.map(([k, v]) => <input key={k} type="hidden" name={k} value={v!} />)}
      <input type="date" name={fromName} defaultValue={from} aria-label="From" className={field} />
      <span className="text-[11px] text-ink-400">to</span>
      <input type="date" name={toName} defaultValue={to} aria-label="To" className={field} />
      <button type="submit"
              className="h-[26px] px-2.5 rounded-md border border-ink-200 text-xs font-medium
                         text-ink-700 hover:bg-ink-100 transition">
        Apply
      </button>
      {(from || to) && (
        <Link href={clearHref} className="text-ink-400 hover:text-ink-700" aria-label="Clear dates">
          <X className="w-3.5 h-3.5" />
        </Link>
      )}
    </form>
  );
}
