'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { SegmentedControl } from '@/components/ui/Toggle';
import { HoverPopover } from '@/components/ui/HoverPopover';
import { InfoTip } from '@/components/ui/InfoTip';
import { LENS_OPTIONS } from '@/lib/coverage';

type Row = {
  city: string;
  orders_all_time: number;
  orders_l30d: number;
  covered_pincodes: number;
  well_served_pincodes: number;
  total_providers: number;
  total_chains: number;
  top_chain_share_pct: number;
  total_active_pincodes: number;
  chain_breakdown: { name: string; branches: number; pct: number }[];
  pincode_samples: { pincode: string; providers: number }[];
};

type Props = {
  initialMode: 'ORDERS' | 'COVERAGE';
  initialLens: string;
  rows: Row[];
  /** Platform-wide total for the current lens — used for the Share% denominator
   *  so it reflects "share of total" not "share of visible top 12". */
  platformTotal: number;
};

function buildHref(mode: 'ORDERS' | 'COVERAGE', lens: string) {
  const params = new URLSearchParams();
  params.set('lb_mode', mode);
  if (lens && lens !== 'ANY') params.set('lens', lens);
  return `?${params.toString()}#leaderboard`;
}

export function Leaderboard({ initialMode, initialLens, rows: initialRows, platformTotal: initialPlatformTotal }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lens, setLens] = useState<string>(initialLens || 'ANY');
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [platformTotal, setPlatformTotal] = useState<number>(initialPlatformTotal);
  const [fetching, setFetching] = useState(false);
  // Keep local state in sync when the URL changes via back/forward or external nav.
  useEffect(() => {
    setLens(initialLens || 'ANY');
    setRows(initialRows);
    setPlatformTotal(initialPlatformTotal);
  }, [initialLens, initialRows, initialPlatformTotal]);
  const mode = initialMode;

  // Use platform-wide total when available — Share% reflects true share, not "of top 12"
  const total = platformTotal > 0
    ? platformTotal
    : mode === 'ORDERS'
      ? rows.reduce((s, r) => s + (r.orders_all_time ?? 0), 0)
      : rows.reduce((s, r) => s + (r.covered_pincodes ?? 0), 0);

  return (
    <Card id="leaderboard">
      <CardHeader
        title="City Leaderboard"
        subtitle={mode === 'ORDERS' ? 'Top cities by total orders' : 'Top cities by pincode coverage'}
        icon={<Trophy className="w-4 h-4" strokeWidth={2.25} />}
        info={
          <InfoTip
            title="City Leaderboard"
            shows="Top 12 cities ranked by either total orders (Orders mode) or pincodes covered (Coverage mode). The lens dropdown filters to a specific (provider kind × modality) slice."
            computed={
              <>
                <strong>Orders mode:</strong> counts unified-demand events (Order + Appointment + PharmaOrder) per city for the chosen lens. <br/>
                <strong>Coverage mode:</strong> distinct pincodes per city where ≥1 provider matches the lens. Share% uses the platform total as denominator (not "top 12 visible") so percentages are honest.
              </>
            }
            drives="Pick a service line (lens dropdown). Click any chain cell or row to see chain breakdown, top-chain concentration, and per-city dominant partners."
          />
        }
        actions={
          <SegmentedControl
            size="sm"
            options={[
              { label: 'Orders', href: buildHref('ORDERS', lens), active: mode === 'ORDERS' },
              { label: 'Coverage', href: buildHref('COVERAGE', lens), active: mode === 'COVERAGE' },
            ]}
          />
        }
      />

      <CardBody className="pt-0">
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">Lens</label>
            {(fetching || pending) && (
              <span className="inline-flex items-center gap-1 text-[10px] text-brand-500 font-medium">
                <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
                Updating…
              </span>
            )}
          </div>
          <select
            value={lens}
            onChange={async (e) => {
              const next = e.target.value;
              setLens(next);                                   // instant local feedback
              setFetching(true);
              // Fire client fetch for fresh data + concurrently update URL (no page reload).
              const fetchUrl = `/api/leaderboard?mode=${mode}&lens=${encodeURIComponent(next)}`;
              try {
                const [data] = await Promise.all([
                  fetch(fetchUrl).then((r) => r.json()),
                  Promise.resolve(window.history.replaceState(null, '', buildHref(mode, next))),
                ]);
                setRows(data.rows ?? []);
                setPlatformTotal(data.platformTotal ?? 0);
              } finally {
                setFetching(false);
              }
              // Soft router refresh in the background so other widgets (map, gaps) also update
              // when the URL changes — but the leaderboard is already showing fresh data.
              startTransition(() => router.push(buildHref(mode, next)));
            }}
            className={`w-full px-2.5 py-1.5 text-xs rounded-lg border border-ink-200 bg-surface font-medium text-ink-700 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-500 transition ${fetching || pending ? 'opacity-60' : ''}`}
          >
            {LENS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className={`-mx-5 transition-opacity duration-200 ${fetching ? 'opacity-50' : ''}`}>
          <table className="lk">
            <thead>
              <tr>
                <th>City</th>
                {mode === 'ORDERS' ? (
                  <>
                    <th className="text-right">Orders</th>
                    <th className="text-right">Share</th>
                  </>
                ) : (
                  <>
                    <th className="text-right">Pincodes</th>
                    <th className="text-right" title="Distinct labs/providers — branches counted individually; subtitle is distinct parent chains">Network</th>
                    <th className="text-right" title="Share of branches from the single largest chain — high = single-chain risk">Top%</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const pct =
                  total > 0
                    ? Math.round(((mode === 'ORDERS' ? r.orders_all_time : r.covered_pincodes) / total) * 100)
                    : 0;
                return (
                  <tr key={r.city}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] tabular-nums text-ink-400 w-4">{idx + 1}</span>
                        <span className="font-medium text-ink-900">{r.city}</span>
                      </div>
                    </td>
                    {mode === 'ORDERS' ? (
                      <>
                        <td className="num font-medium">{(r.orders_all_time ?? 0).toLocaleString()}</td>
                        <td className="num">
                          <div className="flex items-center gap-2 justify-end">
                            <div className="w-14 h-1.5 bg-ink-100 rounded-full overflow-hidden">
                              <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="tabular-nums text-[11px] text-ink-500 w-7 text-right">{pct}%</span>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="num">
                          <HoverPopover content={<PincodesTooltip city={r.city} samples={r.pincode_samples} covered={r.covered_pincodes} wellServed={r.well_served_pincodes} />}>
                            <div className="font-semibold tabular-nums text-ink-900 leading-tight">{(r.covered_pincodes ?? 0).toLocaleString()}</div>
                            <div className="text-[10px] text-ink-500 leading-tight">{(r.well_served_pincodes ?? 0).toLocaleString()} ≥3</div>
                          </HoverPopover>
                        </td>
                        <td className="num">
                          <HoverPopover content={<ChainsTooltip city={r.city} chains={r.chain_breakdown} totalBranches={r.total_providers} />} width={280}>
                            <div className="font-semibold tabular-nums text-ink-900 leading-tight">{(r.total_providers ?? 0).toLocaleString()}</div>
                            <div className="text-[10px] text-ink-500 leading-tight">{(r.total_chains ?? 0).toLocaleString()} chain{r.total_chains === 1 ? '' : 's'}</div>
                          </HoverPopover>
                        </td>
                        <td className="num">
                          <HoverPopover content={<ConcentrationTooltip pct={r.top_chain_share_pct} chains={r.chain_breakdown} />} width={280}>
                            <span className={`tabular-nums ${
                              r.top_chain_share_pct >= 60 ? 'text-danger-500 font-semibold' :
                              r.top_chain_share_pct >= 40 ? 'text-warn-600 font-medium' :
                              'text-ink-500'
                            }`}>
                              {r.top_chain_share_pct}%
                            </span>
                          </HoverPopover>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={mode === 'ORDERS' ? 3 : 4} className="text-center text-ink-400 text-sm py-6">
                    No data for this lens.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Tooltip bodies
// -----------------------------------------------------------------------------

function ChainsTooltip({ city, chains, totalBranches }: { city: string; chains: Row['chain_breakdown']; totalBranches: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-2">
        {city} · {totalBranches.toLocaleString()} branches
      </div>
      <ul className="space-y-1.5">
        {chains.slice(0, 8).map((c, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums text-ink-400 w-4 text-right">{i + 1}</span>
            <span className="flex-1 text-[12px] text-ink-900 truncate" title={c.name}>{c.name}</span>
            <span className="text-[11px] tabular-nums text-ink-700 font-medium">{c.branches}</span>
            <span className="text-[10px] tabular-nums text-ink-500 w-9 text-right">{c.pct}%</span>
          </li>
        ))}
        {chains.length > 8 && (
          <li className="text-[11px] text-ink-400 pl-6">+ {chains.length - 8} more</li>
        )}
        {chains.length === 0 && (
          <li className="text-[11px] text-ink-400">No chain data.</li>
        )}
      </ul>
    </div>
  );
}

function ConcentrationTooltip({ pct, chains }: { pct: number; chains: Row['chain_breakdown'] }) {
  const top = chains[0];
  const tone = pct >= 60 ? 'High concentration' : pct >= 40 ? 'Moderate concentration' : 'Healthy diversification';
  const cls = pct >= 60 ? 'text-danger-500' : pct >= 40 ? 'text-warn-600' : 'text-success-700';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-2">Chain concentration</div>
      <div className={`text-sm font-semibold ${cls} mb-2`}>{pct}% · {tone}</div>
      {top && (
        <div className="text-[12px] text-ink-700 mb-2">
          Largest: <strong className="text-ink-900">{top.name}</strong> with <strong>{top.branches}</strong> branches ({top.pct}%)
        </div>
      )}
      <div className="text-[11px] text-ink-500 leading-snug">
        {pct >= 60
          ? 'Single-chain dependence — losing this MOU collapses most of the network here.'
          : pct >= 40
            ? 'One chain dominates but alternatives exist.'
            : 'Multiple chains compete — resilient to single-MOU loss.'}
      </div>
    </div>
  );
}

function PincodesTooltip({ city, samples, covered, wellServed }: { city: string; samples: Row['pincode_samples']; covered: number; wellServed: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-2">
        {city} · {covered.toLocaleString()} covered ({wellServed.toLocaleString()} with ≥3 providers)
      </div>
      <div className="text-[10px] text-ink-500 font-semibold mb-1.5">Top pincodes by provider count:</div>
      <ul className="space-y-1">
        {samples.slice(0, 8).map((s, i) => (
          <li key={s.pincode} className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums text-ink-400 w-4 text-right">{i + 1}</span>
            <span className="font-mono text-[12px] text-ink-900">{s.pincode}</span>
            <span className="text-[10px] text-ink-500 ml-auto tabular-nums">{s.providers} prov</span>
          </li>
        ))}
        {samples.length === 0 && <li className="text-[11px] text-ink-400">No pincodes with coverage.</li>}
      </ul>
    </div>
  );
}
