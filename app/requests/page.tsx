import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Inbox } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { InfoTip } from '@/components/ui/InfoTip';
import { ChipButton } from '@/components/ui/Toggle';
import {
  getRequests, countRequests, getRequestFunnel, getFacets, getRequestFreshness,
  getUntrackedCount,
} from '@/lib/requestQueries';
import {
  REQUEST_STATES, STATE_SHORT, STAGE_LABEL, SETTLED_STAGES,
  PIPELINE_STAGES, CLOSED_STAGES,
  type RequestState,
} from '@/lib/requests';
import { RequestsTable } from './RequestsTable';
import { DateRange } from './DateRange';
import { RequestFunnel } from './RequestFunnel';
import { SearchBar } from './SearchBar';
import { RefreshRequests } from './RefreshRequests';

export const dynamic = 'force-dynamic';

/** One labelled line of filters. */
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5">
      <span className="w-[150px] shrink-0 text-[11px] uppercase tracking-wide text-ink-400">
        {label}
      </span>
      {children}
    </div>
  );
}

const Divider = () => <span className="w-px h-4 bg-ink-200 mx-1.5" />;

const SORT_LABEL = {
  newest: 'newest first', oldest: 'oldest first',
  value: 'highest quote', value_asc: 'lowest quote',
  soonest: 'earliest date', demand: 'highest pincode demand',
} as const;

/**
 * Order statuses worth filtering on. The source carries a dozen; these are the
 * ones with volume behind them, in the order an order moves through them.
 */
const ORDER_STATUS_FILTERS = [
  ['ORDER_SCHEDULED', 'Scheduled'],
  ['SAMPLE_COLLECTED', 'Sample collected'],
  ['SAMPLE_PROCESSED', 'Sample processed'],
  ['REPORT_DELIVERED', 'Report delivered'],
  ['RESCHEDULED', 'Rescheduled'],
  ['CANCELED', 'Cancelled'],
] as const;

const WINDOW_LABEL = {
  today: 'today', week: 'last 7 days', month: 'last 30 days', all: 'all time',
} as const;

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const gate = await requireView('requests', '/requests');
  if (gate.blocked) return <RoleBlocked area="Requests" detail="operations, network and admin" />;

  const state = (REQUEST_STATES as readonly string[]).includes(searchParams.state ?? '')
    ? (searchParams.state as RequestState) : undefined;
  // Picking a settled stage implies wanting to see settled requests. Without
  // this, filtering to "Ordered" returns zero rows and reads as broken.
  // Both are lists: a person owns several stores and works several stages at
  // once, and a filter that only holds one value makes them run the page
  // twice and add the numbers up themselves.
  const csv = (v: string | undefined) =>
    (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const stages = csv(searchParams.status);
  const stores = csv(searchParams.store).map(Number).filter(Number.isInteger);

  // Asking about appointments is asking about orders, and an order means the
  // request converted — which the open queue hides. Filtering to "appointment
  // today" and getting nothing would read as broken rather than as filtered.
  const openOnly = searchParams.all !== '1'
    && !searchParams.oappt
    && !searchParams.orderStatus
    && !stages.some((st) => SETTLED_STAGES.has(st));
  const f = {
    state,
    status: stages,
    store: stores,
    city: searchParams.city,
    q: searchParams.q,
    sort: (searchParams.sort as 'newest' | 'oldest' | 'value' | 'value_asc' | 'soonest' | 'demand') ?? 'newest',
    priced: searchParams.priced === '1',
    hasLab: searchParams.haslab === '1',
    // Default to the last 7 days, because an all-time queue is a year of
    // history and tells nobody what to do this morning — except when
    // searching, where the whole point is to find one specific thing whose age
    // you do not know. A search scoped to a week returns nothing and reads as
    // "not found" rather than "not in this window".
    window: (searchParams.window as 'today' | 'week' | 'month' | 'all')
            ?? (searchParams.q ? 'all' : 'week'),
    appt: searchParams.appt as 'today' | 'tomorrow' | 'soon' | 'overdue' | 'none' | undefined,
    eta: searchParams.eta as 'today' | 'tomorrow' | 'soon' | 'overdue' | 'none' | undefined,
    oappt: searchParams.oappt as 'today' | 'tomorrow' | 'week' | 'past' | 'any' | undefined,
    createdFrom: searchParams.createdFrom, createdTo: searchParams.createdTo,
    apptFrom: searchParams.apptFrom,       apptTo: searchParams.apptTo,
    etaFrom: searchParams.etaFrom,         etaTo: searchParams.etaTo,
    orderStatus: searchParams.orderStatus,
    openOnly,
    limit: 150,
  };

  const [rows, total, facets, funnel, fresh, untracked] = await Promise.all([
    getRequests(f), countRequests(f), getFacets(f),
    getRequestFunnel({ ...f, state: undefined }),
    getRequestFreshness(),
    getUntrackedCount(f),
  ]);

  /**
   * The same link with one value toggled in or out of a comma-separated list.
   * Clicking a chip that is already on turns it off, which is what a chip
   * that looks pressed should do.
   */
  const toggle = (k: string, v: string) => {
    const current = csv(searchParams[k]);
    const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
    return keep(k, next.length ? next.join(',') : undefined);
  };

  /** Same link, with several keys dropped at once. */
  const drop = (...keys: string[]) => {
    const p = new URLSearchParams();
    for (const [key, val] of Object.entries(searchParams)) {
      if (val && !keys.includes(key)) p.set(key, val);
    }
    const q = p.toString();
    return `/requests${q ? `?${q}` : ''}`;
  };

  const keep = (k: string, v?: string) => {
    const p = new URLSearchParams();
    for (const [key, val] of Object.entries(searchParams)) if (val && key !== k) p.set(key, val);
    if (v) p.set(k, v);
    return `/requests?${p.toString()}`;
  };

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Requests"
        subtitle="Serviceability, price, earliest available date and order status for every request."
        actions={
          <InfoTip
            title="Requests"
            shows="Every request, classified, with the price and date to quote when we cannot serve it today."
            computed={
              <>
                A request is <b>serviceable</b> when one covering lab offers everything asked
                for. If labs cover the pincode but none carries the full request it is a{' '}
                <b>package gap</b> — an activation at a partner we already have. If no lab
                covers it, it is a <b>supply gap</b>, split by whether a candidate is close
                enough to onboard. Price is a reference cost times a markup banded on distance
                to the nearest lab; the date comes from policy per state.
              </>
            }
            drives={
              <>
                Copy the block into the LabStack console and mark the request quoted. Once the
                store accepts and the order books against the placeholder lab, it appears in
                the Network bucket with a clock on it. Atlas never quotes without a basis — it
                says so and escalates instead.
              </>
            }
          />
        }
      />

      <div className="flex flex-wrap items-center gap-3 mt-4">
        <SearchBar initial={searchParams.q} />
        <RefreshRequests newestAt={fresh?.newest ?? null} />
        {searchParams.q && (
          <span className="text-xs text-ink-500">
            {total.toLocaleString('en-IN')} match{total === 1 ? '' : 'es'} for
            {' '}<b className="text-ink-900">{searchParams.q}</b>
          </span>
        )}
      </div>

      {/* A stale snapshot looks exactly like a quiet day. Say which it is. */}
      {funnel.received === 0 && (fresh?.age_hours ?? 0) > 36 && (
        <div className="mt-4 mb-4 rounded-lg border border-warn-100 bg-warn-50 px-4 py-3 text-sm text-ink-700">
          <span className="font-medium text-warn-600">No rows here may mean stale data.</span>{' '}
          The newest request Atlas holds arrived{' '}
          <b>{Math.round((fresh!.age_hours ?? 0) / 24)} days ago</b>
          {fresh?.newest && ` (${new Date(fresh.newest).toLocaleDateString('en-IN',
            { day: 'numeric', month: 'short' })})`}
          , so the nightly refresh has probably not run. Widen the window to see
          what is there, and check <code className="font-mono text-[11px]">docker compose logs atlas-refresh</code>.
        </div>
      )}

      <div className="mt-4" />
      <RequestFunnel
        funnel={funnel}
        windowLabel={WINDOW_LABEL[(searchParams.window ?? (searchParams.q ? 'all' : 'week')) as keyof typeof WINDOW_LABEL]}
        hrefFor={(k, v) => keep(k, v)}
      />

      {/* One filter surface, above the rows it filters.
          Four different dates hang off a request — created, the appointment
          the store asked for, the earliest date we offered, and the booked
          appointment on the order — and they are not interchangeable, so each
          is its own labelled row with its own range. */}
      <div className="mb-4 rounded-lg border border-ink-200 bg-surface divide-y divide-ink-100">
        <FilterRow label="Created">
          {([
            ['today', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days'], ['all', 'All time'],
          ] as const).map(([k, label]) => (
            <ChipButton key={k} href={keep('window', k)}
                        active={(searchParams.window ?? (searchParams.q ? 'all' : 'week')) === k}>
              {label}
            </ChipButton>
          ))}
          <Divider />
          <DateRange fromName="createdFrom" toName="createdTo" params={searchParams} />
        </FilterRow>

        <FilterRow label="Serviceability">
          <ChipButton href={keep('state')} active={!state}>All</ChipButton>
          {REQUEST_STATES.map((st) => (
            <ChipButton key={st} href={keep('state', st)} active={state === st}>
              {STATE_SHORT[st]}
            </ChipButton>
          ))}
          <Divider />
          {/* "Settled" was jargon for five console statuses that mean nobody
              is waiting on us. Name them instead. */}
          <ChipButton href={keep('all', openOnly ? '1' : undefined)} active={!openOnly}>
            Include ordered &amp; closed
          </ChipButton>
        </FilterRow>

        <FilterRow label="Preferred appointment">
          <ChipButton href={keep('appt')} active={!searchParams.appt}>Any</ChipButton>
          {([
            ['overdue', 'Date passed'], ['today', 'Today'], ['tomorrow', 'Tomorrow'],
            ['soon', 'Within 3 days'], ['none', 'No date'],
          ] as const).map(([k, label]) => (
            <ChipButton key={k} href={keep('appt', searchParams.appt === k ? undefined : k)}
                        active={searchParams.appt === k}>
              {label}
            </ChipButton>
          ))}
          <Divider />
          <DateRange fromName="apptFrom" toName="apptTo" params={searchParams} />
        </FilterRow>

        <FilterRow label="Earliest available date">
          <ChipButton href={keep('eta')} active={!searchParams.eta}>Any</ChipButton>
          {([
            ['overdue', 'Date passed'], ['today', 'Today'], ['tomorrow', 'Tomorrow'],
            ['soon', 'Within 3 days'], ['none', 'No date'],
          ] as const).map(([k, label]) => (
            <ChipButton key={k} href={keep('eta', searchParams.eta === k ? undefined : k)}
                        active={searchParams.eta === k}>
              {label}
            </ChipButton>
          ))}
          <Divider />
          <DateRange fromName="etaFrom" toName="etaTo" params={searchParams} />
        </FilterRow>

        <FilterRow label="Order status">
          <ChipButton href={drop('oappt', 'orderStatus')}
                      active={!searchParams.oappt && !searchParams.orderStatus}>
            All
          </ChipButton>
          <ChipButton href={keep('oappt', 'any')} active={searchParams.oappt === 'any'}>
            Converted to order
          </ChipButton>
          <Divider />
          {ORDER_STATUS_FILTERS.map(([k, label]) => (
            <ChipButton key={k} href={keep('orderStatus', searchParams.orderStatus === k ? undefined : k)}
                        active={searchParams.orderStatus === k}>
              {label}
            </ChipButton>
          ))}
        </FilterRow>

        <FilterRow label="Order appointment">
          <ChipButton href={keep('oappt')} active={!searchParams.oappt}>Any</ChipButton>
          {([
            ['today', 'Today'], ['tomorrow', 'Tomorrow'],
            ['week', 'Next 7 days'], ['past', 'Date passed'],
          ] as const).map(([k, label]) => (
            <ChipButton key={k} href={keep('oappt', searchParams.oappt === k ? undefined : k)}
                        active={searchParams.oappt === k}>
              {label}
            </ChipButton>
          ))}
        </FilterRow>

        <FilterRow label="Store">
          <ChipButton href={keep('store')} active={stores.length === 0}>All</ChipButton>
          {/* Only stores with something in the current view. With forty-odd
              tracked stores most are zero, and the handful with actual work is
              what the row is for. What is hidden is counted at the end. */}
          {facets.stores.filter((st) => st.n > 0).map((st) => (
            <ChipButton key={st.store_id} href={toggle('store', String(st.store_id))}
                        active={stores.includes(st.store_id)}>
              {st.name} <span className="text-ink-400">{st.n}</span>
            </ChipButton>
          ))}
          {(() => {
            const quiet = facets.stores.filter((st) => st.n === 0).length;
            const bits = [
              quiet > 0 ? `${quiet} with none` : null,
              untracked > 0 ? `${untracked.toLocaleString('en-IN')} hidden` : null,
            ].filter(Boolean);
            return (
              <Link href="/settings/stores"
                    className="text-[11px] text-brand-600 hover:underline ml-1 whitespace-nowrap">
                {bits.length ? `${bits.join(' · ')} · edit stores →` : 'edit stores →'}
              </Link>
            );
          })()}
        </FilterRow>

        {/* The page's job, in the order it happens: open, quoted, accepted,
            ordered. Listed apart from the stages where nobody is working the
            request any more, because mixing them made a pipeline read as a
            set of unrelated labels. */}
        <FilterRow label="Pipeline">
          <ChipButton href={keep('status')} active={stages.length === 0}>All</ChipButton>
          {PIPELINE_STAGES.map((st, i) => {
            const n = facets.stages.find((x) => x.status === st)?.n ?? 0;
            return (
              <span key={st} className="inline-flex items-center gap-1.5">
                {i > 0 && <span className="text-ink-300 text-[11px]">→</span>}
                <ChipButton href={toggle('status', st)} active={stages.includes(st)}>
                  {STAGE_LABEL[st]} <span className="text-ink-400">{n}</span>
                </ChipButton>
              </span>
            );
          })}
        </FilterRow>

        <FilterRow label="Closed">
          {CLOSED_STAGES.filter((st) => (facets.stages.find((x) => x.status === st)?.n ?? 0) > 0)
            .map((st) => (
              <ChipButton key={st} href={toggle('status', st)} active={stages.includes(st)}>
                {STAGE_LABEL[st]}{' '}
                <span className="text-ink-400">
                  {facets.stages.find((x) => x.status === st)?.n ?? 0}
                </span>
              </ChipButton>
            ))}
        </FilterRow>

        <FilterRow label="Sort by">
          {([
            ['newest', 'Newest first'],
            ['oldest', 'Oldest first'],
            ['value', 'Highest quote'],
            ['value_asc', 'Lowest quote'],
            ['soonest', 'Earliest date'],
            ['demand', 'Highest pincode demand'],
          ] as const).map(([k, label]) => (
            <ChipButton key={k} href={keep('sort', k)} active={(searchParams.sort ?? 'newest') === k}>
              {label}
            </ChipButton>
          ))}
          <Divider />
          <ChipButton href={keep('priced', searchParams.priced === '1' ? undefined : '1')}
                      active={searchParams.priced === '1'}>
            Priced only
          </ChipButton>
          <ChipButton href={keep('haslab', searchParams.haslab === '1' ? undefined : '1')}
                      active={searchParams.haslab === '1'}>
            Covering lab only
          </ChipButton>
        </FilterRow>
      </div>

      <Card>
        <CardHeader
          title={`${rows.length.toLocaleString('en-IN')} shown${total > rows.length ? ` of ${total.toLocaleString('en-IN')}` : ''}`}
          subtitle={`Sorted by ${SORT_LABEL[(searchParams.sort ?? 'newest') as keyof typeof SORT_LABEL]}.`}
          icon={<Inbox className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5">
            <RequestsTable
              rows={rows}
              windowLabel={WINDOW_LABEL[(searchParams.window ?? (searchParams.q ? 'all' : 'week')) as keyof typeof WINDOW_LABEL]}
              widenHref={keep('window', 'all')}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
