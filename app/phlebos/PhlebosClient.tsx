'use client';

import { useEffect, useState, useTransition } from 'react';
import { Phone, MapPin, Search, X, Sparkles, Database, Users, Building2 } from 'lucide-react';

type Phlebo = {
  phone: string;
  name: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  orders_served: number;
  active_days: number | null;
  avg_orders_per_day: number | null;
  labs: string[] | null;
  first_order_at: string | null;
  last_order_at: string | null;
  is_shared_phone: boolean;
  variants_at_phone: number;
  email: string | null;
  notes: string | null;
  source: 'derived' | 'manual' | 'both';
  distance_km?: number | null;
};

type Filters = {
  q: string;
  pincode: string;
  city: string;
  source: 'derived' | 'manual' | 'both' | 'all';
  nearby: boolean;
  radiusKm: number;
  minOrders: number;
};

export function PhlebosClient({
  initialPhlebos,
  initialTotal,
  initialFilters,
  defaultRadius,
  isAdmin,
}: {
  initialPhlebos: Phlebo[];
  initialTotal: number;
  initialFilters: Filters;
  defaultRadius: number;
  isAdmin: boolean;
}) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [phlebos, setPhlebos] = useState<Phlebo[]>(initialPhlebos);
  const [total, setTotal] = useState(initialTotal);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Live search — debounced
  useEffect(() => {
    const t = setTimeout(() => runSearch(filters), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.pincode, filters.city, filters.source, filters.nearby, filters.radiusKm, filters.minOrders]);

  const runSearch = (f: Filters) => {
    const params = new URLSearchParams();
    if (f.q) params.set('q', f.q);
    if (f.pincode) params.set('pincode', f.pincode);
    if (f.city) params.set('city', f.city);
    if (f.source !== 'all') params.set('source', f.source);
    if (f.nearby) params.set('nearby', '1');
    if (f.radiusKm !== defaultRadius) params.set('radius', String(f.radiusKm));
    if (f.minOrders > 0) params.set('min', String(f.minOrders));

    startTransition(async () => {
      try {
        const r = await fetch(`/api/phlebos/search?${params.toString()}`);
        if (!r.ok) throw new Error(await r.text());
        const data = await r.json();
        setPhlebos(data.phlebos);
        setTotal(data.total);
        setError(null);
      } catch (e) {
        setError((e as Error).message || 'Search failed');
      }
    });
  };

  const clearAll = () => {
    setFilters({ q: '', pincode: '', city: '', source: 'all', nearby: false, radiusKm: defaultRadius, minOrders: 0 });
  };

  const hasFilters = filters.q || filters.pincode || filters.city || filters.source !== 'all' || filters.minOrders > 0;
  const isPincodeValid = /^\d{6}$/.test(filters.pincode);

  return (
    <div className="rounded-2xl border border-ink-200 bg-white overflow-hidden">
      {/* Filter bar */}
      <div className="p-4 border-b border-ink-200 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          {/* Free-text search */}
          <div className="relative md:col-span-2">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-ink-400" />
            <input
              type="text"
              placeholder="Search by name, phone, or city"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              className="w-full pl-8 pr-3 h-9 text-sm rounded-md border border-ink-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            />
          </div>

          {/* Pincode */}
          <div className="relative">
            <MapPin className="absolute left-2.5 top-2.5 w-4 h-4 text-ink-400" />
            <input
              type="text"
              placeholder="Pincode (6 digits)"
              value={filters.pincode}
              onChange={(e) => setFilters({ ...filters, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              maxLength={6}
              className="w-full pl-8 pr-3 h-9 text-sm tabular-nums rounded-md border border-ink-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            />
          </div>

          {/* City */}
          <input
            type="text"
            placeholder="City"
            value={filters.city}
            onChange={(e) => setFilters({ ...filters, city: e.target.value })}
            className="w-full px-3 h-9 text-sm rounded-md border border-ink-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
          />
        </div>

        {/* Row 2 — nearby toggle + source + min orders + clear */}
        <div className="flex flex-wrap items-center gap-2.5 text-sm">
          {isPincodeValid && (
            <label className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md border border-ink-200 bg-white cursor-pointer hover:bg-ink-50 transition">
              <input
                type="checkbox"
                checked={filters.nearby}
                onChange={(e) => setFilters({ ...filters, nearby: e.target.checked })}
                className="w-3.5 h-3.5"
              />
              <span className="text-xs font-medium text-ink-700">Include nearby pincodes</span>
              {filters.nearby && (
                <select
                  value={filters.radiusKm}
                  onChange={(e) => setFilters({ ...filters, radiusKm: Number(e.target.value) })}
                  onClick={(e) => e.stopPropagation()}
                  className="ml-1 text-xs bg-transparent border-0 focus:outline-none focus:ring-0 font-medium text-ink-900 cursor-pointer"
                >
                  <option value={3}>3 km</option>
                  <option value={5}>5 km</option>
                  <option value={10}>10 km</option>
                  <option value={15}>15 km</option>
                  <option value={20}>20 km</option>
                </select>
              )}
            </label>
          )}

          <label className="inline-flex items-center gap-1.5 text-xs text-ink-600">
            <span>Source:</span>
            <select
              value={filters.source}
              onChange={(e) => setFilters({ ...filters, source: e.target.value as Filters['source'] })}
              className="text-xs px-2 py-1 rounded-md border border-ink-200 bg-white font-medium"
            >
              <option value="all">All</option>
              <option value="derived">From orders</option>
              <option value="manual">Uploaded</option>
              <option value="both">Both</option>
            </select>
          </label>

          <label className="inline-flex items-center gap-1.5 text-xs text-ink-600">
            <span>Min orders:</span>
            <input
              type="number"
              min={0}
              value={filters.minOrders || ''}
              onChange={(e) => setFilters({ ...filters, minOrders: Number(e.target.value) || 0 })}
              placeholder="0"
              className="w-16 text-xs px-2 py-1 rounded-md border border-ink-200 bg-white tabular-nums"
            />
          </label>

          {hasFilters && (
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900 transition ml-auto"
            >
              <X className="w-3 h-3" /> Clear all
            </button>
          )}
        </div>
      </div>

      {/* Result count */}
      <div className="px-4 py-2 flex items-center gap-2 bg-slate-50 border-b border-ink-200 text-xs text-ink-600">
        <span>{pending ? 'Searching…' : `${total.toLocaleString('en-IN')} phlebos`}</span>
        {filters.nearby && isPincodeValid && (
          <span className="text-brand-700 font-medium">
            · within {filters.radiusKm} km of {filters.pincode}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white sticky top-0">
            <tr className="text-left text-[11px] uppercase tracking-wider text-ink-500 border-b border-ink-200">
              <th className="px-4 py-2 font-semibold">Phlebo</th>
              <th className="px-4 py-2 font-semibold">Location</th>
              <th className="px-4 py-2 font-semibold">Contact</th>
              <th className="px-4 py-2 font-semibold text-right">Orders</th>
              <th className="px-4 py-2 font-semibold">Labs</th>
              <th className="px-4 py-2 font-semibold">Source</th>
            </tr>
          </thead>
          <tbody>
            {phlebos.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <Users className="w-8 h-8 text-ink-300 mx-auto mb-2" />
                  <p className="text-sm text-ink-500">No phlebos match your filters.</p>
                  {isAdmin && !hasFilters && (
                    <p className="text-xs text-ink-400 mt-1">Once orders start flowing, phlebos will appear automatically.</p>
                  )}
                </td>
              </tr>
            ) : (
              phlebos.map((p) => <PhleboRow key={p.phone} p={p} />)
            )}
          </tbody>
        </table>
      </div>

      {phlebos.length >= 200 && (
        <div className="px-4 py-2 text-xs text-ink-500 bg-slate-50 border-t border-ink-200 text-center">
          Showing top 200. Refine filters to see specific phlebos.
        </div>
      )}
    </div>
  );
}

function PhleboRow({ p }: { p: Phlebo }) {
  return (
    <tr className="border-b border-ink-100 hover:bg-slate-50/50 transition">
      <td className="px-4 py-3">
        <div className="font-semibold text-ink-900 text-[13px]">
          {p.name || '—'}
        </div>
        {p.email && <div className="text-[11px] text-ink-500 mt-0.5">{p.email}</div>}
      </td>
      <td className="px-4 py-3">
        <div className="text-[13px] text-ink-800">
          {p.city || '—'}{p.state ? `, ${p.state}` : ''}
        </div>
        <div className="text-[11px] text-ink-500 tabular-nums mt-0.5 flex items-center gap-1.5">
          {p.pincode || '—'}
          {p.distance_km != null && (
            <span className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-semibold bg-brand-50 text-brand-700 border border-brand-100 tabular-nums">
              {p.distance_km < 1 ? '<1 km' : `${p.distance_km.toFixed(1)} km`}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        {p.is_shared_phone ? (
          <div>
            <div className="inline-flex items-center gap-1 text-[13px] text-ink-500 tabular-nums font-medium">
              <Building2 className="w-3.5 h-3.5" />
              <span>{formatPhone(p.phone)}</span>
            </div>
            <div
              className="text-[10px] text-violet-700 font-semibold mt-0.5 flex items-center gap-1"
              title={`This phone is shared across ${p.variants_at_phone} phlebos${p.labs && p.labs.length ? ` at ${p.labs[0]}` : ''}. It's the lab's central dispatch/API line, not this phlebo's direct number.`}
            >
              Central lab number
              {p.labs && p.labs.length > 0 && (
                <span className="text-violet-500 font-medium normal-case">· {p.labs[0]}{p.labs.length > 1 ? ` +${p.labs.length - 1}` : ''}</span>
              )}
            </div>
          </div>
        ) : (
          <a
            href={`tel:${p.phone}`}
            className="inline-flex items-center gap-1 text-[13px] text-brand-700 hover:text-brand-900 hover:underline tabular-nums font-medium"
          >
            <Phone className="w-3.5 h-3.5" />
            {formatPhone(p.phone)}
          </a>
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        <div className="text-[13px] font-semibold text-ink-900">
          {p.orders_served.toLocaleString('en-IN')}
        </div>
        {p.active_days != null && p.avg_orders_per_day != null && (
          <div className="text-[10px] text-ink-500 mt-0.5">
            {p.active_days} days · {p.avg_orders_per_day.toFixed(1)}/day
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        {p.labs && p.labs.length > 0 ? (
          <div className="text-[12px] text-ink-700 max-w-[260px]">
            {p.labs.slice(0, 2).join(', ')}
            {p.labs.length > 2 && <span className="text-ink-500"> +{p.labs.length - 2} more</span>}
          </div>
        ) : (
          <span className="text-[12px] text-ink-400">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        {p.source === 'derived' && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <Database className="w-3 h-3" /> Orders
          </span>
        )}
        {p.source === 'manual' && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <Sparkles className="w-3 h-3" /> Uploaded
          </span>
        )}
        {p.source === 'both' && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Sparkles className="w-3 h-3" /> Both
          </span>
        )}
      </td>
    </tr>
  );
}

function formatPhone(digits: string): string {
  // e.g. "919876543210" → "+91 98765 43210"; "9876543210" → "98765 43210"
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return digits;
}
