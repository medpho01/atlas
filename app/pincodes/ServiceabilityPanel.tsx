'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Search, Upload, ClipboardPaste, Download, X, Check, ChevronDown, MapPin, AlertTriangle,
  Building2, FlaskConical, Plus,
} from 'lucide-react';

type ServiceCell = { service: string; providers: number; local_providers: number; top: string[] };
type Row = { pincode: string; city: string | null; state: string | null; services: ServiceCell[] };
type CityCell = { service: string; covered: number; best: number; top: string[] };
type CityRow = { input: string; city: string | null; state: string | null; pincodes: number; services: CityCell[] };
type TestOption = { name: string; category: string | null; labs: number; entries: number };
/** Every provider kind that offers a modality, as one pick. */
/** Lab records spell the same city several ways; group them as one. */
const CITY_ALIASES: Record<string, string> = {
  bangalore: 'Bengaluru', bengaluru: 'Bengaluru', bombay: 'Mumbai', madras: 'Chennai',
  calcutta: 'Kolkata', cochin: 'Kochi', ernakulam: 'Kochi', gurgaon: 'Gurugram',
  poona: 'Pune', secunderabad: 'Hyderabad', 'new delhi': 'Delhi', trivandrum: 'Thiruvananthapuram',
  pondicherry: 'Puducherry', baroda: 'Vadodara', mysore: 'Mysuru', mangalore: 'Mangaluru',
  vizag: 'Visakhapatnam', 'navi mumbai': 'Mumbai', thane: 'Mumbai', noida: 'Delhi',
  ghaziabad: 'Delhi', faridabad: 'Delhi',
};
const canonicalCity = (n: string | null) => {
  const t = (n ?? '').trim();
  return CITY_ALIASES[t.toLowerCase()] ?? t;
};

const MODALITY_GROUPS = [
  { key: 'CENTER_VISIT', label: 'All centre visit' },
  { key: 'HOME_SAMPLE',  label: 'All home sample' },
  { key: 'HOME_VISIT',   label: 'All home visit' },
];

type Centre = {
  entity_id: string; name: string; kind: string; modalities: string[];
  city: string | null; state: string | null; pincode: string | null; address: string | null;
  area: string | null; chain: string | null; home_collection: boolean;
  /** The searched city this centre sits in, when it was found through one. */
  group?: string | null;
  covers: number; sample: string[]; nearest_km: number | null; tests_listed: number;
};

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
  const [cityInput, setCityInput] = useState('');
  const [cities, setCities] = useState<string[]>([]);
  const [cityRows, setCityRows] = useState<CityRow[]>([]);
  const [tests, setTests] = useState<string[]>([]);
  const [catalogue, setCatalogue] = useState<{ with_dos: number; active_labs: number } | null>(null);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [scanned, setScanned] = useState(0);
  const [centreQ, setCentreQ] = useState('');

  const labelOf = useMemo(
    () => Object.fromEntries(allServices.map((s) => [s.key, s.label])),
    [allServices],
  );

  const run = async (pins: string[], label: string | null, cityList = cities) => {
    if (!pins.length && !cityList.length) { setError('Add a pincode or a city.'); return; }
    if (!services.length) { setError('Pick at least one service.'); return; }
    setLoading(true); setError(null); setSourceLabel(label);
    try {
      const r = await fetch('/api/coverage/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pincodes: pins, cities: cityList, services, tests }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setRows(data.rows ?? []);
      setCityRows(data.cityRows ?? []);
      setCentres(data.centres ?? []);
      setScanned(data.scannedPincodes ?? 0);
      setTruncated(!!data.truncated);
    } catch (e) {
      setError((e as Error).message || 'Lookup failed');
      setRows([]); setCityRows([]); setCentres([]);
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

  // A test filter changes the answer, so re-ask rather than leaving stale
  // counts on screen next to a chip that no longer matches them.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (pincodes.length || cities.length) run(pincodes, sourceLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tests.join('|')]);

  const shownCentres = useMemo(() => {
    const t = centreQ.trim().toLowerCase();
    if (!t) return centres;
    return centres.filter((c) =>
      c.name.toLowerCase().includes(t) ||
      (c.city ?? '').toLowerCase().includes(t) ||
      (c.state ?? '').toLowerCase().includes(t) ||
      (c.pincode ?? '').includes(t));
  }, [centres, centreQ]);

  // Pincodes covered is a home-collection idea: we travel to them. For a
  // walk-in centre the patient travels, so the address is the answer and a
  // list of pincodes would be noise.
  const showsHome = centres.some((c) => c.modalities.includes('HOME_SAMPLE'));

  /**
   * A network workbook, not a data dump: a Summary that can be read on its own,
   * then one tab per city with the centre-level detail behind it.
   */
  const exportCentres = () => {
    const wb = XLSX.utils.book_new();
    const today = new Date().toLocaleDateString('en-GB',
      { day: '2-digit', month: 'long', year: 'numeric' });
    const isHospital = (c: Centre) => c.kind === 'HOSPITAL';
    const label = (c: Centre) => (isHospital(c) ? 'Hospital' : 'Diagnostic Centre');

    // Group by the centre's own city — that is what the data actually says,
    // and it keeps Thane and Navi Mumbai visible rather than folded away.
    const byCity = new Map<string, Centre[]>();
    for (const c of shownCentres) {
      // Prefer the city that was searched for; the centre's own city field is
      // full of localities.
      const key = c.group ?? canonicalCity(c.city) ?? '';
      const k = key || 'Other';
      if (!byCity.has(k)) byCity.set(k, []);
      byCity.get(k)!.push(c);
    }
    const ordered = [...byCity.entries()].sort((a, b) => b[1].length - a[1].length);

    const modalityNames = [...new Set(shownCentres.flatMap((c) => c.modalities))]
      .map((m) => m.replace('_', ' ').toLowerCase()).join(' + ');

    const summary: (string | number)[][] = [
      ['LabStack — ' + (modalityNames || 'network')],
      ['Partner centres reaching the locations searched'],
      ['Network snapshot as of ' + today],
      [],
      ['City', 'Total Centres', 'Diagnostic Centres', 'Hospitals', 'Chains / Brands', 'With Home Collection'],
    ];
    for (const [city, list] of ordered) {
      summary.push([
        city,
        list.length,
        list.filter((c) => !isHospital(c)).length,
        list.filter(isHospital).length,
        new Set(list.map((c) => c.chain).filter(Boolean)).size,
        list.filter((c) => c.home_collection).length,
      ]);
    }
    summary.push([
      'Total',
      shownCentres.length,
      shownCentres.filter((c) => !isHospital(c)).length,
      shownCentres.filter(isHospital).length,
      new Set(shownCentres.map((c) => c.chain).filter(Boolean)).size,
      shownCentres.filter((c) => c.home_collection).length,
    ]);
    summary.push([], ['Notes']);
    summary.push(['• Each city tab carries the centre-level detail behind its row here.']);
    summary.push([`• ${scanned.toLocaleString('en-IN')} pincodes were searched; a centre appears once however many it reaches.`]);
    summary.push(['• "Chains / Brands" counts distinct chains; independent centres are excluded from that count.']);
    if (tests.length) {
      summary.push([`• Restricted to centres listing: ${tests.join(', ')}. Labs with no catalogue recorded are excluded.`]);
    }
    const sum = XLSX.utils.aoa_to_sheet(summary);
    sum['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 18 }, { wch: 11 }, { wch: 16 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, sum, 'Summary');

    // Excel forbids : \ / ? * [ ] in a sheet name, and caps it at 31 chars.
    const used = new Set<string>();
    const tabName = (city: string) => {
      let n = city.replace(/[:\\/?*[\]]/g, ' ').slice(0, 28).trim() || 'Unknown';
      let i = 2;
      while (used.has(n.toLowerCase())) n = `${n.slice(0, 25)} ${i++}`;
      used.add(n.toLowerCase());
      return n;
    };

    for (const [city, list] of ordered) {
      const rowsOut: (string | number)[][] = [
        [`${city} — ${modalityNames || 'network'}`],
        [`${list.length} centres · ${list.filter((c) => c.home_collection).length} with home collection`],
        [],
        ['Sr No', 'Centre Name', 'Centre Type', 'Chain / Brand', 'Area', 'Pincode', 'Home Collection', 'Full Address'],
      ];
      list
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((c, i) => rowsOut.push([
          i + 1, c.name, label(c), c.chain ?? 'Independent',
          c.area ?? '', c.pincode ?? '', c.home_collection ? 'Yes' : 'No',
          c.address ?? '',
        ]));
      const ws = XLSX.utils.aoa_to_sheet(rowsOut);
      ws['!cols'] = [{ wch: 7 }, { wch: 44 }, { wch: 18 }, { wch: 22 },
                     { wch: 20 }, { wch: 10 }, { wch: 16 }, { wch: 60 }];
      XLSX.utils.book_append_sheet(wb, ws, tabName(city));
    }

    // One flat sheet as well, for anyone who wants to pivot it themselves.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shownCentres.map((c) => ({
      Centre: c.name,
      'Centre Type': label(c),
      'Chain / Brand': c.chain ?? 'Independent',
      Services: c.modalities.map((m) => m.replace('_', ' ').toLowerCase()).join('; '),
      Area: c.area ?? '',
      City: c.city ?? '',
      State: c.state ?? '',
      Pincode: c.pincode ?? '',
      'Home Collection': c.home_collection ? 'Yes' : 'No',
      'Full address': c.address ?? '',
      ...(showsHome ? {
        'Pincodes covered': c.modalities.includes('HOME_SAMPLE') ? c.covers : '',
        'Sample pincodes': c.modalities.includes('HOME_SAMPLE') ? c.sample.join('; ') : '',
      } : {}),
    }))), 'All centres');

    XLSX.writeFile(wb, 'labstack-network.xlsx');
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

          <form
            className="relative flex-1 min-w-[220px]"
            onSubmit={(e) => {
              e.preventDefault();
              const c = cityInput.trim();
              if (!c) return;
              const next = [...new Set([...cities, c])];
              setCities(next); setCityInput('');
              run(pincodes, sourceLabel, next);
            }}
          >
            <Building2 className="absolute left-2.5 top-2.5 w-4 h-4 text-ink-400" />
            <input
              value={cityInput}
              onChange={(e) => setCityInput(e.target.value)}
              placeholder="…or a city — e.g. Bengaluru"
              className="w-full pl-8 pr-3 h-9 text-sm rounded-md border border-ink-200 bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
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

        {(cities.length > 0 || tests.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {cities.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 pl-2 pr-1 h-6 text-xs rounded-md border border-brand-200 bg-brand-50 text-brand-700">
                <Building2 className="w-3 h-3" /> {c}
                <button
                  onClick={() => { const next = cities.filter((x) => x !== c); setCities(next); run(pincodes, sourceLabel, next); }}
                  className="p-0.5 hover:text-danger-500" aria-label={`Remove ${c}`}
                ><X className="w-3 h-3" /></button>
              </span>
            ))}
            {tests.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 pl-2 pr-1 h-6 text-xs rounded-md border border-ink-200 bg-ink-50 text-ink-700">
                <FlaskConical className="w-3 h-3" /> {t}
                <button
                  onClick={() => setTests(tests.filter((x) => x !== t))}
                  className="p-0.5 hover:text-danger-500" aria-label={`Remove ${t}`}
                ><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}

        <TestPicker
          selected={tests}
          onChange={setTests}
          onCatalogue={setCatalogue}
        />

        {tests.length > 0 && catalogue && (
          <p className="text-[11px] text-warn-600 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            Only labs are counted, and only those that list the test. {catalogue.with_dos.toLocaleString('en-IN')} of{' '}
            {catalogue.active_labs.toLocaleString('en-IN')} active labs have a catalogue at all — the rest are
            unrecorded, not incapable.
          </p>
        )}

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

      {/* The union — every centre reaching ANY of the locations asked for.
          This is the list people actually want to send on. */}
      {!loading && centres.length > 0 && (
        <div className="rounded-2xl border border-ink-200 bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-ink-200 bg-ink-50 flex flex-wrap items-center gap-3">
            <span className="text-xs text-ink-600">
              <b className="text-ink-900">{centres.length.toLocaleString('en-IN')}</b> centres across{' '}
              <b className="text-ink-900">{scanned.toLocaleString('en-IN')}</b> pincodes
              <span className="text-ink-400"> · union, one row per centre</span>
            </span>
            <input
              value={centreQ}
              onChange={(e) => setCentreQ(e.target.value)}
              placeholder="Filter centres…"
              className="ml-auto h-7 px-2 text-xs rounded-md border border-ink-200 bg-surface w-48 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <button
              onClick={exportCentres}
              className="inline-flex items-center gap-1.5 px-2.5 h-7 text-xs font-semibold rounded-md bg-ink-900 text-ink-50 hover:bg-ink-800 transition"
            >
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
          </div>
          <div className="overflow-x-auto max-h-[520px]">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 sticky top-0 z-10">
                <tr className="text-left text-[10px] uppercase tracking-wider text-ink-500 border-b border-ink-200">
                  <th className="px-4 py-2 font-semibold">Centre</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Full address</th>
                  {showsHome && <th className="px-3 py-2 font-semibold text-right">Pincodes covered</th>}
                </tr>
              </thead>
              <tbody>
                {shownCentres.map((c) => (
                  <tr key={c.entity_id} className="border-b border-ink-100 last:border-0 hover:bg-ink-50/60">
                    <td className="px-4 py-2 max-w-[320px]">
                      <div className="truncate text-ink-900" title={c.name}>{c.name}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-600 whitespace-nowrap">
                      {c.kind.toLowerCase()}
                      <div className="text-[11px] text-ink-400">
                        {c.modalities.map((m) => m.replace('_', ' ').toLowerCase()).join(', ')}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-600 max-w-[420px]">
                      {c.address ?? (
                        <span className="text-ink-400">
                          {[c.city, c.state, c.pincode].filter(Boolean).join(', ') || 'no address on record'}
                        </span>
                      )}
                    </td>
                    {showsHome && (
                      <td className="px-3 py-2 text-right align-top">
                        {c.modalities.includes('HOME_SAMPLE') ? (
                          <>
                            <div className="tabular-nums text-ink-900">{c.covers.toLocaleString('en-IN')}</div>
                            <div className="text-[11px] text-ink-400 truncate max-w-[160px]" title={c.sample.join(', ')}>
                              {c.sample.slice(0, 3).join(', ')}{c.covers > 3 ? ` +${c.covers - 3}` : ''}
                            </div>
                          </>
                        ) : <span className="text-ink-300">—</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shownCentres.length < centres.length && (
            <div className="px-4 py-2 text-[11px] text-ink-400 border-t border-ink-100">
              Showing {shownCentres.length.toLocaleString('en-IN')} of {centres.length.toLocaleString('en-IN')} — the Excel has all of them.
            </div>
          )}
        </div>
      )}

      {/* Cities — a city is rarely all-or-nothing, so the share of its
          pincodes covered is the honest answer. */}
      {!loading && cityRows.length > 0 && (
        <div className="rounded-2xl border border-ink-200 bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-ink-200 bg-ink-50 text-xs text-ink-600">
            <b className="text-ink-900">{cityRows.length}</b> {cityRows.length === 1 ? 'city' : 'cities'}
            <span className="text-ink-400"> · share of each city&rsquo;s pincodes a service reaches</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50">
                <tr className="text-left text-[10px] uppercase tracking-wider text-ink-500 border-b border-ink-200">
                  <th className="px-4 py-2 font-semibold">City</th>
                  <th className="px-3 py-2 font-semibold text-right">Pincodes</th>
                  {services.map((k) => (
                    <th key={k} className="px-3 py-2 font-semibold">{labelOf[k]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cityRows.map((c) => (
                  <tr key={c.input + (c.city ?? '')} className="border-b border-ink-100 last:border-0 hover:bg-ink-50/60">
                    <td className="px-4 py-2">
                      {c.city ? (
                        <>
                          <span className="font-medium text-ink-900">{c.city}</span>
                          {c.state && <span className="text-ink-400 text-xs"> · {c.state}</span>}
                          {c.city.toLowerCase() !== c.input.toLowerCase() && (
                            <span className="text-ink-400 text-[11px]"> (matched &ldquo;{c.input}&rdquo;)</span>
                          )}
                        </>
                      ) : (
                        <span className="text-danger-500">&ldquo;{c.input}&rdquo; — no such city</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-600">
                      {c.pincodes ? c.pincodes.toLocaleString('en-IN') : '—'}
                    </td>
                    {services.map((k) => {
                      const cell = c.services.find((x) => x.service === k);
                      const pct = c.pincodes ? Math.round(100 * (cell?.covered ?? 0) / c.pincodes) : 0;
                      return (
                        <td key={k} className="px-3 py-2">
                          {!c.pincodes ? <span className="text-ink-300">—</span> : (
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-ink-100 overflow-hidden shrink-0">
                                <div className={`h-full rounded-full ${pct >= 80 ? 'bg-success-500' : pct >= 30 ? 'bg-warn-500' : 'bg-danger-500'}`}
                                     style={{ width: `${pct}%` }} />
                              </div>
                              <span className="tabular-nums text-xs text-ink-700">{pct}%</span>
                              <span className="tabular-nums text-[11px] text-ink-400">
                                {(cell?.covered ?? 0).toLocaleString('en-IN')}/{c.pincodes.toLocaleString('en-IN')}
                              </span>
                            </div>
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
      )}

      {/* Results */}
      {loading ? (
        <div className="rounded-2xl border border-ink-200 bg-surface px-4 py-12 text-center text-sm text-ink-500">
          Checking {[
            pincodes.length ? `${pincodes.length.toLocaleString('en-IN')} pincode${pincodes.length === 1 ? '' : 's'}` : '',
            cities.length ? `${cities.length} ${cities.length === 1 ? 'city' : 'cities'}` : '',
          ].filter(Boolean).join(' and ')}…
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
            {/* People think in modalities, not kind × modality pairs — asking
                for "centre visit" means labs AND hospitals, and picking one and
                missing the other is the easiest mistake to make here. */}
            <div className="px-2.5 py-2 border-b border-ink-150 space-y-1.5">
              <div className="flex flex-wrap gap-1">
                {MODALITY_GROUPS.map((g) => {
                  const keys = all.filter((s) => s.key.endsWith('|' + g.key)).map((s) => s.key);
                  if (!keys.length) return null;
                  const on = keys.every((k) => set.has(k));
                  return (
                    <button
                      key={g.key}
                      onClick={() => onChange(on
                        ? selected.filter((k) => !keys.includes(k))
                        : [...new Set([...selected, ...keys])])}
                      className={`px-1.5 py-0.5 text-[11px] font-semibold rounded border transition ${
                        on ? 'border-brand-500 bg-brand-50 text-brand-700 dark:text-brand-400'
                           : 'border-ink-200 text-ink-600 hover:bg-ink-100'}`}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => onChange(all.map((s) => s.key))}
                  className="text-[11px] font-semibold text-brand-700 dark:text-brand-400 hover:underline">Select all</button>
                <button onClick={() => onChange([])}
                  className="text-[11px] font-semibold text-ink-600 hover:text-ink-900 hover:underline">Clear</button>
                <span className="ml-auto text-[11px] text-ink-500 tabular-nums">{selected.length} on</span>
              </div>
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

/**
 * Typeahead over the master test catalogue. Results are ordered by how many
 * labs offer the test, so a filter that would return nothing sorts last rather
 * than looking like a plausible choice.
 */
function TestPicker({
  selected, onChange, onCatalogue,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
  onCatalogue: (c: { with_dos: number; active_labs: number }) => void;
}) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<TestOption[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { setOpts([]); return; }
      setBusy(true);
      try {
        const r = await fetch(`/api/coverage/tests?q=${encodeURIComponent(q.trim())}`);
        if (r.ok) {
          const d = await r.json();
          setOpts(d.tests ?? []);
          if (d.coverage) onCatalogue(d.coverage);
        }
      } finally { setBusy(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [q, onCatalogue]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const add = (name: string) => {
    onChange([...new Set([...selected, name])]);
    setQ(''); setOpts([]); setOpen(false);
  };

  return (
    <div ref={box} className="relative max-w-md">
      <FlaskConical className="absolute left-2.5 top-2.5 w-4 h-4 text-ink-400" />
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Add a test — only centres that can do it will count"
        className="w-full pl-8 pr-3 h-9 text-sm rounded-md border border-ink-200 bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
      />
      {open && (q.trim().length >= 2) && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-ink-200 bg-surface shadow-pop">
          {busy && <div className="px-3 py-2 text-xs text-ink-400">Searching…</div>}
          {!busy && !opts.length && <div className="px-3 py-2 text-xs text-ink-400">No test matches.</div>}
          {opts.map((o) => (
            <button
              key={o.name}
              onClick={() => add(o.name)}
              disabled={selected.includes(o.name)}
              className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-ink-50 disabled:opacity-40"
            >
              <span className="truncate text-ink-800">{o.name}</span>
              <span className={`shrink-0 text-[11px] tabular-nums ${o.labs ? 'text-ink-500' : 'text-danger-500'}`}>
                {o.labs ? `${o.labs} labs` : 'no lab lists it'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
