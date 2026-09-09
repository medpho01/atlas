import type { Metadata } from 'next';
import {
  getNetworkStats, getPhleboStrength, getNurseStrength, CV_RADII,
  type StaffStrength,
} from '@/lib/publicNetwork';
import { getSessionUser } from '@/lib/auth';
import { NetworkClient } from './NetworkClient';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Provider Network · LabStack',
  description:
    'The LabStack provider network covers thousands of pincodes across India ' +
    'with centre-visit and home sample collection — the infrastructure that ' +
    'powers our healthcare partners.',
};

const n = (v: number) => v.toLocaleString('en-IN');

export default async function PublicNetworkPage() {
  // Signed-in staff reach this from the sidebar, so the page already sits
  // inside the app shell — a second header and a forced light theme would just
  // fight it. Anonymous visitors still get the standalone branded page.
  const [me, stats, phlebos, nurses] = await Promise.all([
    getSessionUser(), getNetworkStats(), getPhleboStrength(), getNurseStrength(),
  ]);
  const embedded = Boolean(me);

  const pct = stats.india_pincodes
    ? Math.round((100 * stats.pincodes_covered) / stats.india_pincodes)
    : 0;

  const body = (
    <>
      <section className="px-6 pt-6 max-w-6xl mx-auto">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-6 py-6">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                LabStack coverage
              </div>
              <div className="text-4xl sm:text-5xl font-bold tabular-nums leading-none mt-1 text-slate-900">
                {n(stats.pincodes_covered)}
                <span className="block sm:inline text-base sm:text-lg font-medium text-slate-400 sm:ml-2">
                  of {n(stats.india_pincodes)} pincodes in India
                </span>
              </div>
            </div>
            <div className="text-left sm:text-right">
              <div className="text-2xl sm:text-3xl font-bold tabular-nums text-slate-900">{pct}%</div>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">of India</div>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <Bar label="Home sample" value={stats.home_sample_pincodes}
                 total={stats.india_pincodes} className="bg-violet-500" />
            <Bar label="Centre visit" value={stats.center_visit_pincodes}
                 total={stats.india_pincodes} className="bg-blue-500" />
          </div>
        </div>
      </section>

      {/* The map is the thing people react to first, so it sits directly under
          the headline rather than below four cards. */}
      <section className="px-6 pt-5 max-w-6xl mx-auto">
        <NetworkClient />
      </section>

      <section className="px-6 pt-5 pb-8 max-w-6xl mx-auto">
        <div className="grid md:grid-cols-2 gap-5">
          <Panel title="Home sample collection" accent="bg-violet-50 text-violet-600" glyph="⌂">
            <Stats items={[
              { v: stats.home_sample_pincodes, l: 'Pincodes served' },
              { v: stats.home_sample_labs, l: 'Partnered labs' },
            ]} />
          </Panel>

          <Panel title="Centre visit network" accent="bg-blue-50 text-blue-600" glyph="▣">
            <Stats items={[
              { v: stats.center_visit_pincodes, l: 'Pincodes covered' },
              { v: stats.center_visit_centres, l: 'Centres' },
            ]} />
            <div className="mt-3 flex gap-2 text-[11px]">
              <span className="px-2 py-1 rounded-md bg-slate-100 border border-slate-200 font-medium tabular-nums">
                {n(stats.center_visit_labs)} labs
              </span>
              <span className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100 font-medium tabular-nums">
                {n(stats.center_visit_hospitals)} hospitals
              </span>
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">
                Coverage radius
              </div>
              <div className="flex items-center gap-4 text-[11px] text-slate-700">
                <span><b className="tabular-nums">{CV_RADII.metro} km</b> metro</span>
                <span className="text-slate-300">|</span>
                <span><b className="tabular-nums">{CV_RADII.nonMetro} km</b> rest of India</span>
              </div>
            </div>
          </Panel>

          {phlebos && (
            <Panel title="Phlebotomist strength" accent="bg-teal-50 text-teal-600" glyph="✚">
              <StaffBody s={phlebos} unit="Phlebos" bar="bg-teal-500" />
            </Panel>
          )}

          {nurses && (
            <Panel title="Nurse network strength" accent="bg-rose-50 text-rose-600" glyph="♥">
              <StaffBody s={nurses} unit="Nurses" bar="bg-rose-400" />
            </Panel>
          )}
        </div>
      </section>


    </>
  );

  if (embedded) return <div className="pb-4">{body}</div>;

  return (
    <>
      {/* Force light mode for the public page only — looks far better in
          screen-shares and slide decks than the dark app theme. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.classList.remove('dark');document.documentElement.style.colorScheme='light';`,
        }}
      />
      <div className="min-h-screen bg-white text-slate-900 antialiased">
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
              <span className="font-medium tabular-nums">{n(stats.pincodes_covered)} pincodes</span>
            </div>
          </div>
        </header>
        {body}
      </div>
    </>
  );
}

function Bar({ label, value, total, className }: {
  label: string; value: number; total: number; className: string;
}) {
  const w = total ? Math.min(100, (100 * value) / total) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[13px] font-medium text-slate-700">{label}</span>
        <span className="text-[13px] font-semibold tabular-nums text-slate-900">{n(value)}</span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-2.5 rounded-full ${className}`} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

function Panel({ title, accent, glyph, children }: {
  title: string; accent: string; glyph: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <span className={`w-7 h-7 rounded-lg grid place-items-center text-sm ${accent}`}>{glyph}</span>
        <h3 className="font-semibold text-[15px] text-slate-900">{title}</h3>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Stats({ items }: { items: { v: number; l: string }[] }) {
  return (
    <div className={`grid gap-3 sm:gap-4 ${items.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {items.map((it) => (
        <div key={it.l}>
          <div className="text-2xl sm:text-3xl font-bold tabular-nums text-slate-900">{n(it.v)}</div>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mt-0.5">{it.l}</div>
        </div>
      ))}
    </div>
  );
}

function StaffBody({ s, unit, bar }: { s: StaffStrength; unit: string; bar: string }) {
  const top = s.top_cities.slice(0, 3);
  const max = top[0]?.people ?? 1;
  return (
    <>
      <Stats items={[
        { v: s.people, l: unit },
        { v: s.pincodes, l: 'Pincodes' },
        { v: s.cities, l: 'Cities' },
      ]} />
      {top.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {top.map((c) => (
            <div key={c.city} className="flex items-center gap-2 text-[11px]">
              <span className="w-24 text-slate-500 truncate">{c.city}</span>
              <div className="flex-1 h-2 rounded bg-slate-100 overflow-hidden">
                <div className={`h-2 rounded ${bar}`} style={{ width: `${(100 * c.people) / max}%` }} />
              </div>
              <span className="tabular-nums w-10 text-right text-slate-600">{n(c.people)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
