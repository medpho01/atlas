'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/**
 * What every screen does while it is loading.
 *
 * Two different waits were being confused with each other. Opening a page for
 * the first time mounts a new route segment, and Next shows the nearest
 * loading.tsx — that part worked. But clicking a tab, a filter chip or a sort
 * only changes the query string, which is the SAME segment: React keeps the
 * page mounted, streams the new payload in, and loading.tsx never fires. So
 * the most common wait on the busiest pages — requests, order tracking — had
 * no indicator at all. The old rows sat there looking live, and the only sign
 * anything had happened was a two-pixel bar at the top of the window.
 *
 * This covers that wait, uniformly, for every route at once: the content it
 * wraps dims and stops taking clicks, a bar runs across the top, and a pill
 * says so in words. Nothing is per-page, so nothing can be forgotten on a page.
 *
 * Knowing when to stop is the trick, and it is NOT the children element, which
 * was the first thing I tried: a layout does not re-render on a same-segment
 * navigation, so its children slot keeps its identity and the indicator never
 * cleared. The router's own state does change, so a watcher on the path and
 * the query is the signal. It lives in a component of its own, rendering
 * nothing, because useSearchParams needs a Suspense boundary and this way the
 * boundary is around nothing rather than around the whole application shell.
 */

/** Where the router currently is, in a form both sides spell the same way. */
const routeKey = (path: string, search: string) =>
  `${path}?${new URLSearchParams(search).toString()}`;

function NavWatcher({ onRoute }: { onRoute: (key: string) => void }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const key = routeKey(pathname, search.toString());
  useEffect(() => { onRoute(key); }, [key, onRoute]);
  return null;
}

/** Tell the indicator a navigation has begun — for router.push, which is not a click. */
export function startNav() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('atlas:nav-start'));
}

export function NavProgress({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState(false);

  // Where we were when the wait began. The indicator clears when the router
  // reaches somewhere else — not merely when the watcher re-runs, which it
  // does for reasons of its own (a refresh, a re-render) and which used to
  // take the indicator down about a third of a second in, mid-wait.
  const from = useRef<string | null>(null);
  const onRoute = useCallback((key: string) => {
    if (from.current !== null && key !== from.current) {
      from.current = null;
      setPending(false);
    }
  }, []);

  useEffect(() => {
    // flushSync, because React would otherwise batch this together with the
    // navigation the caller is about to start: both updates land in one
    // commit, and on a fast navigation the indicator is created and destroyed
    // without ever being painted. Forcing the commit here means the wait is
    // always visible, however short.
    const begin = () => {
      from.current = routeKey(window.location.pathname, window.location.search);
      try { flushSync(() => setPending(true)); } catch { setPending(true); }
    };

    const onClick = (e: MouseEvent) => {
      // Anything but a plain left click is the browser's business: new tabs,
      // downloads and modified clicks never replace this page.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || a.target === '_blank' || a.hasAttribute('download')) return;
      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      // Same place: no navigation, so nothing to wait for.
      if (url.pathname + url.search === window.location.pathname + window.location.search) return;
      begin();
    };

    document.addEventListener('click', onClick, true);
    window.addEventListener('atlas:nav-start', begin);
    // Back and forward are navigations too, and they can be slow here.
    window.addEventListener('popstate', begin);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('atlas:nav-start', begin);
      window.removeEventListener('popstate', begin);
    };
  }, []);

  // An indicator that never clears is worse than none: it turns one slow page
  // into an app that always looks busy.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => { from.current = null; setPending(false); }, 20000);
    return () => clearTimeout(t);
  }, [pending]);

  return (
    <>
      <Suspense fallback={null}><NavWatcher onRoute={onRoute} /></Suspense>

      {pending && (
        <div
          role="status"
          aria-label="Loading"
          className="fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden bg-brand-500/15 pointer-events-none"
        >
          <div className="h-full w-1/3 rounded-r-full bg-brand-500 animate-route-progress" />
        </div>
      )}

      <div
        aria-busy={pending}
        className={`transition-opacity duration-150 ${pending ? 'opacity-40 pointer-events-none select-none' : ''}`}
      >
        {children}
      </div>

      {/* In words, and low on the screen where the eye already is when you have
          just clicked a filter under a long table. */}
      {pending && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] pointer-events-none
                        flex items-center gap-2 rounded-full border border-ink-200 bg-surface
                        px-3.5 py-1.5 shadow-lg">
          <Loader2 className="w-3.5 h-3.5 text-brand-600 animate-spin" />
          <span className="text-[12px] font-medium text-ink-700">Loading…</span>
        </div>
      )}
    </>
  );
}
