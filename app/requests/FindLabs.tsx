'use client';

import { runAction } from './runAction';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2 } from 'lucide-react';
import { findLabsForPincode } from './actions';

/**
 * Search the web for labs, from the request the network team is looking at.
 *
 * Only shown where the network genuinely cannot reach the pincode. Everywhere
 * else there is a real lab to talk to and an unverified search result would be
 * a distraction.
 *
 * Searches ON MOUNT when the server says it should. That reverses the old
 * "never on page load" rule and it is the point of the change: a request with
 * no covering lab is a request whose next step is always this search, and
 * waiting for a click bought nothing except a click. `autoSearch` is computed
 * server-side in app/requests/[id]/page.tsx from the same conditions
 * atlas.claim_discovery enforces, and the database has the final say — see
 * shouldAutoSearch() in lib/labDiscovery.ts.
 */
export function FindLabs({
  pincode, city, state, lastRun, found, error, disciplines, autoSearch, running,
}: {
  pincode: string; city: string | null; state: string | null;
  disciplines?: string[] | null;
  // pg hands timestamptz back as a Date, and Next serializes it across the
  // boundary as one. Accept both rather than making the page stringify it.
  lastRun: string | Date | null; found: number | null; error?: string | null;
  /** The server's answer to "should this page search on its own". */
  autoSearch?: boolean;
  /** A search for this pincode was already in flight when the page rendered —
   *  somebody else's tab, or the nightly batch. */
  running?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  // Elapsed seconds while it runs. A spinner with no number gives no way to
  // tell "working" from "hung", which is the whole complaint.
  const [secs, setSecs] = useState(0);
  // True only for a search this component started without being asked, so the
  // card can explain itself to somebody who clicked nothing.
  const [auto, setAuto] = useState(!!autoSearch);
  // True while this tab is waiting on a search — its own or one it found
  // already in flight.
  const [watching, setWatching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Start a search, then watch for it to finish.
   *
   * The action no longer waits for the search — it takes the claim and
   * returns, because awaiting a two-minute search over an HTTP request is what
   * put a white page in front of this card. So the wait happens here, by
   * asking a one-row endpoint every few seconds, and the card re-reads when
   * the run row says there is something to read.
   */
  const run = (trigger: 'manual' | 'request_page') => start(async () => {
    setMsg(null);
    const r = await runAction(() => findLabsForPincode(pincode, city, state, disciplines, trigger));
    if (!r.ok) { setMsg(r.error ?? 'search failed'); return; }
    setWatching(true);
    router.refresh();
  });

  // Poll while a search is running — this tab's or anybody else's.
  useEffect(() => {
    if (!watching && !running) return;
    let stop = false;
    let tries = 0;
    const tick = async () => {
      if (stop) return;
      tries += 1;
      try {
        const res = await fetch(`/api/discovery/run?pincode=${pincode}`, { cache: 'no-store' });
        const row = await res.json() as { running?: boolean; found?: number | null; error?: string | null };
        if (!row.running) {
          setWatching(false);
          setMsg(row.error
            ? row.error
            : row.found
              ? `${row.found} lead${row.found === 1 ? '' : 's'} found`
              : 'nothing found');
          // The leads are rendered by a server component, so the rows only
          // appear once the page is re-read.
          router.refresh();
          return;
        }
      } catch {
        // A failed poll is not a failed search. Keep watching.
      }
      // Six minutes at five seconds, comfortably past the three-minute ceiling
      // the search itself runs under.
      if (tries < 72) timer.current = setTimeout(tick, 5000);
      else { setWatching(false); setMsg('still running — reload in a moment'); }
    };
    timer.current = setTimeout(tick, 4000);
    return () => { stop = true; if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, running, pincode]);

  // Fire once, ever.
  //
  // The empty dep array plus the ref are both load-bearing. React's dev-mode
  // double-invoke, or any re-render that changed a dep, would otherwise buy a
  // second web search for the same pincode — which the claim in the database
  // would decline, but only after the request had been made.
  const fired = useRef(false);
  useEffect(() => {
    if (!autoSearch || fired.current) return;
    fired.current = true;
    setAuto(true);
    run('request_page');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = pending || watching;

  useEffect(() => {
    if (!busy) { setSecs(0); return; }
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => { setAuto(false); run('manual'); }}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 dark:border-brand-100
                     bg-brand-50 text-brand-700 dark:text-brand-400 px-2.5 py-1.5 text-xs font-medium
                     hover:bg-brand-100 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          {busy ? `Searching the web… ${secs}s` : 'Search again'}
        </button>
        {msg && <span className="text-[11px] text-ink-600">{msg}</span>}
        {!msg && !busy && lastRun && (
          <span className="text-[11px] text-ink-400">
            Last searched {new Date(lastRun).toLocaleString('en-IN',
              { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            {found != null && ` · ${found} found`}
          </span>
        )}
        {/* A stored failure with no date reads as current. This one sent an
            afternoon chasing an API error that had already been fixed by adding
            credits — the search just had not been retried. */}
        {!msg && !busy && error && (
          <span className="text-[11px] text-ink-500">
            Previous attempt failed
            {lastRun && ` on ${new Date(lastRun).toLocaleString('en-IN',
              { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`}
            {' — try again, it may be resolved.'}
          </span>
        )}
      </div>

      {/* Somebody who clicked nothing is owed a reason the page is working. */}
      {busy && auto && (
        <p className="text-[11px] text-ink-500">
          No lab in the network reaches {pincode}, so Atlas is searching the open web
          without waiting to be asked. A minute or two. Nothing is contacted —
          these come back as leads to phone.
        </p>
      )}
      {busy && !auto && (
        <p className="text-[11px] text-ink-500">
          Searching the open web for {pincode}. It reads several listings, so it takes a
          minute or two — this page updates itself when it is done, and the search
          carries on even if you navigate away.
        </p>
      )}
      {!busy && running && !msg && (
        <p className="text-[11px] text-ink-500">
          A search for {pincode} is already running — started from another tab or by the
          nightly job. This page will update when it finishes.
        </p>
      )}
      {busy && secs > 180 && (
        <p className="text-[11px] text-warn-600">
          Longer than the three-minute ceiling. The result will still be recorded —
          reload in a moment.
        </p>
      )}
    </div>
  );
}
