import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Inbox } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { InfoTip } from '@/components/ui/InfoTip';
import { ChipButton } from '@/components/ui/Toggle';
import {
  getRequests, getRequestFunnel, getFacets, getRequestFreshness,
} from '@/lib/requestQueries';
import {
  REQUEST_STATES, STAGE_LABEL, SETTLED_STAGES, PIPELINE_STAGES,
  type RequestState,
} from '@/lib/requests';
import { RequestsTable } from './RequestsTable';
import { StorePicker } from './StorePicker';
import { RequestFunnel } from './RequestFunnel';
import { SearchBar } from './SearchBar';
import { RefreshRequests } from './RefreshRequests';

export const dynamic = 'force-dynamic';

const SORT_LABEL = {
  newest: 'newest first', oldest: 'oldest first',
  value: 'highest quote', value_asc: 'lowest quote',
  soonest: 'earliest date', demand: 'highest pincode demand',
  waiting: 'waiting longest',
} as const;

/**
 * The three things the team actually does on this page, in the order a request
 * moves through them.
 *
 * The page could already express all three — pick the stage, pick the stores,
 * turn the window off — but that is four clicks and a piece of knowledge, and
 * it started every morning from a list of last week's everything. Each queue
 * is one stage of the pipeline, every store the person owns, no time window,
 * and the action written on it.
 */
const QUEUES = [
  {
    key: 'open',
    label: 'Needs a quote',
    statuses: ['OPEN', 'CONSENTED'],
    sort: 'waiting',
    action: 'Price it and give the store an earliest available date.',
    empty: 'Every request that came in has been priced. New ones land here as stores raise them.',
    tone: 'bg-danger-500',
    bar: 'border-danger-500',
  },
  {
    key: 'quoted',
    label: 'Awaiting acceptance',
    statuses: ['QUOTED'],
    sort: 'waiting',
    action: 'Quoted and gone quiet. Chase the store for a yes or a no — longest wait first.',
    empty: 'No quote is sitting unanswered — every store has come back to us.',
    tone: 'bg-warn-500',
    bar: 'border-warn-500',
  },
  {
    key: 'accepted',
    label: 'Ready to order',
    statuses: ['QUOTATION_ACCEPTED'],
    sort: 'waiting',
    action: 'The store said yes. Convert it in the console before the date we promised moves.',
    empty: 'Nothing is waiting to be converted. Accepted quotes land here the moment a store says yes.',
    tone: 'bg-success-600',
    bar: 'border-success-600',
  },
] as const;

/** What the funnel reads as when a queue has switched it off. */
const EMPTY_FUNNEL = {
  received: 0, answerable: 0, priced: 0, quoted: 0, ordered: 0, sourced: 0,
  no_ask: 0, no_pincode: 0, supply_gap: 0, awaiting: 0,
};

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
  const queue = QUEUES.find((qu) => qu.key === searchParams.queue);
  // A queue owns the stage filter outright. Letting a leftover `status` from a
  // previous click survive into a queue is how you end up on "Ready to order"
  // looking at an empty table and a stage chip you did not know was on.
  const stages = queue ? [...queue.statuses] : csv(searchParams.status);
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
    // In a queue, oldest-waiting first by default: the whole job is the thing
    // that has been sitting longest, and newest-first buries it.
    sort: (searchParams.sort as 'newest' | 'oldest' | 'value' | 'value_asc' | 'soonest' | 'demand' | 'waiting')
          ?? (queue ? queue.sort : 'newest'),
    priced: searchParams.priced === '1',
    unquoted: searchParams.unquoted === '1',
    hasLab: searchParams.haslab === '1',
    // Default to the last 7 days, because an all-time queue is a year of
    // history and tells nobody what to do this morning.
    //
    // Two exceptions, both cases where the window would silently win an
    // argument it was never asked to join. A search is for one specific thing
    // whose age nobody knows, and scoped to a week it reads as "not found"
    // rather than "not in this window". And a pipeline stage is a question
    // about what is STUCK: every request sitting at Quoted has by definition
    // been sitting a while, so defaulting to the last week hides exactly the
    // rows that were asked for.
    // A queue is never windowed by default. Everything in it is waiting on us
    // by definition, and a request quoted three weeks ago is the one that
    // needs chasing, not the one to hide.
    window: (searchParams.window as 'today' | 'week' | 'month' | 'all')
            ?? (searchParams.q || stages.length ? 'all' : 'week'),
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

  // The funnel is a shape-of-the-month chart, and inside a queue it is both a
  // distraction and a whole extra pass over the table. A queue is a worklist.
  // Three queries, not eight. The list carries its own total now, the two
  // facet aggregates share one round trip, and the funnel and the untracked
  // count are gone from the critical path — each was a full pass over the
  // table to print a number beside a filter nobody had clicked.
  const [list, facets, funnel, fresh] = await Promise.all([
    getRequests(f),
    getFacets(f),
    queue ? Promise.resolve(EMPTY_FUNNEL) : getRequestFunnel({ ...f, state: undefined }),
    getRequestFreshness(),
  ]);
  const { rows, total } = list;

  /** How many sit in each queue right now, for the stores in scope. */
  const stageCount = new Map(facets.stages.map((x) => [x.status, x.n]));
  const queueCount = (qu: (typeof QUEUES)[number]) =>
    qu.statuses.reduce((n, st) => n + (stageCount.get(st) ?? 0), 0);

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

  // What the rows are actually ordered by, which inside a queue is not what
  // `sort` says — the queue supplies a default. The chips and the caption read
  // this, not the URL, or the table says "newest first" while showing oldest.
  const effectiveSort = f.sort ?? 'newest';
  const activeWindow = f.window ?? 'week';

  /** Every search param except the named one, for a client component to carry. */
  const carry = (without: string) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(searchParams)) if (v && k !== without) out[k] = v;
    return out;
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

      {/* The three jobs, as three doors. Anything else on this page is still
          here — "All requests" is the old surface, unchanged. */}
      <div className="flex flex-wrap gap-1 mt-5 border-b border-ink-200">
        {QUEUES.map((qu) => {
          const active = queue?.key === qu.key;
          const n = queueCount(qu);
          return (
            <Link
              key={qu.key}
              href={keep('queue', qu.key)}
              className={`flex items-center gap-2 px-4 py-2.5 -mb-px border-b-[3px] transition-colors
                          ${active ? `${qu.bar} text-ink-900` : 'border-transparent text-ink-500 hover:text-ink-800'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${active ? qu.tone : 'bg-ink-300'}`} />
              <span className={`text-sm ${active ? 'font-bold' : 'font-medium'}`}>{qu.label}</span>
              <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 tabular-nums
                                ${active ? `${qu.tone} text-white` : 'bg-ink-100 text-ink-500'}`}>
                {n.toLocaleString('en-IN')}
              </span>
            </Link>
          );
        })}
        <Link
          href={drop('queue', 'status', 'sort', 'window')}
          className={`flex items-center gap-2 px-4 py-2.5 -mb-px border-b-[3px] transition-colors
                      ${!queue ? 'border-ink-400 text-ink-900 font-bold' : 'border-transparent text-ink-500 hover:text-ink-800'}`}
        >
          <span className="text-sm">All requests</span>
        </Link>
      </div>

      {queue && (
        <p className="text-[13px] text-ink-700 mt-3">
          {queue.action}
          {stores.length > 0 && (
            <span className="text-ink-400">
              {' '}· {stores.length} store{stores.length === 1 ? '' : 's'} selected
            </span>
          )}
        </p>
      )}

      {/* A stale snapshot looks exactly like a quiet day. Say which it is. */}
      {!queue && funnel.received === 0 && (fresh?.age_hours ?? 0) > 36 && (
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
      {!queue && <RequestFunnel
        funnel={funnel}
        windowLabel={WINDOW_LABEL[activeWindow as keyof typeof WINDOW_LABEL]}
        hrefFor={(k, v) => keep(k, v)}
      />}

      {/* One line of filters.
          There used to be ten rows, six of them behind a disclosure:
          serviceability, closed stages, preferred appointment, earliest
          available date, order status, order appointment, and a date range
          under four of those. Every one was a real question somebody asked
          once, and together they were a wall — and each chip is a full page
          load, so the cost of having them on screen was paid by everyone who
          did not use them. What is left is what the job needs: when it
          arrived, whose account it is, and what order to read it in. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg
                      border border-ink-200 bg-surface px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Created</span>
          {([
            ['today', 'Today'], ['week', '7 days'], ['month', '30 days'], ['all', 'All time'],
          ] as const).map(([k, label]) => (
            <ChipButton key={k} href={keep('window', k)} active={activeWindow === k}>
              {label}
            </ChipButton>
          ))}
        </div>

        <span className="w-px h-5 bg-ink-200" />

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Store</span>
          <StorePicker
            options={facets.stores}
            selected={stores}
            carry={carry('store')}
          />
          <Link href="/settings/stores"
                className="text-[11px] text-brand-600 hover:underline whitespace-nowrap">
            edit →
          </Link>
        </div>

        {/* Outside a queue the pipeline is still how you pick a stage. Inside
            one the tabs above ARE that filter. */}
        {!queue && (
          <>
            <span className="w-px h-5 bg-ink-200" />
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Stage</span>
              <ChipButton href={keep('status')} active={stages.length === 0}>All</ChipButton>
              {PIPELINE_STAGES.map((st) => (
                <ChipButton key={st} href={toggle('status', st)} active={stages.includes(st)}>
                  {STAGE_LABEL[st]}{' '}
                  <span className={stages.includes(st) ? 'text-white/70' : 'text-ink-400'}>
                    {stageCount.get(st) ?? 0}
                  </span>
                </ChipButton>
              ))}
            </div>
          </>
        )}

        <span className="w-px h-5 bg-ink-200" />

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Sort</span>
          {([
            ['waiting', 'Waiting longest'],
            ['newest', 'Newest'],
            ['value', 'Highest quote'],
            ['soonest', 'Earliest date'],
          ] as const).map(([k, label]) => (
            <ChipButton key={k} href={keep('sort', k)} active={effectiveSort === k}>
              {label}
            </ChipButton>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader
          title={`${rows.length.toLocaleString('en-IN')} shown${total > rows.length ? ` of ${total.toLocaleString('en-IN')}` : ''}`}
          subtitle={`Sorted by ${SORT_LABEL[effectiveSort as keyof typeof SORT_LABEL]}.`}
          icon={<Inbox className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5">
            <RequestsTable
              rows={rows}
              windowLabel={WINDOW_LABEL[activeWindow as keyof typeof WINDOW_LABEL]}
              widenHref={keep('window', 'all')}
              emptyQueue={queue ? queue.empty : undefined}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
