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

  const run = (trigger: 'manual' | 'request_page') => start(async () => {
    const r = await runAction(() => findLabsForPincode(pincode, city, state, disciplines, trigger));
    setMsg(r.ok
      ? ('declined' in r && r.declined
          // Somebody else got the claim between the page rendering and this
          // firing. Their result is the one to show, so just re-read.
          ? 'already being searched'
          : (r.found ? `${r.found} lead${r.found === 1 ? '' : 's'} found` : 'nothing found'))
      : (r.error ?? 'search failed'));
    // revalidatePath in the action is not enough on its own: the leads are
    // rendered by a server component, and without this the new rows do not
    // appear until the next navigation.
    router.refresh();
  });

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

  useEffect(() => {
    if (!pending) { setSecs(0); return; }
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [pending]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => { setAuto(false); run('manual'); }}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 dark:border-brand-100
                     bg-brand-50 text-brand-700 dark:text-brand-400 px-2.5 py-1.5 text-xs font-medium
                     hover:bg-brand-100 disabled:opacity-50"
        >
          {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          {pending ? `Searching the web… ${secs}s` : 'Search again'}
        </button>
        {msg && <span className="text-[11px] text-ink-600">{msg}</span>}
        {!msg && !pending && lastRun && (
          <span className="text-[11px] text-ink-400">
            Last searched {new Date(lastRun).toLocaleString('en-IN',
              { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            {found != null && ` · ${found} found`}
          </span>
        )}
        {/* A stored failure with no date reads as current. This one sent an
            afternoon chasing an API error that had already been fixed by adding
            credits — the search just had not been retried. */}
        {!msg && !pending && error && (
          <span className="text-[11px] text-ink-500">
            Previous attempt failed
            {lastRun && ` on ${new Date(lastRun).toLocaleString('en-IN',
              { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`}
            {' — try again, it may be resolved.'}
          </span>
        )}
      </div>

      {/* Somebody who clicked nothing is owed a reason the page is working. */}
      {pending && auto && (
        <p className="text-[11px] text-ink-500">
          No lab in the network reaches {pincode}, so Atlas is searching the open web
          without waiting to be asked. Usually 20–40 seconds. Nothing is contacted —
          these come back as leads to phone.
        </p>
      )}
      {!pending && running && !msg && (
        <p className="text-[11px] text-ink-500">
          A search for {pincode} is already running — started from another tab or by the
          nightly job. Reload in a moment to see what it found.
        </p>
      )}
      {pending && secs > 50 && (
        <p className="text-[11px] text-warn-600">
          Taking longer than usual — it gives up at 45s and will report why.
        </p>
      )}
    </div>
  );
}
