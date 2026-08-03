import { KanbanSquare, Inbox, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ChipButton } from '@/components/ui/Toggle';
import { getQueue, getQueueFunnel, listTeam } from '@/lib/crm';
import { CrmTabs } from './CrmTabs';
import { QueueFunnel } from './QueueFunnel';
import { QueueTable } from './QueueTable';

export const dynamic = 'force-dynamic';

/**
 * How long a provider can sit untouched before it counts as stale.
 *
 * One threshold across every stage is deliberately crude — a week untouched in
 * Negotiating is worse than a week in Identified — but it's visible on screen
 * and adjustable from the URL, which makes it arguable. Splitting it per stage
 * is worth doing once someone has watched a real number for a fortnight.
 */
const DEFAULT_STALE_DAYS = 7;

export default async function MyQueuePage({
  searchParams,
}: {
  searchParams: { who?: string; stale?: string };
}) {
  const gate = await requireView('providerPipeline', '/crm');
  if (gate.blocked) return <RoleBlocked area="The network CRM" detail="the network and admin teams" />;
  const me = gate.user;

  const staleAfter = Math.max(1, Number(searchParams.stale) || DEFAULT_STALE_DAYS);
  const unassigned = searchParams.who === 'unassigned';
  const viewingId = unassigned ? null : searchParams.who ? Number(searchParams.who) : me.id;

  const [rows, funnel, team] = await Promise.all([
    getQueue({ assigneeId: viewingId, unassigned, limit: 500 }),
    getQueueFunnel({ assigneeId: viewingId, unassigned }),
    listTeam(),
  ]);

  const stale = rows.filter((r) => r.days_stale >= staleAfter);
  const whoLabel = unassigned
    ? 'Nobody'
    : viewingId === me.id
      ? 'You'
      : (team.find((t) => t.id === viewingId)?.name ?? 'They');

  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...searchParams, ...patch })) if (v) next.set(k, v);
    const qs = next.toString();
    return `/crm${qs ? `?${qs}` : ''}`;
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex items-center gap-2 mb-1">
        <KanbanSquare className="w-5 h-5 text-brand-600" strokeWidth={2.25} />
        <h1 className="text-2xl font-bold text-ink-900">Network CRM</h1>
      </div>
      <p className="text-sm text-ink-600 mb-5 max-w-3xl">
        Everything assigned to you across every thread, longest-untouched first. Providers get
        assigned per campaign, so anything sitting in a thread you don&rsquo;t open often is easy to
        lose — this is the same work, sorted by what&rsquo;s been waiting.
      </p>

      <CrmTabs active="/crm" />

      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-1">Showing</span>
        <ChipButton href={href({ who: undefined })} active={!unassigned && viewingId === me.id}>
          Mine
        </ChipButton>
        <ChipButton href={href({ who: 'unassigned' })} active={unassigned}>
          ⚠ Unassigned
        </ChipButton>
        {team.filter((t) => t.id !== me.id).map((t) => (
          <ChipButton key={t.id} href={href({ who: String(t.id) })} active={!unassigned && viewingId === t.id}>
            {t.name}
          </ChipButton>
        ))}
      </div>

      <QueueFunnel funnel={funnel} staleCount={stale.length} staleAfter={staleAfter} />

      {stale.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-warn-500/30 bg-warn-500/5 px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-warn-600 mt-0.5 shrink-0" strokeWidth={2.25} />
          <p className="text-xs text-ink-700">
            Oldest untouched is {rows[0]?.days_stale}d. Stale means {staleAfter}+ days;{' '}
            <Link href={href({ stale: staleAfter === 7 ? '14' : '7' })} className="underline hover:text-ink-900">
              try {staleAfter === 7 ? 14 : 7}
            </Link>.
          </p>
        </div>
      )}

      <Card>
        <CardHeader
          title={`${rows.length} open${unassigned ? ' · unowned' : ''}`}
          subtitle={
            rows.length
              ? 'Open means not yet onboarded — stalled and dropped stay here on purpose.'
              : undefined
          }
          icon={<Inbox className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5 overflow-x-auto">
            <QueueTable
              rows={rows}
              staleAfter={staleAfter}
              emptyLabel={
                unassigned
                  ? 'Every provider on an active thread has an owner.'
                  : `${whoLabel === 'You' ? 'You have' : `${whoLabel} has`} nothing open. Check the Team tab for what's unowned.`
              }
            />
          </div>
        </CardBody>
      </Card>
    </main>
  );
}
