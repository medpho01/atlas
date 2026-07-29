'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Download, ClipboardPaste, CheckCircle2, XCircle } from 'lucide-react';

type CoverageRow = {
  pincode: string;
  city: string | null;
  state: string | null;
  cv_providers: number;
  cv_local_providers: number;
  cv_top_labs: string[] | null;
  hs_providers: number;
  hs_top_labs: string[] | null;
};

export function CoverageClient() {
  const [pincodes, setPincodes] = useState<string[]>([]);
  const [rejected, setRejected] = useState(0);
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const ingest = (values: string[]) => {
    const cleaned = values.map((v) => String(v).trim()).filter(Boolean);
    const valid = Array.from(new Set(cleaned.filter((v) => /^\d{6}$/.test(v))));
    setRejected(cleaned.length - valid.length - (cleaned.length - new Set(cleaned).size));
    setPincodes(valid);
    setRows([]);
    if (valid.length) check(valid);
  };

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      // Flatten every cell — pincodes can be in any column; numbers or text
      const cells: string[] = [];
      raw.forEach((r) => r.forEach((c) => { if (c !== '' && c != null) cells.push(String(c)); }));
      ingest(cells);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const check = async (list: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/coverage/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pincodes: list }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setRows(data.rows ?? []);
    } catch (e) {
      setError((e as Error).message || 'Check failed');
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = () => {
    const sheetRows = rows.map((r) => ({
      Pincode: r.pincode,
      City: r.city ?? '',
      State: r.state ?? '',
      'Center Visit labs (10 km)': r.cv_providers,
      'CV labs at pincode': r.cv_local_providers,
      'Nearest CV labs': (r.cv_top_labs ?? []).join('; '),
      'Home Sample labs': r.hs_providers,
      'HS labs (top 3)': (r.hs_top_labs ?? []).join('; '),
      'Covered?': r.cv_providers > 0 || r.hs_providers > 0 ? 'YES' : 'NO',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), 'Coverage');
    XLSX.writeFile(wb, 'atlas-coverage.xlsx');
  };

  const covered = rows.filter((r) => r.cv_providers > 0 || r.hs_providers > 0).length;
  const bothCount = rows.filter((r) => r.cv_providers > 0 && r.hs_providers > 0).length;

  return (
    <div className="space-y-4">
      {/* Input */}
      <div className="rounded-2xl border border-ink-200 bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-semibold rounded-md bg-ink-900 text-ink-50 hover:bg-ink-800 transition cursor-pointer">
            <Upload className="w-4 h-4" /> Upload Excel / CSV
            <input
              type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.currentTarget.value = ''; }}
            />
          </label>
          <button
            onClick={() => setPasteMode(!pasteMode)}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50 transition"
          >
            <ClipboardPaste className="w-4 h-4" /> Paste pincodes
          </button>
          {pincodes.length > 0 && (
            <span className="text-[12px] text-ink-600">
              {pincodes.length.toLocaleString('en-IN')} valid pincodes
              {rejected > 0 && <span className="text-warn-600"> · {rejected} invalid skipped</span>}
            </span>
          )}
          {rows.length > 0 && (
            <button
              onClick={exportExcel}
              className="ml-auto inline-flex items-center gap-1.5 px-3 h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 transition"
            >
              <Download className="w-4 h-4" /> Download Excel
            </button>
          )}
        </div>
        {pasteMode && (
          <div className="mt-3 space-y-2">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste pincodes — any separator works (newline, comma, space)"
              rows={4}
              className="w-full text-sm rounded-md border border-ink-200 bg-surface p-3 font-mono"
            />
            <button
              onClick={() => { ingest(pasteText.split(/[\s,;]+/)); setPasteMode(false); }}
              className="px-4 h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 transition"
            >
              Check coverage
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-danger-50 border border-danger-100 text-sm text-danger-500">{error}</div>
      )}

      {/* Summary */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="Pincodes checked" value={rows.length} />
          <Tile label="Covered (any service)" value={covered} pct={rows.length ? covered / rows.length : 0} />
          <Tile label="Both services" value={bothCount} pct={rows.length ? bothCount / rows.length : 0} />
          <Tile label="No coverage" value={rows.length - covered} danger={rows.length - covered > 0} />
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="rounded-2xl border border-ink-200 bg-surface p-10 text-center text-sm text-ink-500">
          Checking {pincodes.length.toLocaleString('en-IN')} pincodes…
        </div>
      ) : rows.length > 0 ? (
        <div className="rounded-2xl border border-ink-200 bg-surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-500 border-b border-ink-200">
                <th className="px-4 py-2 font-semibold">Pincode</th>
                <th className="px-2 py-2 font-semibold">Location</th>
                <th className="px-2 py-2 font-semibold text-center">Center visit (10 km)</th>
                <th className="px-2 py-2 font-semibold">Nearest CV labs</th>
                <th className="px-2 py-2 font-semibold text-center">Home sample</th>
                <th className="px-4 py-2 font-semibold">HS labs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const none = r.cv_providers === 0 && r.hs_providers === 0;
                return (
                  <tr key={r.pincode} className={`border-b border-ink-100 ${none ? 'bg-danger-50/40' : ''}`}>
                    <td className="px-4 py-2 tabular-nums font-medium text-ink-900">
                      <span className="inline-flex items-center gap-1.5">
                        {none
                          ? <XCircle className="w-3.5 h-3.5 text-danger-500" />
                          : <CheckCircle2 className="w-3.5 h-3.5 text-success-600" />}
                        {r.pincode}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-[12px] text-ink-700">
                      {r.city ?? '—'}{r.state ? `, ${r.state}` : ''}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                        r.cv_providers > 0 ? 'bg-success-50 text-success-600 border-success-100'
                                           : 'bg-ink-100 text-ink-500 border-ink-200'
                      }`}>
                        {r.cv_providers}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-[11px] text-ink-600 max-w-[280px]">
                      {(r.cv_top_labs ?? []).join(' · ') || '—'}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                        r.hs_providers > 0 ? 'bg-success-50 text-success-600 border-success-100'
                                           : 'bg-ink-100 text-ink-500 border-ink-200'
                      }`}>
                        {r.hs_providers}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[11px] text-ink-600 max-w-[240px]">
                      {(r.hs_top_labs ?? []).join(' · ') || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Tile({ label, value, pct, danger }: { label: string; value: number; pct?: number; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-3.5">
      <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-0.5">{label}</div>
      <div className={`text-2xl font-bold tabular-nums leading-tight ${danger && value > 0 ? 'text-danger-500' : 'text-ink-900'}`}>
        {value.toLocaleString('en-IN')}
        {pct !== undefined && <span className="text-sm font-semibold text-ink-500 ml-1.5">{Math.round(pct * 100)}%</span>}
      </div>
    </div>
  );
}
