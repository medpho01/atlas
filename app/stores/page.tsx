import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Card, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { InfoTip } from '@/components/ui/InfoTip';
import { ChipButton } from '@/components/ui/Toggle';
import { Pager } from '@/components/ui/Pager';
import { humanHours } from '@/lib/stores';
import {
  getStoreRows, countStores, getStoreOverview, STORE_SORTS, type StoreSort,
} from '@/lib/storeOrders';
import { StoreList } from './StoreList';
import { StoreSearch } from './StoreSearch';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

/**
 * How far back the counts look.
 *
 * A window, not "everything", because every number on this page is a rate or
 * an average and both are meaningless without one — a partner onboarded in
 * March and one onboarded last week are not comparable on lifetime totals,
 * and "all time" quietly averages this quarter's turnaround with last year's.
 * Ninety days is the default: long enough for a monthly partner to appear,
 * short enough that a problem from last summer is not still dragging the mean.
 */
const WINDOWS = [
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: '365', label: '12 months', days: 365 },
  { key: 'all', label: 'All time', days: null },
] as const;
const DEFAULT_WINDOW = '90';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

type SP = {
  q?: string; window?: string; from?: string; to?: string;
  active?: string; tracked?: string; attention?: string;
  sort?: string; page?: string;
};

export default async function StoresPage({ searchParams }: { searchParams: SP }) {
  const gate = await requireView('storeOrders', '/stores');
  if (gate.blocked) {
    return <RoleBlocked area="Stores & Orders" detail="accounts, network, operations and admin" />;
  }

  const win = WINDOWS.find((w) => w.key === searchParams.window)
    ?? WINDOWS.find((w) => w.key === DEFAULT_WINDOW)!;
  // An explicit from/to beats the preset — the preset is the quick way in, the
  // dates are the exact question somebody came with.
  const from = searchParams.from || (win.days ? isoDaysAgo(win.days) : undefined);
  const to = searchParams.to || undefined;

  const activeOnly = searchParams.active !== '0';
  const trackedOnly = searchParams.tracked === '1';
  const needsAttention = searchParams.attention === '1';
  const sort: StoreSort = (STORE_SORTS as readonly string[]).includes(searchParams.sort ?? '')
    ? (searchParams.sort as StoreSort) : 'orders';
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.page)) || 1);

  const f = { q: searchParams.q?.trim() || undefined, from, to, activeOnly, trackedOnly,
              needsAttention, sort };

  // Counted first so the page can be clamped to one that exists — see the note
  // on the same pattern in [id]/page.tsx.
  const total = await countStores(f);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, lastPage);

  const [rows, overview] = await Promise.all([
    getStoreRows({ ...f, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    getStoreOverview({ from, to }),
  ]);

  /**
   * Every link on this page except the pager drops `page`.
   *
   * Narrowing a filter while on page three would otherwise land on a page that
   * no longer exists, and an empty table reads as "no matches" rather than
   * "wrong page" — the one pagination bug that costs somebody a phone call.
   */
  const link = (patch: Partial<SP>) => {
    const merged: SP = {
      q: searchParams.q,
      window: win.key === DEFAULT_WINDOW ? undefined : win.key,
      from: searchParams.from, to: searchParams.to,
      active: activeOnly ? undefined : '0',
      tracked: trackedOnly ? '1' : undefined,
      attention: needsAttention ? '1' : undefined,
      sort: sort === 'orders' ? undefined : sort,
      ...patch,
    };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const q = p.toString();
    return `/stores${q ? `?${q}` : ''}`;
  };

  const hrefForPage = (n: number) => {
    const base = link({});
    const sep = base.includes('?') ? '&' : '?';
    return n <= 1 ? base : `${base}${sep}page=${n}`;
  };

  const windowLabel = searchParams.from || searchParams.to
    ? [searchParams.from ?? 'the beginning', searchParams.to ?? 'today'].join(' → ')
    : win.label.toLowerCase();

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Stores & Orders"
        subtitle="Every partner, and the whole book of orders behind each one."
        actions={
          <InfoTip
            title="Stores & Orders"
            width={380}
            shows={
              <>
                One row per store, with its orders grouped into six stages. Open a row to see
                the orders themselves — patient, phlebo, lab, status and timings.
              </>
            }
            computed={
              <>
                Counts, turnaround and cancellation rate are all measured inside the window
                above ({windowLabel}), so two partners can be compared. Turnaround runs from
                the order being taken to the report being delivered and is only counted on
                completed orders. An order is <b>delayed</b> when its appointment has passed
                by more than the store&apos;s own threshold and it is still unfinished.
              </>
            }
            drives="Answer a partner's call without opening the console, and notice the store whose orders are quietly stalling before they do."
            notes={
              <>
                Read-only on LabStack. Atlas never writes a store or an order — what it owns
                here is the account overlay, the reschedule flags and the change log.
              </>
            }
          />
        }
      />

      {/* The fleet in one line. Delayed and flagged come first because they are
          the only two numbers here that are somebody's job today. */}
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 mt-5 mb-4">
        <Metric n={overview?.orders ?? 0} label={`orders · ${windowLabel}`} />
        <Metric
          n={overview?.delayed ?? 0}
          label="past their promise"
          tone={(overview?.delayed ?? 0) > 0 ? 'bad' : undefined}
          href={link({ attention: '1' })}
        />
        <Metric
          n={overview?.flagged ?? 0}
          label="waiting on a new date"
          tone={(overview?.flagged ?? 0) > 0 ? 'warn' : undefined}
        />
        <Metric n={overview?.pending ?? 0} label="not scheduled yet" />
        <Metric
          n={overview?.active_stores ?? 0}
          label={`active stores of ${overview?.stores ?? 0}`}
        />
        {/* A store that has sent nothing is the one thing a table of orders can
            never show you, so it gets its own number. */}
        {(overview?.quiet_stores ?? 0) > 0 && (
          <Metric n={overview!.quiet_stores} label="sent nothing in the window" tone="warn" />
        )}
        <div>
          <div className="text-2xl font-bold text-ink-900 num">
            {humanHours(overview?.avg_turnaround_hours)}
          </div>
          <div className="text-[11px] text-ink-500 mt-0.5">average turnaround</div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg
                      border border-ink-200 bg-surface px-4 py-2.5">
        <StoreSearch defaultValue={searchParams.q ?? ''} hidden={carry(searchParams, 'q')} />

        <span className="w-px h-5 bg-ink-200" />

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Window</span>
          {WINDOWS.map((w) => (
            <ChipButton
              key={w.key}
              href={link({ window: w.key === DEFAULT_WINDOW ? undefined : w.key,
                           from: undefined, to: undefined })}
              active={!searchParams.from && !searchParams.to && w.key === win.key}
            >
              {w.label}
            </ChipButton>
          ))}
        </div>

        <span className="w-px h-5 bg-ink-200" />

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Show</span>
          <ChipButton href={link({ active: activeOnly ? '0' : undefined })} active={activeOnly}>
            Active only
          </ChipButton>
          <ChipButton href={link({ tracked: trackedOnly ? undefined : '1' })} active={trackedOnly}>
            In the requests queue
          </ChipButton>
          <ChipButton
            href={link({ attention: needsAttention ? undefined : '1' })}
            active={needsAttention}
          >
            Needs attention
          </ChipButton>
        </div>

        <span className="w-px h-5 bg-ink-200" />

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Sort</span>
          {([['orders', 'Busiest'], ['delayed', 'Most delayed'],
             ['cancelled', 'Most cancelled'], ['turnaround', 'Slowest'],
             ['name', 'A–Z']] as const).map(([k, label]) => (
            <ChipButton key={k} href={link({ sort: k === 'orders' ? undefined : k })}
                        active={sort === k}>
              {label}
            </ChipButton>
          ))}
        </div>
      </div>

      {(searchParams.from || searchParams.to) && (
        <p className="text-[12px] text-ink-500 mb-3">
          Counting orders from {searchParams.from ?? 'the beginning'} to{' '}
          {searchParams.to ?? 'today'}.{' '}
          <Link href={link({ from: undefined, to: undefined })} className="text-brand-600 hover:underline">
            Clear the dates
          </Link>
        </p>
      )}

      <Card>
        <CardBody className="pt-4 px-0">
          {rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-ink-500">
              {needsAttention
                ? 'Nothing is delayed or waiting on a new date. '
                : 'No store matches these filters. '}
              <Link href="/stores" className="text-brand-600 hover:underline">
                Clear the filters
              </Link>
            </p>
          ) : (
            <StoreList rows={rows} />
          )}
          <Pager
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            shown={rows.length}
            hrefForPage={hrefForPage}
            unit="stores"
          />
        </CardBody>
      </Card>

      <p className="text-[11px] text-ink-400 mt-3 flex items-start gap-1.5 max-w-3xl">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>
          Store records and appointments belong to LabStack and Atlas reads them without
          writing. Adding, editing or closing a store, and moving an appointment, are console
          operations — what can be changed here is who runs the account, when it raises an
          alert, and which orders somebody has marked as needing a new date.
        </span>
      </p>
    </div>
  );
}

/** Every search param except the named one, as hidden inputs for the GET form. */
function carry(sp: SP, without: keyof SP): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    // `page` is dropped with the rest: a new search starts at the first page.
    if (v && k !== without && k !== 'page') out[k] = String(v);
  }
  return out;
}

function Metric({
  n, label, tone, href,
}: { n: number; label: string; tone?: 'bad' | 'warn'; href?: string }) {
  const colour = tone === 'bad' ? 'text-danger-500' : tone === 'warn' ? 'text-warn-600' : 'text-ink-900';
  const body = (
    <>
      <div className={`text-2xl font-bold num ${colour}`}>{n.toLocaleString('en-IN')}</div>
      <div className="text-[11px] text-ink-500 mt-0.5">{label}</div>
    </>
  );
  // Only the numbers that lead somewhere become links, so a pointer over a
  // figure means it can be clicked rather than meaning nothing.
  return href && n > 0
    ? <Link href={href} className="rounded-sm hover:opacity-80 focus:outline-none
                                   focus-visible:ring-2 focus-visible:ring-brand-500">{body}</Link>
    : <div>{body}</div>;
}
