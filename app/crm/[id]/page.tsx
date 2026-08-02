import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Target } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import { getThread, getThreadProviders, getChecklist, listTeam, getThreadStats, canWriteCrm } from '@/lib/crm';
import { BoardClient } from './BoardClient';
import { ThreadStats } from './ThreadStats';

export const dynamic = 'force-dynamic';

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const threadId = parseInt(id, 10);
  if (!Number.isInteger(threadId)) notFound();

  const me = await getSessionUser();
  if (!me) redirect(`/login?next=/crm/${threadId}`);
  if (!canAccess(me, 'providerPipeline')) {
    return <RoleBlocked area="The network CRM" detail="the network and admin teams" />;
  }

  const thread = await getThread(threadId);
  if (!thread) notFound();

  const [providers, checklist, team, stats] = await Promise.all([
    getThreadProviders(threadId),
    getChecklist(threadId),
    listTeam(),
    getThreadStats(threadId),
  ]);

  return (
    <main className="mx-auto max-w-[1500px] px-6 py-6">
      <Link href="/crm" className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900 transition mb-3">
        <ArrowLeft className="w-4 h-4" /> All threads
      </Link>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-4">
        <h1 className="text-xl font-bold text-ink-900">{thread.name}</h1>
        <span className="inline-flex items-center gap-1 text-[13px] text-ink-600">
          <Target className="w-3.5 h-3.5" />
          {thread.onboarded_count}/{thread.target_count || '∞'} onboarded · {thread.provider_total} in pipeline
        </span>
        {thread.region && <span className="text-[13px] text-ink-500">{thread.region}</span>}
        {thread.description && <span className="text-[13px] text-ink-500">— {thread.description}</span>}
      </div>

      <ThreadStats thread={thread} stats={stats} />

      <BoardClient
        thread={thread}
        initialProviders={providers}
        checklist={checklist}
        team={team}
        canWrite={canWriteCrm(me)}
        myId={me?.id ?? 0}
      />
    </main>
  );
}
