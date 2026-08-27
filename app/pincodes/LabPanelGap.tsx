'use client';

import { useMemo, useState, useTransition } from 'react';
import * as XLSX from 'xlsx';
import { Download, Loader2, Play, Search } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { runPanelGap } from './actions';

type Lab = { lab_id: number; name: string; city: string | null; pincodes: number };
type Row = {
  pincode: string; city: string | null; state: string | null;
  labs: string[]; lab_count: number; orders_all_time: number | null;
};
type Summary = {
  panel_pincodes: number; network_pincodes: number;
  remaining_pincodes: number; remaining_with_demand: number;
};

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
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t
      ? labs.filter((l) => l.name.toLowerCase().includes(t) || (l.city ?? '').toLowerCase().includes(t))
      : labs;
    return list.slice(0, 60);
  }, [labs, q]);

  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const download = () => {
    const sheet = rows.map((r) => ({
      Pincode: r.pincode,
      City: r.city ?? '',
      State: r.state ?? '',
      'Orders all time': r.orders_all_time ?? 0,
      'Labs covering': r.lab_count,
      Labs: r.labs.join('; '),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Not covered by panel');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        labs.filter((l) => picked.includes(l.lab_id))
            .map((l) => ({ Lab: l.name, City: l.city ?? '', 'Pincodes served': l.pincodes })),
      ),
      'Panel',
    );
    XLSX.writeFile(wb, 'atlas-lab-panel-gap.xlsx');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <div>
            <div className="text-sm font-medium text-ink-900">Pick the labs in your panel</div>
            <p className="text-xs text-ink-500 mt-0.5">
              Coverage is the union — a pincode counts if any one of them reaches it. The result
              is everything the rest of the network reaches that this panel does not.
            </p>
          </div>

          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter labs by name or city…"
              className="w-full rounded-md border border-ink-200 bg-surface pl-8 pr-3 py-1.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto">
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
                      : 'border-ink-200 text-ink-700 hover:bg-ink-100'
                  }`}
                >
                  {l.name}
                  <span className="ml-1.5 text-ink-400">{n(l.pincodes)}</span>
                </button>
              );
            })}
            {!visible.length && <span className="text-xs text-ink-400">No labs match.</span>}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              disabled={pending || !picked.length}
              onClick={() => start(async () => {
                setErr(null);
                const r = await runPanelGap(picked);
                if (!r.ok) { setErr(r.error); setRows([]); setSummary(null); return; }
                setSummary(r.summary); setRows(r.rows);
              })}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 text-white
                         px-3 py-1.5 text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {picked.length ? `Analyse ${picked.length} lab${picked.length === 1 ? '' : 's'}` : 'Pick a lab first'}
            </button>
            {picked.length > 0 && (
              <button type="button" onClick={() => setPicked([])}
                      className="text-xs text-ink-500 hover:text-ink-900">Clear</button>
            )}
            {err && <span className="text-xs text-danger-500">{err}</span>}
          </div>
        </CardBody>
      </Card>

      {summary && (
        <Card>
          <CardBody>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
              <div>
                <div className="text-2xl font-bold num text-ink-900">{n(summary.panel_pincodes)}</div>
                <div className="text-[11px] text-ink-500 mt-0.5">covered by your panel</div>
              </div>
              <div>
                <div className="text-2xl font-bold num text-ink-700">{n(summary.network_pincodes)}</div>
                <div className="text-[11px] text-ink-500 mt-0.5">reachable by the network</div>
              </div>
              <div>
                <div className="text-2xl font-bold num text-warn-600">{n(summary.remaining_pincodes)}</div>
                <div className="text-[11px] text-ink-500 mt-0.5">the panel does not reach</div>
              </div>
              <div>
                <div className="text-2xl font-bold num text-danger-500">{n(summary.remaining_with_demand)}</div>
                <div className="text-[11px] text-ink-500 mt-0.5">of those with real orders</div>
              </div>
            </div>
            {summary.remaining_with_demand > 0 && (
              <p className="text-[11px] text-ink-500 mt-3">
                The last figure is the one worth working: pincodes this panel misses where orders
                have actually been placed. The rest are reachable but untested.
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardBody className="pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-ink-900">
                {n(rows.length)} pincode{rows.length === 1 ? '' : 's'} the panel misses
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
