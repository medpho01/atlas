import Link from 'next/link';
import { Inbox, IndianRupee, PackageCheck, MapPinOff, Clock, FileQuestion } from 'lucide-react';
import { KpiTile } from '@/components/KpiTile';
import { StickyMetrics } from '@/components/ui/StickyMetrics';
import { InfoTip } from '@/components/ui/InfoTip';

export type Funnel = {
  received: number; answerable: number; priced: number;
  quoted: number; ordered: number; sourced: number;
  no_ask: number; no_pincode: number; supply_gap: number; awaiting: number;
};

const n = (v: number) => v.toLocaleString('en-IN');

/**
 * Headline counts for the selected arrival window, in the same tiles every
 * other page uses.
 *
 * Counts only. The stage-by-stage chart that used to sit under these was a
 * report rather than a queue, and it stood between the filters and the rows
 * they filter.
 */
export function RequestFunnel({
  funnel, windowLabel, hrefFor,
}: {
  funnel: Funnel;
  windowLabel: string;
  hrefFor: (key: string, value?: string) => string;
}) {
  const conv     = funnel.received   ? Math.round((funnel.ordered / funnel.received) * 100) : 0;
  const answered = funnel.answerable ? Math.round((funnel.priced / funnel.answerable) * 100) : 0;

  return (
    <StickyMetrics title="Requests" className="mb-5">
      <div className="kpi-row grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiTile
          label="Requests received"
          value={n(funnel.received)}
          sub={windowLabel}
          icon={<Inbox className="w-4 h-4" />}
          info={<InfoTip title="Requests received"
                shows="Every request that arrived in the selected window, before any other filter."
                computed="Count of requests by creation date."
                drives="Change the Created filter to widen or narrow the window." />}
        />
        <KpiTile
          label="Priced or serviceable"
          value={`${answered}%`}
          sub={`${n(funnel.priced)} of ${n(funnel.answerable)} identified`}
          tone={answered >= 80 ? 'good' : 'warn'}
          icon={<IndianRupee className="w-4 h-4" />}
          info={<InfoTip title="Priced or serviceable"
                shows="Of the requests whose items Atlas could identify, the share it could answer — either a covering lab exists or a price could be computed."
                computed="Serviceable requests plus those with a quote, over requests with identifiable items and a pincode."
                drives="A low share means pricing inputs are missing, not that supply is short." />}
        />
        <KpiTile
          label="Converted to orders"
          value={`${conv}%`}
          sub={`${n(funnel.ordered)} orders`}
          tone={conv >= 50 ? 'good' : 'default'}
          icon={<PackageCheck className="w-4 h-4" />}
          info={<InfoTip title="Converted to orders"
                shows="The share of requests in this window that became an order in the console."
                computed="Requests with a converted order id, over requests received."
                drives="Filter Order status to see where the orders themselves ended up." />}
        />
        <Link href={hrefFor('state', 'SUPPLY_GAP_KNOWN')} className="block">
        <KpiTile
          label="Supply gap"
          value={n(funnel.supply_gap)}
          sub="no lab carries the request"
          tone={funnel.supply_gap ? 'warn' : 'default'}
          icon={<MapPinOff className="w-4 h-4" />}
          info={<InfoTip title="Supply gap"
                shows="Requests where no lab in the network covers the pincode with everything asked for."
                computed="Requests in a SUPPLY_GAP state."
                drives="Each one is a lab to onboard. Click the tile to filter to them." />}
        />
        </Link>
        <KpiTile
          label="Awaiting supply"
          value={n(funnel.awaiting)}
          sub="ordered, lab not assigned"
          tone={funnel.awaiting ? 'warn' : 'default'}
          icon={<Clock className="w-4 h-4" />}
          info={<InfoTip title="Awaiting supply"
                shows="Orders booked against the placeholder lab, with a date already given to the store."
                computed="Open commitments on requests in this window."
                drives="These have a clock on them. Securing a lab is the only thing that closes them." />}
        />
        <Link href={hrefFor('state', 'NO_ITEMS')} className="block">
        <KpiTile
          label="Unidentified items"
          value={n(funnel.no_ask)}
          sub={`${n(funnel.no_pincode)} without a pincode`}
          tone={funnel.no_ask ? 'bad' : 'default'}
          icon={<FileQuestion className="w-4 h-4" />}
          info={<InfoTip title="Unidentified items"
                shows="Requests where nothing asked for could be matched to the catalogue, so Atlas cannot price or place them."
                computed="Requests in the NO_ITEMS state; the sub-count is requests with no pincode."
                drives="A data problem, not a supply one — the catalogue mapping is what fixes it." />}
        />
        </Link>
      </div>
    </StickyMetrics>
  );
}
