'use client';

import dynamic from 'next/dynamic';
import { useState, useTransition } from 'react';
import { Search, MapPin, Home, Building2, X } from 'lucide-react';
import type { NetworkPoint, Mode } from '@/components/PublicNetworkMap';
import { NetworkMapControls } from '@/components/PublicNetworkMap';

const PublicNetworkMap = dynamic(
  () => import('@/components/PublicNetworkMap').then((m) => m.PublicNetworkMap),
  { ssr: false, loading: () => <div className="rounded-2xl border border-slate-200 bg-slate-50" style={{ height: 600 }} /> },
);

type Lab = {
  name: string;
  kind: 'LAB' | 'HOSPITAL';
  city: string | null;
  state: string | null;
  modalities: string[];
};

type Lookup = {
  pincode: string;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  center_visit: Lab[];
  home_sample: Lab[];
  found: boolean;
};

export function NetworkClient({ points }: { points: NetworkPoint[] }) {
  const [pinInput, setPinInput] = useState('');
  const [mode, setMode] = useState<Mode>('both');
  const [result, setResult] = useState<Lookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const lookup = (raw: string) => {
    const p = raw.trim();
    if (!/^\d{6}$/.test(p)) {
      setError('Enter a 6-digit pincode.');
      setResult(null);
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await fetch(`/api/public/pincode?p=${p}`);
      if (!r.ok) { setError('Lookup failed. Try again in a moment.'); return; }
      const data: Lookup = await r.json();
      setResult(data);
      setPinInput(p);
    });
  };

  const focus =
    result && result.latitude != null && result.longitude != null
      ? { pincode: result.pincode, latitude: result.latitude, longitude: result.longitude }
      : null;

  return (
    <div>
      {/* Search bar — prominent but not overpowering. Centered above the map. */}
      <div className="max-w-2xl mx-auto mb-6">
        <form
          onSubmit={(e) => { e.preventDefault(); lookup(pinInput); }}
          className="flex items-stretch gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Check coverage by pincode (e.g. 560102)"
              inputMode="numeric"
              pattern="[0-9]{6}"
              className="w-full h-12 pl-10 pr-3 rounded-lg border border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400
                         focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-500 transition"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="h-12 px-5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white rounded-lg font-semibold transition shadow-sm"
          >
            {pending ? 'Looking up…' : 'Check coverage'}
          </button>
        </form>
        {error && <p className="text-center text-sm text-rose-600 mt-2">{error}</p>}
      </div>

      {/* Controls above the map */}
      <NetworkMapControls mode={mode} onChange={setMode} />

      {/* Result either splits with the map (desktop) or stacks below (mobile) */}
      {result ? (
        <div className="grid lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3">
            <PublicNetworkMap points={points} mode={mode} onPincodeSelect={lookup} focusPincode={focus} />
          </div>
          <div className="lg:col-span-2">
            <ResultPanel result={result} onClose={() => { setResult(null); setPinInput(''); }} />
          </div>
        </div>
      ) : (
        <PublicNetworkMap points={points} mode={mode} onPincodeSelect={lookup} focusPincode={null} />
      )}
    </div>
  );
}

function ResultPanel({ result, onClose }: { result: Lookup; onClose: () => void }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-lg p-5 lg:sticky lg:top-24">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-slate-500">Pincode</div>
          <div className="text-3xl font-bold tabular-nums text-slate-900 leading-tight">{result.pincode}</div>
          {(result.city || result.state) && (
            <div className="text-sm text-slate-500 mt-0.5 flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {[result.city, result.state].filter(Boolean).join(', ')}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 transition p-1.5 rounded-md hover:bg-slate-100"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {!result.found ? (
        <NoCoverage />
      ) : (
        <div className="space-y-4">
          {/* Summary chip strip */}
          <div className="flex gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-100 font-medium">
              <Building2 className="w-3 h-3" /> {result.center_visit.length} center visit
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-violet-50 text-violet-700 border border-violet-100 font-medium">
              <Home className="w-3 h-3" /> {result.home_sample.length} home sample
            </span>
          </div>

          <LabSection
            icon={<Building2 className="w-4 h-4 text-blue-600" />}
            title="Center visit"
            desc="Walk-in sample collection at a lab or hospital"
            labs={result.center_visit}
            emptyMsg="No center-visit partners at this pincode yet."
          />
          <LabSection
            icon={<Home className="w-4 h-4 text-violet-600" />}
            title="Home sample collection"
            desc="A phlebotomist visits the customer's address"
            labs={result.home_sample}
            emptyMsg="No home-sample partners serving this pincode yet."
            hideLocation         // lab's HQ city is irrelevant for home-sample service
          />
        </div>
      )}
    </div>
  );
}

function LabSection({
  icon, title, desc, labs, emptyMsg, hideLocation = false,
}: {
  icon: React.ReactNode; title: string; desc: string; labs: Lab[]; emptyMsg: string;
  hideLocation?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h3 className="font-semibold text-slate-900 text-[14px]">{title}</h3>
        <span className="ml-auto text-xs text-slate-500 tabular-nums font-medium">{labs.length}</span>
      </div>
      <p className="text-[11px] text-slate-500 mb-2.5">{desc}</p>

      {labs.length === 0 ? (
        <p className="text-sm text-slate-500 italic py-1.5">{emptyMsg}</p>
      ) : (
        <ul className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1 -mr-1">
          {labs.map((l, i) => (
            <li key={`${l.name}-${i}`} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 hover:bg-white hover:border-slate-300 transition">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 text-sm leading-tight truncate">{l.name}</div>
                  {!hideLocation && l.city && (
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {l.city}{l.state ? `, ${l.state}` : ''}
                    </div>
                  )}
                </div>
                <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                  l.kind === 'HOSPITAL'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                }`}>
                  {l.kind === 'HOSPITAL' ? 'Hospital' : 'Lab'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NoCoverage() {
  return (
    <div className="text-center py-8">
      <div className="inline-flex w-12 h-12 rounded-full bg-amber-50 text-amber-600 items-center justify-center mb-3 border border-amber-100">
        <MapPin className="w-5 h-5" />
      </div>
      <p className="text-slate-900 font-semibold mb-1">Not covered yet</p>
      <p className="text-sm text-slate-500 max-w-xs mx-auto">
        This pincode isn't part of the active network. We're constantly expanding —
        let us know if it's a priority for your customers.
      </p>
    </div>
  );
}
