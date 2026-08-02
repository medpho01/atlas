'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Upload, FileText, CheckCircle2, AlertCircle, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { commitUpload } from './actions';

type ParsedRow = {
  phone: string;
  name: string;
  city?: string;
  state?: string;
  pincode?: string;
  aggregator?: string;
  qualification?: string;
  email?: string;
  notes?: string;
  __rowIndex: number;
  __issue?: string;
};

// Case-insensitive column matcher: accepts variants like "Phone Number", "PHONE".
const KEY_ALIASES: Record<string, string[]> = {
  phone:         ['phone', 'mobile', 'phone number', 'contact', 'phone_number', 'mobile number', 'contact number'],
  name:          ['name', 'full name', 'nurse name', 'nurse', 'first name'],
  city:          ['city', 'town'],
  state:         ['state', 'region'],
  pincode:       ['pincode', 'pin code', 'zip', 'postal code', 'pin'],
  aggregator:    ['aggregator', 'agency', 'supplier', 'partner', 'vendor', 'source agency', 'company'],
  qualification: ['qualification', 'course', 'degree', 'education'],
  email:         ['email', 'email address', 'mail'],
  notes:         ['notes', 'note', 'remarks', 'comment'],
};

function findKey(headerRow: string[], target: string): string | undefined {
  const wanted = KEY_ALIASES[target].map((s) => s.toLowerCase().replace(/[_\s]/g, ''));
  return headerRow.find((h) => wanted.includes((h ?? '').toString().toLowerCase().replace(/[_\s]/g, '')));
}

function normalizePhone(raw: string): string {
  let d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

export function UploadClient({ uploadedBy }: { uploadedBy: string }) {
  const [filename, setFilename] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [hasAggCol, setHasAggCol] = useState(false);
  const [defaultAggregator, setDefaultAggregator] = useState('');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<null | { inserted: number; updated: number; skipped: number; total: number }>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setResult(null);
    setFilename(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (!raw.length) throw new Error('File is empty.');
      const header = raw[0].map((h) => String(h ?? '').trim());

      const kPhone = findKey(header, 'phone');
      const kName  = findKey(header, 'name');
      if (!kPhone || !kName) {
        throw new Error(
          `Missing required column. Need "phone" and "name" (case-insensitive). Found: ${header.join(', ')}`,
        );
      }

      const idx = (t: string) => { const k = findKey(header, t); return k ? header.indexOf(k) : -1; };
      const iPhone = header.indexOf(kPhone), iName = header.indexOf(kName);
      const iCity = idx('city'), iState = idx('state'), iPincode = idx('pincode');
      const iAgg = idx('aggregator'), iQual = idx('qualification');
      const iEmail = idx('email'), iNotes = idx('notes');
      setHasAggCol(iAgg >= 0);

      const cell = (row: unknown[], i: number) =>
        i >= 0 ? String(row[i] ?? '').trim() || undefined : undefined;

      const rows: ParsedRow[] = [];
      for (let r = 1; r < raw.length; r++) {
        const row = raw[r];
        if (!row || row.every((c) => c === '' || c == null)) continue;

        const phone = normalizePhone(String(row[iPhone] ?? ''));
        const name = String(row[iName] ?? '').trim();

        let issue: string | undefined;
        if (!phone) issue = 'no phone';
        else if (phone.length !== 10) issue = 'phone must be 10 digits';
        if (!issue && !name) issue = 'missing name';

        rows.push({
          phone, name,
          city:          cell(row, iCity),
          state:         cell(row, iState),
          pincode:       cell(row, iPincode),
          aggregator:    cell(row, iAgg),
          qualification: cell(row, iQual),
          email:         cell(row, iEmail),
          notes:         cell(row, iNotes),
          __rowIndex: r + 1,
          __issue: issue,
        });
      }

      if (!rows.length) throw new Error('No data rows found.');
      setParsed(rows);
    } catch (e) {
      setError((e as Error).message);
      setParsed([]);
    }
  };

  const commit = () => {
    const good = parsed.filter((p) => !p.__issue);
    if (!good.length) { setError('No valid rows to import.'); return; }
    startTransition(async () => {
      const payload = good.map(({ phone, name, city, state, pincode, aggregator, qualification, email, notes }) => ({
        phone, name, city, state, pincode, aggregator, qualification, email, notes,
      }));
      const res = await commitUpload({
        filename: filename ?? 'unnamed.csv',
        rows: payload,
        defaultAggregator: defaultAggregator.trim() || undefined,
      });
      if (!res.ok) { setError(res.error); return; }
      setResult(res.result);
    });
  };

  const reset = () => {
    setFilename(null); setParsed([]); setResult(null); setError(null);
    setHasAggCol(false); setDefaultAggregator('');
  };

  const goodCount = parsed.filter((p) => !p.__issue).length;
  const badCount = parsed.length - goodCount;
  const missingAgg = parsed.filter((p) => !p.__issue && !p.aggregator).length;

  return (
    <div className="space-y-5">
      {!parsed.length && !result && (
        <label className="flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed border-ink-300 rounded-xl bg-surface hover:border-brand-400 hover:bg-brand-50/30 transition cursor-pointer">
          <Upload className="w-8 h-8 text-ink-400" />
          <div className="text-sm font-semibold text-ink-900">Click to select file</div>
          <div className="text-xs text-ink-500">.xlsx, .xls, or .csv</div>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </label>
      )}

      {parsed.length > 0 && !result && (
        <div className="rounded-xl border border-ink-200 bg-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand-600" />
              <div>
                <div className="text-sm font-semibold text-ink-900">{filename}</div>
                <div className="text-xs text-ink-500">
                  {parsed.length} rows found · <span className="text-success-600 font-medium">{goodCount} ready</span>
                  {badCount > 0 && <span className="text-danger-500 font-medium"> · {badCount} with issues</span>}
                </div>
              </div>
            </div>
            <button onClick={reset} className="text-xs text-ink-500 hover:text-ink-900 inline-flex items-center gap-1">
              <X className="w-3 h-3" /> Choose different file
            </button>
          </div>

          {/* Aggregator is the axis nurses are searched on, so make it hard to
              upload a nameless batch: offer one value for the whole file. */}
          {missingAgg > 0 && (
            <div className="px-4 py-3 border-b border-ink-200 bg-warn-50/60">
              <label className="text-xs text-ink-800">
                <span className="font-semibold">
                  {hasAggCol
                    ? `${missingAgg} row${missingAgg === 1 ? ' has' : 's have'} no aggregator.`
                    : 'This file has no aggregator column.'}
                </span>{' '}
                Set one for the whole batch — otherwise these nurses won&apos;t appear under any aggregator filter.
                <input
                  type="text"
                  value={defaultAggregator}
                  onChange={(e) => setDefaultAggregator(e.target.value)}
                  placeholder="e.g. Portea, Nightingales, Freelancer"
                  className="mt-2 block w-full max-w-sm px-2 h-8 text-sm rounded-md border border-ink-200 bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                />
              </label>
            </div>
          )}

          <div className="max-h-[440px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 sticky top-0">
                <tr className="text-left text-[11px] uppercase tracking-wider text-ink-500 border-b border-ink-200">
                  <th className="px-3 py-2 font-semibold">Row</th>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Phone</th>
                  <th className="px-3 py-2 font-semibold">Location</th>
                  <th className="px-3 py-2 font-semibold">Aggregator</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 100).map((p) => (
                  <tr key={p.__rowIndex} className="border-b border-ink-100">
                    <td className="px-3 py-2 text-[11px] text-ink-500 tabular-nums">{p.__rowIndex}</td>
                    <td className="px-3 py-2 text-[13px] text-ink-900">
                      {p.name || <span className="text-danger-500 italic">missing</span>}
                    </td>
                    <td className="px-3 py-2 text-[12px] tabular-nums font-mono">
                      {p.phone || <span className="text-danger-500 italic">—</span>}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-ink-700">
                      {[p.city, p.state, p.pincode].filter(Boolean).join(' · ') || <span className="text-ink-400">—</span>}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-ink-700">
                      {p.aggregator || (
                        <span className={defaultAggregator ? 'text-brand-700 dark:text-brand-400' : 'text-ink-400'}>
                          {defaultAggregator || '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {p.__issue ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-danger-500">
                          <AlertCircle className="w-3 h-3" /> {p.__issue}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-success-600">
                          <CheckCircle2 className="w-3 h-3" /> ready
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.length > 100 && (
              <div className="text-center px-3 py-2 bg-ink-50 text-xs text-ink-500 border-t border-ink-200">
                Preview of first 100 rows. All {parsed.length.toLocaleString('en-IN')} rows will be committed.
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-ink-200 flex items-center justify-between bg-ink-50">
            <div className="text-xs text-ink-600">
              Committing as <span className="font-semibold text-ink-900">{uploadedBy}</span>.
              Existing nurses matched by phone will be updated.
            </div>
            <button
              onClick={commit}
              disabled={pending || goodCount === 0}
              className="inline-flex items-center gap-1.5 px-4 h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pending ? 'Importing…' : `Import ${goodCount.toLocaleString('en-IN')} nurse${goodCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="p-6 rounded-xl border border-success-100 bg-success-50">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-success-600 shrink-0" />
            <div className="flex-1">
              <h3 className="text-lg font-bold text-ink-900">Import complete</h3>
              <p className="text-sm text-ink-700 mt-1">
                <b>{result.inserted}</b> new nurses added, <b>{result.updated}</b> existing updated,{' '}
                <b>{result.skipped}</b> skipped (invalid phone/name).
              </p>
              <div className="mt-4 flex gap-2">
                <Link
                  href="/nurses"
                  className="inline-flex items-center gap-1 px-3 h-8 text-sm font-semibold rounded-md bg-success-500 text-white hover:bg-success-600"
                >
                  View nurses
                </Link>
                <button
                  onClick={reset}
                  className="inline-flex items-center gap-1 px-3 h-8 text-sm font-semibold rounded-md bg-surface text-success-600 border border-success-100 hover:bg-success-50"
                >
                  Upload another file
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl border border-danger-100 bg-danger-50 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-danger-500 shrink-0" />
          <div className="text-sm text-danger-500">{error}</div>
        </div>
      )}
    </div>
  );
}
