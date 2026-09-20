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
  getQueueCounts, getTasks, getAssignableUsers,
  TASK_BLURB, TASK_KINDS, type TaskKind,
} from '@/lib/orderTracking';
import { TaskTable } from './TaskTable';

export const dynamic = 'force-dynamic';

/** Colour, icon and the second line each queue puts under the tab. */
const QUEUE = {
  needs_lab: {
    label: 'Needs a lab',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    dot: 'bg-danger-500',
    bar: 'border-danger-500',
    chip: 'bg-danger-500',
    urgent: (n: number) => `${n} due today or tomorrow`,
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
  searchParams: { tab?: string; urgent?: string; mine?: string };
}) {
  const gate = await requireView('orderTracking', '/order-tracking');
  if (gate.blocked) return <RoleBlocked area="Order tracking" detail="network, operations and admin" />;

  const tab: TaskKind = (TASK_KINDS as readonly string[]).includes(searchParams.tab ?? '')
    ? (searchParams.tab as TaskKind) : 'needs_lab';
  const urgent = searchParams.urgent === '1';
  const mine = searchParams.mine === '1';
  const canAssign = canManage(gate.user, 'orderTracking');

  const [counts, rows, people] = await Promise.all([
    getQueueCounts(),
    getTasks(tab, {
      urgent: urgent && tab !== 'confirm_pickup',
      late: urgent && tab === 'chase_report',
      assignee: mine ? gate.user.id : undefined,
    }),
    getAssignableUsers(),
  ]);

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      tab: tab === 'needs_lab' ? undefined : tab,
      urgent: urgent ? '1' : undefined,
      mine: mine ? '1' : undefined,
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
              href={link({ tab: k === 'needs_lab' ? undefined : k, urgent: undefined })}
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

      <div className="flex flex-wrap items-start justify-between gap-4 mt-4 mb-4">
        <div className="max-w-3xl">
          <p className="text-[13px] text-ink-700">{TASK_BLURB[tab]}</p>
          <div className="flex flex-wrap gap-4 mt-2">
            {count.urgent > 0 && (
              <span className="text-[12px] font-semibold text-danger-500">{here.urgent(count.urgent)}</span>
            )}
            <span className="text-[12px] text-ink-500">{count.unassigned} unassigned</span>
            <span className="text-[12px] text-ink-500">{rows.length} shown</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {tab !== 'confirm_pickup' && (
            <>
              <ChipButton href={link({ urgent: undefined })} active={!urgent}>All</ChipButton>
              <ChipButton href={link({ urgent: '1' })} active={urgent}>
                {tab === 'chase_report' ? 'Late only' : 'Due today or tomorrow'}
              </ChipButton>
              <span className="w-px h-4 bg-ink-200 mx-1" />
            </>
          )}
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
