import { ReactNode } from 'react';
import Link from 'next/link';
import { Search, Filter, X } from 'lucide-react';

/**
 * Standardized filter bar used across data pages.
 * All controls are h-9 (36px) so they share a baseline regardless of border/icon variants.
 */
export function FilterBar({
  searchName = 'q',
  searchPlaceholder = 'Search…',
  searchDefault,
  hidden,
  children,
  applyLabel = 'Apply',
  clearHref,
  meta,
}: {
  searchName?: string;
  searchPlaceholder?: string;
  searchDefault?: string;
  hidden?: Record<string, string>;
  children?: ReactNode;
  applyLabel?: string;
  clearHref?: string;
  meta?: ReactNode;
}) {
  return (
    <form className="flex items-center gap-2 flex-wrap bg-surface rounded-xl border border-ink-150 shadow-card px-4 py-2.5">
      <div className="relative flex-1 min-w-[240px] max-w-xl">
        <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          name={searchName}
          defaultValue={searchDefault ?? ''}
          placeholder={searchPlaceholder}
          className="w-full h-9 pl-9 pr-3 rounded-lg border border-ink-200 bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-500 transition"
        />
      </div>
      {children}
      {hidden &&
        Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
      <button
        type="submit"
        className="h-9 inline-flex items-center gap-1.5 px-3.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition shrink-0"
      >
        <Filter className="w-3.5 h-3.5" strokeWidth={2.5} /> {applyLabel}
      </button>
      {clearHref && (
        <Link
          href={clearHref}
          className="h-9 inline-flex items-center gap-1 px-2 text-[12px] text-ink-500 hover:text-ink-800 font-medium shrink-0"
        >
          <X className="w-3 h-3" /> Clear
        </Link>
      )}
      {meta && <div className="ml-auto text-[11px] text-ink-400 tabular-nums shrink-0 pr-1">{meta}</div>}
    </form>
  );
}

/** A text input sized to match the FilterBar (h-9). */
export function FilterInput({
  name,
  defaultValue,
  placeholder,
  width = 'w-44',
}: {
  name: string;
  defaultValue?: string;
  placeholder: string;
  width?: string;
}) {
  return (
    <input
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      className={`h-9 px-3 rounded-lg border border-ink-200 bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-500 transition shrink-0 ${width}`}
    />
  );
}

/** A select sized to match the FilterBar (h-9). */
export function FilterSelect({
  name,
  defaultValue,
  children,
  width = '',
}: {
  name: string;
  defaultValue?: string;
  children: ReactNode;
  width?: string;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className={`h-9 px-2.5 rounded-lg border border-ink-200 bg-surface text-sm font-medium text-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-500 transition shrink-0 ${width}`}
    >
      {children}
    </select>
  );
}
