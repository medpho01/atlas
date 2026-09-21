'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Search } from 'lucide-react';
import { startNav } from '@/components/ui/NavProgress';

export type StoreOption = { store_id: number; name: string; n: number };

/**
 * Stores, chosen several at a time and applied once.
 *
 * They used to be a row of chips, one link each, so selecting five accounts
 * meant five full page loads — five round trips through eight queries — and
 * four of them showed a list nobody wanted to see. A person owns a handful of
 * stores and picks the same handful every morning; that should cost one
 * navigation, not one per store.
 *
 * Selection is local until Apply, which is the whole point: nothing is fetched
 * while you are still deciding.
 */
export function StorePicker({
  options, selected, carry,
}: {
  options: StoreOption[];
  selected: number[];
  /**
   * Every other search param, so applying a selection keeps the queue, the
   * window and the sort. A function would be the obvious shape, but this
   * component runs on the client and a server component cannot hand one over.
   */
  carry: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number[]>(selected);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);

  // Reopening shows what is actually applied, not what was abandoned last
  // time — but as an effect keyed on `selected` this reset fired on EVERY
  // render, because the array is rebuilt each time and never compares equal.
  // Ticking a box re-rendered, the effect ran, and the tick was wiped before
  // it reached the screen. It belongs on the open transition, which is the
  // only moment it is actually about.
  const openPanel = () => { setDraft(selected); setQ(''); setOpen(true); };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const toggle = (id: number) =>
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  const apply = (ids: number[]) => {
    setOpen(false);
    // router.push is not a click, so the shell's indicator would never see it.
    startNav();
    const p = new URLSearchParams(carry);
    if (ids.length) p.set('store', ids.join(','));
    const q = p.toString();
    router.push(`/requests${q ? `?${q}` : ''}`);
  };

  const shown = q
    ? options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()))
    : options;
  const withWork = shown.filter((o) => o.n > 0);
  const quiet = shown.filter((o) => o.n === 0);

  const label = selected.length === 0
    ? 'All stores'
    : selected.length === 1
      ? (options.find((o) => o.store_id === selected[0])?.name ?? '1 store')
      : `${selected.length} stores`;

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition
          ${selected.length
            ? 'border-brand-600 bg-brand-600 text-white font-medium'
            : 'border-ink-200 text-ink-700 hover:bg-ink-100'}`}
      >
        {label}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-[300px] rounded-lg border border-ink-200 bg-surface shadow-lg">
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-ink-100">
            <Search className="w-3.5 h-3.5 text-ink-400 shrink-0" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a store"
              className="w-full bg-transparent text-[12px] text-ink-900 placeholder:text-ink-400 outline-none"
            />
          </div>

          <div className="max-h-[280px] overflow-y-auto py-1">
            {shown.length === 0 && (
              <p className="px-3 py-3 text-[12px] text-ink-400">No store matches “{q}”.</p>
            )}
            {/* Stores with work first. With forty-odd tracked stores most read
                zero on any given day, and burying the five that matter among
                them is what made the chip row unreadable. */}
            {[...withWork, ...quiet].map((o, i) => {
              const on = draft.includes(o.store_id);
              const firstQuiet = o.n === 0 && i === withWork.length && withWork.length > 0;
              return (
                <div key={o.store_id}>
                  {firstQuiet && (
                    <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-ink-400">
                      Nothing right now
                    </p>
                  )}
                  <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-ink-50">
                    <span className={`w-3.5 h-3.5 border flex items-center justify-center shrink-0
                      ${on ? 'bg-brand-600 border-brand-600' : 'border-ink-300'}`}
                          style={{ borderRadius: 3 }}>
                      {on && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />}
                    </span>
                    <input type="checkbox" className="sr-only" checked={on}
                           onChange={() => toggle(o.store_id)} />
                    <span className={`text-[12px] flex-1 truncate ${on ? 'text-ink-900 font-medium' : 'text-ink-700'}`}>
                      {o.name}
                    </span>
                    <span className="text-[11px] text-ink-400 tabular-nums">{o.n}</span>
                  </label>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 px-3 py-2 border-t border-ink-100">
            <button type="button" onClick={() => setDraft(withWork.map((o) => o.store_id))}
                    className="text-[11px] text-brand-600 hover:underline">
              Select all with work
            </button>
            <button type="button" onClick={() => setDraft([])}
                    className="text-[11px] text-ink-500 hover:underline">
              Clear
            </button>
            <button
              type="button"
              onClick={() => apply(draft)}
              className="ml-auto rounded-md bg-brand-600 px-3 py-1 text-[12px] font-medium text-white hover:bg-brand-700"
            >
              Apply{draft.length ? ` (${draft.length})` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
