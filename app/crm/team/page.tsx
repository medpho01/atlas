import Link from 'next/link';
import { KanbanSquare, Users } from 'lucide-react';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { getTeamWorkload } from '@/lib/crm';
import { CrmTabs } from '../CrmTabs';

export const dynamic = 'force-dynamic';

const DEFAULT_STALE_DAYS = 7;

export default async function TeamPage({ searchParams }: { searchParams: { stale?: string } }) {
  const gate = await requireView('providerPipeline', '/crm/team');
  if (gate.blocked) return <RoleBlocked area="The network CRM" detail="the network and admin teams" />;

  const staleAfter = Math.max(1, Number(searchParams.stale) || DEFAULT_STALE_DAYS);
  const rows = await getTeamWorkload(staleAfter);

  const totalOpen = rows.reduce((s, r) => s + r.open_count, 0);
  const totalStale = rows.reduce((s, r) => s + r.stale_count, 0);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex items-center gap-2 mb-1">
        <KanbanSquare className="w-5 h-5 text-brand-600" strokeWidth={2.25} />
        <h1 className="text-2xl font-bold text-ink-900">Network CRM</h1>
      </div>
      <p className="text-sm text-ink-600 mb-5 max-w-3xl">
        Who is carrying what, across every active thread. Unowned work is listed first — a provider
        nobody is responsible for is the one most reliably missed.
      </p>

      <CrmTabs active="/crm/team" />

      <Card>
        <CardHeader
          title={`${totalOpen} open across the team`}
          subtitle={`${totalStale} untouched for ${staleAfter}+ days. Open means not yet onboarded.`}
          icon={<Users className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5 overflow-x-auto">
            {rows.length === 0 ? (
              <p className="px-5 py-10 text-sm text-ink-500 text-center">
                No open work on any active thread.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
                    <th className="text-left font-medium px-5 py-2">Owner</th>
                    <th className="text-right font-medium px-2 py-2">Open</th>
                    <th className="text-right font-medium px-2 py-2">Threads</th>
                    <th className="text-right font-medium px-2 py-2">Stale</th>
                    <th className="text-right font-medium px-5 py-2">Oldest</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.assignee_id ?? 'unassigned'}
                      className={`border-b border-ink-100 last:border-0 ${r.assignee_id === null ? 'bg-warn-500/5' : ''}`}
                    >
                      <td className="px-5 py-2">
                        <Link
                          href={`/crm?who=${r.assignee_id ?? 'unassigned'}&stale=${staleAfter}`}
                          className="font-medium text-ink-900 hover:text-brand-700 dark:hover:text-brand-400 hover:underline"
                        >
                          {r.assignee_name ?? 'Unassigned'}
                        </Link>
                        {r.role && <span className="text-[11px] text-ink-500 ml-1.5">{r.role}</span>}
                      </td>
                      <td className="px-2 py-2 num font-medium">{r.open_count}</td>
                      <td className="px-2 py-2 num text-ink-600">{r.threads}</td>
                      <td className="px-2 py-2 num">
                        {r.stale_count > 0
                          ? <span className="text-warn-600 font-medium">{r.stale_count}</span>
                          : <span className="text-ink-300">—</span>}
                      </td>
                      <td className="px-5 py-2 num text-ink-600">
                        {r.oldest_days === 0 ? 'today' : `${r.oldest_days}d`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardBody>
      </Card>

      <p className="mt-4 text-xs text-ink-500">
        Counts cover active threads only. Click a name to see exactly what they&rsquo;re carrying.
      </p>
    </main>
  );
}
