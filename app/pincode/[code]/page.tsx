import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MapPin, ShoppingBag, GitBranch, Building2, Star, Activity } from 'lucide-react';
import { KpiTile } from '@/components/KpiTile';
import { HealthBadge, CoverageBadge } from '@/components/HealthBadge';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pill } from '@/components/ui/Toggle';
import { InfoTip } from '@/components/ui/InfoTip';
import MapClient from '@/components/MapClient';
import { CoverageMatrix } from '@/components/CoverageMatrix';
import {
  getPincodeSummary,
  getPincodeCity,
  getProvidersInPincode,
  getLabsServingPincode,
  getNearbyPincodes,
  getPincodeFunnel,
} from '@/lib/queries';
import { getPincodeCoverageWithRadius } from '@/lib/coverageQueries';

export const dynamic = 'force-dynamic';

export default async function PincodePage({
  params,
  searchParams,
}: {
  params: { code: string };
  searchParams: { radius?: string };
}) {
  const code = params.code;
  const radiusKm = Math.max(0, Math.min(50, Number(searchParams.radius ?? 5))) || 5;

  const [s, geo, providers, labs, nearby, funnel, coverageCells] = await Promise.all([
    getPincodeSummary(code),
    getPincodeCity(code),
    getProvidersInPincode(code),
    getLabsServingPincode(code),
    getNearbyPincodes(code, 5),
    getPincodeFunnel(code),
    getPincodeCoverageWithRadius(code, radiusKm),
  ]);

  if (!s) notFound();

  const doctors = providers.filter((p: any) => p.type_name === 'Doctor');
  const phlebos = providers.filter((p: any) => p.type_name === 'Phlebotomist');
  const nurses = providers.filter((p: any) => p.type_name === 'Nurse');

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      <PageHeader
        title={code}
        subtitle={`${geo.city ?? '—'}${geo.state ? `, ${geo.state}` : ''}${s.latitude && s.longitude ? `  ·  ${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)}` : ''}`}
        breadcrumbs={[
          { label: 'Pincodes', href: '/pincodes' },
          { label: code },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <CoverageBadge bucket={s.coverage_bucket} />
            {s.gap_score >= 50 && <Pill tone="bad">⚠ Gap {s.gap_score}</Pill>}
          </div>
        }
      />

      {/* Coverage Matrix */}
      <div className="mb-5">
        <CoverageMatrix cells={coverageCells as any} radiusKm={radiusKm} />
      </div>

      {/* Order summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KpiTile label="Orders L30D" value={s.orders_l30d.toLocaleString()} icon={<ShoppingBag className="w-4 h-4" />} />
        <KpiTile label="Orders L90D" value={s.orders_l90d.toLocaleString()} sub="last 90 days" />
        <KpiTile label="Orders all-time" value={s.orders_all_time.toLocaleString()} sub="cumulative" />
        <KpiTile
          label="Gap Score"
          value={`${s.gap_score}/100`}
          sub={s.gap_score >= 50 ? 'critical gap' : s.gap_score >= 20 ? 'moderate' : 'healthy'}
          tone={s.gap_score >= 50 ? 'bad' : s.gap_score >= 20 ? 'warn' : 'good'}
        />
      </div>

      {/* Map + Order breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <Card>
          <CardHeader
            title="Location & Nearby"
            subtitle={`${nearby.length} pincodes within 5km`}
            icon={<MapPin className="w-4 h-4" strokeWidth={2.25} />}
          />
          <CardBody className="pt-0">
            {s.latitude && s.longitude ? (
              <MapClient
                points={[{ pincode: s.pincode, latitude: s.latitude, longitude: s.longitude, network_strength: s.network_strength, orders_all_time: s.orders_all_time }]}
                center={[s.latitude, s.longitude]}
                zoom={13}
                height="260px"
                colorMode="supply"
                highlightPincode={s.pincode}
              />
            ) : (
              <div className="h-[260px] flex items-center justify-center text-ink-400 text-sm bg-ink-50 rounded-lg">
                No lat/long available for this pincode.
              </div>
            )}
            {nearby.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {nearby.map((n) => (
                  <Link
                    key={n.pincode}
                    href={`/pincode/${n.pincode}`}
                    className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-md bg-ink-50 hover:bg-ink-100 text-ink-700 transition"
                  >
                    <span className="font-mono font-semibold">{n.pincode}</span>
                    <span className="text-ink-400">{n.distance_km}km · {n.network_strength}</span>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Order Volume"
            subtitle="Demand at this pincode"
            icon={<Activity className="w-4 h-4" strokeWidth={2.25} />}
          />
          <CardBody className="pt-0">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <Stat label="L30D" value={s.orders_l30d} />
              <Stat label="L90D" value={s.orders_l90d} />
              <Stat label="All time" value={s.orders_all_time} />
            </div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-2">By order type (all-time)</div>
            <div className="space-y-2">
              <OrderTypeBar label="Home Sample" value={s.home_sample} total={s.orders_all_time} color="bg-brand-500" />
              <OrderTypeBar label="Camp" value={s.camp} total={s.orders_all_time} color="bg-warn-500" />
              <OrderTypeBar label="Center Visit" value={s.center_visit} total={s.orders_all_time} color="bg-success-500" />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Funnel */}
      {funnel && (funnel.requests > 0 || funnel.delivered > 0) && (
        <div className="mb-5">
          <Card>
            <CardHeader
              title="Demand–Supply Funnel (L90D)"
              subtitle="From request lead to delivered order"
              icon={<GitBranch className="w-4 h-4" strokeWidth={2.25} />}
              info={
                <InfoTip
                  title="Demand–Supply Funnel"
                  shows="Tracks how a Request (lead) becomes an Order. Three steps: requests received → marked serviceable → converted. Last bar = total orders booked (incl. direct orders bypassing requests)."
                  computed={<>All counts L90D-scoped from <code className="font-mono text-[10px]">mv_pincode_requests</code>. Percentages are computed against the requests bar.</>}
                  drives="If serviceable% is low → coverage gap in this pincode. If converted% is low → demand is being lost despite serviceability."
                  notes="When 'Manual overrides detected' appears, customer support has converted unserviceable requests anyway — funnel can exceed 100% by design."
                />
              }
            />
            <CardBody className="pt-0">
              <Funnel data={funnel} />
            </CardBody>
          </Card>
        </div>
      )}

      {/* Labs serving */}
      <Card className="mb-5">
        <CardHeader
          title={`Labs serving this pincode`}
          subtitle={`${labs.length} labs match — local or via service area`}
          icon={<Building2 className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          {labs.length === 0 ? (
            <p className="text-sm text-ink-400 py-2">
              No labs serve this pincode.{' '}
              <Link className="text-brand-600 hover:text-brand-700 font-medium" href="/gaps">
                Find candidates →
              </Link>
            </p>
          ) : (
            <div className="-mx-5">
              <table className="lk">
                <thead>
                  <tr>
                    <th>Lab</th>
                    <th>Chain</th>
                    <th className="text-right">Orders</th>
                    <th className="text-right">L30D</th>
                    <th className="text-right">Cancel%</th>
                    <th>Health</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {labs.map((l: any) => (
                    <tr key={l.id}>
                      <td className="font-medium text-ink-900">{l.lab_name}</td>
                      <td className="text-ink-600">{l.chain_name ?? '—'}</td>
                      <td className="num">{l.orders_total}</td>
                      <td className="num">{l.orders_l30d}</td>
                      <td className="num">{l.cancel_pct ?? 0}%</td>
                      <td>
                        <HealthBadge score={l.health_score ?? 50} />
                      </td>
                      <td>
                        {l.active ? <Pill tone="good">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Providers in pincode */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <ProviderList title="Doctors" count={doctors.length} rows={doctors} />
        <ProviderList title="Phlebotomists" count={phlebos.length} rows={phlebos} />
        <ProviderList title="Nurses" count={nurses.length} rows={nurses} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-0.5">{value.toLocaleString()}</div>
    </div>
  );
}

function OrderTypeBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-24 text-ink-700">{label}</span>
      <div className="flex-1 h-2 bg-ink-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] tabular-nums w-20 text-right text-ink-700 font-medium">
        {value.toLocaleString()} <span className="text-ink-400">({pct}%)</span>
      </span>
    </div>
  );
}

function Funnel({ data }: { data: { requests: number; serviceable: number; converted: number; delivered: number } }) {
  const max = Math.max(data.requests, data.serviceable, data.converted, data.delivered, 1);
  // Source data anomaly: ~20% of pincodes have isServiceable=false requests later converted
  // (manual customer-support overrides). Cap displayed % at 100 with an asterisk so the
  // visual stays honest, and surface the anomaly explicitly.
  const requestSteps = [
    { label: 'Requests received', value: data.requests, base: data.requests },
    { label: 'Marked serviceable', value: data.serviceable, base: data.requests },
    { label: 'Converted to order', value: data.converted, base: data.requests },
  ];
  const hasAnomaly =
    data.serviceable > data.requests || data.converted > data.serviceable;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">Request → conversion funnel</div>
        {hasAnomaly && (
          <span className="text-[10px] text-warn-500 font-medium">⚠ Manual overrides detected — funnel may exceed 100%</span>
        )}
      </div>
      <div className="space-y-3 mb-5">
        {requestSteps.map((step, i) => {
          const rawPct = step.base > 0 ? (step.value / step.base) * 100 : 0;
          const cappedPct = Math.min(100, rawPct);
          const overflow = rawPct > 100;
          const barPct = (step.value / Math.max(data.requests, 1)) * 100;
          return (
            <div key={i}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-ink-700 font-medium">{step.label}</span>
                <span className="tabular-nums">
                  <strong className="text-ink-900">{step.value.toLocaleString()}</strong>
                  {i > 0 && step.base > 0 && (
                    <span className={`ml-2 ${overflow ? 'text-warn-500' : 'text-ink-400'}`}>
                      ({cappedPct.toFixed(1)}%{overflow ? '*' : ''})
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2.5 bg-ink-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${overflow ? 'bg-warn-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, barPct)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-ink-100 pt-3">
        <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-2">Total orders booked (L90D — incl. direct)</div>
        <div className="flex items-center justify-between">
          <div className="h-2.5 flex-1 mr-3 bg-ink-100 rounded-full overflow-hidden">
            <div className="h-full bg-success-500 rounded-full" style={{ width: `${(data.delivered / max) * 100}%` }} />
          </div>
          <strong className="tabular-nums text-ink-900">{data.delivered.toLocaleString()}</strong>
        </div>
      </div>
    </div>
  );
}

function ProviderList({ title, count, rows }: { title: string; count: number; rows: any[] }) {
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={`${count} in this pincode`}
        icon={<Star className="w-4 h-4" strokeWidth={2.25} />}
      />
      <CardBody className="pt-0">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-400 py-1">None onboarded.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.slice(0, 8).map((r) => (
              <li key={r.id} className="text-sm flex items-center justify-between py-1">
                <span className="text-ink-900 truncate">{r.name}</span>
                {r.is_verified ? <Pill tone="good">✓ Verified</Pill> : <span className="text-[11px] text-ink-400">unverified</span>}
              </li>
            ))}
            {rows.length > 8 && <li className="text-[11px] text-ink-400">+ {rows.length - 8} more</li>}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
