'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The bar that appears once cards are ticked, pinned to the bottom of the window.
 *
 * It used to be a `sticky bottom-3` element at the end of the board. On the
 * thread board that worked; in the queue it did not, because there the board
 * sits in a horizontally scrolling container — and a sticky bottom resolves
 * against its scroll container, which in that case is exactly as tall as its
 * content. The bar came to rest under the longest column, ninety-one cards
 * below the fold, so selecting providers appeared to do nothing at all.
 *
 * Fixed to the viewport through a portal instead: out of any scroller, any
 * transformed or blurred ancestor, and visible the moment something is picked.
 * Below the drawer's z-50, so opening a provider covers it rather than fighting it.
 */
export function BulkBar({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-max max-w-[calc(100vw-2rem)]">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/40 bg-surface shadow-2xl px-3 py-2">
        {children}
      </div>
    </div>,
    document.body,
  );
}
