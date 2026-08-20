'use client';

import { useState, useTransition } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { findLabsForPincode } from './actions';

/**
 * Search the web for labs, from the request the network team is looking at.
 *
 * Only shown where the network genuinely cannot reach the pincode. Everywhere
 * else there is a real lab to talk to and an unverified search result would be
 * a distraction.
 */
export function FindLabs({
  pincode, city, state, lastRun, found,
}: {
  pincode: string; city: string | null; state: string | null;
  lastRun: string | null; found: number | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          const r = await findLabsForPincode(pincode, city, state);
          setMsg(r.ok
            ? (r.found ? `${r.found} lead${r.found === 1 ? '' : 's'} found` : 'nothing found')
            : (r.error ?? 'search failed'));
        })}
        className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50
                   text-brand-700 px-2.5 py-1.5 text-xs font-medium hover:bg-brand-100
                   disabled:opacity-50"
      >
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
        {pending ? 'Searching the web…' : 'Find labs on the web'}
      </button>
      {msg && <span className="text-[11px] text-ink-600">{msg}</span>}
      {!msg && lastRun && (
        <span className="text-[11px] text-ink-400">
          Last searched {new Date(lastRun).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          {found != null && ` · ${found} found`}
        </span>
      )}
    </div>
  );
}
