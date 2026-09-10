import { redirect } from 'next/navigation';
import { KanbanSquare } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import { canLeadCrm } from '@/lib/crm';
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
  // Your own update, always. People post these to the group themselves, so a
  // picker for reading colleagues' drafts was answering a question nobody had
  // and made a private working page look like a monitoring tool.
  const viewingId = me.id;

  const update = await getDailyUpdate(viewingId, day);

  const href = (day: string) => {
    const q = new URLSearchParams();
    if (day !== istToday()) q.set('day', day);
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
          <ChipButton key={d} href={href(d)} active={d === day}>
            {d === istToday()
              ? 'Today'
              : new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </ChipButton>
        ))}
      </div>


      <UpdateClient update={update} />
    </main>
  );
}
