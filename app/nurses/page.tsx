import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Upload, HeartPulse, MapPin, BadgeCheck, Building } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { requireView } from '@/lib/guard';
import { canManage } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import {
  getNurseRepoStats, listNurses, countNurses, listNurseAggregators, NURSE_REACH_RADIUS_KM,
} from '@/lib/nursesQueries';
import { NursesClient } from './NursesClient';

export const dynamic = 'force-dynamic';

type SP = { [k: string]: string | string[] | undefined };
const s = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function NursesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const gate = await requireView('directory', '/nurses');
  if (gate.blocked) return <RoleBlocked area="The provider directory" detail="every signed-in role" />;
  const user = gate.user;

  const filters = {
    q:       s(sp.q),
    pincode: s(sp.pincode),
    city:    s(sp.city),
    state:   s(sp.state),
    aggregators: (Array.isArray(sp.agg) ? sp.agg : sp.agg ? [sp.agg] : []).filter(Boolean),
    source:  (s(sp.source) || 'all') as 'derived' | 'manual' | 'both' | 'all',
    verifiedOnly: s(sp.verified) === '1',
    nearby:  s(sp.nearby) !== '0',
    radiusKm: Number(s(sp.radius)) || NURSE_REACH_RADIUS_KM,
  };

  const [stats, nurses, totalCount, aggregators] = await Promise.all([
    getNurseRepoStats(),
    listNurses(filters, 200, 0),
    countNurses(filters),
    listNurseAggregators(),
  ]);

  const canEdit = canManage(user, 'directory');

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <HeartPulse className="w-5 h-5 text-brand-600" />
            <h1 className="text-2xl font-bold text-ink-900">Nurse Repository</h1>
          </div>
          <p className="text-sm text-ink-600 max-w-2xl">
            Every nurse in the LabStack provider registry, plus anyone your team uploads from an
            aggregator or agency list. Search by city or pincode to find who can take a home visit.
          </p>
        </div>
        {canEdit && (
          <Link
            href="/nurses/upload"
            className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-semibold rounded-md bg-ink-900 text-ink-50 hover:bg-ink-800 transition shrink-0"
          >
            <Upload className="w-4 h-4" /> Upload nurses
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatTile
          icon={<HeartPulse className="w-4 h-4 text-brand-600" />}
          label="Total nurses"
          value={stats.total.toLocaleString('en-IN')}
        />
        <StatTile
          icon={<BadgeCheck className="w-4 h-4 text-success-600" />}
          label="Verified"
          value={stats.verified.toLocaleString('en-IN')}
          sub={stats.total > 0 ? `${Math.round((100 * stats.verified) / stats.total)}% of repository` : undefined}
        />
        <StatTile
          icon={<MapPin className="w-4 h-4 text-violet-600 dark:text-violet-400" />}
          label="Cities"
          value={stats.distinct_cities.toLocaleString('en-IN')}
        />
        <StatTile
          icon={<Building className="w-4 h-4 text-warn-600" />}
          label="Aggregators"
          value={stats.distinct_aggregators.toLocaleString('en-IN')}
          sub={stats.manual > 0 ? `${stats.manual.toLocaleString('en-IN')} uploaded` : undefined}
        />
      </div>

      <NursesClient
        initialNurses={nurses}
        initialTotal={totalCount}
        initialFilters={{
          q: filters.q,
          pincode: filters.pincode,
          city: filters.city,
          aggregators: filters.aggregators,
          source: filters.source,
          verifiedOnly: filters.verifiedOnly,
          nearby: filters.nearby,
          radiusKm: filters.radiusKm,
          sortBy: 'name',
          sortDir: 'asc',
        }}
        aggregatorOptions={aggregators}
        defaultRadius={NURSE_REACH_RADIUS_KM}
        canEdit={canEdit}
      />
    </main>
  );
}

function StatTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-3.5">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <div className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">{label}</div>
      </div>
      <div className="text-2xl font-bold text-ink-900 tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-ink-500 mt-0.5">{sub}</div>}
    </div>
  );
}
