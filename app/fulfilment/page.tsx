import Link from 'next/link';
import { Sparkles, AlertTriangle, MoveRight, Phone, CircleDot } from 'lucide-react';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChipButton, SegmentedControl } from '@/components/ui/Toggle';
import { StickyMetrics } from '@/components/ui/StickyMetrics';
import { KpiTile } from '@/components/KpiTile';
import {
  istDay, shiftDay, getOpenPromises, getDayOrders, getDayCounts, getDeskSummary,
  type DayFilters,
} from '@/lib/fulfilmentQueries';
import { OrderTable } from './OrderTable';

export const dynamic = 'force-dynamic';

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB',
    { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const inr = (v: string | null) =>
  v == null ? '—' : '₹' + Math.round(Number(v)).toLocaleString('en-IN');

export default async function FulfilmentPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const gate = await requireView('commitments', '/fulfilment');
  if (gate.blocked) return <RoleBlocked area="The fulfilment desk" detail="network, accounts and admin" />;

  const today = istDay();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day ?? '') ? searchParams.day! : today;
  const tab = searchParams.tab === 'promises' ? 'promises' : 'orders';

  const filters: DayFilters = {
    from: searchParams.from === 'all' ? 'all' : 'requests',
    lab: searchParams.lab === 'none' ? 'none' : 'any',
    first: searchParams.first === '1',
    moved: searchParams.moved === '1',
    cancelled: searchParams.cancelled === '1',
  };

  const [orders, promises, counts, summary] = await Promise.all([
    tab === 'orders' ? getDayOrders(day, filters) : Promise.resolve([]),
    tab === 'promises' ? getOpenPromises(shiftDay(day, 30)) : Promise.resolve([]),
    getDayCounts(shiftDay(day, -3), shiftDay(day, 7)),
    getDeskSummary(day),
  ]);

  /** Every filter is a link, so any view of this page can be sent to somebody. */
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      day: day === today ? undefined : day,
      tab: tab === 'orders' ? undefined : tab,
      from: filters.from === 'requests' ? undefined : filters.from,
      lab: filters.lab === 'any' ? undefined : filters.lab,
      first: filters.first ? '1' : undefined,
      moved: filters.moved ? '1' : undefined,
      cancelled: filters.cancelled ? '1' : undefined,
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const q = p.toString();
    return `/fulfilment${q ? `?${q}` : ''}`;
  };

  const countFor = (d: string) => counts.find((c) => c.day === d);
  const strip = Array.from({ length: 11 }, (_, i) => shiftDay(day, i - 3));

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Fulfilment desk"
        subtitle="The day's orders in the order they should be worked. Anything without a lab is first, whatever time it is booked for."
      />

      <StickyMetrics title="Fulfilment desk" className="mb-5">
        {/* The day, and what each nearby day is carrying, before you open it. */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="w-10 shrink-0 text-[11px] uppercase tracking-wide text-ink-400">Day</span>
          {strip.map((d) => {
            const c = countFor(d);
            return (
              <ChipButton key={d} href={link({ day: d === today ? undefined : d })} active={d === day}>
                {d === today ? 'Today' : dayLabel(d).replace(',', '')}
                {c && c.appointments > 0 && <span className="opacity-60 tabular-nums">{c.appointments}</span>}
                {c && c.unallocated > 0 && <AlertTriangle className="w-3 h-3 text-warn-500" />}
              </ChipButton>
            );
          })}
        </div>

        <div className="kpi-row grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiTile label="No lab yet" value={(summary?.no_lab ?? 0).toLocaleString('en-IN')}
                   sub={`on ${day === today ? 'today' : dayLabel(day)}`}
                   tone={summary?.no_lab ? 'bad' : 'default'} />
          <KpiTile label="First orders" value={(summary?.first_orders ?? 0).toLocaleString('en-IN')}
                   sub="a lab's first ever" tone={summary?.first_orders ? 'warn' : 'default'} />
          <KpiTile label="From requests" value={(summary?.from_requests ?? 0).toLocaleString('en-IN')}
                   sub={`of ${(summary?.appointments ?? 0).toLocaleString('en-IN')} appointments`} />
          <KpiTile label="Moved" value={(summary?.moved ?? 0).toLocaleString('en-IN')}
                   sub="rescheduled since we looked" />
          <KpiTile label="Promised, no order" value={(summary?.promises ?? 0).toLocaleString('en-IN')}
                   sub={`${summary?.overdue ?? 0} past the promised date`}
                   tone={summary?.overdue ? 'warn' : 'default'} />
        </div>
      </StickyMetrics>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <SegmentedControl
          options={[
            { label: `Day's orders${summary ? ` (${summary.from_requests})` : ''}`,
              href: link({ tab: undefined }), active: tab === 'orders' },
            { label: `Promised, no order yet${summary ? ` (${summary.promises})` : ''}`,
              href: link({ tab: 'promises' }), active: tab === 'promises' },
          ]}
        />
      </div>

      {tab === 'orders' ? (
        <Card>
          <CardHeader
            title={`Orders on ${day === today ? 'today' : dayLabel(day)}`}
            subtitle="Click a row for the lab situation: who is on it, who else could be, and what each is missing."
          />
          <CardBody className="pt-0">
            {/* Filters, as chips, because a filtered view should be a link. */}
            <div className="flex flex-wrap items-center gap-1.5 pb-3">
              <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">From</span>
              <ChipButton href={link({ from: undefined })} active={filters.from === 'requests'}>Requests</ChipButton>
              <ChipButton href={link({ from: 'all' })} active={filters.from === 'all'}>All orders</ChipButton>

              <span className="text-[11px] uppercase tracking-wide text-ink-400 mx-1 ml-4">Only</span>
              <ChipButton href={link({ lab: filters.lab === 'none' ? undefined : 'none' })} active={filters.lab === 'none'}>
                <AlertTriangle className="w-3 h-3" /> No lab
              </ChipButton>
              <ChipButton href={link({ first: filters.first ? undefined : '1' })} active={filters.first}>
                <Sparkles className="w-3 h-3" /> First orders
              </ChipButton>
              <ChipButton href={link({ moved: filters.moved ? undefined : '1' })} active={filters.moved}>
                <MoveRight className="w-3 h-3" /> Moved
              </ChipButton>
              <ChipButton href={link({ cancelled: filters.cancelled ? undefined : '1' })} active={filters.cancelled}>
                <CircleDot className="w-3 h-3" /> Include cancelled
              </ChipButton>

              <span className="ml-auto text-[11px] text-ink-400 tabular-nums">
                {orders.length} row{orders.length === 1 ? '' : 's'}
              </span>
            </div>

            <OrderTable rows={orders} />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Promised, no order yet"
            subtitle="A date somebody has already been given, with nobody to serve it. There is no appointment to filter on until a lab exists, which is why this is its own list."
            icon={<AlertTriangle className="w-4 h-4" />}
          />
          <CardBody className="pt-0">
            {promises.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-500">
                Nothing promised without supply. Every quoted request has a lab behind it.
              </p>
            ) : (
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full text-sm min-w-[900px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
                      <th className="text-left font-medium px-5 py-2">Request</th>
                      <th className="text-left font-medium px-2 py-2">Where</th>
                      <th className="text-left font-medium px-2 py-2">Promised</th>
                      <th className="text-right font-medium px-2 py-2">Quote</th>
                      <th className="text-left font-medium px-2 py-2">Nearest lab</th>
                      <th className="text-left font-medium px-5 py-2">Onboarding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promises.map((p) => (
                      <tr key={p.commitment_id} className="border-b border-ink-100 last:border-0">
                        <td className="px-5 py-2">
                          <Link href={`/requests/${p.request_id}`} className="font-medium text-ink-900 hover:text-brand-600">
                            #{p.request_id}
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-ink-700">
                          {p.city ?? '—'}
                          <span className="block text-[11px] text-ink-400 num">{p.pincode ?? ''}</span>
                        </td>
                        <td className="px-2 py-2">
                          <span className={p.breached ? 'text-danger-500 font-medium' : 'text-ink-700'}>
                            {p.promised_date ?? 'no date'}
                          </span>
                          {p.days_left != null && (
                            <span className="block text-[11px] text-ink-400">
                              {p.breached
                                ? `${Math.abs(p.days_left)}d overdue`
                                : p.days_left === 0 ? 'due today' : `${p.days_left}d left`}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right num">{inr(p.quoted_price)}</td>
                        <td className="px-2 py-2 text-ink-700">
                          {p.target_lab_name ?? <span className="text-ink-400">none within range</span>}
                          {p.nearest_km && <span className="block text-[11px] text-ink-400">{Math.round(Number(p.nearest_km))} km</span>}
                        </td>
                        <td className="px-5 py-2">
                          {p.crm_thread_id ? (
                            <Link href={`/crm/${p.crm_thread_id}?provider=${p.crm_provider_id}`}
                                  className="text-[12px] text-brand-700 dark:text-brand-400 hover:underline">
                              on a board · {(p.crm_stage ?? '').replace(/_/g, ' ')}
                            </Link>
                          ) : (
                            <span className="text-[12px] text-ink-400">not started</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
