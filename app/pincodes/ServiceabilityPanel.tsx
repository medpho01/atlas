'use client';

import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Search, Upload, ClipboardPaste, Download, X, Check, ChevronDown, MapPin, AlertTriangle,
} from 'lucide-react';

type ServiceCell = { service: string; providers: number; local_providers: number; top: string[] };
type Row = { pincode: string; city: string | null; state: string | null; services: ServiceCell[] };

type Props = {
  allServices: { key: string; label: string }[];
  defaultServices: string[];
};

/**
 * Serviceability for one pincode or a whole uploaded list, across whichever
 * services you pick. Replaces the separate bulk-coverage page — same question,
 * asked one pincode at a time or two thousand at a time.
 */
export function ServiceabilityPanel({ allServices, defaultServices }: Props) {
  const [single, setSingle] = useState('');
  const [pincodes, setPincodes] = useState<string[]>([]);
  const [rejected, setRejected] = useState(0);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [services, setServices] = useState<string[]>(defaultServices);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [truncated, setTruncated] = useState(false);

  const labelOf = useMemo(
    () => Object.fromEntries(allServices.map((s) => [s.key, s.label])),
    [allServices],
  );

  const run = async (pins: string[], label: string | null) => {
    if (!pins.length) { setError('No valid 6-digit pincodes found.'); return; }
    if (!services.length) { setError('Pick at least one service.'); return; }
    setLoading(true); setError(null); setSourceLabel(label);
    try {
      const r = await fetch('/api/coverage/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pincodes: pins, services }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setRows(data.rows ?? []);
      setTruncated(!!data.truncated);
    } catch (e) {
      setError((e as Error).message || 'Lookup failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const extractPincodes = (values: unknown[]): { ok: string[]; bad: number } => {
    const ok: string[] = []; let bad = 0;
    for (const v of values) {
      const s = String(v ?? '').trim();
      if (!s) continue;
      const m = s.match(/\b\d{6}\b/);
      if (m && /^[1-9]/.test(m[0])) ok.push(m[0]); else bad++;
    }
    return { ok: [...new Set(ok)], bad };
  };

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      // Scan every cell — the pincode column isn't always first or headed.
      const { ok, bad } = extractPincodes(raw.flat());
      setPincodes(ok); setRejected(bad);
      await run(ok, file.name);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const exportExcel = () => {
    const sheet = rows.map((r) => {
      const base: Record<string, string | number> = {
        Pincode: r.pincode, City: r.city ?? '', State: r.state ?? '',
      };
      for (const key of services) {
        const cell = r.services.find((s) => s.service === key);
        base[`${labelOf[key]} — providers`] = cell?.providers ?? 0;
        base[`${labelOf[key]} — nearest`] = (cell?.top ?? []).join('; ');
      }
      return base;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Serviceability');
    XLSX.writeFile(wb, 'atlas-serviceability.xlsx');
  };

  const covered = rows.filter((r) => r.services.some((s) => s.providers > 0)).length;

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="rounded-2xl border border-ink-200 bg-surface p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative flex-1 min-w-[240px]"
            onSubmit={(e) => { e.preventDefault(); const p = single.trim(); if (/^\d{6}$/.test(p)) { setPincodes([p]); setRejected(0); run([p], null); } }}
          >
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-ink-400" />
            <input
              value={single}
              onChange={(e) => setSingle(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Check one pincode — e.g. 560103"
              className="w-full pl-8 pr-3 h-9 text-sm tabular-nums rounded-md border border-ink-200 bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            />
          </form>

          <ServiceSelect all={allServices} selected={services} onChange={setServices} />

          <label className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold rounded-md border border-ink-200 bg-surface hover:bg-ink-50 cursor-pointer transition shrink-0">
            <Upload className="w-3.5 h-3.5" /> Upload list
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </label>

          <button
            onClick={() => setPasteOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold rounded-md border border-ink-200 bg-surface hover:bg-ink-50 transition shrink-0"
          >
            <ClipboardPaste className="w-3.5 h-3.5" /> Paste
          </button>

          {rows.length > 0 && (
            <button
              onClick={exportExcel}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold rounded-md bg-ink-900 text-ink-50 hover:bg-ink-800 transition shrink-0 ml-auto"
            >
              <Download className="w-3.5 h-3.5" /> Download Excel
            </button>
          )}
        </div>

        {pasteOpen && (
          <div className="flex gap-2">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={3}
              placeholder="Paste pincodes — one per line, or comma separated"
              className="flex-1 px-3 py-2 text-sm rounded-md border border-ink-200 bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            />
            <button
              onClick={() => {
                const { ok, bad } = extractPincodes(pasteText.split(/[\s,;]+/));
                setPincodes(ok); setRejected(bad); setPasteOpen(false); run(ok, 'pasted list');
              }}
              className="px-3 h-9 self-end text-xs font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 transition"
            >
              Check
            </button>
          </div>
        )}

        <div className="text-[11px] text-ink-500 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Any spreadsheet works — every cell is scanned for a 6-digit pincode, so the column needn&apos;t be named or first.</span>
          {sourceLabel && <span className="text-ink-700 font-medium">· {sourceLabel}</span>}
          {pincodes.length > 0 && <span>· {pincodes.length.toLocaleString('en-IN')} pincodes</span>}
          {rejected > 0 && <span className="text-warn-600">· {rejected} unrecognised value{rejected === 1 ? '' : 's'} skipped</span>}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-500 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {truncated && (
        <div className="rounded-xl border border-warn-100 bg-warn-50 px-4 py-2.5 text-xs text-warn-600">
          Only the first 2,000 pincodes were checked. Split the file to cover the rest.
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="rounded-2xl border border-ink-200 bg-surface px-4 py-12 text-center text-sm text-ink-500">
          Checking {pincodes.length.toLocaleString('en-IN')} pincode{pincodes.length === 1 ? '' : 's'}…
        </div>
      ) : rows.length > 0 ? (
        <div className="rounded-2xl border border-ink-200 bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-ink-200 bg-ink-50 text-xs text-ink-600 flex flex-wrap gap-x-3">
            <span><b className="text-ink-900">{rows.length.toLocaleString('en-IN')}</b> checked</span>
            <span className="text-success-600"><b>{covered.toLocaleString('en-IN')}</b> with at least one service</span>
            {rows.length - covered > 0 && (
              <span className="text-danger-500"><b>{(rows.length - covered).toLocaleString('en-IN')}</b> with none</span>
            )}
          </div>
          <div className="overflow-x-auto max-h-[560px]">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 sticky top-0 z-10">
                <tr className="text-left text-[10px] uppercase tracking-wider text-ink-500 border-b border-ink-200">
                  <th className="px-3 py-2 font-semibold">Pincode</th>
                  <th className="px-3 py-2 font-semibold">Location</th>
                  {services.map((s) => (
                    <th key={s} className="px-3 py-2 font-semibold whitespace-nowrap">{labelOf[s]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.pincode} className="border-b border-ink-100 hover:bg-ink-100/40 transition align-top">
                    <td className="px-3 py-2.5 tabular-nums font-semibold text-ink-900">{r.pincode}</td>
                    <td className="px-3 py-2.5 text-[12px] text-ink-700">
                      {r.city || <span className="text-ink-400">unknown</span>}
                      {r.state && <div className="text-[11px] text-ink-500">{r.state}</div>}
                    </td>
                    {services.map((key) => {
                      const cell = r.services.find((s) => s.service === key);
                      const n = cell?.providers ?? 0;
                      return (
                        <td key={key} className="px-3 py-2.5">
                          {n > 0 ? (
                            <>
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-success-600">
                                <Check className="w-3 h-3" />{n}
                              </span>
                              {cell!.top.length > 0 && (
                                <div className="text-[11px] text-ink-500 mt-0.5 max-w-[240px]">
                                  {cell!.top.join(', ')}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] font-semibold text-danger-500">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-ink-300 bg-surface px-4 py-14 text-center">
          <MapPin className="w-7 h-7 text-ink-300 mx-auto mb-2" />
          <div className="text-sm font-semibold text-ink-900 mb-1">Check serviceability</div>
          <div className="text-xs text-ink-500 max-w-md mx-auto">
            Search a single pincode, or upload a client&apos;s list to see which of your services
            reach each one — then download the result to send back.
          </div>
        </div>
      )}
    </div>
  );
}

/** Checkbox dropdown over the service types. */
function ServiceSelect({
  all, selected, onChange,
}: {
  all: { key: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const set = new Set(selected);
  const summary = selected.length === 0 ? 'No services'
    : selected.length === 1 ? all.find((s) => s.key === selected[0])?.label ?? '1 service'
    : `${selected.length} services`;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-3 h-9 text-xs font-semibold rounded-md border border-brand-500 bg-surface text-brand-700 dark:text-brand-400 max-w-[220px] transition"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute left-0 top-full mt-1 z-50 w-[250px] rounded-lg border border-ink-200 bg-surface shadow-lg overflow-hidden">
            <div className="flex items-center gap-3 px-2.5 py-2 border-b border-ink-150">
              <button onClick={() => onChange(all.map((s) => s.key))}
                className="text-[11px] font-semibold text-brand-700 dark:text-brand-400 hover:underline">Select all</button>
              <button onClick={() => onChange([])}
                className="text-[11px] font-semibold text-ink-600 hover:text-ink-900 hover:underline">Clear</button>
              <span className="ml-auto text-[11px] text-ink-500 tabular-nums">{selected.length} on</span>
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {all.map((s) => {
                const on = set.has(s.key);
                return (
                  <label key={s.key} className="flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-ink-100/60 transition">
                    <span className={`inline-flex w-3.5 h-3.5 shrink-0 items-center justify-center rounded border transition ${
                      on ? 'bg-brand-600 border-brand-600' : 'border-ink-300 bg-surface'}`}>
                      {on && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />}
                    </span>
                    <input type="checkbox" checked={on} className="sr-only"
                      onChange={() => onChange(on ? selected.filter((x) => x !== s.key) : [...selected, s.key])} />
                    <span className={on ? 'font-semibold text-ink-900' : 'text-ink-700'}>{s.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
