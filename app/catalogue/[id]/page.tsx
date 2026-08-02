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
          {pkg.intent ?? pkg.description ?? `${pkg.test_count} tests.`}
        </p>
        {pkg.positioning && (
          <p className="mt-2 text-sm text-ink-700 border-l-2 border-brand-500 pl-3 max-w-3xl">
            {pkg.positioning}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiTile
          label="People taken"
          value={pkg.patients > 0 ? pkg.patients.toLocaleString('en-IN') : 'Not yet'}
          sub={pkg.patients > 0
            ? `${pkg.orders.toLocaleString('en-IN')} orders${pkg.last_ordered ? ` · last ${pkg.last_ordered}` : ''}`
            : 'no recorded orders'}
        />
        <KpiTile
          label="Tests"
          value={pkg.test_count > 0 ? String(pkg.test_count) : '—'}
          sub={pkg.test_count === 0
            ? 'sold as a unit, not a test list'
            : `${pkg.department_count} department${pkg.department_count === 1 ? '' : 's'}${pkg.sample_type_count === 1 ? ' · single sample' : ''}`}
        />
        <KpiTile
          label="Report in"
          value={pkg.tat_hours ? `${pkg.tat_hours}h` : '—'}
          sub={(pkg.order_types ?? []).map((m) => MODALITY_LABEL[m] ?? m).join(' · ') || 'modality not set'}
        />
        <KpiTile
          label="Price"
          value={inr(pkg.pkg_cost)}
          sub={pkg.best_lab_name
            ? `at ${pkg.best_lab_name}${pkg.labs_quoting > 1 ? ` · ${pkg.labs_quoting - 1} other option${pkg.labs_quoting > 2 ? 's' : ''}` : ''}`
            : 'no lab quotes this package'}
        />
      </div>


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="What's in it"
              subtitle="Most-taken first. Per-test prices are the lowest any lab charges, for reference only — the package price above is what it costs."
              icon={<Beaker className="w-4 h-4" strokeWidth={2.25} />}
            />
            <CardBody className="pt-0">
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
                      <th className="text-left font-medium px-5 py-2">Test</th>
                      <th className="text-left font-medium px-2 py-2">Department</th>
                      <th className="text-right font-medium px-2 py-2">People taken</th>
                      <th className="text-right font-medium px-2 py-2">MRP from</th>
                      <th className="text-right font-medium px-2 py-2">Cost from</th>
                      <th className="text-right font-medium px-5 py-2">Labs w/ test</th>
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
                        <td className="px-2 py-1.5 num text-ink-700">
                          {c.patients > 0 ? c.patients.toLocaleString('en-IN') : <span className="text-ink-300">—</span>}
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
                        <td colSpan={6} className="px-5 py-6 text-sm text-ink-500">
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
            {pkg.labs_quoting > labs.length && (
              <p className="text-[11px] text-ink-400 pt-1">
                +{pkg.labs_quoting - labs.length} more labs quote this package.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
