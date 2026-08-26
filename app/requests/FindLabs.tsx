'use client';

import { runAction } from './runAction';

import { useEffect, useState, useTransition } from 'react';
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
  pincode, city, state, lastRun, found, error, disciplines,
}: {
  pincode: string; city: string | null; state: string | null;
  disciplines?: string[] | null;
  lastRun: string | null; found: number | null; error?: string | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  // Elapsed seconds while it runs. A spinner with no number gives no way to
  // tell "working" from "hung", which is the whole complaint.
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!pending) { setSecs(0); return; }
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [pending]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          const r = await runAction(() => findLabsForPincode(pincode, city, state, disciplines));
          setMsg(r.ok
            ? (r.found ? `${r.found} lead${r.found === 1 ? '' : 's'} found` : 'nothing found')
            : (r.error ?? 'search failed'));
        })}
        className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 dark:border-brand-100
                   bg-brand-50 text-brand-700 dark:text-brand-400 px-2.5 py-1.5 text-xs font-medium
                   hover:bg-brand-100 disabled:opacity-50"
      >
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
        {pending
          ? `Searching the web… ${secs}s`
          : 'Find labs on the web'}
      </button>
      {msg && <span className="text-[11px] text-ink-600">{msg}</span>}
      {pending && secs > 50 && (
        <span className="text-[11px] text-warn-600">
          Taking longer than usual — it gives up at 45s and will report why.
        </span>
      )}
      {!msg && lastRun && (
        <span className="text-[11px] text-ink-400">
          Last searched {new Date(lastRun).toLocaleString('en-IN',
            { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
          {found != null && ` · ${found} found`}
        </span>
      )}
      {/* A stored failure with no date reads as current. This one sent an
          afternoon chasing an API error that had already been fixed by adding
          credits — the search just had not been retried. */}
      {!msg && error && (
        <span className="text-[11px] text-ink-500">
          Previous attempt failed
          {lastRun && ` on ${new Date(lastRun).toLocaleString('en-IN',
            { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`}
          {' — try again, it may be resolved.'}
        </span>
      )}
    </div>
  );
}
