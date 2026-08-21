import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';

type Intel = {
  pincode: string; area: string | null; city: string | null; district: string | null;
  state: string | null; tier: string | null; tier_rationale: string | null;
  labs_local: number | null; providers_total: number | null;
  orders_all_time: number | null; orders_l90d: number | null;
  requests_total: number; requests_unserved: number; open_commitments: number;
  nearest_lab_km: string | null; nearest_lab_name: string | null;
};

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN');

/**
 * The pincode as a place, not a number.
 *
 * "No lab covers 533220" is not something anyone can act on. Kesanakurrupalem,
 * East Godavari district, Andhra Pradesh, with 14 unserved requests and nothing
 * within 37 km — that is a decision. The demand figures are the part that
 * settles it: one stranded request is a shrug, fourteen is a lab worth signing.
 */
export function PincodeIntel({ intel }: { intel: Intel }) {
  const repeat = intel.requests_unserved > 1;

  return (
    <Card>
      <CardHeader
        title={`Pincode ${intel.pincode}`}
        subtitle="Where this is, and how often we have failed here."
        icon={<MapPin className="w-4 h-4" strokeWidth={2.25} />}
      />
      <CardBody className="pt-0 space-y-3">
        <div className="text-sm text-ink-900">
          {[intel.area, intel.district, intel.state].filter(Boolean).join(' · ')}
          {!intel.area && !intel.district && (
            <span className="text-ink-400">Not in the India Post directory</span>
          )}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <div>
            <div className="num text-base font-semibold text-ink-900">{n(intel.requests_total)}</div>
            <div className="text-ink-500">requests from here</div>
          </div>
          <div>
            <div className={`num text-base font-semibold ${repeat ? 'text-warn-600' : 'text-ink-900'}`}>
              {n(intel.requests_unserved)}
            </div>
            <div className="text-ink-500">we could not serve</div>
          </div>
          <div>
            <div className="num text-base font-semibold text-ink-900">{n(intel.orders_all_time)}</div>
            <div className="text-ink-500">orders all time</div>
          </div>
          <div>
            <div className="num text-base font-semibold text-ink-900">{n(intel.labs_local)}</div>
            <div className="text-ink-500">labs in the pincode</div>
          </div>
          {intel.open_commitments > 0 && (
            <div>
              <div className="num text-base font-semibold text-warn-600">{n(intel.open_commitments)}</div>
              <div className="text-ink-500">promises outstanding</div>
            </div>
          )}
        </div>

        <div className="text-xs text-ink-600 space-y-1 pt-1 border-t border-ink-100">
          {intel.tier && (
            <div>
              <span className="text-ink-500">City tier · </span>
              <span className="text-ink-900">{intel.tier}</span>
              {intel.city && <span className="text-ink-400"> ({intel.city})</span>}
              {intel.tier_rationale && (
                <span className="block text-[11px] text-ink-400">{intel.tier_rationale}</span>
              )}
            </div>
          )}
          {intel.nearest_lab_name && (
            <div>
              <span className="text-ink-500">Nearest lab · </span>
              <span className="text-ink-900">{intel.nearest_lab_name}</span>
              <span className="text-ink-500"> at {intel.nearest_lab_km} km</span>
            </div>
          )}
        </div>

        {repeat && (
          <p className="text-[11px] text-warn-600">
            This pincode has failed {n(intel.requests_unserved)} times. Onboarding one lab here
            settles all of them, not just this request.
          </p>
        )}

        <div className="flex flex-wrap gap-3 text-xs pt-1">
          <Link href={`/pincodes?q=${intel.pincode}`} className="text-brand-600 hover:underline">
            Coverage in {intel.pincode} →
          </Link>
          <Link href={`/requests?q=${intel.pincode}`} className="text-brand-600 hover:underline">
            All requests here →
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
