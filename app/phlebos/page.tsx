import { getPhleboRepoStats, listPhlebos, countPhlebos, listPhleboLabs, PHLEBO_REACH_RADIUS_KM } from '@/lib/phlebosQueries';
import { getSessionUser } from '@/lib/auth';
import { PhlebosClient } from './PhlebosClient';
import Link from 'next/link';
import { Upload, Users, MapPin, TrendingUp, Sparkles } from 'lucide-react';

export const dynamic = 'force-dynamic';

type SP = { [k: string]: string | string[] | undefined };
const s = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function PhlebosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await getSessionUser();

  const filters = {
    q:         s(sp.q),
    pincode:   s(sp.pincode),
    city:      s(sp.city),
    state:     s(sp.state),
    lab:       s(sp.lab),
    source:    (s(sp.source) || 'all') as 'derived' | 'manual' | 'both' | 'all',
    nearby:    s(sp.nearby) === '1',
    radiusKm:  Number(s(sp.radius)) || PHLEBO_REACH_RADIUS_KM,
    minOrders: Number(s(sp.min)) || 0,
  };

  const [stats, phlebos, totalCount, labs] = await Promise.all([
    getPhleboRepoStats(),
    listPhlebos(filters, 200, 0),
    countPhlebos(filters),
    listPhleboLabs(),
  ]);

  const isAdmin = user?.role === 'admin';

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-5 h-5 text-brand-600" />
            <h1 className="text-2xl font-bold text-ink-900">Phlebo Repository</h1>
          </div>
          <p className="text-sm text-ink-600 max-w-2xl">
            Every phlebo LabStack has worked with — automatically compiled from the Order table, augmented with anyone you upload manually.
            Search by city, pincode, or name to find who to call for a sample pickup.
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/phlebos/upload"
            className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-semibold rounded-md bg-ink-900 text-ink-50 hover:bg-ink-800 transition shrink-0"
          >
            <Upload className="w-4 h-4" /> Upload phlebos
          </Link>
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatTile
          icon={<Users className="w-4 h-4 text-brand-600" />}
          label="Total phlebos"
          value={stats.total.toLocaleString('en-IN')}
        />
        <StatTile
          icon={<TrendingUp className="w-4 h-4 text-violet-600 dark:text-violet-400" />}
          label="Orders covered"
          value={stats.total_orders_covered.toLocaleString('en-IN')}
        />
        <StatTile
          icon={<MapPin className="w-4 h-4 text-success-600" />}
          label="Cities"
          value={stats.distinct_cities.toLocaleString('en-IN')}
        />
        <StatTile
          icon={<Sparkles className="w-4 h-4 text-warn-600" />}
          label="Uploaded (manual)"
          value={stats.manual.toLocaleString('en-IN')}
          sub={stats.overlap > 0 ? `${stats.overlap.toLocaleString('en-IN')} also in order data` : undefined}
        />
      </div>

      {/* Client interactive area */}
      <PhlebosClient
        initialPhlebos={phlebos}
        initialTotal={totalCount}
        initialFilters={{
          q: filters.q,
          pincode: filters.pincode,
          city: filters.city,
          lab: filters.lab,
          source: filters.source,
          nearby: filters.nearby,
          radiusKm: filters.radiusKm,
          minOrders: filters.minOrders,
          sortBy: 'orders',
          sortDir: 'desc',
        }}
        labOptions={labs}
        defaultRadius={PHLEBO_REACH_RADIUS_KM}
        isAdmin={isAdmin}
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
