import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Beaker, Building2, Package as PackageIcon } from 'lucide-react';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Toggle';
import { KpiTile } from '@/components/KpiTile';
import {
  getPackageComponents, getPackageDetail, getPackageLabs, MODALITY_LABEL,
} from '@/lib/catalogueQueries';

export const dynamic = 'force-dynamic';

const inr = (v: string | null | undefined) =>
  v == null ? '—' : `₹${Math.round(Number(v)).toLocaleString('en-IN')}`;

export default async function PackageDetailPage({ params }: { params: { id: string } }) {
  const { blocked } = await requireView('catalogue', `/catalogue/${params.id}`);
  if (blocked) return <RoleBlocked area="The catalogue" detail="the network, accounts and admin teams" />;

  const id = Number(params.id);
  if (!Number.isFinite(id)) notFound();

  const [pkg, components, labs] = await Promise.all([
    getPackageDetail(id),
    getPackageComponents(id),
    getPackageLabs(id),
  ]);
  if (!pkg) notFound();

  const unpriced = pkg.test_count - pkg.tests_priced;

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <Link
        href="/catalogue"
        className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900 mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> All packages
      </Link>

      <div className="mb-5">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <PackageIcon className="w-5 h-5 text-brand-600" strokeWidth={2.25} />
          <h1 className="text-2xl font-bold text-ink-900">{pkg.package_name}</h1>
          {pkg.is_custom && <Pill tone="neutral">Custom</Pill>}
          {(pkg.categories ?? []).map((c) => (
            <Pill key={c} tone="info">{c.replace(/_/g, ' ').toLowerCase()}</Pill>
          ))}
        </div>
        <p className="text-sm text-ink-600 max-w-3xl">
          {pkg.intent ?? pkg.description ?? `${pkg.test_count} tests across ${pkg.labs_offering} labs.`}
        </p>
        {pkg.positioning && (
          <p className="mt-2 text-sm text-ink-700 border-l-2 border-brand-500 pl-3 max-w-3xl">
            {pkg.positioning}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <KpiTile label="Tests" value={String(pkg.test_count)} sub={unpriced > 0 ? `${unpriced} unpriced` : 'all priced'} />
        <KpiTile label="À-la-carte value" value={inr(pkg.alacarte_low)} sub="if bought separately" />
        <KpiTile
          label="Lab cost"
          value={pkg.cost_low != null ? inr(pkg.cost_low) : inr(pkg.lab_quote_low)}
          sub={pkg.cost_low != null ? 'summed from tests, lowest across labs' : 'lab’s quoted price for the package'}
        />
        <KpiTile
          label="Headroom"
          value={pkg.headroom_pct == null ? '—' : `${pkg.headroom_pct}%`}
          sub="sets the discount you can offer"
        />
        <KpiTile label="Labs offering" value={String(pkg.labs_offering)} sub={(pkg.order_types ?? []).map((m) => MODALITY_LABEL[m] ?? m).join(' · ') || '—'} />
      </div>

      {unpriced > 0 && (
        <div className="mb-6 rounded-md border border-warn-500/30 bg-warn-500/5 px-3 py-2 text-xs text-ink-700">
          <span className="font-medium text-ink-900">{unpriced} of {pkg.test_count} tests carry no lab rate.</span>{' '}
          The value and cost above cover only the {pkg.tests_priced} that do, so both understate the package.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="What's in it"
              subtitle="Priciest first — where the value sits, and what to cut when a client pushes back."
              icon={<Beaker className="w-4 h-4" strokeWidth={2.25} />}
            />
            <CardBody className="pt-0">
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
                      <th className="text-left font-medium px-5 py-2">Test</th>
                      <th className="text-left font-medium px-2 py-2">Department</th>
                      <th className="text-right font-medium px-2 py-2">MRP</th>
                      <th className="text-right font-medium px-2 py-2">Cost</th>
                      <th className="text-right font-medium px-5 py-2">Labs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((c) => (
                      <tr key={c.master_id} className="border-b border-ink-100 last:border-0">
                        <td className="px-5 py-1.5 text-ink-900">
                          {c.test_name}
                          {c.why_it_matters && (
                            <div className="text-[11px] text-ink-500">{c.why_it_matters}</div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-xs text-ink-500">
                          {c.department ? c.department.toLowerCase() : '—'}
                        </td>
                        <td className="px-2 py-1.5 num">{inr(c.mrp_min)}</td>
                        <td className="px-2 py-1.5 num text-ink-600">{inr(c.b2b_min)}</td>
                        <td className="px-5 py-1.5 num text-ink-600">
                          {c.labs_count ?? <span className="text-ink-300">—</span>}
                        </td>
                      </tr>
                    ))}
                    {!components.length && (
                      <tr>
                        <td colSpan={5} className="px-5 py-6 text-sm text-ink-500">
                          No test-level composition in LabStack — this package is priced by the
                          lab as a unit rather than assembled from catalogue tests. Common for kit
                          and imaging packages.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Who can fulfil it"
            subtitle="Cheapest first"
            icon={<Building2 className="w-4 h-4" strokeWidth={2.25} />}
          />
          <CardBody className="pt-0 space-y-1.5">
            {labs.map((l) => (
              <div key={l.lab_id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink-800 truncate">
                  {l.lab_name}
                  {l.city && <span className="text-[11px] text-ink-400 ml-1.5">{l.city}</span>}
                </span>
                <span className="num text-ink-600 shrink-0">{inr(l.b2b)}</span>
              </div>
            ))}
            {!labs.length && <p className="text-sm text-ink-500">No lab carries this package yet.</p>}
            {pkg.labs_offering > labs.length && (
              <p className="text-[11px] text-ink-400 pt-1">
                +{pkg.labs_offering - labs.length} more labs offer this package.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
