'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * A bar that says "the click landed".
 *
 * Pages here are server-rendered against a database, and some of them take a
 * few seconds. Until the server responds the browser stays on the old page
 * with nothing moving, which reads as a freeze — people click again, or decide
 * the app is broken. The skeletons in loading.tsx cover the wait once the
 * navigation commits; this covers the moment before that, which is the part
 * that felt broken.
 *
 * Clicks are caught at the document, in the capture phase, so every internal
 * link gets this without being rewritten — sidebar, tables, cards, chips. A
 * navigation is over when the path or the query changes.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [loading, setLoading] = useState(false);

  useEffect(() => { setLoading(false); }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Anything but a plain left click is the browser's business: new tabs,
      // downloads, and modified clicks never replace this page.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || a.target === '_blank' || a.hasAttribute('download')) return;
      let url: URL;
      try { url = new URL(a.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      // Same place: no navigation, so no bar to show.
      if (url.pathname + url.search === window.location.pathname + window.location.search) return;
      setLoading(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // A bar that never goes away is worse than no bar: it turns one slow page
  // into an app that always looks busy.
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 20000);
    return () => clearTimeout(t);
  }, [loading]);

  if (!loading) return null;

  return (
    <div
      role="status"
      aria-label="Loading"
      className="fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-brand-500/15 pointer-events-none"
    >
      <div className="h-full w-1/3 rounded-r-full bg-brand-500 animate-route-progress" />
    </div>
  );
}
