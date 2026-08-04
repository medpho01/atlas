import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { getThread, getThreadProviders, getChecklist, listTeam, canWriteCrm } from '@/lib/crm';

/**
 * Everything the provider panel needs, for one provider on one thread.
 *
 * The thread page loads this with the page because it's rendering the whole
 * board anyway. The queue can't — it spans every thread, and pre-loading each
 * provider's checklist and journey to cover the one that might be clicked
 * would be most of the CRM on every page view.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canAccess(user, 'providerPipeline')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const threadId = Number(req.nextUrl.searchParams.get('thread'));
  const providerId = Number(req.nextUrl.searchParams.get('provider'));
  if (!Number.isInteger(threadId) || !Number.isInteger(providerId)) {
    return NextResponse.json({ error: 'thread and provider required' }, { status: 400 });
  }

  const thread = await getThread(threadId);
  if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });

  const [providers, checklist, team] = await Promise.all([
    getThreadProviders(threadId),
    getChecklist(threadId),
    listTeam(),
  ]);
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return NextResponse.json({ error: 'Provider not on this thread' }, { status: 404 });

  return NextResponse.json({
    thread,
    provider,
    stages: thread.stages,
    checklist,
    team,
    canWrite: canWriteCrm(user),
  });
}
