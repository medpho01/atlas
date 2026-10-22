import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { listPipelines, KIND_LABEL, KIND_BLURB, type PipelineKind } from '@/lib/pipelines';
import { StageEditor } from './StageEditor';

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
          <div className="flex-[1_1_250px] min-w-[230px] rounded-xl border border-ink-200 bg-surface p-2.5">
            {groups.map((g) => (
              <div key={g.kind} className="mb-3 last:mb-0">
                <div className="px-1.5 pb-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-ink-400 font-semibold">
                    {KIND_LABEL[g.kind]}
                  </div>
                  <p className="text-[11px] text-ink-500 leading-snug mt-1">{KIND_BLURB[g.kind]}</p>
                </div>
                {g.items.map((p) => {
                  const on = selected && p.kind === selected.kind && p.id === selected.id;
                  const cards = Object.values(p.counts).reduce((a, b) => a + b, 0);
                  return (
                    <Link key={`${p.kind}:${p.id}`} href={`/settings/pipeline?kind=${p.kind}&id=${p.id}`}
                          className={`block rounded-lg px-3 py-2.5 mb-1 border transition
                                      ${on ? 'bg-brand-50 border-brand-100' : 'border-transparent hover:bg-ink-50'}`}>
                      <div className={`text-[13px] ${on ? 'font-bold text-ink-900' : 'font-medium text-ink-700'}`}>
                        {p.name}
                      </div>
                      <div className="text-[11px] text-ink-500 mt-0.5">
                        {p.stages.length} stages · {cards} {p.cardNoun}
                        {p.isDefault ? ' · default' : ''}
                      </div>
                    </Link>
                  );
                })}
              </div>
            ))}
            <p className="text-[11px] text-ink-400 leading-snug px-1.5 pt-2 border-t border-ink-100">
              A new CRM adds its pipelines to this list. Nothing here is per-screen: the editor
              asks each pipeline what shape it is.
            </p>
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
