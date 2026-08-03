'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/**
 * Searchable multi-select with scoped select-all.
 *
 * Generalised from the lab picker on /phlebos, which needs to stay usable at
 * 1,500+ options. Three things make it work at that size: search inside the
 * dropdown, select-all that applies to what the search is currently showing
 * rather than the whole list, and selected options floated to the top so a
 * choice doesn't disappear the moment you type.
 *
 * Options are {value, label, count}. Values are what's stored and emitted, so
 * a label can change without invalidating a saved filter.
 */
export type MultiSelectOption = { value: string; label: string; count?: number };

export function MultiSelect({
  options,
  selected,
  onChange,
  allLabel,
  nounSingular,
  nounPlural,
  searchPlaceholder,
  footerFor,
  width = 290,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Shown on the trigger when nothing is selected, e.g. "All labs". */
  allLabel: string;
  nounSingular: string;
  nounPlural: string;
  searchPlaceholder?: string;
  /** Optional line under the list explaining what the selection does. */
  footerFor?: (count: number) => string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matched = needle
      ? options.filter((o) => o.label.toLowerCase().includes(needle))
      : options;
    // Selected first, so what you've chosen stays in sight as the list moves.
    return [
      ...matched.filter((o) => selectedSet.has(o.value)),
      ...matched.filter((o) => !selectedSet.has(o.value)),
    ];
  }, [options, q, selectedSet]);

  const toggle = (value: string) =>
    onChange(selectedSet.has(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  const allVisibleSelected = visible.length > 0 && visible.every((o) => selectedSet.has(o.value));
  const selectAllVisible = () => {
    const next = new Set(selected);
    visible.forEach((o) => next.add(o.value));
    onChange([...next]);
  };

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? `1 ${nounSingular}`)
        : `${selected.length} ${nounPlural}`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`inline-flex items-center gap-1.5 text-xs px-2 h-7 rounded-md border bg-surface font-medium max-w-[240px] transition ${
          selected.length > 0
            ? 'border-brand-500 text-brand-700 dark:text-brand-400'
            : 'border-ink-200 text-ink-900 hover:bg-ink-50 dark:hover:bg-ink-900/40'
        }`}
      >
        <span className="truncate">{summary}</span>
        {selected.length > 1 && (
          <span className="shrink-0 tabular-nums text-[10px] px-1 rounded bg-brand-500/15">
            {selected.length}
          </span>
        )}
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          style={{ width }}
          className="absolute left-0 top-full mt-1 z-50 rounded-lg border border-ink-200 bg-surface shadow-lg overflow-hidden"
        >
          <div className="p-2 border-b border-ink-200">
            <input
              autoFocus
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder ?? `Search ${nounPlural}`}
              className="w-full px-2 h-7 text-xs rounded-md border border-ink-200 bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            />
            <div className="flex items-center gap-3 mt-2 px-0.5">
              <button
                type="button"
                onClick={selectAllVisible}
                disabled={allVisibleSelected}
                className="text-[11px] font-semibold text-brand-700 dark:text-brand-400 hover:underline disabled:text-ink-400 disabled:no-underline disabled:cursor-default"
              >
                Select all{q.trim() ? ' shown' : ''}
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                disabled={selected.length === 0}
                className="text-[11px] font-semibold text-ink-600 hover:text-ink-900 hover:underline disabled:text-ink-400 disabled:no-underline disabled:cursor-default"
              >
                Deselect all
              </button>
              <span className="ml-auto text-[11px] text-ink-500 tabular-nums">
                {selected.length || 'no'} selected
              </span>
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {visible.length === 0 && (
              <div className="px-3 py-4 text-xs text-ink-500 text-center">
                No {nounPlural} match “{q.trim()}”
              </div>
            )}
            {visible.map((o) => {
              const checked = selectedSet.has(o.value);
              return (
                <label
                  key={o.value}
                  className="flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-ink-100/60 transition"
                >
                  <span
                    className={`inline-flex w-3.5 h-3.5 shrink-0 items-center justify-center rounded border transition ${
                      checked ? 'bg-brand-600 border-brand-600' : 'border-ink-300 bg-surface'
                    }`}
                  >
                    {checked && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />}
                  </span>
                  <input type="checkbox" checked={checked} onChange={() => toggle(o.value)} className="sr-only" />
                  <span className={`truncate ${checked ? 'font-semibold text-ink-900' : 'text-ink-700'}`}>
                    {o.label}
                  </span>
                  {o.count !== undefined && (
                    <span className="ml-auto shrink-0 tabular-nums text-[11px] text-ink-500">
                      {o.count.toLocaleString('en-IN')}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {footerFor && (
            <div className="px-2.5 py-1.5 border-t border-ink-200 bg-ink-50 dark:bg-ink-900/40 text-[11px] text-ink-500">
              {footerFor(selected.length)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
