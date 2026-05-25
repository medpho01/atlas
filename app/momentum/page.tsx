import Link from 'next/link';
import { TrendingUp, TrendingDown, AlertTriangle, Sparkles, CalendarDays } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { InfoTip } from '@/components/ui/InfoTip';
import { ChipButton } from '@/components/ui/Toggle';
import { getServiceLineGlobalSummary, getServiceLineCityMatrix } from '@/lib/demandQueries';
import { SERVICE_LINE_LABEL, SERVICE_LINES, SERVICE_LINE_TONE, TONE_COLORS, type ServiceLine } from '@/lib/serviceLines';
import { WINDOW_OPTIONS, ASOF_OPTIONS, parseWindow, parseAsof, shortWindowLabel, shortAsofLabel } from '@/lib/momentumScope';

export const dynamic = 'force-dynamic';

export default async function MomentumPage({ searchParams }: { searchParams: { window?: string; asof?: string } }) {
  const windowSel = parseWindow(searchParams.window);
  const asofSel = parseAsof(searchParams.asof);
  const scope = { asofDays: asofSel.days, windowDays: windowSel.days };

  const [globalSummary, cityMatrix] = await Promise.all([
    getServiceLineGlobalSummary(scope),
    getServiceLineCityMatrix(scope),
  ]);

  const buildHref = (next: { window?: string; asof?: string }) => {
    const w = next.window ?? windowSel.key;
    const a = next.asof ?? asofSel.key;
    const params = new URLSearchParams();
    if (w !== 'L30D') params.set('window', w);
    if (a !== 'latest') params.set('asof', a);
    const qs = params.toString();
    return `/momentum${qs ? `?${qs}` : ''}`;
  };
  const winShort = shortWindowLabel(windowSel.days);
  const asofShort = shortAsofLabel(asofSel.key);

  // Pivot city matrix: cities = rows, service_lines = columns
  const cities = Array.from(new Set(cityMatrix.map((r) => r.city)));
  const services = SERVICE_LINES.filter((s) => globalSummary.some((g) => g.service_line === s));
  const cityIndex: Record<string, Record<string, typeof cityMatrix[number]>> = {};
  for (const r of cityMatrix) {
    if (!cityIndex[r.city]) cityIndex[r.city] = {};
    cityIndex[r.city][r.service_line] = r;
  }
  // Sort cities by total L30D events desc
  cities.sort((a, b) => {
    const aSum = services.reduce((s, sl) => s + (cityIndex[a]?.[sl]?.events_l30d ?? 0), 0);
    const bSum = services.reduce((s, sl) => s + (cityIndex[b]?.[sl]?.events_l30d ?? 0), 0);
    return bSum - aSum;
  });
  const topCities = cities.slice(0, 12);

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Service-line Momentum"
        subtitle={`Where is demand growing, where is it dying — and across which service lines? ${winShort} vs prior ${winShort}${asofSel.key !== 'latest' ? `, ${asofSel.label.toLowerCase()}` : ''}.`}
        actions={
          <InfoTip
            title="Service-line Momentum"
            shows="Per-service-line tiles with event counts, WoW and growth % vs the prior equal-length window, and a 12-week sparkline ending at the chosen anchor. Below: a City × Service-line matrix where each cell shows demand and growth in the same window."
            computed={
              <>
                Events sourced from <code className="font-mono text-[10px]">mv_unified_demand</code> (Order + Appointment + PharmaOrder unified). The <strong>window</strong> picker controls lookback size (L7D / L30D / L90D); the <strong>as of</strong> picker slides the anchor back by 0 / 1 / 2 / 3 months so you can compare past periods.<br/>
                Anchor stays inside the data: <code className="font-mono text-[10px]">MAX(week_start)</code> minus the chosen offset — not <code className="font-mono text-[10px]">NOW()</code>. Cell colour: green ≥ +50%, mid-green +15%, amber −10%, red ≤ −25%.
              </>
            }
            drives="Use the date selector to confirm whether a service line's drop is recent or a longer trend. Cross-reference with the Imbalance page for pincode-level alerts."
          />
        }
      />

      {/* Window + As-of selectors */}
      <div className="flex items-center gap-4 flex-wrap mb-5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mr-1">Window</span>
          {WINDOW_OPTIONS.map((o) => (
            <ChipButton key={o.key} href={buildHref({ window: o.key })} active={windowSel.key === o.key}>
              {o.key}
            </ChipButton>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <CalendarDays className="w-3.5 h-3.5 text-ink-500" strokeWidth={2.25} />
          <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold mr-1">As of</span>
          {ASOF_OPTIONS.map((o) => (
            <ChipButton key={o.key} href={buildHref({ asof: o.key })} active={asofSel.key === o.key}>
              {o.key === 'latest' ? 'Latest' : o.key}
            </ChipButton>
          ))}
        </div>
      </div>

      {/* Global service-line cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {globalSummary.map((g) => (
          <ServiceLineCard key={g.service_line} row={g} windowLabel={winShort} />
        ))}
      </div>

      {/* City × Service-line matrix */}
      <Card>
        <CardHeader
          title={`City × Service-line — ${winShort} events with growth`}
          subtitle={`Cell = events in the last ${windowSel.days} days${asofSel.key !== 'latest' ? ` (${asofShort})` : ''}. Color = growth vs prior ${winShort} (green +, red −). ⚠ = high growth and low supply.`}
          icon={<Sparkles className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5 overflow-x-auto">
            <table className="lk">
              <thead>
                <tr>
                  <th>City</th>
                  {services.map((sl) => (
                    <th key={sl} className="text-right whitespace-nowrap">{SERVICE_LINE_LABEL[sl].replace(' — ', '\n')}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topCities.map((city) => (
                  <tr key={city}>
                    <td className="font-medium text-ink-900">{city}</td>
                    {services.map((sl) => {
                      const row = cityIndex[city]?.[sl];
                      const events = row?.events_l30d ?? 0;
                      const prior = row?.events_l30d_prior ?? 0;
                      const growth = prior > 0 ? Math.round(100 * (events - prior) / prior) : (events > 0 ? 999 : null);
                      return <MatrixCell key={sl} events={events} prior={prior} growth={growth} />;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <div className="text-xs text-ink-500 mt-3">
        Want pincode-level imbalances? <Link href="/imbalance" className="text-brand-500 hover:text-brand-400 font-medium">Open the Demand-Supply Watchlist →</Link>
      </div>
    </div>
  );
}

function ServiceLineCard({ row, windowLabel }: { row: any; windowLabel: string }) {
  const sl = row.service_line as ServiceLine;
  const label = SERVICE_LINE_LABEL[sl];
  const tone = SERVICE_LINE_TONE[sl];
  const colors = TONE_COLORS[tone];
  const wow = row.wow_pct;
  const mom = row.mom_pct;
  const upWoW = wow !== null && wow > 0;
  const upMoM = mom !== null && mom > 0;
  const series = (row.weekly_series ?? []).slice(-12);
  const max = Math.max(1, ...series.map((s: any) => s.events));

  return (
    <div className={`rounded-xl border ${colors.border} bg-surface p-3.5 flex flex-col gap-1.5`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-ink-500">{label}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
      </div>
      <div className="text-2xl font-semibold tabular-nums text-ink-900 leading-none">{row.events_l30d.toLocaleString()}</div>
      <div className="text-[10px] text-ink-500">{windowLabel} events</div>
      <div className="flex items-center gap-3 mt-1 text-[11px] tabular-nums">
        {wow !== null ? (
          <span className={`inline-flex items-center gap-0.5 font-medium ${upWoW ? 'text-success-700' : 'text-danger-500'}`}>
            {upWoW ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {wow > 0 ? '+' : ''}{wow}% wow
          </span>
        ) : <span className="text-ink-400">— wow</span>}
        {mom !== null ? (
          <span className={`inline-flex items-center gap-0.5 font-medium ${upMoM ? 'text-success-700' : 'text-danger-500'}`}>
            {upMoM ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {mom > 0 ? '+' : ''}{mom}% vs prior
          </span>
        ) : null}
      </div>
      {/* Sparkline */}
      {series.length > 0 && (
        <div className="flex items-end gap-0.5 h-7 mt-1.5">
          {series.map((s: any, i: number) => (
            <div
              key={i}
              className={`flex-1 ${colors.dot} rounded-sm opacity-70`}
              style={{ height: `${Math.max(8, (s.events / max) * 100)}%` }}
              title={`${s.week}: ${s.events}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MatrixCell({ events, prior, growth }: { events: number; prior: number; growth: number | null }) {
  if (events === 0 && prior === 0) {
    return <td className="num text-ink-300">—</td>;
  }
  const tone =
    growth === null ? 'neutral' :
    growth >= 50 ? 'hot' :
    growth >= 15 ? 'good' :
    growth <= -25 ? 'bad' :
    growth <= -10 ? 'warn' : 'neutral';
  const cellCls = {
    hot: 'text-success-700 font-semibold',
    good: 'text-success-700',
    bad: 'text-danger-500 font-semibold',
    warn: 'text-warn-500',
    neutral: 'text-ink-700',
  }[tone];
  return (
    <td className="num">
      <div className="flex flex-col items-end leading-tight">
        <span className={`tabular-nums ${cellCls}`}>{events.toLocaleString()}</span>
        {growth !== null && growth !== 999 && (
          <span className="text-[10px] text-ink-500 tabular-nums">{growth > 0 ? '+' : ''}{growth}%</span>
        )}
        {growth === 999 && <span className="text-[10px] text-success-700 font-semibold">new ●</span>}
      </div>
    </td>
  );
}
