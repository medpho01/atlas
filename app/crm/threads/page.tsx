import { KanbanSquare } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import { listThreads, listFunnels, canWriteCrm, listThreadMembers, listTeam, canLeadCrm, getQueue, getQueueFunnel } from '@/lib/crm';
import { ThreadsClient } from '../ThreadsClient';
import { CrmTabs } from '../CrmTabs';
import { QueueBoard } from '../QueueBoard';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';

export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  const me = await getSessionUser();
  if (!me) redirect('/login?next=/crm/threads');
  if (!canAccess(me, 'providerPipeline')) {
    return <RoleBlocked area="The network CRM" detail="the network and admin teams" />;
  }

  const isLead = canLeadCrm(me);
  // Running the campaigns is the lead's job — creating them, naming them,
  // choosing who works them. A member sees their queue and writes their update.
  if (!isLead) {
    return <RoleBlocked area="Threads" detail="network leads and admins" />;
  }
  const [threads, funnels, members, team, everything, funnel] = await Promise.all([
    listThreads(), listFunnels(), listThreadMembers(), listTeam(),
    // Every card the team holds. The thread cards above say how each campaign
    // is doing; this says what state the work itself is in, and who has it.
    getQueue({ limit: 2000 }),
    getQueueFunnel({}),
  ]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex items-center gap-2 mb-1">
        <KanbanSquare className="w-5 h-5 text-brand-600" />
        <h1 className="text-2xl font-bold text-ink-900">Network CRM</h1>
      </div>
      <CrmTabs active="/crm/threads" isLead={isLead} />
      <p className="text-sm text-ink-600 mb-6 max-w-3xl">
        Threads are onboarding campaigns with a target and a funnel. Assign providers to the team,
        track their journey stage by stage, and collect the document checklist so console onboarding
        can pick them up the moment they're ready.
      </p>
      <ThreadsClient threads={threads} funnels={funnels} canWrite={isLead}
        isAdmin={me?.role === 'admin'} members={members} team={team} />

      <Card className="mt-6">
        <CardHeader
          title={`Everyone's pipeline · ${everything.length} providers`}
          subtitle="Every card the team holds, by stage. Each shows its thread and who owns it — unowned cards say so."
          icon={<KanbanSquare className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <QueueBoard
            rows={everything}
            stages={funnel.stages}
            staleAfter={7}
            emptyLabel="No providers on any thread yet."
          />
        </CardBody>
      </Card>
    </main>
  );
}
