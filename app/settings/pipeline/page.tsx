import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { listPipelines, KIND_LABEL, type PipelineKind } from '@/lib/pipelines';
import { StageEditor } from './StageEditor';
import { PipelineList } from './PipelineList';

export const dynamic = 'force-dynamic';

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: { kind?: string; id?: string };
}) {
  const gate = await requireView('admin', '/settings/pipeline');
  if (gate.blocked) return <RoleBlocked area="Pipeline settings" detail="admin" />;

  const all = await listPipelines();
  const selected =
    all.find((p) => p.kind === searchParams.kind && String(p.id) === searchParams.id)
    ?? all[0];

  // Grouped by the CRM that owns them, in the order a reader expects: the one
  // being configured most often first.
  const groups = (['sales', 'network'] as PipelineKind[])
    .map((kind) => ({ kind, items: all.filter((p) => p.kind === kind) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1200px] mx-auto">
      <PageHeader
        title="Configure pipelines"
        subtitle="The stages a card moves through, for every CRM in Atlas. Changing them changes the board for everyone."
      />

      {all.length === 0 ? (
        <p className="text-[13px] text-ink-600 mt-5">No pipelines exist yet.</p>
      ) : (
        <div className="flex flex-wrap gap-4 mt-5 items-start">
          <div className="flex-[1_1_250px] min-w-[230px]">
            <PipelineList
              groups={groups}
              selected={selected ? { kind: selected.kind, id: selected.id } : null}
            />
          </div>

          {selected && (
            <Card className="flex-[999_1_600px] min-w-0">
              <CardBody>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] uppercase tracking-wide text-ink-400">
                    {KIND_LABEL[selected.kind]}
                  </span>
                  <Link href={selected.href} className="text-[11px] text-brand-600 hover:underline ml-auto">
                    Open the board →
                  </Link>
                </div>
                <StageEditor key={`${selected.kind}:${selected.id}`} pipeline={selected} />
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
