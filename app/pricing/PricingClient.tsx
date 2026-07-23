'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Search, X, AlertTriangle, FlaskConical,
  Download, Package as PackageIcon, Building2,
} from 'lucide-react';

type TestHit = {
  master_id: number;
  test_name: string;
  ls_id: string;
  category: string;
  is_profile: boolean;
  labs_count: number;
  mrp_min: number | null;
  b2b_min: number | null;
  b2b_max: number | null;
};

type TestRate = {
  master_id: number;
  test_name: string;
  ls_id: string;
  lab_id: number;
  lab_name: string;
  lab_city: string | null;
  lab_state: string | null;
  lab_code: string | null;
  mrp: number;
  b2b: number | null;
  tat_hours: number | null;
  nabl: boolean;
  in_house: boolean;
};

type LabPackage = {
  package_id: number;
  package_name: string;
  canonical_name: string;
  mrp: number | null;
  b2b: number | null;
  component_count: number;
  overlap: number;
  covered_ids: number[];
};

type Discounts = { mrp: number; b2b: number };

const COVERAGE_THRESHOLD = 0.8;
const DEFAULT_DISCOUNTS: Discounts = { mrp: 40, b2b: 10 };

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

/** Excel sheet names: ≤31 chars, no []:*?/\ — dedupe with a numeric suffix. */
function sheetName(base: string, used: Set<string>): string {
  let name = base.replace(/[[\]:*?/\\]/g, '').slice(0, 28).trim() || 'Lab';
  let candidate = name;
  let i = 2;
  while (used.has(candidate)) candidate = `${name.slice(0, 25)} ${i++}`;
  used.add(candidate);
  return candidate;
}

export function PricingClient() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<TestHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [basket, setBasket] = useState<TestHit[]>([]);
  const [rates, setRates] = useState<TestRate[]>([]);
  const [loadingRates, setLoadingRates] = useState(false);
  const [selectedLabId, setSelectedLabId] = useState<number | null>(null);
  const [labDiscounts, setLabDiscounts] = useState<Record<number, Discounts>>({});
  const [packages, setPackages] = useState<LabPackage[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // ---- search typeahead ----
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/pricing/search?q=${encodeURIComponent(q)}`);
        const data = await r.json();
        setHits(data.tests ?? []);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setHits([]);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ---- rates when basket changes ----
  useEffect(() => {
    if (!basket.length) { setRates([]); setSelectedLabId(null); return; }
    let cancelled = false;
    (async () => {
      setLoadingRates(true);
      try {
        const ids = basket.map((b) => b.master_id).join(',');
        const r = await fetch(`/api/pricing/rates?ids=${ids}`);
        const data = await r.json();
        if (!cancelled) setRates(data.rates ?? []);
      } finally {
        if (!cancelled) setLoadingRates(false);
      }
    })();
    return () => { cancelled = true; };
  }, [basket]);

  // ---- per-lab rollup ----
  const labs = useMemo(() => {
    const byLab = new Map<number, { lab_id: number; lab_name: string; lab_city: string | null; tests: Map<number, TestRate> }>();
    for (const r of rates) {
      let e = byLab.get(r.lab_id);
      if (!e) {
        e = { lab_id: r.lab_id, lab_name: r.lab_name, lab_city: r.lab_city, tests: new Map() };
        byLab.set(r.lab_id, e);
      }
      e.tests.set(r.master_id, r);
    }
    const n = basket.length;
    const rows = Array.from(byLab.values()).map((l) => {
      let mrp = 0, b2b = 0;
      basket.forEach((t) => {
        const r = l.tests.get(t.master_id);
        if (r) { mrp += r.mrp; b2b += r.b2b ?? 0; }
      });
      return { ...l, covered: l.tests.size, coverage: n ? l.tests.size / n : 0, sumMrp: mrp, sumB2b: b2b };
    });
    rows.sort((a, b) => b.coverage - a.coverage || a.sumB2b - b.sumB2b);
    return rows;
  }, [rates, basket]);

  const eligible = useMemo(() => labs.filter((l) => l.coverage >= COVERAGE_THRESHOLD), [labs]);
  const selectedLab = eligible.find((l) => l.lab_id === selectedLabId) ?? null;

  useEffect(() => {
    if (eligible.length && (selectedLabId == null || !eligible.some((l) => l.lab_id === selectedLabId))) {
      setSelectedLabId(eligible[0].lab_id);
    }
    if (!eligible.length) setSelectedLabId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible.map((l) => l.lab_id).join(',')]);

  // ---- packages for selected lab ----
  useEffect(() => {
    if (!selectedLabId || !basket.length) { setPackages([]); return; }
    let cancelled = false;
    (async () => {
      setLoadingPackages(true);
      try {
        const ids = basket.map((b) => b.master_id).join(',');
        const r = await fetch(`/api/pricing/packages?lab=${selectedLabId}&ids=${ids}`);
        const data = await r.json();
        if (!cancelled) setPackages(data.packages ?? []);
      } finally {
        if (!cancelled) setLoadingPackages(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedLabId, basket]);

  const discountsFor = (labId: number): Discounts => labDiscounts[labId] ?? DEFAULT_DISCOUNTS;
  const setDiscount = (labId: number, key: keyof Discounts, value: number) =>
    setLabDiscounts((d) => ({ ...d, [labId]: { ...discountsFor(labId), [key]: value } }));

  const addTest = (t: TestHit) => {
    if (!basket.some((b) => b.master_id === t.master_id)) setBasket([...basket, t]);
    setQ('');
    setHits([]);
  };
  const removeTest = (id: number) => setBasket(basket.filter((b) => b.master_id !== id));

  // ---- Excel export: summary + ONE TAB PER LAB ----
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const used = new Set<string>();

    // Sheet 1 — comparison summary
    const compRows = eligible.map((l) => {
      const d = discountsFor(l.lab_id);
      return {
        Lab: l.lab_name,
        City: l.lab_city ?? '',
        Coverage: `${l.covered}/${basket.length}`,
        'Sum MRP': l.sumMrp,
        'Sum B2B': l.sumB2b,
        'MRP disc %': d.mrp,
        'B2B disc %': d.b2b,
        'MRP quote': Math.round(l.sumMrp * (1 - d.mrp / 100)),
        'B2B quote': Math.round(l.sumB2b * (1 - d.b2b / 100)),
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(compRows), sheetName('Comparison', used));

    // One sheet per lab — negotiation-ready: lab's own code + our code + rates
    eligible.forEach((l) => {
      const d = discountsFor(l.lab_id);
      const rows: Record<string, unknown>[] = basket.map((t) => {
        const r = l.tests.get(t.master_id);
        return {
          'Test name': t.test_name,
          'Lab test ID': r?.lab_code ?? '',
          'LabStack test ID': t.ls_id,
          Available: r ? 'yes' : 'NO',
          MRP: r?.mrp ?? '',
          'B2B rate': r?.b2b ?? '',
          'TAT (hrs)': r?.tat_hours ?? '',
        };
      });
      rows.push({});
      rows.push({ 'Test name': 'TOTAL', MRP: l.sumMrp, 'B2B rate': l.sumB2b });
      rows.push({
        'Test name': `QUOTE (MRP −${d.mrp}% / B2B −${d.b2b}%)`,
        MRP: Math.round(l.sumMrp * (1 - d.mrp / 100)),
        'B2B rate': Math.round(l.sumB2b * (1 - d.b2b / 100)),
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName(l.lab_name, used));
    });

    // Packages sheet for the selected lab
    if (selectedLab && packages.length) {
      const pkgRows = packages.map((p) => ({
        Lab: selectedLab.lab_name,
        Package: p.package_name,
        'Covers of basket': `${p.overlap}/${basket.length}`,
        'Total components': p.component_count,
        'Package MRP': p.mrp ?? '',
        'Package B2B': p.b2b ?? '',
        'Basket Σ B2B': selectedLab.sumB2b,
        'B2B difference': p.b2b != null && p.b2b > 0 ? Math.round(p.b2b - selectedLab.sumB2b) : '',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pkgRows), sheetName('Packages', used));
    }

    XLSX.writeFile(wb, 'atlas-pricing.xlsx');
  };

  return (
    <div>
      {/* Sticky action bar */}
      <div className="sticky top-14 z-30 rounded-2xl border border-ink-200 bg-surface shadow-sm p-3 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <Building2 className="w-4 h-4 text-ink-400 shrink-0" />
            <select
              value={selectedLabId ?? ''}
              onChange={(e) => setSelectedLabId(Number(e.target.value) || null)}
              className="flex-1 h-9 text-sm rounded-md border border-ink-200 bg-surface px-2 font-medium text-ink-900"
            >
              {eligible.length === 0 && <option value="">Add tests to see eligible labs</option>}
              {eligible.map((l) => (
                <option key={l.lab_id} value={l.lab_id}>
                  {l.lab_name}{l.lab_city ? ` — ${l.lab_city}` : ''} · {l.covered}/{basket.length} tests · B2B {inr(l.sumB2b)}
                </option>
              ))}
            </select>
          </div>
          <div className="text-[11px] text-ink-500">
            {loadingRates ? 'Loading rates…' : `${eligible.length} labs with ≥80% match`}
          </div>
          <button
            onClick={exportExcel}
            disabled={!eligible.length}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-semibold rounded-md bg-ink-900 text-ink-50 hover:bg-ink-800 transition disabled:opacity-40"
            title="One tab per lab: lab test ID, LabStack test ID, MRP, B2B, quote"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* Workbench grid: left rail (basket + labs) · main (lab analytics) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* ---- LEFT RAIL ---- */}
        <div className="xl:col-span-4 space-y-4">
          {/* Basket */}
          <div className="rounded-2xl border border-ink-200 bg-surface p-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-2">
              Test basket
            </div>
            <div ref={searchRef} className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-ink-400" />
              <input
                type="text"
                placeholder="Search DOS — e.g. CBC, HbA1c"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full pl-9 pr-3 h-10 text-sm rounded-md border border-ink-200 bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
              {(hits.length > 0 || searching) && (
                <div className="absolute left-0 right-0 top-11 z-40 rounded-lg border border-ink-200 bg-surface shadow-pop overflow-hidden">
                  {searching && hits.length === 0 && <div className="px-4 py-3 text-sm text-ink-500">Searching…</div>}
                  {hits.map((h) => {
                    const inBasket = basket.some((b) => b.master_id === h.master_id);
                    return (
                      <button
                        key={h.master_id}
                        onClick={() => addTest(h)}
                        disabled={inBasket}
                        className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 border-b border-ink-100 last:border-0 hover:bg-ink-50 transition disabled:opacity-40"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-ink-900 truncate">{h.test_name}</div>
                          <div className="text-[10px] text-ink-500">
                            {h.ls_id}{h.b2b_min != null && <> · B2B from {inr(h.b2b_min)}</>}
                          </div>
                        </div>
                        <span className="text-[11px] text-ink-500 shrink-0 tabular-nums">
                          {inBasket ? 'added' : `${h.labs_count} labs`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {basket.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {basket.map((t) => (
                  <span
                    key={t.master_id}
                    className="inline-flex items-center gap-1.5 text-[12px] px-2 py-1 rounded-full bg-brand-50 text-brand-700 dark:text-brand-400 border border-brand-100"
                  >
                    {t.test_name}
                    <button onClick={() => removeTest(t.master_id)} aria-label={`Remove ${t.test_name}`}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <button onClick={() => setBasket([])} className="text-[11px] text-ink-500 hover:text-ink-900 px-1 transition">
                  Clear
                </button>
              </div>
            ) : (
              <p className="text-[12px] text-ink-500 mt-3">
                Individual tests and profiles from the DOS only — packages appear as suggestions on the right, never in the basket.
              </p>
            )}
          </div>

          {/* Labs list (compact comparison) */}
          {eligible.length > 0 && (
            <div className="rounded-2xl border border-ink-200 bg-surface overflow-hidden">
              <div className="px-4 py-2.5 border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
                Labs — sorted by coverage, then cheapest B2B
              </div>
              <div className="max-h-[480px] overflow-y-auto">
                {eligible.map((l) => {
                  const d = discountsFor(l.lab_id);
                  const isSel = l.lab_id === selectedLabId;
                  const full = l.covered === basket.length;
                  return (
                    <button
                      key={l.lab_id}
                      onClick={() => setSelectedLabId(l.lab_id)}
                      className={`w-full text-left px-4 py-2.5 border-b border-ink-100 last:border-0 transition flex items-center gap-3 ${
                        isSel ? 'bg-brand-50' : 'hover:bg-ink-100/40'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className={`text-[13px] font-medium truncate ${isSel ? 'text-brand-700 dark:text-brand-400' : 'text-ink-900'}`}>
                          {l.lab_name}
                        </div>
                        <div className="text-[11px] text-ink-500">
                          {l.lab_city ?? '—'} · levers {d.mrp}%/{d.b2b}%
                        </div>
                      </div>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${
                        full ? 'bg-success-50 text-success-600 border-success-100'
                             : 'bg-warn-50 text-warn-600 border-warn-100'
                      }`}>
                        {l.covered}/{basket.length}
                      </span>
                      <div className="text-right shrink-0 w-20">
                        <div className="text-[13px] font-semibold text-ink-900 tabular-nums">
                          {inr(l.sumB2b * (1 - d.b2b / 100))}
                        </div>
                        <div className="text-[10px] text-ink-500">B2B quote</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ---- MAIN PANEL ---- */}
        <div className="xl:col-span-8">
          {basket.length === 0 ? (
            <div className="rounded-2xl border border-ink-200 bg-surface p-12 text-center">
              <FlaskConical className="w-8 h-8 text-ink-300 mx-auto mb-2" />
              <p className="text-sm text-ink-500">
                Build a basket on the left — rates, levers, and package suggestions appear here.
              </p>
            </div>
          ) : !selectedLab ? (
            <div className="rounded-2xl border border-ink-200 bg-surface p-12 text-center">
              <p className="text-sm text-ink-500">
                {loadingRates ? 'Loading rates…' : 'No lab covers ≥80% of this basket. Remove the rarest test and retry.'}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-brand-200 bg-surface overflow-hidden">
              <div className="px-4 py-3 border-b border-ink-200 flex items-baseline justify-between gap-3">
                <div>
                  <span className="text-sm font-semibold text-ink-900">{selectedLab.lab_name}</span>
                  {selectedLab.lab_city && <span className="text-[11px] text-ink-500 ml-2">{selectedLab.lab_city}</span>}
                </div>
                <span className="text-[11px] text-ink-500">{selectedLab.covered}/{basket.length} tests covered</span>
              </div>

              {/* Tiles */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4">
                <Tile label="Σ MRP" value={inr(selectedLab.sumMrp)} />
                <Tile label="Σ B2B" value={inr(selectedLab.sumB2b)} />
                <Tile
                  label="MRP quote"
                  value={inr(selectedLab.sumMrp * (1 - discountsFor(selectedLab.lab_id).mrp / 100))}
                  sub={`at −${discountsFor(selectedLab.lab_id).mrp}%`}
                />
                <Tile
                  label="B2B quote"
                  value={inr(selectedLab.sumB2b * (1 - discountsFor(selectedLab.lab_id).b2b / 100))}
                  sub={`at −${discountsFor(selectedLab.lab_id).b2b}%`}
                />
              </div>

              {/* Levers */}
              <div className="px-4 pb-4">
                <div className="rounded-xl border border-ink-200 bg-ink-50 p-3.5 grid sm:grid-cols-2 gap-x-8 gap-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-ink-600 min-w-[104px]">Disc on Σ MRP</span>
                    <input
                      type="range" min={0} max={80} step={1}
                      value={discountsFor(selectedLab.lab_id).mrp}
                      onChange={(e) => setDiscount(selectedLab.lab_id, 'mrp', +e.target.value)}
                      className="flex-1 accent-brand-600"
                    />
                    <span className="text-sm font-semibold text-ink-900 tabular-nums w-10 text-right">
                      {discountsFor(selectedLab.lab_id).mrp}%
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-ink-600 min-w-[104px]">Disc on Σ B2B</span>
                    <input
                      type="range" min={0} max={50} step={1}
                      value={discountsFor(selectedLab.lab_id).b2b}
                      onChange={(e) => setDiscount(selectedLab.lab_id, 'b2b', +e.target.value)}
                      className="flex-1 accent-brand-600"
                    />
                    <span className="text-sm font-semibold text-ink-900 tabular-nums w-10 text-right">
                      {discountsFor(selectedLab.lab_id).b2b}%
                    </span>
                  </div>
                  <div className="sm:col-span-2 text-[10px] text-ink-500">
                    Levers are saved per lab — switch labs and each keeps its own.
                  </div>
                </div>
              </div>

              {/* Side-by-side: rates | packages */}
              <div className="grid grid-cols-1 lg:grid-cols-5 border-t border-ink-200">
                {/* Rates table */}
                <div className="lg:col-span-3 lg:border-r border-ink-200 overflow-x-auto">
                  <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
                    Per-test rates
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-ink-500 border-b border-ink-200">
                        <th className="px-4 py-1.5 font-semibold">Test</th>
                        <th className="px-2 py-1.5 font-semibold">Lab code</th>
                        <th className="px-2 py-1.5 font-semibold text-right">MRP</th>
                        <th className="px-2 py-1.5 font-semibold text-right">B2B</th>
                        <th className="px-4 py-1.5 font-semibold text-right">TAT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {basket.map((t) => {
                        const r = selectedLab.tests.get(t.master_id);
                        if (!r) {
                          return (
                            <tr key={t.master_id} className="border-b border-ink-100 bg-warn-50">
                              <td colSpan={5} className="px-4 py-2 text-warn-600 text-[13px]">
                                <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5 -mt-px" />
                                {t.test_name} — not available at this lab
                              </td>
                            </tr>
                          );
                        }
                        return (
                          <tr key={t.master_id} className="border-b border-ink-100">
                            <td className="px-4 py-2 text-[13px] text-ink-800">{t.test_name}</td>
                            <td className="px-2 py-2 text-[11px] font-mono text-ink-500">{r.lab_code ?? '—'}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-[13px] text-ink-700">{inr(r.mrp)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-[13px] text-ink-700">{r.b2b != null ? inr(r.b2b) : '—'}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-[12px] text-ink-500">{r.tat_hours != null ? `${r.tat_hours}h` : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Packages */}
                <div className="lg:col-span-2 p-4">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-2">
                    <PackageIcon className="w-3.5 h-3.5" />
                    Nearby packages · ≥75% match
                  </div>
                  {loadingPackages ? (
                    <div className="text-[13px] text-ink-500 py-2">Checking packages…</div>
                  ) : packages.length === 0 ? (
                    <div className="text-[13px] text-ink-500 py-2">No package at this lab covers 75%+ of the basket.</div>
                  ) : (
                    <div className="space-y-2">
                      {packages.map((p) => {
                        const diff = p.b2b != null && p.b2b > 0 ? p.b2b - selectedLab.sumB2b : null;
                        const extra = p.component_count - p.overlap;
                        return (
                          <div key={p.package_id} className="rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2.5">
                            <div className="text-[13px] font-medium text-ink-900">{p.package_name}</div>
                            <div className="text-[11px] text-ink-500 mb-1.5">
                              Covers {p.overlap}/{basket.length}
                              {extra > 0 && <> · +{extra} extra test{extra > 1 ? 's' : ''}</>}
                            </div>
                            <div className="flex items-center justify-between text-[12px]">
                              <span className="text-ink-600">
                                B2B <span className="font-semibold text-ink-900 tabular-nums">{p.b2b != null && p.b2b > 0 ? inr(p.b2b) : '—'}</span>
                              </span>
                              <span className={`font-semibold tabular-nums ${
                                diff == null ? 'text-ink-500' : diff <= 0 ? 'text-success-600' : 'text-danger-500'
                              }`}>
                                {diff == null ? 'n/a' : (diff <= 0 ? '−' : '+') + inr(Math.abs(diff)).slice(1)}
                                {diff != null && <span className="font-normal text-ink-500"> vs basket</span>}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-ink-50 p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-0.5">{label}</div>
      <div className="text-lg font-bold text-ink-900 tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-ink-500 mt-0.5">{sub}</div>}
    </div>
  );
}
