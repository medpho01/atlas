import { KanbanSquare } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { listThreads, listFunnels, canWriteCrm } from '@/lib/crm';
import { ThreadsClient } from './ThreadsClient';

export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  const me = await getSessionUser();
  const [threads, funnels] = await Promise.all([listThreads(), listFunnels()]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex items-center gap-2 mb-1">
        <KanbanSquare className="w-5 h-5 text-brand-600" />
        <h1 className="text-2xl font-bold text-ink-900">Network CRM</h1>
      </div>
      <p className="text-sm text-ink-600 mb-6 max-w-3xl">
        Threads are onboarding campaigns with a target and a funnel. Assign providers to the team,
        track their journey stage by stage, and collect the document checklist so console onboarding
        can pick them up the moment they're ready.
      </p>
      <ThreadsClient threads={threads} funnels={funnels} canWrite={canWriteCrm(me)} isAdmin={me?.role === 'admin'} />
    </main>
  );
}
