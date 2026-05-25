import { Check, X, Search, MapPin, PhoneCall, ShieldCheck } from 'lucide-react';
import { getPlatformStats } from '@/lib/queries';
import { getPincodeCoverageWithRadius } from '@/lib/coverageQueries';
import type { ProviderKind, Modality } from '@/lib/coverage';

export const dynamic = 'force-dynamic';

export default async function CheckPage({ searchParams }: { searchParams: { pin?: string } }) {
  const stats = await getPlatformStats();
  const pin = searchParams.pin?.trim();
  const valid = pin && /^\d{6}$/.test(pin);
  const cells = valid ? await getPincodeCoverageWithRadius(pin!, 5) : [];

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-gradient-to-b from-brand-50/60 via-white to-white">
      <div className="max-w-4xl mx-auto px-6 py-12 lg:py-16">
        <div className="text-center mb-10">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-50 text-brand-700 text-[11px] font-semibold uppercase tracking-wider mb-3">
            <ShieldCheck className="w-3 h-3" /> Powered by Atlas · LabStack
          </span>
          <h1 className="text-3xl md:text-4xl font-bold text-ink-900 mb-3 tracking-tight">
            What's available in your pincode?
          </h1>
          <p className="text-ink-600 max-w-xl mx-auto">
            Check which healthcare services are live in your area — and request what's missing. India's largest diagnostics network.
          </p>
        </div>

        <div className="bg-surface rounded-2xl border border-ink-150 shadow-card-lg p-6 md:p-8 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Stat label="Labs" value={stats?.labs?.toLocaleString() ?? '—'} />
            <Stat label="Chains" value={stats?.chains?.toLocaleString() ?? '—'} />
            <Stat label="Pincodes" value={stats?.pincodes?.toLocaleString() ?? '—'} />
            <Stat label="Providers" value={stats?.providers?.toLocaleString() ?? '—'} />
          </div>

          <form method="get" className="flex items-center gap-2 max-w-md mx-auto">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                name="pin"
                defaultValue={pin ?? ''}
                placeholder="Enter your 6-digit pincode"
                maxLength={6}
                pattern="\d{6}"
                className="w-full pl-9 pr-3 py-3 rounded-xl border border-ink-200 bg-surface text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-500 transition"
              />
            </div>
            <button className="px-5 py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 transition shadow-sm">Check</button>
          </form>
        </div>

        {pin && !valid && (
          <div className="bg-warn-50 border border-warn-100 rounded-xl p-4 text-sm text-warn-600 font-medium">
            Please enter a valid 6-digit Indian pincode.
          </div>
        )}

        {valid && <PublicCoverageCard pin={pin!} cells={cells as any} />}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl md:text-3xl font-bold text-brand-700 tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mt-0.5">{label}</div>
    </div>
  );
}

function PublicCoverageCard({ pin, cells }: { pin: string; cells: { kind: ProviderKind; modality: Modality; within_radius: number }[] }) {
  const cellMap = new Map<string, number>();
  cells.forEach((c) => cellMap.set(`${c.kind}|${c.modality}`, c.within_radius));

  const anyCoverage = cells.some((c) => c.within_radius > 0);
  const labCenter = cellMap.get('LAB|CENTER_VISIT') ?? 0;
  const labHome = cellMap.get('LAB|HOME_SAMPLE') ?? 0;
  const hospital = cellMap.get('HOSPITAL|CENTER_VISIT') ?? 0;
  const doctorCenter = cellMap.get('DOCTOR|CENTER_VISIT') ?? 0;
  const doctorHome = cellMap.get('DOCTOR|HOME_VISIT') ?? 0;
  const phlebo = cellMap.get('PHLEBO|HOME_SAMPLE') ?? 0;
  const nurse = cellMap.get('NURSE|HOME_VISIT') ?? 0;
  const pharmacy = cellMap.get('PHARMACY|DELIVERY') ?? 0;

  if (!anyCoverage) {
    return (
      <div className="bg-warn-50/60 border border-warn-100 rounded-2xl p-6 md:p-8">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-warn-100 text-warn-600 flex items-center justify-center shrink-0">
            <MapPin className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-semibold text-ink-900 text-lg">We're not yet active in <span className="tabular-nums">{pin}</span></h2>
            <p className="text-sm text-ink-600 mt-1">Help us prioritize this area — leave your details and we'll reach out when we onboard a partner near you.</p>
          </div>
        </div>
        <form className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input placeholder="Your name" className="px-3 py-2 rounded-lg border border-warn-200 bg-surface text-sm" />
          <input placeholder="Mobile" className="px-3 py-2 rounded-lg border border-warn-200 bg-surface tabular-nums text-sm" />
          <input placeholder="Email (optional)" className="px-3 py-2 rounded-lg border border-warn-200 bg-surface text-sm" />
          <button className="px-4 py-2 bg-warn-500 text-white rounded-lg font-semibold hover:bg-warn-600 transition">Notify me</button>
        </form>
        <p className="text-[11px] text-ink-500 mt-3">Every request helps our network team prioritise where to expand next.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-2xl border border-ink-150 shadow-card-lg overflow-hidden">
      <div className="bg-gradient-to-r from-success-50 to-white px-6 py-4 border-b border-ink-100 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-success-100 text-success-700 flex items-center justify-center">
          <Check className="w-5 h-5" strokeWidth={2.5} />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-ink-900 text-lg">We service <span className="tabular-nums">{pin}</span></h2>
          <p className="text-xs text-ink-500">All counts shown within 5km of your pincode.</p>
        </div>
      </div>

      <div className="p-6">
        <h3 className="text-[10px] uppercase tracking-wider font-semibold text-ink-500 mb-3">Services available</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">
          <CapabilityRow label="Diagnostic lab — walk-in" count={labCenter} />
          <CapabilityRow label="Diagnostic lab — home collection" count={labHome} />
          <CapabilityRow label="Hospital — OPD" count={hospital} />
          <CapabilityRow label="Doctor — in-clinic" count={doctorCenter} />
          <CapabilityRow label="Doctor — home visit" count={doctorHome} />
          <CapabilityRow label="Phlebotomist — sample at home" count={phlebo} />
          <CapabilityRow label="Nurse — home care" count={nurse} />
          <CapabilityRow label="Pharmacy — delivery" count={pharmacy} />
        </div>

        <div className="border-t border-ink-100 pt-5">
          <h3 className="font-semibold text-ink-900 text-base mb-1 flex items-center gap-2"><PhoneCall className="w-4 h-4 text-brand-600" /> Book a test or consultation</h3>
          <p className="text-xs text-ink-500 mb-3">Tell us what you need — we'll call you back within 30 minutes.</p>
          <form className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input placeholder="Your name" className="px-3 py-2 rounded-lg border border-ink-200 bg-surface text-sm" />
            <input placeholder="Mobile" className="px-3 py-2 rounded-lg border border-ink-200 bg-surface tabular-nums text-sm" />
            <select className="px-2.5 py-2 rounded-lg border border-ink-200 bg-surface text-sm font-medium text-ink-700">
              <option>Service…</option>
              <option>Home blood test</option>
              <option>Doctor consultation</option>
              <option>Health checkup</option>
              <option>Pharmacy</option>
            </select>
            <button className="px-4 py-2 bg-brand-600 text-white rounded-lg font-semibold hover:bg-brand-700 transition">Request callback</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function CapabilityRow({ label, count }: { label: string; count: number }) {
  const ok = count > 0;
  return (
    <div className={`flex items-center justify-between rounded-lg border px-3 py-2.5 transition ${ok ? 'border-success-100 bg-success-50/40' : 'border-ink-200 bg-ink-50/40'}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${ok ? 'bg-success-100 text-success-700' : 'bg-ink-200 text-ink-400'}`}>
          {ok ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : <X className="w-3.5 h-3.5" strokeWidth={3} />}
        </span>
        <span className={`text-sm font-medium ${ok ? 'text-ink-900' : 'text-ink-400 line-through'}`}>{label}</span>
      </div>
      <span className={`tabular-nums text-sm font-bold ${ok ? 'text-ink-900' : 'text-ink-400'}`}>{count}</span>
    </div>
  );
}
