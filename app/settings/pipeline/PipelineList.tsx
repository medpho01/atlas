'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Plus, Star } from 'lucide-react';
import { createPipeline, setDefaultPipeline } from './actions';
import { startNav } from '@/components/ui/NavProgress';
import { KIND_LABEL, KIND_BLURB, type PipelineKind, type PipelineSummary } from '@/lib/pipelineKinds';

/**
 * Every pipeline in Atlas, grouped by the CRM that owns it.
 *
 * Creating one lives here and nowhere else. The Network CRM used to have its
 * own funnel builder in a modal on the board — same idea, different code,
 * different rules, and it could create a funnel but never edit one, so a typo
 * in a stage name was permanent.
 */
export function PipelineList({
  groups, selected,
}: {
  groups: { kind: PipelineKind; items: PipelineSummary[] }[];
  selected: { kind: PipelineKind; id: number } | null;
}) {
  const [adding, setAdding] = useState<PipelineKind | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const create = (kind: PipelineKind) => {
    if (!name.trim()) return;
    setErr(null);
    start(async () => {
      const r = await createPipeline({ kind, name });
      if (!r.ok) { setErr(r.error ?? 'Could not create it'); return; }
      setAdding(null); setName('');
      startNav();
      if (r.id) window.location.href = `/settings/pipeline?kind=${kind}&id=${r.id}`;
    });
  };

  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-2.5">
      {groups.map((g) => (
        <div key={g.kind} className="mb-4 last:mb-0">
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
              <div key={`${p.kind}:${p.id}`}
                   className={`rounded-lg mb-1 border transition
                               ${on ? 'bg-brand-50 border-brand-100' : 'border-transparent hover:bg-ink-50'}`}>
                <Link href={`/settings/pipeline?kind=${p.kind}&id=${p.id}`}
                      className="block px-3 pt-2.5 pb-1">
                  <div className={`text-[13px] ${on ? 'font-bold text-ink-900' : 'font-medium text-ink-700'}`}>
                    {p.name}
                  </div>
                  <div className="text-[11px] text-ink-500 mt-0.5">
                    {p.stages.length} stages · {cards} {p.cardNoun}
                  </div>
                </Link>
                <div className="px-3 pb-2">
                  {p.isDefault ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-success-600">
                      <Star className="w-3 h-3 fill-current" /> default for new {p.cardNoun === 'deals' ? 'deals' : 'threads'}
                    </span>
                  ) : (
                    <button type="button" disabled={pending}
                            onClick={() => start(async () => {
                              await setDefaultPipeline({ kind: p.kind, pipelineId: p.id });
                            })}
                            className="text-[10px] text-ink-400 hover:text-brand-600">
                      make default
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {adding === g.kind ? (
            <form onSubmit={(e) => { e.preventDefault(); create(g.kind); }} className="px-1.5 pt-1">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                     aria-label={`New ${KIND_LABEL[g.kind]} pipeline name`}
                     placeholder={g.kind === 'sales' ? 'e.g. Enterprise' : 'e.g. Hospital onboarding'}
                     className="w-full text-[12px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5" />
              <div className="flex gap-1.5 mt-1.5">
                <button type="submit" disabled={pending || !name.trim()}
                        className="flex-1 text-[11px] font-semibold rounded-md bg-brand-600 text-white py-1.5 disabled:opacity-50">
                  {pending ? 'Creating…' : 'Create'}
                </button>
                <button type="button" onClick={() => { setAdding(null); setName(''); setErr(null); }}
                        className="text-[11px] rounded-md border border-ink-200 px-2.5 py-1.5 text-ink-600">
                  Cancel
                </button>
              </div>
              <p className="text-[10px] text-ink-400 mt-1.5 leading-snug">
                It starts with the few stages this kind needs. Build the rest in the editor —
                existing boards keep the pipeline they are on.
              </p>
            </form>
          ) : (
            <button type="button" onClick={() => { setAdding(g.kind); setName(''); }}
                    className="w-full flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed
                               border-ink-200 text-[11px] text-ink-500 hover:bg-ink-50 hover:text-ink-700">
              <Plus className="w-3 h-3" /> New {KIND_LABEL[g.kind].replace(' CRM', '')} pipeline
            </button>
          )}
        </div>
      ))}

      {err && <p className="text-[11px] text-danger-500 px-1.5 pb-2">{err}</p>}

      <p className="text-[11px] text-ink-400 leading-snug px-1.5 pt-2 border-t border-ink-100">
        A new CRM adds its pipelines to this list. Nothing here is per-screen: the editor asks
        each pipeline what shape it is.
      </p>
    </div>
  );
}
