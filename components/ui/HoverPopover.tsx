'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  children: ReactNode;            // The trigger (cell content)
  content: ReactNode;             // The popover body
  align?: 'left' | 'right';
  width?: number;
};

/**
 * Lightweight CSS-tracked popover that uses a portal for proper z-index +
 * intelligent positioning (auto-flip if it would go off-screen).
 */
export function HoverPopover({ children, content, align = 'left', width = 260 }: Props) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    let left = align === 'left' ? r.left - width - margin : r.right + margin;
    if (left < 8) left = r.right + margin; // flip
    if (left + width > window.innerWidth - 8) left = r.left - width - margin;
    let top = r.top + r.height / 2 - 12;
    // Clamp vertically
    if (top < 8) top = 8;
    if (top + 240 > window.innerHeight) top = Math.max(8, window.innerHeight - 248);
    // Use viewport-relative coords for position:fixed — avoids stacking-context
    // battles with Leaflet panes (marker pane z-index = 600) and any sticky/transformed ancestors.
    setPos({ top, left });
  };

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={() => {
          place();
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        className="inline-block cursor-help relative"
      >
        {children}
      </span>
      {mounted && open && pos && createPortal(
        <div
          style={{ top: pos.top, left: pos.left, width }}
          className="fixed z-[9999] rounded-xl border border-ink-200 bg-surface shadow-pop p-3 text-left animate-fade-in pointer-events-none isolate"
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
}
