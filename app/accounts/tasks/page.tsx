import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { canManage } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import { PageHeader } from '@/components/ui/PageHeader';
import { AccountsTabs } from '@/components/ui/AccountsTabs';
import { ChipButton } from '@/components/ui/Toggle';
import { listTasks, listAccounts, getAccountPeople } from '@/lib/accountHealth';
import { TaskRow } from './TaskList';
import { NewTask } from './NewTask';

export const dynamic = 'force-dynamic';

export default async function TasksPage({
  searchParams,
}: {
  searchParams: { mine?: string; done?: string };
}) {
  const gate = await requireView('accountHealth', '/accounts/tasks');
  if (gate.blocked) return <RoleBlocked area="Account health" detail="accounts, network and admin" />;

  const canEdit = canManage(gate.user, 'accountHealth');
  const mine = searchParams.mine !== '0';
  const done = searchParams.done === '1';

  const [tasks, accounts, people] = await Promise.all([
    listTasks({ assignee: mine ? gate.user.id : undefined, done }),
    listAccounts({}),
    getAccountPeople(),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const late = tasks.filter((t) => t.late);
  const soon = tasks.filter((t) => !t.late && t.due_on && t.due_on <= addDays(today, 7));
  const rest = tasks.filter((t) => !late.includes(t) && !soon.includes(t));

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { mine: mine ? undefined : '0', done: done ? '1' : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return `/accounts/tasks${qs ? `?${qs}` : ''}`;
  };

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1200px] mx-auto">
      <AccountsTabs active="/accounts/tasks" />
      <div className="text-[13px] text-ink-500 mb-3">
        <Link href="/accounts" className="hover:text-ink-900">Account health</Link>
        <span className="text-ink-300"> / </span>
        <span className="font-semibold text-ink-900">Tasks</span>
      </div>

      <PageHeader
        title="Tasks"
        subtitle="Everything committed to across accounts, in the order it has to happen."
      />

      <div className="mt-5 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg
                      border border-ink-200 bg-surface px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Owner</span>
          <ChipButton href={link({ mine: undefined })} active={mine}>Mine</ChipButton>
          <ChipButton href={link({ mine: '0' })} active={!mine}>Everyone</ChipButton>
        </div>
        <span className="w-px h-5 bg-ink-200" />
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Show</span>
          <ChipButton href={link({ done: undefined })} active={!done}>Open</ChipButton>
          <ChipButton href={link({ done: '1' })} active={done}>Done</ChipButton>
        </div>
        <span className="ml-auto text-[12px] text-ink-500">{tasks.length} shown</span>
      </div>

      {late.length > 0 && (
        <Section title={`Late — ${late.length}`} tone="danger">
          {late.map((t) => <TaskRow key={t.id} t={t} canEdit={canEdit} />)}
        </Section>
      )}
      {soon.length > 0 && (
        <Section title={`Next seven days — ${soon.length}`}>
          {soon.map((t) => <TaskRow key={t.id} t={t} canEdit={canEdit} />)}
        </Section>
      )}
      {rest.length > 0 && (
        <Section title={done ? `Done — ${rest.length}` : `Later — ${rest.length}`}>
          {rest.map((t) => <TaskRow key={t.id} t={t} canEdit={canEdit} />)}
        </Section>
      )}
      {tasks.length === 0 && (
        <div className="rounded-xl border border-ink-200 bg-surface px-5 py-12 text-center">
          <p className="text-sm font-semibold text-ink-900">Nothing here.</p>
          <p className="text-sm text-ink-500 mt-1">
            {done ? 'Nothing has been completed yet.' : 'No open tasks — add the first one below.'}
          </p>
        </div>
      )}

      {canEdit && accounts.length > 0 && (
        <div className="mt-5">
          <NewTask accounts={accounts} people={people} meId={gate.user.id} />
        </div>
      )}
    </div>
  );
}

function Section({ title, tone, children }: {
  title: string; tone?: 'danger'; children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className={`text-[11px] font-bold uppercase tracking-wide mb-2
                       ${tone === 'danger' ? 'text-danger-500' : 'text-ink-500'}`}>
        {title}
      </div>
      <div className={`rounded-xl border bg-surface
                       ${tone === 'danger' ? 'border-danger-100' : 'border-ink-200'}`}>
        {children}
      </div>
    </div>
  );
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
