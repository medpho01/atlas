'use client';

import { useState, useRef, useEffect } from 'react';
import { LogOut, User as UserIcon } from 'lucide-react';

type User = { id: number; email: string; name: string; role: 'admin' | 'editor' | 'viewer' };

export function UserChip({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const initials = user.name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 group"
        title={`${user.name} (${user.email})`}
      >
        <span className="hidden md:inline text-xs text-ink-500 font-medium">{user.name}</span>
        <span className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-xs font-semibold text-white shadow-sm">
          {initials || 'A'}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl border border-ink-200 bg-surface shadow-pop p-2 z-50">
          <div className="px-2.5 py-1.5">
            <div className="text-sm font-semibold text-ink-900 leading-tight">{user.name}</div>
            <div className="text-[11px] text-ink-500 mt-0.5">{user.email}</div>
            <div className="text-[10px] uppercase tracking-wider text-ink-400 mt-1.5">{user.role}</div>
          </div>
          <hr className="border-ink-150 my-1.5" />
          <a
            href="/api/logout"
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-ink-700 hover:bg-ink-100 hover:text-ink-900 transition"
          >
            <LogOut className="w-3.5 h-3.5" strokeWidth={2.25} /> Sign out
          </a>
        </div>
      )}
    </div>
  );
}
