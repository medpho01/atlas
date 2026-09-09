import { redirect } from 'next/navigation';
import { KanbanSquare } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import { listTeam, canLeadCrm } from '@/lib/crm';
import { getDailyUpdate } from '@/lib/crmUpdate';
import { CrmTabs } from '../CrmTabs';
import { ChipButton } from '@/components/ui/Toggle';
import { UpdateClient } from './UpdateClient';

export const dynamic = 'force-dynamic';

/** Today in Asia/Kolkata — the team's day, not the server's. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export default async function UpdatePage({
  searchParams,
}: {
  searchParams: { day?: string; who?: string };
}) {
  const me = await getSessionUser();
  if (!me) redirect('/login?next=/crm/update');
  if (!canAccess(me, 'providerPipeline')) {
    return <RoleBlocked area="The network CRM" detail="the network and admin teams" />;
  }

  const day = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day ?? '') ? searchParams.day! : istToday();
  // Anyone can read a colleague's update — standups are posted to the group
  // anyway, and a lead covering for someone should not have to ask them for it.
  const isLead = canLeadCrm(me);
  const team = isLead ? await listTeam() : [];
  // A lead reads the team's updates — that is the point of standups. A member
  // reads their own, and cannot reach a colleague's by editing the URL.
  const viewingId = isLead ? (Number(searchParams.who) || me.id) : me.id;

  const update = await getDailyUpdate(viewingId, day);

  const href = (patch: { day?: string; who?: string }) => {
    const q = new URLSearchParams();
    const d = patch.day ?? day;
    const w = patch.who ?? String(viewingId);
    if (d !== istToday()) q.set('day', d);
    if (Number(w) !== me.id) q.set('who', w);
    const qs = q.toString();
    return `/crm/update${qs ? `?${qs}` : ''}`;
  };

  // The last seven days, which is as far back as anyone writes up.
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${istToday()}T00:00:00`);
    d.setDate(d.getDate() - i);
    return d.toISOString().slice(0, 10);
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex items-center gap-2 mb-1">
        <KanbanSquare className="w-5 h-5 text-brand-600" />
        <h1 className="text-2xl font-bold text-ink-900">Network CRM</h1>
      </div>
      <CrmTabs active="/crm/update" isLead={isLead} />

      <div className="flex flex-wrap items-center gap-1.5 mb-2 mt-4">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Day</span>
        {days.map((d) => (
          <ChipButton key={d} href={href({ day: d })} active={d === day}>
            {d === istToday()
              ? 'Today'
              : new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </ChipButton>
        ))}
      </div>

      <div className={`flex flex-wrap items-center gap-1.5 mb-5 ${isLead ? '' : 'hidden'}`}>
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Person</span>
        {team.map((t) => (
          <ChipButton key={t.id} href={href({ who: String(t.id) })} active={viewingId === t.id}>
            {t.id === me.id ? 'Me' : t.name}
          </ChipButton>
        ))}
      </div>

      <UpdateClient update={update} />
    </main>
  );
}
