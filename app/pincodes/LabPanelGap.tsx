'use client';

import { useMemo, useState, useTransition } from 'react';
import * as XLSX from 'xlsx';
import { Building2, Download, Loader2, Play, Plug, Search, X } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { KpiTile } from '@/components/KpiTile';
import { runPanelGap } from './actions';

type Lab = {
  lab_id: number; name: string; city: string | null; pincodes: number;
  api_provider: string | null; api_home_sample: boolean;
};
type Row = {
  pincode: string; city: string | null; state: string | null;
  labs: string[]; lab_count: number; orders_all_time: number | null;
};
type Summary = {
  panel_pincodes: number; network_pincodes: number;
  remaining_pincodes: number; remaining_with_demand: number;
  panel_with_demand: number;
};
type Mode = 'include' | 'exclude';

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN');

/**
 * "We have these labs — what do they miss, and who fills it?"
 *
 * Coverage is a union: a pincode counts as served if any selected lab reaches
 * it. What comes back is the opposite — every pincode the network reaches that
 * the panel does not — because that is the half somebody can act on, and each
 * row names the labs to call.
 */
export function LabPanelGap({ labs }: { labs: Lab[] }) {
  const [picked, setPicked] = useState<number[]>([]);
  const [q, setQ] = useState('');
  // Eleven of 269 labs take orders over an API, and they are the ones a panel
  // is usually built around — everything else is email and a portal. Worth a
  // filter of its own rather than eleven names to remember.
  const [apiOnly, setApiOnly] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [mode, setMode] = useState<Mode>('exclude');
  // What the shown numbers were computed with, so the labels never describe a
  // toggle position the results do not belong to.
  const [ranMode, setRanMode] = useState<Mode>('exclude');
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const apiLabs = useMemo(() => labs.filter((l) => l.api_provider), [labs]);

  const matching = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = apiOnly ? apiLabs : labs;
    return t
      ? base.filter((l) => l.name.toLowerCase().includes(t) || (l.city ?? '').toLowerCase().includes(t))
      : base;
  }, [labs, apiLabs, apiOnly, q]);

  // Sixty is enough to scan; the integrated list is short enough to show whole.
  const visible = useMemo(
    () => (apiOnly ? matching : matching.slice(0, 60)),
    [matching, apiOnly],
  );

  const chosen = useMemo(
    () => labs.filter((l) => picked.includes(l.lab_id)),
    [labs, picked],
  );

  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const download = () => {
    const sheet = rows.map((r) => ({
      Pincode: r.pincode,
      City: r.city ?? '',
      State: r.state ?? '',
      'Orders all time': r.orders_all_time ?? 0,
      [ranMode === 'include' ? 'Selected labs covering' : 'Labs covering']: r.lab_count,
      Labs: r.labs.join('; '),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet),
      ranMode === 'include' ? 'Covered by panel' : 'Not covered by panel');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        labs.filter((l) => picked.includes(l.lab_id))
            .map((l) => ({ Lab: l.name, City: l.city ?? '', 'Pincodes served': l.pincodes })),
      ),
      'Panel',
    );
    XLSX.writeFile(wb, ranMode === 'include'
      ? 'atlas-lab-panel-coverage.xlsx' : 'atlas-lab-panel-gap.xlsx');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="pt-4 space-y-4">
          <div>
            <div className="text-sm font-medium text-ink-900">Pick the labs in your panel</div>
            <p className="text-xs text-ink-500 mt-0.5 max-w-2xl">
              Coverage is the union — a pincode counts if any one of them reaches it.{' '}
              {mode === 'include'
                ? 'Inclusion returns every pincode this panel serves.'
                : 'Exclusion returns everything the rest of the network reaches that this panel does not.'}
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
            {/* Left: search over the full lab list */}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <FilterChip active={!apiOnly} onClick={() => setApiOnly(false)}>
                  All labs <span className="tabular-nums opacity-70">{n(labs.length)}</span>
                </FilterChip>
                <FilterChip active={apiOnly} onClick={() => setApiOnly(true)}>
                  <Plug className="w-3 h-3" /> API integrated{' '}
                  <span className="tabular-nums opacity-70">{n(apiLabs.length)}</span>
                </FilterChip>
                {apiOnly && apiLabs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPicked((p) => [...new Set([...p, ...apiLabs.map((l) => l.lab_id)])])}
                    className="text-[11px] text-brand-600 hover:text-brand-700 font-medium ml-1"
                  >
                    Add all {apiLabs.length} to panel
                  </button>
                )}
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter labs by name or city…"
                  className="w-full rounded-md border border-ink-200 bg-surface pl-8 pr-3 py-1.5 text-sm
                             focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>

              <div className="mt-2 rounded-lg border border-ink-150 bg-ink-50/40 dark:bg-ink-100/20
                              h-64 overflow-y-auto p-2">
                <div className="flex flex-wrap gap-1.5 content-start">
                  {visible.map((l) => {
                    const on = picked.includes(l.lab_id);
                    return (
                      <button
                        key={l.lab_id}
                        type="button"
                        onClick={() => toggle(l.lab_id)}
                        className={`rounded-md border px-2 py-1 text-xs transition ${
                          on
                            ? 'border-brand-500 bg-brand-50 text-brand-700 dark:text-brand-400 font-medium'
                            : 'border-ink-200 bg-surface text-ink-700 hover:bg-ink-100'
                        }`}
                        title={[l.city, l.api_provider && `API · ${l.api_provider.replace(/_/g, ' ')}`
                                + (l.api_home_sample ? ' · home collection' : '')]
                               .filter(Boolean).join(' — ') || undefined}
                      >
                        {l.api_provider && (
                          <Plug
                            className="inline w-3 h-3 mr-1 -mt-0.5 text-brand-600 dark:text-brand-400"
                            aria-label={`Integrated over ${l.api_provider}`}
                          />
                        )}
                        {l.name}
                        <span className="ml-1.5 text-ink-400">{n(l.pincodes)}</span>
                      </button>
                    );
                  })}
                  {!visible.length && <span className="text-xs text-ink-400 p-1">No labs match.</span>}
                </div>
              </div>
              <div className="text-[11px] text-ink-400 mt-1.5">
                {apiOnly
                  ? `${visible.length} lab${visible.length === 1 ? '' : 's'} we place orders with over an API`
                  : q.trim()
                    ? `${matching.length} of ${n(labs.length)} labs match`
                    : `Showing the ${visible.length} widest of ${n(labs.length)} labs — search to reach the rest`}
              </div>
            </div>

            {/* Right: the panel as it stands, and the action */}
            <div className="rounded-lg border border-ink-150 p-3 lg:sticky lg:top-4">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
                  Your panel
                </span>
                {picked.length > 0 && (
                  <button type="button" onClick={() => setPicked([])}
                          className="text-[11px] text-ink-500 hover:text-ink-900">Clear</button>
                )}
              </div>

              {picked.length === 0 ? (
                <p className="text-xs text-ink-400 mt-2">
                  Nothing picked yet. Choose the labs you already have on contract.
                </p>
              ) : (
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {chosen.map((l) => (
                    <button
                      key={l.lab_id}
                      type="button"
                      onClick={() => toggle(l.lab_id)}
                      className="w-full flex items-center gap-2 text-left text-xs rounded px-1.5 py-1
                                 text-ink-700 hover:bg-ink-100 group"
                      title="Remove from panel"
                    >
                      <span className="truncate flex-1">{l.name}</span>
                      <span className="text-ink-400 tabular-nums">{n(l.pincodes)}</span>
                      <X className="w-3 h-3 text-ink-300 group-hover:text-danger-500 shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              <div className="flex rounded-md border border-ink-200 overflow-hidden mb-2">
                {([
                  { k: 'include' as Mode, label: 'Inclusion', hint: 'what these labs cover' },
                  { k: 'exclude' as Mode, label: 'Exclusion', hint: 'what they leave to others' },
                ]).map((m) => (
                  <button
                    key={m.k}
                    type="button"
                    onClick={() => setMode(m.k)}
                    title={m.hint}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium transition ${
                      mode === m.k
                        ? 'bg-brand-600 text-white'
                        : 'bg-surface text-ink-600 hover:bg-ink-100'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={pending || !picked.length}
                onClick={() => start(async () => {
                  setErr(null);
                  const r = await runPanelGap(picked, mode);
                  if (!r.ok) { setErr(r.error); setRows([]); setSummary(null); return; }
                  setSummary(r.summary); setRows(r.rows); setRanMode(mode);
                })}
                className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-md
                           bg-brand-600 text-white px-3 py-1.5 text-sm font-medium
                           hover:bg-brand-700 disabled:opacity-50"
              >
                {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {picked.length ? `Analyse ${picked.length} lab${picked.length === 1 ? '' : 's'}` : 'Pick a lab first'}
              </button>
              {err && <p className="text-[11px] text-danger-500 mt-2">{err}</p>}
            </div>
          </div>
        </CardBody>
      </Card>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile
            label="Covered by panel"
            value={n(summary.panel_pincodes)}
            sub="union of the labs you picked"
            icon={<Building2 className="w-4 h-4" />}
            tone={ranMode === 'include' ? 'good' : 'default'}
          />
          <KpiTile
            label="Network reach"
            value={n(summary.network_pincodes)}
            sub="every lab in the network"
          />
          {ranMode === 'include' ? (
            <>
              <KpiTile
                label="Share of network"
                value={summary.network_pincodes
                  ? Math.round(100 * summary.panel_pincodes / summary.network_pincodes) + '%'
                  : '—'}
                sub="of everywhere the network reaches"
              />
              <KpiTile
                label="Covered with demand"
                value={n(summary.panel_with_demand)}
                sub="orders already placed here"
                tone="good"
              />
            </>
          ) : (
            <>
              <KpiTile
                label="Panel misses"
                value={n(summary.remaining_pincodes)}
                sub="reachable, not by this panel"
                tone="warn"
              />
              <KpiTile
                label="Missed with demand"
                value={n(summary.remaining_with_demand)}
                sub="orders already placed here"
                tone="bad"
              />
            </>
          )}
        </div>
      )}

      {summary && (
        <p className="text-xs text-ink-500 -mt-1">
          {ranMode === 'include'
            ? 'These are the pincodes the selected labs already reach — the coverage you would keep if the rest of the network went away.'
            : 'The last tile is the one worth working: pincodes this panel misses where orders have actually been placed. The rest are reachable but untested.'}
        </p>
      )}

      {rows.length > 0 && (
        <Card>
          <CardBody className="pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-ink-900">
                {n(rows.length)} pincode{rows.length === 1 ? '' : 's'}{' '}
                {ranMode === 'include' ? 'this panel covers' : 'the panel misses'}
                <span className="ml-2 text-[11px] font-normal text-ink-500">
                  most-ordered first{rows.length >= 5000 ? ' · capped at 5,000' : ''}
                </span>
              </div>
              <button type="button" onClick={download}
                      className="inline-flex items-center gap-1.5 rounded-md border border-ink-200
                                 px-2.5 py-1.5 text-xs text-ink-700 hover:bg-ink-100">
                <Download className="w-3.5 h-3.5" /> Excel
              </button>
            </div>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
                    <th className="text-left font-medium px-5 py-2">Pincode</th>
                    <th className="text-left font-medium px-2 py-2">Where</th>
                    <th className="text-right font-medium px-2 py-2">Orders</th>
                    <th className="text-right font-medium px-2 py-2">Labs</th>
                    <th className="text-left font-medium px-5 py-2 min-w-[260px]">Who covers it</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 300).map((r) => (
                    <tr key={r.pincode} className="border-b border-ink-100 last:border-0">
                      <td className="px-5 py-2 font-medium text-ink-900">{r.pincode}</td>
                      <td className="px-2 py-2 text-ink-700 text-xs">
                        {[r.city, r.state].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-2 py-2 text-right num text-ink-700">{n(r.orders_all_time)}</td>
                      <td className="px-2 py-2 text-right num text-ink-500">{r.lab_count}</td>
                      <td className="px-5 py-2 text-xs text-ink-700">
                        {r.labs.slice(0, 3).join(', ')}
                        {r.labs.length > 3 && (
                          <span className="text-ink-400"> +{r.labs.length - 3}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 300 && (
              <p className="text-[11px] text-ink-500 mt-3">
                Showing the first 300 of {n(rows.length)}. The Excel has every row.
              </p>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/** A one-line filter toggle, the same shape as the chips elsewhere. */
function FilterChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-ink-200 bg-surface text-ink-700 hover:bg-ink-100'
      }`}
    >
      {children}
    </button>
  );
}
