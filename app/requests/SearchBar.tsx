'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Search, X } from 'lucide-react';

/**
 * Find one request, or everything from a place.
 *
 * Searching sets the arrival window to all time. Otherwise a search for a
 * request from last month returns nothing against the default seven-day
 * window, which reads as "not found" rather than "not in this window" — the
 * same trap that made the whole queue look broken when the window defaulted to
 * a calendar week.
 */
export function SearchBar({ initial }: { initial?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(initial ?? '');

  const go = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value.trim()) {
      next.set('q', value.trim());
      // Search across everything unless the user has deliberately picked a
      // window in this session.
      if (!next.get('window')) next.set('window', 'all');
    } else {
      next.delete('q');
    }
    router.push(`/requests?${next.toString()}`);
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); go(q); }}
      className="relative flex-1 min-w-[260px] max-w-md"
    >
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Request id, pincode, city, store or test…"
        aria-label="Search requests"
        className="w-full rounded-md border border-ink-200 bg-surface pl-9 pr-8 py-2 text-sm
                   text-ink-900 placeholder:text-ink-400
                   focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
      />
      {q && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => { setQ(''); go(''); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </form>
  );
}
