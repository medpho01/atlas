import type { Metadata } from 'next';
import { Building2, Home as HomeIcon, MapPinned, Activity } from 'lucide-react';
import { getNetworkStats, getMapPoints } from '@/lib/publicNetwork';
import { NetworkClient } from './NetworkClient';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Provider Network · LabStack',
  description:
    'The LabStack provider network covers thousands of pincodes across India ' +
    'with center-visit and home sample collection — the infrastructure that ' +
    'powers our healthcare partners.',
};

export default async function PublicNetworkPage() {
  const [stats, points] = await Promise.all([getNetworkStats(), getMapPoints()]);

  return (
    <>
      {/* Force light mode for this page only — looks far better in screen-shares
          and slide decks than the dark app theme. Runs before paint to avoid flash. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.classList.remove('dark');document.documentElement.style.colorScheme='light';`,
        }}
      />
      <div className="min-h-screen bg-white text-slate-900 antialiased">
        {/* Top bar */}
        <header className="border-b border-slate-200 bg-white/90 backdrop-blur sticky top-0 z-40">
          <div className="px-6 h-16 max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex w-8 h-8 bg-emerald-600 rounded-lg items-center justify-center shadow-sm">
                <svg viewBox="0 0 32 32" className="w-4 h-4" fill="none" aria-hidden>
                  <path d="M 10.5 10.5 L 21.5 10.5 L 16 22 Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="10.5" cy="10.5" r="2.6" fill="white" />
                  <circle cx="21.5" cy="10.5" r="2.6" fill="white" />
                  <circle cx="16"   cy="22"   r="2.6" fill="white" />
                </svg>
              </span>
              <span className="font-semibold text-slate-900 text-[16px] tracking-tight">LabStack</span>
              <span className="hidden sm:inline text-slate-300 text-sm">·</span>
              <span className="hidden sm:inline text-slate-500 text-sm">Provider Network</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span className="inline-flex w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="font-medium">Live coverage · {stats.pincodes_covered.toLocaleString()} pincodes</span>
            </div>
          </div>
        </header>

        {/* Hero */}
        <section className="px-6 pt-10 pb-6 max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2.5 text-lg md:text-xl font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-5 py-2.5">
            <Activity className="w-5 h-5" />
            <span>Provider network across India</span>
          </div>
        </section>

        {/* Stats strip */}
        <section className="px-6 mb-10 max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              icon={<MapPinned className="w-5 h-5" />}
              iconClass="text-emerald-600 bg-emerald-50"
              value={stats.pincodes_covered.toLocaleString()}
              label="Pincodes covered"
            />
            <StatCard
              icon={<Building2 className="w-5 h-5" />}
              iconClass="text-blue-600 bg-blue-50"
              value={stats.center_visit_pincodes.toLocaleString()}
              label="With center visit"
            />
            <StatCard
              icon={<HomeIcon className="w-5 h-5" />}
              iconClass="text-violet-600 bg-violet-50"
              value={stats.home_sample_pincodes.toLocaleString()}
              label="With home sample"
            />
            <StatCard
              icon={<Building2 className="w-5 h-5" />}
              iconClass="text-slate-600 bg-slate-100"
              value={stats.distinct_labs.toLocaleString()}
              label="Partner labs"
            />
          </div>
        </section>

        {/* Map + search + result — the centerpiece */}
        <section className="px-6 pb-16 max-w-6xl mx-auto">
          <NetworkClient points={points} />
        </section>
      </div>
    </>
  );
}

function StatCard({
  icon, iconClass, value, label,
}: { icon: React.ReactNode; iconClass: string; value: string; label: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow">
      <span className={`inline-flex w-10 h-10 rounded-lg items-center justify-center ${iconClass}`}>
        {icon}
      </span>
      <div>
        <div className="text-2xl font-bold tabular-nums leading-tight text-slate-900">{value}</div>
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mt-0.5">{label}</div>
      </div>
    </div>
  );
}
