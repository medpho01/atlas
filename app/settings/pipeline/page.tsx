import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { query } from '@/lib/db';
import { getPipeline } from '@/lib/salesCrm';
import { StageEditor } from './StageEditor';

export const dynamic = 'force-dynamic';

export default async function PipelinePage() {
  const gate = await requireView('admin', '/settings/pipeline');
  if (gate.blocked) return <RoleBlocked area="Pipeline settings" detail="admin" />;

  const pipeline = await getPipeline();
  if (!pipeline) {
    return (
      <div className="px-6 lg:px-8 py-6">
        <PageHeader title="Pipeline" subtitle="No pipeline exists yet." />
      </div>
    );
  }

  const rows = await query<{ stage_key: string; n: number }>(
    `SELECT stage_key, COUNT(*)::int AS n FROM atlas.sales_deal WHERE pipeline_id = $1 GROUP BY 1`,
    [pipeline.id],
  );
  const counts = Object.fromEntries(rows.map((r) => [r.stage_key, r.n]));

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1100px] mx-auto">
      <PageHeader
        title="Pipeline"
        subtitle="The stages a deal moves through. Changing them changes the board for everyone."
      />

      <div className="flex flex-wrap gap-4 mt-5 items-start">
        <div className="flex-[1_1_240px] min-w-[220px] rounded-xl border border-ink-200 bg-surface p-2">
          <div className="rounded-lg bg-brand-50 border border-brand-100 px-3 py-2.5">
            <div className="text-[13px] font-bold text-ink-900">{pipeline.name}</div>
            <div className="text-[11px] text-ink-500 mt-0.5">Sales CRM · default</div>
          </div>
          <p className="text-[11px] text-ink-400 leading-snug px-3 py-3">
            One pipeline today. The account-management CRM will add its own — a second pipeline
            is a row here, not a migration.
          </p>
        </div>

        <Card className="flex-[999_1_600px] min-w-0">
          <CardBody>
            <StageEditor pipelineId={pipeline.id} initial={pipeline.stages} counts={counts} />
            <div className="mt-5 rounded-lg border border-ink-200 bg-ink-50 px-4 py-3">
              <div className="text-[11px] font-bold text-ink-700">Three rules this editor enforces</div>
              <ul className="mt-2 pl-4 list-disc text-[12px] text-ink-600 space-y-1 leading-relaxed">
                <li>Exactly one won stage and one lost stage. They can be renamed and reordered,
                    not removed — every report counts on them.</li>
                <li>A stage holding deals cannot be deleted, and renaming one never changes its
                    key. Either would leave those deals on a stage that does not exist.</li>
                <li>Stuck is not a stage. A deal with nothing logged for fourteen days is badged
                    on the board wherever it sits — nothing to configure, nothing to drag into.</li>
              </ul>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
