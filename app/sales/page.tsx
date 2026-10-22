import { requireView } from '@/lib/guard';
import { canManage } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChipButton } from '@/components/ui/Toggle';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  getPipeline, listSalesPipelines, getDeals, getBoardSummary, getTags, getAssignableUsers,
} from '@/lib/salesCrm';
import { Board } from './Board';
import { NewDeal } from './NewDeal';

export const dynamic = 'force-dynamic';

const inr = (v: string | number | null) => {
  const n = Number(v ?? 0);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
};

function Metric({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'warn' | 'good';
}) {
  const border = tone === 'warn' ? 'border-warn-100 bg-warn-50'
    : tone === 'good' ? 'border-success-100 bg-success-50' : 'border-ink-200 bg-surface';
  const num = tone === 'warn' ? 'text-warn-600' : tone === 'good' ? 'text-success-600' : 'text-ink-900';
  return (
    <div className={`rounded-xl border ${border} px-4 py-3`}>
      <div className="text-[10px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`text-[22px] font-extrabold mt-1 num ${num}`}>{value}</div>
      {sub && <div className="text-[11px] text-ink-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: { mine?: string; tag?: string; q?: string; show?: string; pipeline?: string };
}) {
  const gate = await requireView('salesCrm', '/sales');
  if (gate.blocked) return <RoleBlocked area="Sales CRM" detail="sales, accounts and admin" />;

  const pipelines = await listSalesPipelines();
  const wanted = Number(searchParams.pipeline);
  const pipeline = (Number.isInteger(wanted) && pipelines.find((p) => p.id === wanted))
    || pipelines[0] || await getPipeline();
  if (!pipeline) {
    return (
      <div className="px-6 lg:px-8 py-6">
        <PageHeader title="Sales CRM" subtitle="No pipeline has been configured yet." />
        <p className="text-[13px] text-ink-600 mt-4">
          An admin sets the stages in <b>Admin › Pipeline</b>.
        </p>
      </div>
    );
  }

  const canEdit = canManage(gate.user, 'salesCrm');
  const mine = searchParams.mine === '1';
  const show = searchParams.show === 'all' ? 'all' as const : 'open' as const;

  const [deals, summary, tags, people] = await Promise.all([
    getDeals(pipeline.id, {
      owner: mine ? gate.user.id : undefined,
      tag: searchParams.tag,
      q: searchParams.q,
      show,
    }),
    getBoardSummary(pipeline.id),
    getTags(),
    getAssignableUsers(),
  ]);

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      mine: mine ? '1' : undefined,
      tag: searchParams.tag,
      q: searchParams.q,
      show: show === 'all' ? 'all' : undefined,
      pipeline: searchParams.pipeline,
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const q = p.toString();
    return `/sales${q ? `?${q}` : ''}`;
  };

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Sales CRM"
        subtitle="Every company we are trying to sign as a store, and what has to happen next on each one."
        actions={
          <InfoTip
            title="Sales CRM"
            shows="One card per prospective store, on the stage it has reached."
            computed={
              <>
                A deal is <b>stuck</b> when nothing has been logged against it for fourteen days —
                no note, no task, no stage move. That is derived, not a stage, so it cannot go
                stale and there is nothing to configure.
              </>
            }
            drives="Winning a deal links it to the LabStack store it became, and from then on Stores & Orders shows what that account actually sends."
          />
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-5">
        <Metric label="Open pipeline" value={inr(summary?.open_value ?? 0)}
                sub={`${summary?.open_deals ?? 0} deals`} />
        <Metric label="Weighted" value={inr(summary?.weighted ?? 0)} sub="by stage probability" />
        <Metric label="Closing this month" value={String(summary?.closing_month ?? 0)}
                sub={inr(summary?.closing_month_value ?? 0)} />
        <Metric label="Stuck 14 days+" value={String(summary?.stuck ?? 0)}
                sub="nothing logged" tone={(summary?.stuck ?? 0) > 0 ? 'warn' : undefined} />
        <Metric label="Won this quarter" value={String(summary?.won_quarter ?? 0)}
                tone="good" sub={`${summary?.unassigned ?? 0} unassigned`} />
      </div>

      <div className="mt-5 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg
                      border border-ink-200 bg-surface px-4 py-2.5">
        {/* Only when there is more than one: a control with a single option is
            a control nobody needs, and a second pipeline made in Configure
            pipelines would otherwise be invisible. */}
        {pipelines.length > 1 && (
          <>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Pipeline</span>
              {pipelines.map((p) => (
                <ChipButton key={p.id} href={link({ pipeline: String(p.id) })}
                            active={p.id === pipeline.id}>
                  {p.name}
                </ChipButton>
              ))}
            </div>
            <span className="w-px h-5 bg-ink-200" />
          </>
        )}

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Owner</span>
          <ChipButton href={link({ mine: undefined })} active={!mine}>Everyone</ChipButton>
          <ChipButton href={link({ mine: '1' })} active={mine}>Mine</ChipButton>
        </div>

        {tags.length > 0 && (
          <>
            <span className="w-px h-5 bg-ink-200" />
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Tag</span>
              <ChipButton href={link({ tag: undefined })} active={!searchParams.tag}>All</ChipButton>
              {tags.filter((t) => t.n > 0).slice(0, 6).map((t) => (
                <ChipButton key={t.key} href={link({ tag: t.label })} active={searchParams.tag === t.label}>
                  {t.label} <span className="text-ink-400">{t.n}</span>
                </ChipButton>
              ))}
            </div>
          </>
        )}

        <span className="w-px h-5 bg-ink-200" />
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Show</span>
          <ChipButton href={link({ show: undefined })} active={show === 'open'}>Open only</ChipButton>
          <ChipButton href={link({ show: 'all' })} active={show === 'all'}>Include closed</ChipButton>
        </div>

        {canEdit && (
          <div className="ml-auto">
            <NewDeal people={people} meId={gate.user.id} />
          </div>
        )}
      </div>

      <Board
        stages={show === 'all' ? pipeline.stages : pipeline.stages.filter((s) => s.outcome === 'open')}
        deals={deals}
        canEdit={canEdit}
      />

      {deals.length === 0 && (
        <div className="rounded-xl border border-ink-200 bg-surface px-5 py-12 text-center">
          <p className="text-sm font-semibold text-ink-900">Nothing in the pipeline.</p>
          <p className="text-sm text-ink-500 mt-1">
            {canEdit ? 'Add the first company you are talking to.' : 'Sales will add deals as they come in.'}
          </p>
        </div>
      )}
    </div>
  );
}
