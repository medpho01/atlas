import Link from 'next/link';
import { AlertTriangle, CalendarClock, FileClock } from 'lucide-react';
import { requireView } from '@/lib/guard';
import { canManage } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Card, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChipButton } from '@/components/ui/Toggle';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  getQueueCounts, getTasks, getAssignableUsers, getQueueStores,
  TASK_BLURB, TASK_KINDS, type TaskKind,
} from '@/lib/orderTracking';
import { TaskTable } from './TaskTable';
import { StorePicker } from '@/components/ui/StorePicker';

export const dynamic = 'force-dynamic';

/** Colour, icon and the second line each queue puts under the tab. */
const QUEUE = {
  needs_lab: {
    label: 'Needs a lab',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    dot: 'bg-danger-500',
    bar: 'border-danger-500',
    chip: 'bg-danger-500',
    urgent: (n: number) => `${n} due today`,
  },
  confirm_pickup: {
    label: 'Pickup today',
    icon: <CalendarClock className="w-3.5 h-3.5" />,
    dot: 'bg-warn-500',
    bar: 'border-warn-500',
    chip: 'bg-warn-500',
    urgent: (n: number) => `${n} still to confirm`,
  },
  chase_report: {
    label: 'Report outstanding',
    icon: <FileClock className="w-3.5 h-3.5" />,
    dot: 'bg-brand-600',
    bar: 'border-brand-600',
    chip: 'bg-brand-600',
    urgent: (n: number) => `${n} already late`,
  },
} as const satisfies Record<TaskKind, unknown>;

export default async function OrderTrackingPage({
  searchParams,
}: {
  searchParams: { tab?: string; urgent?: string; mine?: string; within?: string; store?: string };
}) {
  const gate = await requireView('orderTracking', '/order-tracking');
  if (gate.blocked) return <RoleBlocked area="Order tracking" detail="network, operations and admin" />;

  const tab: TaskKind = (TASK_KINDS as readonly string[]).includes(searchParams.tab ?? '')
    ? (searchParams.tab as TaskKind) : 'needs_lab';
  const urgent = searchParams.urgent === '1';
  // How far ahead the allocation queue looks. Some of this job is done days in
  // advance off a list of everything coming up, and some of it is today's
  // stragglers; one "urgent or not" switch only served the second.
  // Each chip means what it says, on the appointment date. "Tomorrow" is
  // tomorrow's appointments, not everything whose deadline has arrived by
  // tomorrow — which is what it used to be, and why the page looked like it
  // was ignoring the filter.
  const HORIZONS = [
    { key: '1', label: 'Tomorrow', exact: 1 },
    { key: '3', label: 'Next 3 days', within: 3 },
    { key: '7', label: 'Next 7 days', within: 7 },
  ] as const;
  const horizon = HORIZONS.find((h) => h.key === searchParams.within);
  const mine = searchParams.mine === '1';
  const canAssign = canManage(gate.user, 'orderTracking');
  // filter(Boolean) before Number, not after: ''.split(',') is [''], and
  // Number('') is 0, which Number.isInteger happily accepts — so an absent
  // filter became "store 0" and the queue came back empty.
  const stores = (searchParams.store ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean)
    .map(Number).filter(Number.isInteger);

  const [counts, rows, people, storeFacet] = await Promise.all([
    getQueueCounts(),
    getTasks(tab, {
      apptInDays: tab === 'needs_lab' ? (horizon as { exact?: number } | undefined)?.exact : undefined,
      apptWithinDays: tab === 'needs_lab' ? (horizon as { within?: number } | undefined)?.within : undefined,
      urgent: urgent && tab === 'chase_report',
      late: urgent && tab === 'chase_report',
      stores,
      assignee: mine ? gate.user.id : undefined,
    }),
    getAssignableUsers(),
    getQueueStores(tab),
  ]);

  /** Every search param except the named one, for a client component to carry. */
  const carry = (without: string) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(searchParams)) {
      if (v && k !== without) out[k] = v;
    }
    return out;
  };

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      tab: tab === 'needs_lab' ? undefined : tab,
      urgent: urgent ? '1' : undefined,
      within: searchParams.within,
      mine: mine ? '1' : undefined,
      store: stores.length ? stores.join(',') : undefined,
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const q = p.toString();
    return `/order-tracking${q ? `?${q}` : ''}`;
  };

  const here = QUEUE[tab];
  const count = counts[tab];

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Order tracking"
        subtitle="Every order in flight, in the three stages where it can quietly go wrong."
        actions={
          <InfoTip
            title="Order tracking"
            shows="Orders that have left the request queue and still need somebody: no lab yet, a pickup to confirm today, or a report that has not come back."
            computed={
              <>
                Derived from the order data — a row appears when work is due and disappears when
                the order moves on. Pickup and report are filtered to labs with fewer than{' '}
                <code className="font-mono text-[10px]">followup_max_lifetime_orders</code> orders
                ever, because that is where orders actually fail: under five orders, 41% fail;
                over twenty, 16%.
              </>
            }
            drives="A lead assigns the rows; whoever holds one calls the lab and records what was said. Nobody closes a task by hand."
          />
        }
      />

      {/* Three tabs, because they are three different jobs with three
          different deadlines — not one list with a type column. */}
      <div className="flex flex-wrap gap-1 mt-5 border-b border-ink-200">
        {TASK_KINDS.map((k) => {
          const q = QUEUE[k];
          const c = counts[k];
          const active = k === tab;
          return (
            <Link
              key={k}
              // The horizon and the late filter belong to one queue each, so they
              // do not follow you to another — a stale `within` in the URL of a
              // queue that ignores it is a filter you cannot see. The store
              // selection does follow: that is whose work it is.
              href={link({ tab: k === 'needs_lab' ? undefined : k, urgent: undefined, within: undefined })}
              className={`flex items-center gap-2 px-4 py-2.5 -mb-px border-b-[3px] transition-colors
                          ${active ? `${q.bar} text-ink-900` : 'border-transparent text-ink-500 hover:text-ink-800'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${active ? q.dot : 'bg-ink-300'}`} />
              <span className={`text-sm ${active ? 'font-bold' : 'font-medium'}`}>{q.label}</span>
              <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 tabular-nums
                                ${active ? `${q.chip} text-white` : 'bg-ink-100 text-ink-500'}`}>
                {c.total}
              </span>
            </Link>
          );
        })}

      </div>

      <div className="mt-4 mb-4 max-w-3xl">
        <p className="text-[13px] text-ink-700">{TASK_BLURB[tab]}</p>
        <div className="flex flex-wrap gap-4 mt-2">
          {count.urgent > 0 && (
            <span className="text-[12px] font-semibold text-danger-500">{here.urgent(count.urgent)}</span>
          )}
          <span className="text-[12px] text-ink-500">{count.unassigned} unassigned</span>
          <span className="text-[12px] text-ink-500">
            {rows.length} shown
            {tab === 'needs_lab' && horizon
              && ` · ${horizon.key === '1' ? 'appointments tomorrow' : `appointments in the next ${horizon.key} days`}`}
          </span>
        </div>
      </div>

      {/* The same filter bar as Requests, in the same order and the same
          words. Two pages the same person works all day should not need to be
          learned twice — and the store filter in particular was a row of chips
          here, one navigation per store, long after Requests stopped doing
          that. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg
                      border border-ink-200 bg-surface px-4 py-2.5">
        {tab === 'needs_lab' && (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Appointment</span>
              <ChipButton href={link({ within: undefined })} active={horizon == null}>
                Everything ahead
              </ChipButton>
              {HORIZONS.map((h) => (
                <ChipButton key={h.key} href={link({ within: h.key })} active={horizon?.key === h.key}>
                  {h.label}
                </ChipButton>
              ))}
            </div>
            <span className="w-px h-5 bg-ink-200" />
          </>
        )}

        {tab === 'chase_report' && (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Due</span>
              <ChipButton href={link({ urgent: undefined })} active={!urgent}>All</ChipButton>
              <ChipButton href={link({ urgent: '1' })} active={urgent}>Late only</ChipButton>
            </div>
            <span className="w-px h-5 bg-ink-200" />
          </>
        )}

        {/* Only the stores with work in this queue: a list of forty where
            thirty-nine read zero is a list nobody reads. */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Store</span>
          <StorePicker
            options={storeFacet}
            selected={stores}
            carry={carry('store')}
            basePath="/order-tracking"
          />
        </div>

        <span className="w-px h-5 bg-ink-200" />

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Owner</span>
          <ChipButton href={link({ mine: undefined })} active={!mine}>Everyone</ChipButton>
          <ChipButton href={link({ mine: '1' })} active={mine}>Assigned to me</ChipButton>
        </div>
      </div>

      <Card>
        <CardBody className="pt-4">
          <TaskTable
            kind={tab}
            rows={rows}
            people={people}
            canAssign={canAssign}
            meId={gate.user.id}
          />
        </CardBody>
      </Card>

      {!canAssign && (
        <p className="text-[11px] text-ink-400 mt-3">
          Work is handed out by a network lead. You can add notes to anything here.
        </p>
      )}
    </div>
  );
}
