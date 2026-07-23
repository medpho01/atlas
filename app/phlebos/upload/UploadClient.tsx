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
  email?: string;
  notes?: string;
  __phoneRaw: string;
  __rowIndex: number;
  __issue?: string;
};

// Case-insensitive column matcher: accepts variants like "Phone Number", "PHONE", etc.
const KEY_ALIASES: Record<string, string[]> = {
  phone:   ['phone', 'mobile', 'phone number', 'contact', 'phone_number', 'mobile number', 'contact number'],
  name:    ['name', 'full name', 'phlebo name', 'phlebo', 'first name'],
  city:    ['city', 'town'],
  state:   ['state', 'region'],
  pincode: ['pincode', 'pin code', 'zip', 'postal code', 'pin'],
  email:   ['email', 'email address', 'mail'],
  notes:   ['notes', 'note', 'remarks', 'comment'],
};

function findKey(headerRow: string[], target: string): string | undefined {
  const wanted = KEY_ALIASES[target].map((s) => s.toLowerCase().replace(/[_\s]/g, ''));
  return headerRow.find((h) => wanted.includes((h ?? '').toString().toLowerCase().replace(/[_\s]/g, '')));
}

function normalizePhone(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

export function UploadClient({ uploadedBy }: { uploadedBy: string }) {
  const [filename, setFilename] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
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
      // header:1 → keeps header row so we can match aliases
      const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (!raw.length) throw new Error('File is empty.');
      const header = raw[0].map((h) => String(h ?? '').trim());

      const kPhone   = findKey(header, 'phone');
      const kName    = findKey(header, 'name');
      const kCity    = findKey(header, 'city');
      const kState   = findKey(header, 'state');
      const kPincode = findKey(header, 'pincode');
      const kEmail   = findKey(header, 'email');
      const kNotes   = findKey(header, 'notes');

      if (!kPhone || !kName) {
        throw new Error(
          `Missing required column. Need "phone" and "name" (case-insensitive). Found: ${header.join(', ')}`,
        );
      }

      const idx = (col: string | undefined) => (col ? header.indexOf(col) : -1);
      const iPhone = idx(kPhone), iName = idx(kName);
      const iCity = idx(kCity), iState = idx(kState), iPincode = idx(kPincode);
      const iEmail = idx(kEmail), iNotes = idx(kNotes);

      const rows: ParsedRow[] = [];
      for (let r = 1; r < raw.length; r++) {
        const row = raw[r];
        if (!row || row.every((c) => c === '' || c == null)) continue;

        const phoneRaw = String(row[iPhone] ?? '').trim();
        const phone = normalizePhone(phoneRaw);
        const name = String(row[iName] ?? '').trim();

        let issue: string | undefined;
        if (!phone) issue = 'no phone';
        else if (phone.length < 10) issue = 'phone must be at least 10 digits';
        if (!issue && !name) issue = 'missing name';

        rows.push({
          phone,
          name,
          city:    iCity    >= 0 ? String(row[iCity] ?? '').trim() || undefined : undefined,
          state:   iState   >= 0 ? String(row[iState] ?? '').trim() || undefined : undefined,
          pincode: iPincode >= 0 ? String(row[iPincode] ?? '').trim() || undefined : undefined,
          email:   iEmail   >= 0 ? String(row[iEmail] ?? '').trim() || undefined : undefined,
          notes:   iNotes   >= 0 ? String(row[iNotes] ?? '').trim() || undefined : undefined,
          __phoneRaw: phoneRaw,
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
    if (!good.length) {
      setError('No valid rows to import.');
      return;
    }
    startTransition(async () => {
      // Strip helper fields before sending
      const payload = good.map(({ phone, name, city, state, pincode, email, notes }) => ({
        phone, name, city, state, pincode, email, notes,
      }));
      const res = await commitUpload({ filename: filename ?? 'unnamed.csv', rows: payload });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res.result);
    });
  };

  const reset = () => {
    setFilename(null);
    setParsed([]);
    setResult(null);
    setError(null);
  };

  const goodCount = parsed.filter((p) => !p.__issue).length;
  const badCount = parsed.length - goodCount;

  return (
    <div className="space-y-5">
      {/* File picker */}
      {!parsed.length && !result && (
        <label className="flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed border-ink-300 rounded-xl bg-surface hover:border-brand-400 hover:bg-brand-50/30 transition cursor-pointer">
          <Upload className="w-8 h-8 text-ink-400" />
          <div className="text-sm font-semibold text-ink-900">Click to select file</div>
          <div className="text-xs text-ink-500">.xlsx, .xls, or .csv</div>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </label>
      )}

      {/* Preview */}
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
            <button
              onClick={reset}
              className="text-xs text-ink-500 hover:text-ink-900 inline-flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Choose different file
            </button>
          </div>

          <div className="max-h-[440px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 sticky top-0">
                <tr className="text-left text-[11px] uppercase tracking-wider text-ink-500 border-b border-ink-200">
                  <th className="px-3 py-2 font-semibold">Row</th>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Phone</th>
                  <th className="px-3 py-2 font-semibold">Location</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 100).map((p) => (
                  <tr key={p.__rowIndex} className="border-b border-ink-100">
                    <td className="px-3 py-2 text-[11px] text-ink-500 tabular-nums">{p.__rowIndex}</td>
                    <td className="px-3 py-2 text-[13px] text-ink-900">{p.name || <span className="text-danger-500 italic">missing</span>}</td>
                    <td className="px-3 py-2 text-[12px] tabular-nums font-mono">{p.phone || <span className="text-danger-500 italic">—</span>}</td>
                    <td className="px-3 py-2 text-[12px] text-ink-700">
                      {[p.city, p.state, p.pincode].filter(Boolean).join(' · ') || <span className="text-ink-400">—</span>}
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
              Existing phlebos matched by phone will be updated.
            </div>
            <button
              onClick={commit}
              disabled={pending || goodCount === 0}
              className="inline-flex items-center gap-1.5 px-4 h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pending ? 'Importing…' : `Import ${goodCount.toLocaleString('en-IN')} phlebo${goodCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="p-6 rounded-xl border border-success-100 bg-success-50">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-success-600 shrink-0" />
            <div className="flex-1">
              <h3 className="text-lg font-bold text-ink-900">Import complete</h3>
              <p className="text-sm text-ink-700 mt-1">
                <b>{result.inserted}</b> new phlebos added, <b>{result.updated}</b> existing updated, <b>{result.skipped}</b> skipped (invalid phone/name).
              </p>
              <div className="mt-4 flex gap-2">
                <Link
                  href="/phlebos"
                  className="inline-flex items-center gap-1 px-3 h-8 text-sm font-semibold rounded-md bg-success-500 text-white hover:bg-success-600"
                >
                  View phlebos
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

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl border border-danger-100 bg-danger-50 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-danger-500 shrink-0" />
          <div className="text-sm text-danger-500">{error}</div>
        </div>
      )}
    </div>
  );
}
