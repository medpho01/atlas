import Link from 'next/link';
import { Activity, AlertTriangle, Flame, ListChecks, MapPinned, Globe2, ChevronRight } from 'lucide-react';
import { KpiTile } from '@/components/KpiTile';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { InfoTip } from '@/components/ui/InfoTip';
import MapClient from '@/components/MapClient';
import { Leaderboard } from '@/components/Leaderboard';
import { getNetworkKpis, getMapPoints, getMapCoverage, getQualityList } from '@/lib/queries';
import { getLeaderboard, getMapPointsByKindModality, getPlatformLeaderboardTotal, getGapTriples } from '@/lib/coverageQueries';
import { parseLens, LENS_OPTIONS, KIND_SHORT, MODALITY_LABEL } from '@/lib/coverage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage({ searchParams }: { searchParams: { lb_mode?: string; lens?: string; lb_lens?: string } }) {
  const mode = (searchParams.lb_mode === 'COVERAGE' ? 'COVERAGE' : 'ORDERS') as 'ORDERS' | 'COVERAGE';
  // Accept either `lens` (new shared param) or `lb_lens` (legacy) for back-compat.
  const lensKey = searchParams.lens ?? searchParams.lb_lens ?? 'ANY';
  const { kinds, modality } = parseLens(lensKey);
  const isLensed = lensKey !== 'ANY';

  const [kpis, leaderboard, platformTotal, points, mapCoverage, gaps, redLabs] = await Promise.all([
    getNetworkKpis(),
    getLeaderboard({ mode, kinds, modality, limit: 12 }),
    getPlatformLeaderboardTotal({ mode, kinds, modality }),
    isLensed
      ? getMapPointsByKindModality({ kinds, modality })
      : getMapPoints({ minOrders: 1, minStrength: 1 }),
    getMapCoverage(),
    // Lens-aware gap triples — when a lens is active, show only matching needs
    getGapTriples({ kinds, modality, limit: 8 }),
    getQualityList({ health: 'red', limit: 6 }),
  ]);

  const lensLabel = LENS_OPTIONS.find((o) => o.key === lensKey)?.label ?? 'Any provider · any modality';
  const mappablePct = mapCoverage.active_total > 0 ? Math.round(100 * mapCoverage.plotted / mapCoverage.active_total) : 0;

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Network Health"
        subtitle="A unified view of supply, demand, and gaps across India."
        actions={
          <div className="flex items-center gap-1.5">
            <SmartSelect label="All-time" />
            <SmartSelect label="All cities" />
            <SmartSelect label="All order types" />
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiTile
          label="Active pincodes"
          value={kpis.active_pincodes.toLocaleString()}
          sub="with ≥1 provider"
          icon={<MapPinned className="w-4 h-4" />}
          info={
            <InfoTip
              title="Active pincodes"
              shows="Total pincodes where at least one verified provider operates (any kind, any modality)."
              computed={<>Distinct pincodes with <code className="font-mono text-[10px]">providers_total ≥ 1</code> in <code className="font-mono text-[10px]">mv_pincode_summary</code>. Mass-claim labs (&gt;500 pincodes) are excluded from this count.</>}
              drives="Your operational footprint. Trend this over time — flat = stalled BD; growing = healthy network expansion."
            />
          }
        />
        <KpiTile
          label="Well-served"
          value={kpis.well_served.toLocaleString()}
          sub="≥5 providers"
          tone="good"
          info={
            <InfoTip
              title="Well-served pincodes"
              shows="Pincodes with deep coverage — at least 5 verified providers across kinds. Resilient to a single partner going down."
              computed={<>Distinct pincodes with <code className="font-mono text-[10px]">providers_total ≥ 5</code>.</>}
              drives="Healthy redundancy zone. Use as a benchmark: a city where most pincodes are 'Well-served' has graduated past gap-filling and into optimisation."
            />
          }
        />
        <KpiTile
          label="At risk"
          value={kpis.at_risk.toLocaleString()}
          sub="single provider"
          tone="bad"
          info={
            <InfoTip
              title="At-risk pincodes"
              shows="Pincodes where exactly one provider operates. A single churn = total coverage loss for that pincode."
              computed={<>Distinct pincodes with <code className="font-mono text-[10px]">providers_total = 1</code>.</>}
              drives="Onboard a second provider in these pincodes — especially ones with active orders. Highest concentration risk in the network."
            />
          }
        />
        <KpiTile
          label="Demand not served"
          value={kpis.demand_no_supply.toLocaleString()}
          sub="orders, 0 supply"
          tone="warn"
          info={
            <InfoTip
              title="Demand-not-served"
              shows="Pincodes with at least one order in L90D but zero verified providers — direct revenue leak. Orders are being fulfilled by partners outside your verified network."
              computed={<>Distinct pincodes where <code className="font-mono text-[10px]">orders_l90d &gt; 0 AND providers_total = 0</code>.</>}
              drives="Top-priority onboarding queue. See the Gaps page for the ranked list."
            />
          }
        />
        <KpiTile
          label="Active L30D"
          value={kpis.pincodes_with_orders_l30d.toLocaleString()}
          sub="pincodes with orders"
          info={
            <InfoTip
              title="Active in last 30 days"
              shows="Pincodes that received at least one order in the last 30 days — your current live demand surface."
              computed={<>Distinct pincodes with <code className="font-mono text-[10px]">orders_l30d &gt; 0</code> from unified demand (Order + Appointment + PharmaOrder).</>}
              drives="Compare to Active pincodes to see utilisation. Large gap = many pincodes have supply but no recent demand → marketing/partner-activation problem."
            />
          }
        />
        <KpiTile
          label="Pipeline"
          value={kpis.pipeline_count.toLocaleString()}
          sub="onboarding"
          info={
            <InfoTip
              title="Onboarding pipeline"
              shows="Providers currently in the onboarding workflow — created in the system but not yet activated."
              computed={<>Count of providers with <code className="font-mono text-[10px]">status IN (DRAFT, IN_REVIEW, PENDING_DOCS)</code>.</>}
              drives="A healthy network keeps this moving. Stale pipeline (no movement over weeks) → BD/ops bottleneck."
            />
          }
        />
      </div>

      {/* Map + Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader
            title="Network Coverage"
            subtitle={
              <>
                <span className="tabular-nums">{points.length.toLocaleString()}</span> pincodes plotted ·{' '}
                Lens: <span className="text-ink-700 font-medium">{lensLabel}</span>
              </>
            }
            icon={<Globe2 className="w-4 h-4" strokeWidth={2.25} />}
            info={
              <InfoTip
                title="Network Coverage Map"
                shows="Every pincode where we have at least one provider or one order. Marker colour = number of providers; solid dots = exact lat/long, dashed dots = inferred location from the pincode prefix."
                computed={<>Pincodes from <code className="font-mono text-[10px]">mv_pincode_summary</code> joined with <code className="font-mono text-[10px]">mv_pincode_geo</code>. When a lens is active, points come from <code className="font-mono text-[10px]">mv_pincode_coverage</code> filtered to the (kind × modality) slice.</>}
                drives="Spot geographic clusters and gaps. Click 'Open full heatmap →' to view modes (Demand / Supply / Gap) and filter by service line."
                notes="~2,617 of 7,912 active pincodes have exact lat/long. The rest are approximated to a ~30km centroid based on the first 3 digits of the pincode."
              />
            }
            actions={
              <div className="flex items-center gap-3 text-[11px]">
                <LegendDot color="bg-success-500" label="≥5" />
                <LegendDot color="bg-success-300" label="3–4" />
                <LegendDot color="bg-warn-500" label="2" />
                <LegendDot color="bg-danger-500" label="1" />
                <LegendDot color="bg-ink-300" label="0" />
              </div>
            }
          />
          <CardBody>
            <MapClient points={points} colorMode="supply" height="440px" />
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-ink-500 tabular-nums flex-wrap gap-2">
              <span>
                <strong className="text-ink-700">{mapCoverage.plotted.toLocaleString()}</strong> of {mapCoverage.active_total.toLocaleString()} active pincodes on map ({mappablePct}%):
                {' '}<strong className="text-ink-700">{mapCoverage.exact_count.toLocaleString()}</strong> exact ·{' '}
                <strong className="text-warn-500">{mapCoverage.inferred.toLocaleString()}</strong> approx (dashed){mapCoverage.unmappable > 0 ? ` · ${mapCoverage.unmappable} unmappable` : ''}
              </span>
              <span className="flex items-center gap-2">
                <Link href={isLensed ? `/heatmap?lens=${encodeURIComponent(lensKey)}` : '/heatmap'} className="text-brand-500 hover:text-brand-400 font-medium">
                  Open full heatmap →
                </Link>
                {isLensed && (
                  <>
                    <span className="text-ink-300">·</span>
                    <span>
                      Lens: <strong className="text-ink-700">{lensLabel}</strong> ·{' '}
                      <Link href="/" className="text-brand-500 hover:text-brand-400">clear</Link>
                    </span>
                  </>
                )}
              </span>
            </div>
          </CardBody>
        </Card>

        <Leaderboard initialMode={mode} initialLens={lensKey} rows={leaderboard} platformTotal={platformTotal} />
      </div>

      {/* Operator Zone */}
      <div className="mb-3 mt-10 flex items-end justify-between">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-ink-900">Operator Zone</h2>
          <p className="text-sm text-ink-500 mt-0.5">Action queues for the Head of Networks this week.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader
            title="Top gap pincodes"
            subtitle={isLensed ? `For ${lensLabel}` : 'Highest demand÷supply imbalance'}
            icon={<Flame className="w-4 h-4" strokeWidth={2.25} />}
            info={
              <InfoTip
                title="Top Gap Pincodes"
                shows="The 8 most urgent (pincode × kind × modality) triples — pincodes where demand exceeds supply most severely. Each row tells you exactly what kind of provider to onboard."
                computed={
                  <>
                    Score 0–100:&nbsp;
                    <code className="font-mono text-[10px] bg-ink-100 px-1 rounded">
                      (orders_l90d + unserviced × 2) ÷ (providers + 1) ÷ 4
                    </code>
                    . Unserviced requests are weighted 2× because they're demand we couldn't even attempt to fulfil. Score caps at 100 when supply = 0.
                  </>
                }
                drives="Click any row → Pincode Explorer → onboard the provider. 'Full queue' opens the complete 80-row gap table with forecast + urgency window."
              />
            }
            actions={
              <Link
                href={isLensed ? `/gaps?lens=${encodeURIComponent(lensKey)}` : '/gaps'}
                className="text-xs text-brand-500 hover:text-brand-400 font-medium flex items-center gap-0.5"
              >
                Full queue <ChevronRight className="w-3 h-3" />
              </Link>
            }
          />
          <CardBody className="pt-0">
            <ol className="-mx-2">
              {(gaps as any[]).slice(0, 8).map((g, i) => (
                <li key={`${g.pincode}-${g.kind}-${g.modality}`}>
                  <Link href={`/pincode/${g.pincode}`} className="flex items-center justify-between hover:bg-ink-100/40 rounded-lg px-2 py-2 -mx-px transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-[11px] font-semibold text-ink-400 tabular-nums w-5">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink-900 font-mono tracking-tight">{g.pincode}</div>
                        <div className="text-[11px] text-ink-500 truncate">
                          {g.city ?? '—'} · +{KIND_SHORT[g.kind as keyof typeof KIND_SHORT]} {MODALITY_LABEL[g.modality as keyof typeof MODALITY_LABEL]} · L90D {g.orders_l90d}
                        </div>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-danger-500 tabular-nums">{g.gap_score}</span>
                  </Link>
                </li>
              ))}
              {gaps.length === 0 && <li className="text-sm text-ink-400 px-2 py-2">No gaps detected for this lens.</li>}
            </ol>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Quality alerts"
            subtitle="Labs flagged red (cancel% high or delivery% low)"
            icon={<AlertTriangle className="w-4 h-4" strokeWidth={2.25} />}
            info={
              <InfoTip
                title="Quality Alerts"
                shows="Active labs whose composite health score is below 50, ranked by order volume so the biggest problems come first. These are partners whose performance is hurting customer experience NOW."
                computed={
                  <>
                    Health 0–100 blends four signals:&nbsp;
                    <strong>30%</strong> delivery rate ·&nbsp;
                    <strong>25%</strong> inverse cancel rate ·&nbsp;
                    <strong>20%</strong> TAT score (median order→report hours) ·&nbsp;
                    <strong>25%</strong> repeat-order rate.
                    Score &lt; 50 = red, 50–74 = amber, ≥ 75 = green.
                  </>
                }
                drives="Call the partner / route around them / replace. Click 'View all →' for the full quality table with TAT, repeat %, and the Chains tab for chain-level rollup."
              />
            }
            actions={<Link href="/quality" className="text-xs text-brand-500 hover:text-brand-400 font-medium flex items-center gap-0.5">View all <ChevronRight className="w-3 h-3" /></Link>}
          />
          <CardBody className="pt-0">
            <ul className="-mx-2">
              {redLabs.map((l: any) => (
                <li key={l.lab_id} className="flex items-center justify-between text-sm py-2 px-2 rounded-lg hover:bg-ink-50">
                  <div className="min-w-0 flex-1 mr-2">
                    <div className="font-medium text-ink-900 truncate text-[13px]">{l.lab_name}</div>
                    <div className="text-[11px] text-ink-500">{l.city ?? '—'} · Cancel {l.cancel_pct ?? 0}% · {l.orders_total} orders</div>
                  </div>
                  <span className="text-sm font-bold text-danger-500 tabular-nums">{l.health_score}</span>
                </li>
              ))}
              {redLabs.length === 0 && <li className="text-sm text-ink-400 px-2 py-2">No red-flagged labs.</li>}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Onboarding pipeline"
            subtitle="Status of prospects in CRM (placeholder)"
            icon={<ListChecks className="w-4 h-4" strokeWidth={2.25} />}
            info={
              <InfoTip
                title="Onboarding Pipeline"
                shows="The BD team's prospect funnel: Identified → Contacted → Negotiating → MOU Signed. Tracks every potential partner from first identification to active onboarding."
                computed="Pipeline data not yet wired to a real CRM. Numbers shown are illustrative placeholders to convey the stage structure."
                drives="When live: leadership monitors BD velocity (avg days per stage); BD reps work their assigned prospects. Gap-queue rows can be one-click-added as Identified prospects here."
              />
            }
          />
          <CardBody className="pt-0 space-y-2.5">
            <StageBar label="Identified" value={12} max={20} color="bg-ink-400" />
            <StageBar label="Contacted" value={5} max={20} color="bg-brand-500" />
            <StageBar label="Negotiating" value={3} max={20} color="bg-brand-600" />
            <StageBar label="MOU signed" value={3} max={20} color="bg-success-500" />
            <div className="pt-3 mt-2 border-t border-ink-100 text-[11px] text-ink-500">
              CRM module not yet wired — illustrative values.
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-ink-500">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="font-medium">{label}</span>
    </span>
  );
}

function SmartSelect({ label }: { label: string }) {
  return (
    <select className="px-2.5 py-1.5 rounded-lg border border-ink-200 bg-surface text-[12px] text-ink-700 font-medium hover:border-ink-300 focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-500 transition">
      <option>{label}</option>
    </select>
  );
}

function StageBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-ink-700 font-medium">{label}</span>
        <span className="text-ink-800 font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
