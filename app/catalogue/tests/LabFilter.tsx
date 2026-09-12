'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, Loader2, Plug, Search, X } from 'lucide-react';
import type { RateLab } from '@/lib/catalogueQueries';

const n = (v: number) => v.toLocaleString('en-IN');

/**
 * Which labs the catalogue is being read through.
 *
 * The page answers "what can we quote" — and what we can quote depends
 * entirely on whose rate card is open. Unfiltered it is the whole network,
 * which is right for a market view and wrong for a client with three labs on
 * contract: every price on screen is then the network's cheapest, which nobody
 * in that panel has agreed to.
 *
 * The selection lives in the URL, so a filtered catalogue is a link somebody
 * can send, and the export below takes the same parameters — what downloads is
 * what was on screen.
 */
export function LabFilter({ labs }: { labs: RateLab[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [apiOnly, setApiOnly] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const picked = useMemo(() => {
    const raw = params.get('labs');
    return raw ? raw.split(',').map(Number).filter(Boolean) : [];
  }, [params]);

  const apiLabs = useMemo(() => labs.filter((l) => l.api_provider), [labs]);

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = apiOnly ? apiLabs : labs;
    const list = t
      ? base.filter((l) => l.lab_name.toLowerCase().includes(t) || (l.lab_city ?? '').toLowerCase().includes(t))
      : base;
    return apiOnly ? list : list.slice(0, 40);
  }, [labs, apiLabs, apiOnly, q]);

  const setLabs = (ids: number[]) => {
    const next = new URLSearchParams(params.toString());
    if (ids.length) next.set('labs', [...new Set(ids)].join(','));
    else next.delete('labs');
    const qs = next.toString();
    router.push(`/catalogue/tests${qs ? `?${qs}` : ''}`);
  };

  const toggle = (id: number) =>
    setLabs(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  const chosen = labs.filter((l) => picked.includes(l.lab_id));

  const download = async () => {
    setDownloading(true);
    try {
      const qs = new URLSearchParams(params.toString()).toString();
      // A plain navigation, so the browser saves the file the way it saves any
      // download rather than holding a spreadsheet in memory first.
      window.location.href = `/api/catalogue/tests-export${qs ? `?${qs}` : ''}`;
      setTimeout(() => setDownloading(false), 2500);
    } catch {
      setDownloading(false);
    }
  };

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Labs</span>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
            picked.length
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-ink-200 bg-surface text-ink-700 hover:bg-ink-100'
          }`}
        >
          {picked.length ? `${picked.length} lab${picked.length === 1 ? '' : 's'} selected` : 'All labs'}
        </button>

        <button
          type="button"
          onClick={() => { setApiOnly(true); setOpen(true); }}
          className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-surface px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100"
          title="Labs we place orders with over an API"
        >
          <Plug className="w-3 h-3" /> API integrated <span className="opacity-60 tabular-nums">{apiLabs.length}</span>
        </button>

        {picked.length > 0 && (
          <button type="button" onClick={() => setLabs([])}
                  className="text-[11px] text-ink-500 hover:text-ink-900">clear</button>
        )}

        <button
          type="button"
          onClick={download}
          disabled={downloading}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-surface px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-50"
          title="Every test on this list, with each lab's MRP and B2B rate"
        >
          {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
          Download rates
        </button>
      </div>

      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {chosen.map((l) => (
            <button
              key={l.lab_id}
              type="button"
              onClick={() => toggle(l.lab_id)}
              className="inline-flex items-center gap-1.5 rounded-md border border-brand-500/40 bg-brand-50 dark:bg-brand-500/10 px-2 py-0.5 text-[11px] text-brand-700 dark:text-brand-300"
              title="Remove"
            >
              {l.api_provider && <Plug className="w-2.5 h-2.5" />}
              {l.lab_name}
              <X className="w-2.5 h-2.5 opacity-60" />
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-2 rounded-lg border border-ink-200 bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter labs by name or city…"
                className="w-full rounded-md border border-ink-200 bg-surface pl-7 pr-2 h-8 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-600">
              <input type="checkbox" checked={apiOnly} onChange={(e) => setApiOnly(e.target.checked)} />
              API integrated only
            </label>
            {apiOnly && apiLabs.length > 0 && (
              <button
                type="button"
                onClick={() => setLabs([...picked, ...apiLabs.map((l) => l.lab_id)])}
                className="text-[11px] text-brand-600 hover:text-brand-700 font-medium"
              >
                Select all {apiLabs.length}
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)}
                    className="text-[11px] text-ink-500 hover:text-ink-900">done</button>
          </div>

          <div className="max-h-56 overflow-y-auto">
            <div className="flex flex-wrap gap-1.5">
              {visible.map((l) => {
                const on = picked.includes(l.lab_id);
                return (
                  <button
                    key={l.lab_id}
                    type="button"
                    onClick={() => toggle(l.lab_id)}
                    title={[l.lab_city, l.api_provider && `API · ${l.api_provider.replace(/_/g, ' ')}`]
                      .filter(Boolean).join(' — ') || undefined}
                    className={`rounded-md border px-2 py-1 text-xs transition ${
                      on
                        ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 font-medium'
                        : 'border-ink-200 bg-surface text-ink-700 hover:bg-ink-100'
                    }`}
                  >
                    {l.api_provider && <Plug className="inline w-3 h-3 mr-1 -mt-0.5 text-brand-600 dark:text-brand-400" />}
                    {l.lab_name}
                    <span className="ml-1.5 text-ink-400 tabular-nums">{n(l.tests)}</span>
                  </button>
                );
              })}
              {!visible.length && <span className="text-xs text-ink-400 p-1">No labs match.</span>}
            </div>
          </div>
          <p className="text-[11px] text-ink-400 mt-2">
            {apiOnly
              ? `${visible.length} integrated lab${visible.length === 1 ? '' : 's'} with a rate card`
              : q.trim()
                ? `${visible.length} match`
                : `Showing the ${visible.length} widest of ${n(labs.length)} labs with rates — search to reach the rest`}
            . The number is how many tests that lab prices.
          </p>
        </div>
      )}
    </div>
  );
}
