import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Inbox } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { InfoTip } from '@/components/ui/InfoTip';
import { ChipButton } from '@/components/ui/Toggle';
import {
  getRequests, countRequests, getRequestFunnel, getFacets, getRequestFreshness,
} from '@/lib/requestQueries';
import {
  REQUEST_STATES, STATE_SHORT, STAGE_ORDER, STAGE_LABEL, SETTLED_STAGES,
  type RequestState,
} from '@/lib/requests';
import { RequestsTable } from './RequestsTable';
import { RequestFunnel } from './RequestFunnel';

export const dynamic = 'force-dynamic';

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
  const openOnly = searchParams.all !== '1'
    && !(searchParams.status && SETTLED_STAGES.has(searchParams.status));
  const f = {
    state,
    status: searchParams.status,
    store: searchParams.store,
    city: searchParams.city,
    q: searchParams.q,
    sort: (searchParams.sort as 'newest' | 'oldest' | 'value' | 'value_asc' | 'soonest' | 'demand') ?? 'newest',
    priced: searchParams.priced === '1',
    disputed: searchParams.disputed === '1',
    hasLab: searchParams.haslab === '1',
    // Default to this week. An all-time queue is a year of history and tells
    // nobody what to do this morning.
    window: (searchParams.window as 'today' | 'week' | 'month' | 'all') ?? 'week',
    appt: searchParams.appt as 'today' | 'tomorrow' | 'soon' | 'overdue' | 'none' | undefined,
    openOnly,
    limit: 150,
  };

  const [rows, total, facets, funnel, fresh] = await Promise.all([
    getRequests(f), countRequests(f), getFacets(f),
    getRequestFunnel({ ...f, state: undefined }),
    getRequestFreshness(),
  ]);

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
        subtitle="One open queue. Each row carries its own answer — price, date, and why."
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

      <div className="flex flex-wrap items-center gap-1.5 my-4">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Arrived</span>
        {([
          ['today', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days'], ['all', 'All time'],
        ] as const).map(([k, label]) => (
          <ChipButton key={k} href={keep('window', k)} active={(searchParams.window ?? 'week') === k}>
            {label}
          </ChipButton>
        ))}
        <span className="w-px h-4 bg-ink-200 mx-2" />
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Wanted</span>
        {([
          ['overdue', 'Date passed'], ['today', 'Today'], ['tomorrow', 'Tomorrow'],
          ['soon', 'Within 3 days'], ['none', 'No date given'],
        ] as const).map(([k, label]) => (
          <ChipButton key={k} href={keep('appt', searchParams.appt === k ? undefined : k)}
                      active={searchParams.appt === k}>
            {label}
          </ChipButton>
        ))}
      </div>

      {/* A stale snapshot looks exactly like a quiet day. Say which it is. */}
      {funnel.received === 0 && (fresh?.age_hours ?? 0) > 36 && (
        <div className="mb-4 rounded-lg border border-warn-100 bg-warn-50 px-4 py-3 text-sm text-ink-700">
          <span className="font-medium text-warn-600">Nothing here may mean stale data.</span>{' '}
          The newest request Atlas holds arrived{' '}
          <b>{Math.round((fresh!.age_hours ?? 0) / 24)} days ago</b>
          {fresh?.newest && ` (${new Date(fresh.newest).toLocaleDateString('en-IN',
            { day: 'numeric', month: 'short' })})`}
          , so the nightly refresh has probably not run. Widen the window to see
          what is there, and check <code className="font-mono text-[11px]">docker compose logs atlas-refresh</code>.
        </div>
      )}

      <RequestFunnel
        funnel={funnel}
        windowLabel={WINDOW_LABEL[(searchParams.window ?? 'week') as keyof typeof WINDOW_LABEL]}
        hrefFor={(k, v) => keep(k, v)}
      />

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">State</span>
        <ChipButton href={keep('state')} active={!state}>All</ChipButton>
        {REQUEST_STATES.map((s) => (
          <ChipButton key={s} href={keep('state', s)} active={state === s}>
            {STATE_SHORT[s]}
          </ChipButton>
        ))}
        <span className="w-px h-4 bg-ink-200 mx-2" />
        <ChipButton href={keep('all', openOnly ? '1' : undefined)} active={!openOnly}>
          Include settled
        </ChipButton>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Store</span>
        <ChipButton href={keep('store')} active={!searchParams.store}>All</ChipButton>
        {/* Zero-count chips stay visible but muted: knowing a store has nothing
            in this window is useful, and removing them makes the row jump. */}
        {facets.stores.slice(0, 6).map((s) => (
          <ChipButton key={s.store_id} href={keep('store', String(s.store_id))}
                      active={searchParams.store === String(s.store_id)}>
            {s.name}{' '}
            <span className={s.n === 0 ? 'text-ink-300' : 'text-ink-400'}>{s.n}</span>
          </ChipButton>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Stage</span>
        <ChipButton href={keep('status')} active={!searchParams.status}>All</ChipButton>
        {STAGE_ORDER.filter((st) => (facets.stages.find((x) => x.status === st)?.n ?? 0) > 0)
          .map((st) => (
          <ChipButton key={st} href={keep('status', st)} active={searchParams.status === st}>
            {STAGE_LABEL[st]}{' '}
            <span className="text-ink-400">
              {facets.stages.find((x) => x.status === st)?.n ?? 0}
            </span>
          </ChipButton>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Sort</span>
        {([
          ['newest', 'Newest first'],
          ['oldest', 'Oldest first'],
          ['value', 'Largest quote'],
          ['value_asc', 'Smallest quote'],
          ['soonest', 'Date soonest'],
          ['demand', 'Busiest pincode'],
        ] as const).map(([k, label]) => (
          <ChipButton key={k} href={keep('sort', k)} active={(searchParams.sort ?? 'newest') === k}>
            {label}
          </ChipButton>
        ))}
        <span className="w-px h-4 bg-ink-200 mx-2" />
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Only</span>
        <ChipButton href={keep('priced', searchParams.priced === '1' ? undefined : '1')}
                    active={searchParams.priced === '1'}>
          Priced
        </ChipButton>
        <ChipButton href={keep('haslab', searchParams.haslab === '1' ? undefined : '1')}
                    active={searchParams.haslab === '1'}>
          Has a covering lab
        </ChipButton>
        <ChipButton href={keep('disputed', searchParams.disputed === '1' ? undefined : '1')}
                    active={searchParams.disputed === '1'}>
          Console disagrees
        </ChipButton>
      </div>

      <Card>
        <CardHeader
          title={`${rows.length.toLocaleString('en-IN')} shown${total > rows.length ? ` of ${total.toLocaleString('en-IN')}` : ''}`}
          subtitle="Newest first by default — with no assignment, sort order is the prioritisation."
          icon={<Inbox className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5">
            <RequestsTable
              rows={rows}
              windowLabel={WINDOW_LABEL[(searchParams.window ?? 'week') as keyof typeof WINDOW_LABEL]}
              widenHref={keep('window', 'all')}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
