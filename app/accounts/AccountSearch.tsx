'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { startNav } from '@/components/ui/NavProgress';

/**
 * Find one account.
 *
 * Searching clears the status and line filters, because the reason to type a
 * name is that you want that account — not that account if it happens to be
 * declining on pharmacy. The manager filter stays: "my accounts, the one
 * called Plum" is a real thing to ask for.
 */
export function AccountSearch({ initial }: { initial?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(initial ?? '');

  const go = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value.trim()) {
      next.set('q', value.trim());
      next.delete('status');
      next.delete('line');
    } else {
      next.delete('q');
    }
    startNav();
    const qs = next.toString();
    router.push(`/accounts${qs ? `?${qs}` : ''}`);
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); go(q); }} className="relative w-[250px]">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Account, city or manager"
        aria-label="Search accounts"
        className="w-full rounded-md border border-ink-200 bg-surface pl-8 pr-7 py-1.5 text-[12px]
                   text-ink-900 placeholder:text-ink-400
                   focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
      />
      {q && (
        <button type="button" aria-label="Clear search"
                onClick={() => { setQ(''); go(''); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </form>
  );
}
