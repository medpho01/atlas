'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, AlertTriangle, ChevronDown, ChevronUp, FlaskConical } from 'lucide-react';

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
  lab_id: number;
  lab_name: string;
  lab_city: string | null;
  lab_state: string | null;
  mrp: number;
  b2b: number | null;
  tat_hours: number | null;
  nabl: boolean;
  in_house: boolean;
};

const COVERAGE_THRESHOLD = 0.8;

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export function PricingClient() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<TestHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [basket, setBasket] = useState<TestHit[]>([]);
  const [rates, setRates] = useState<TestRate[]>([]);
  const [loadingRates, setLoadingRates] = useState(false);
  const [mrpDisc, setMrpDisc] = useState(40);
  const [b2bDisc, setB2bDisc] = useState(10);
  const [openLab, setOpenLab] = useState<number | null>(null);
  const [showAllBelow, setShowAllBelow] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Typeahead search — debounced
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

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setHits([]);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Fetch rates whenever the basket changes
  useEffect(() => {
    if (!basket.length) { setRates([]); return; }
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

  const addTest = (t: TestHit) => {
    if (!basket.some((b) => b.master_id === t.master_id)) setBasket([...basket, t]);
    setQ('');
    setHits([]);
  };
  const removeTest = (id: number) => setBasket(basket.filter((b) => b.master_id !== id));

  // Per-lab rollup
  const labs = useMemo(() => {
    const byLab = new Map<number, { lab_id: number; lab_name: string; lab_city: string | null; tests: Map<number, TestRate> }>();
    for (const r of rates) {
      let entry = byLab.get(r.lab_id);
      if (!entry) {
        entry = { lab_id: r.lab_id, lab_name: r.lab_name, lab_city: r.lab_city, tests: new Map() };
        byLab.set(r.lab_id, entry);
      }
      entry.tests.set(r.master_id, r);
    }
    const n = basket.length;
    const rows = Array.from(byLab.values()).map((l) => {
      let mrp = 0, b2b = 0, b2bKnown = true;
      basket.forEach((t) => {
        const r = l.tests.get(t.master_id);
        if (r) { mrp += r.mrp; if (r.b2b == null) b2bKnown = false; else b2b += r.b2b; }
      });
      return {
        ...l,
        covered: l.tests.size,
        coverage: n ? l.tests.size / n : 0,
        sumMrp: mrp,
        sumB2b: b2b,
        b2bKnown,
      };
    });
    rows.sort((a, b) => b.coverage - a.coverage || a.sumB2b - b.sumB2b);
    return rows;
  }, [rates, basket]);

  const eligible = labs.filter((l) => l.coverage >= COVERAGE_THRESHOLD);
  const below = labs.filter((l) => l.coverage < COVERAGE_THRESHOLD);

  return (
    <div>
      {/* Step 1 — basket builder */}
      <div className="rounded-2xl border border-ink-200 bg-surface p-4 mb-4">
        <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-2">
          Step 1 · Build the test basket
        </div>
        <div ref={searchRef} className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-ink-400" />
          <input
            type="text"
            placeholder="Search tests from the DOS — name or alias (e.g. CBC, HbA1c, Vitamin D)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full pl-9 pr-3 h-10 text-sm rounded-md border border-ink-200 bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
          />
          {(hits.length > 0 || searching) && (
            <div className="absolute left-0 right-0 top-11 z-40 rounded-lg border border-ink-200 bg-surface shadow-pop overflow-hidden">
              {searching && hits.length === 0 && (
                <div className="px-4 py-3 text-sm text-ink-500">Searching…</div>
              )}
              {hits.map((h) => {
                const inBasket = basket.some((b) => b.master_id === h.master_id);
                return (
                  <button
                    key={h.master_id}
                    onClick={() => addTest(h)}
                    disabled={inBasket}
                    className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-3 border-b border-ink-100 last:border-0 hover:bg-ink-50 transition disabled:opacity-40"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink-900 truncate">
                        {h.test_name}
                        {h.is_profile && (
                          <span className="ml-2 text-[10px] uppercase font-semibold px-1.5 py-px rounded bg-brand-50 text-brand-700 dark:text-brand-400 border border-brand-100">
                            Profile
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-500">
                        {h.ls_id} · {h.category}
                        {h.b2b_min != null && <> · B2B from {inr(h.b2b_min)}</>}
                      </div>
                    </div>
                    <span className="text-xs text-ink-500 shrink-0 tabular-nums">
                      {inBasket ? 'added' : `${h.labs_count} labs`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {basket.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {basket.map((t) => (
              <span
                key={t.master_id}
                className="inline-flex items-center gap-1.5 text-[13px] px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 dark:text-brand-400 border border-brand-100"
              >
                {t.test_name}
                <button onClick={() => removeTest(t.master_id)} aria-label={`Remove ${t.test_name}`}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <button
              onClick={() => setBasket([])}
              className="text-xs text-ink-500 hover:text-ink-900 px-2 transition"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {basket.length === 0 ? (
        <div className="rounded-2xl border border-ink-200 bg-surface p-12 text-center">
          <FlaskConical className="w-8 h-8 text-ink-300 mx-auto mb-2" />
          <p className="text-sm text-ink-500">
            Search and add tests to see lab-by-lab MRP and B2B rates with live discount modelling.
          </p>
        </div>
      ) : (
        <>
          {/* Step 2 — sticky discount levers */}
          <div className="sticky top-14 z-30 rounded-2xl border border-ink-200 bg-surface shadow-sm p-4 mb-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mb-2.5">
              Step 2 · Discount levers — applied to every lab below
            </div>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-ink-600 min-w-[110px]">Discount on Σ MRP</span>
                <input
                  type="range" min={0} max={80} step={1} value={mrpDisc}
                  onChange={(e) => setMrpDisc(+e.target.value)}
                  className="flex-1 accent-brand-600"
                />
                <span className="text-sm font-semibold text-ink-900 tabular-nums w-10 text-right">{mrpDisc}%</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-ink-600 min-w-[110px]">Discount on Σ B2B</span>
                <input
                  type="range" min={0} max={50} step={1} value={b2bDisc}
                  onChange={(e) => setB2bDisc(+e.target.value)}
                  className="flex-1 accent-brand-600"
                />
                <span className="text-sm font-semibold text-ink-900 tabular-nums w-10 text-right">{b2bDisc}%</span>
              </div>
            </div>
          </div>

          {/* Step 3 — comparison */}
          <div className="rounded-2xl border border-ink-200 bg-surface overflow-hidden">
            <div className="px-4 py-2.5 border-b border-ink-200 flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
                Step 3 · Lab comparison — {loadingRates ? 'loading rates…' : `${eligible.length} labs with ≥80% match`}
              </div>
              <div className="text-[11px] text-ink-500">{basket.length} tests in basket</div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-ink-500 border-b border-ink-200">
                    <th className="px-4 py-2 font-semibold">Lab</th>
                    <th className="px-2 py-2 font-semibold text-center">Coverage</th>
                    <th className="px-2 py-2 font-semibold text-right">Σ MRP</th>
                    <th className="px-2 py-2 font-semibold text-right">Σ B2B</th>
                    <th className="px-2 py-2 font-semibold text-right">MRP quote</th>
                    <th className="px-4 py-2 font-semibold text-right">B2B quote</th>
                  </tr>
                </thead>
                <tbody>
                  {eligible.length === 0 && !loadingRates && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-ink-500">
                        No lab covers ≥80% of this basket. Remove a rare test, or check the below-threshold list.
                      </td>
                    </tr>
                  )}
                  {eligible.map((l) => (
                    <LabRow
                      key={l.lab_id}
                      lab={l}
                      basket={basket}
                      mrpDisc={mrpDisc}
                      b2bDisc={b2bDisc}
                      open={openLab === l.lab_id}
                      onToggle={() => setOpenLab(openLab === l.lab_id ? null : l.lab_id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {below.length > 0 && (
              <div className="px-4 py-2.5 border-t border-ink-200 bg-ink-50 text-[12px] text-ink-500 flex items-center justify-between">
                <span>
                  {below.length} lab{below.length > 1 ? 's' : ''} below the 80% match threshold
                </span>
                <button
                  onClick={() => setShowAllBelow(!showAllBelow)}
                  className="inline-flex items-center gap-1 text-ink-600 hover:text-ink-900 font-medium transition"
                >
                  {showAllBelow ? <>Hide <ChevronUp className="w-3 h-3" /></> : <>Show anyway <ChevronDown className="w-3 h-3" /></>}
                </button>
              </div>
            )}
            {showAllBelow && below.length > 0 && (
              <div className="overflow-x-auto border-t border-ink-200">
                <table className="w-full text-sm opacity-70">
                  <tbody>
                    {below.map((l) => (
                      <LabRow
                        key={l.lab_id}
                        lab={l}
                        basket={basket}
                        mrpDisc={mrpDisc}
                        b2bDisc={b2bDisc}
                        open={openLab === l.lab_id}
                        onToggle={() => setOpenLab(openLab === l.lab_id ? null : l.lab_id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function LabRow({
  lab, basket, mrpDisc, b2bDisc, open, onToggle,
}: {
  lab: {
    lab_id: number; lab_name: string; lab_city: string | null;
    tests: Map<number, TestRate>; covered: number; coverage: number;
    sumMrp: number; sumB2b: number; b2bKnown: boolean;
  };
  basket: TestHit[];
  mrpDisc: number;
  b2bDisc: number;
  open: boolean;
  onToggle: () => void;
}) {
  const full = lab.covered === basket.length;
  return (
    <>
      <tr
        onClick={onToggle}
        className={`border-b border-ink-100 cursor-pointer transition ${open ? 'bg-ink-50' : 'hover:bg-ink-100/40'}`}
      >
        <td className="px-4 py-2.5">
          <div className="font-medium text-ink-900 text-[13px] flex items-center gap-1.5">
            {lab.lab_name}
            {open ? <ChevronUp className="w-3 h-3 text-ink-400" /> : <ChevronDown className="w-3 h-3 text-ink-400" />}
          </div>
          {lab.lab_city && <div className="text-[11px] text-ink-500">{lab.lab_city}</div>}
        </td>
        <td className="px-2 py-2.5 text-center">
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
            full
              ? 'bg-success-50 text-success-600 border-success-100'
              : 'bg-warn-50 text-warn-600 border-warn-100'
          }`}>
            {lab.covered}/{basket.length}
          </span>
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums text-ink-700">{inr(lab.sumMrp)}</td>
        <td className="px-2 py-2.5 text-right tabular-nums text-ink-700">
          {lab.b2bKnown ? inr(lab.sumB2b) : `${inr(lab.sumB2b)}+`}
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums font-semibold text-ink-900">
          {inr(lab.sumMrp * (1 - mrpDisc / 100))}
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-ink-900">
          {inr(lab.sumB2b * (1 - b2bDisc / 100))}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-ink-100">
          <td colSpan={6} className="px-4 py-3 bg-ink-50/60">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-ink-500">
                  <th className="py-1 font-semibold">Test</th>
                  <th className="py-1 font-semibold text-right">MRP</th>
                  <th className="py-1 font-semibold text-right">B2B</th>
                  <th className="py-1 font-semibold text-right pr-2">TAT</th>
                </tr>
              </thead>
              <tbody>
                {basket.map((t) => {
                  const r = lab.tests.get(t.master_id);
                  if (!r) {
                    return (
                      <tr key={t.master_id} className="text-warn-600">
                        <td className="py-1.5 flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5" /> {t.test_name} — not available at this lab
                        </td>
                        <td className="py-1.5 text-right">—</td>
                        <td className="py-1.5 text-right">—</td>
                        <td className="py-1.5 text-right pr-2">—</td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={t.master_id} className="text-ink-800">
                      <td className="py-1.5">{t.test_name}</td>
                      <td className="py-1.5 text-right tabular-nums">{inr(r.mrp)}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.b2b != null ? inr(r.b2b) : '—'}</td>
                      <td className="py-1.5 text-right tabular-nums pr-2 text-ink-500">
                        {r.tat_hours != null ? `${r.tat_hours}h` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
