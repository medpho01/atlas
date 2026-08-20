import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Inbox } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { InfoTip } from '@/components/ui/InfoTip';
import { ChipButton } from '@/components/ui/Toggle';
import {
  getRequests, countRequests, getRequestSummary, getFacets,
} from '@/lib/requestQueries';
import { REQUEST_STATES, STATE_SHORT, type RequestState } from '@/lib/requests';
import { RequestsTable } from './RequestsTable';

export const dynamic = 'force-dynamic';

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const gate = await requireView('requests', '/requests');
  if (gate.blocked) return <RoleBlocked area="Requests" detail="operations, network and admin" />;

  const state = (REQUEST_STATES as readonly string[]).includes(searchParams.state ?? '')
    ? (searchParams.state as RequestState) : undefined;
  const openOnly = searchParams.all !== '1';
  const f = {
    state,
    store: searchParams.store,
    city: searchParams.city,
    q: searchParams.q,
    sort: (searchParams.sort as 'newest' | 'oldest' | 'value' | 'value_asc' | 'soonest' | 'demand') ?? 'newest',
    priced: searchParams.priced === '1',
    disputed: searchParams.disputed === '1',
    hasLab: searchParams.haslab === '1',
    openOnly,
    limit: 150,
  };

  const [rows, total, summary, facets] = await Promise.all([
    getRequests(f), countRequests(f), getRequestSummary({ ...f, state: undefined }), getFacets(),
  ]);

  const keep = (k: string, v?: string) => {
    const p = new URLSearchParams();
    for (const [key, val] of Object.entries(searchParams)) if (val && key !== k) p.set(key, val);
    if (v) p.set(k, v);
    return `/requests?${p.toString()}`;
  };

  const needsWork = summary
    .filter((s) => s.state !== 'SERVICEABLE')
    .reduce((n, s) => n + s.n, 0);

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

      {/* A grid, not a wrapping baseline row: with six tiles of uneven number
          width the flex gaps collapsed differently on every filter change, so
          the strip never sat still. Fixed columns keep it steady. */}
      <Card className="my-4">
        <CardBody>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-4">
            <div>
              <div className="text-2xl font-bold text-ink-900 num leading-tight">
                {total.toLocaleString('en-IN')}
              </div>
              <div className="text-[11px] text-ink-500 mt-1 leading-snug">
                {openOnly ? 'Open requests' : 'All requests'}
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold num text-warn-600 leading-tight">
                {needsWork.toLocaleString('en-IN')}
              </div>
              <div className="text-[11px] text-ink-500 mt-1 leading-snug">Not serviceable as-is</div>
            </div>
            {summary.slice(0, 4).map((s) => (
              <div key={s.state}>
                <div className="text-2xl font-bold num text-ink-700 leading-tight">
                  {s.n.toLocaleString('en-IN')}
                </div>
                <div className="text-[11px] text-ink-500 mt-1 leading-snug">
                  {STATE_SHORT[s.state as RequestState] ?? s.state}
                  {s.quoted > 0 && (
                    <span className="block text-ink-400">{s.quoted.toLocaleString('en-IN')} priced</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

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
        {facets.stores.slice(0, 6).map((s) => (
          <ChipButton key={s.store_id} href={keep('store', String(s.store_id))}
                      active={searchParams.store === String(s.store_id)}>
            {s.name} <span className="text-ink-400">{s.n}</span>
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
            <RequestsTable rows={rows} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
