'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, X } from 'lucide-react';
import { startNav } from '@/components/ui/NavProgress';

/** The same filters, with the search dropped. */
function clearHref(hidden: Record<string, string>): string {
  const p = new URLSearchParams(hidden);
  p.delete('q');
  const q = p.toString();
  return `/stores${q ? `?${q}` : ''}`;
}

/**
 * Find a store by name, city, state or pincode.
 *
 * A plain GET form, so it submits and the page re-renders from the URL like
 * every other filter here — which means a search is bookmarkable, the back
 * button undoes it, and it keeps working if the JavaScript has not arrived
 * yet. The only thing the client adds is the clear button and the progress
 * indicator.
 *
 * `hidden` carries the other filters through the submit. Without it, typing a
 * name would silently reset the window and the sort, which is the sort of
 * thing nobody reports and everybody works around.
 */
export function StoreSearch({
  defaultValue, hidden,
}: { defaultValue: string; hidden: Record<string, string> }) {
  const [value, setValue] = useState(defaultValue);

  return (
    <form
      action="/stores"
      method="get"
      onSubmit={() => startNav()}
      className="flex items-center gap-1.5"
      role="search"
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="flex items-center gap-1.5 rounded-md border border-ink-200
                        bg-surface px-2 py-1 focus-within:border-brand-500">
        <Search className="w-3.5 h-3.5 text-ink-400 shrink-0" aria-hidden />
        <span className="sr-only">Find a store</span>
        <input
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Store, city or pincode"
          className="w-[190px] bg-transparent text-[12px] text-ink-900
                     placeholder:text-ink-400 outline-none"
        />
        {value && (
          // A link, not a button that blanks the field and submits: setState
          // has not reached the DOM by the time the form serialises, so that
          // button would have posted the old text and appeared to do nothing.
          // The URL without `q` is what "no search" actually means anyway.
          <Link
            href={clearHref(hidden)}
            onClick={() => { setValue(''); startNav(); }}
            aria-label="Clear the search"
            className="text-ink-400 hover:text-ink-700 shrink-0 rounded-sm
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <X className="w-3.5 h-3.5" />
          </Link>
        )}
      </label>
      <button
        type="submit"
        className="rounded-md border border-ink-200 px-2.5 py-1 text-[12px]
                   font-medium text-ink-700 hover:bg-ink-100"
      >
        Search
      </button>
    </form>
  );
}
