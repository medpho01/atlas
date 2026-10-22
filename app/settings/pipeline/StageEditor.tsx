'use client';

import { useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, Check, X } from 'lucide-react';
import { saveStages } from './actions';
import type { PipelineStage, PipelineSummary } from '@/lib/pipelines';

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/**
 * One editor, two shapes.
 *
 * A sales stage carries a probability and an outcome; a network stage is a key
 * and a label, with one of them marked as the one that means onboarded. The
 * columns change rather than the storage: writing sales fields into a CRM
 * funnel would put data in the database that nothing reads.
 */
export function StageEditor({ pipeline }: { pipeline: PipelineSummary }) {
  const isSales = pipeline.kind === 'sales';
  const [stages, setStages] = useState<PipelineStage[]>(pipeline.stages);
  const [successKey, setSuccessKey] = useState<string | null>(pipeline.successKey);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const patch = (i: number, next: Partial<PipelineStage>) =>
    setStages((xs) => xs.map((s, j) => (j === i ? { ...s, ...next } : s)));

  const move = (i: number, by: number) =>
    setStages((xs) => {
      const j = i + by;
      if (j < 0 || j >= xs.length) return xs;
      const out = [...xs];
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    });

  const save = () => {
    setErr(null);
    start(async () => {
      const r = await saveStages({
        kind: pipeline.kind, pipelineId: pipeline.id, stages, successKey,
      });
      if (!r.ok) { setErr(r.error ?? 'Could not save'); return; }
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    });
  };

  const cols = isSales ? 7 : 6;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-bold text-ink-900">{pipeline.name}</h2>
        <span className="text-[11px] text-ink-400">order top to bottom is left to right on the board</span>
        <button type="button" onClick={save} disabled={pending}
                className="ml-auto text-[12px] font-semibold rounded-md bg-brand-600 text-white px-4 py-1.5 disabled:opacity-60">
          {pending ? 'Saving…' : saved ? 'Saved' : 'Save pipeline'}
        </button>
      </div>

      {err && (
        <p className="mt-3 rounded-md border border-danger-100 bg-danger-50 px-3 py-2 text-[12px] text-danger-500">
          {err}
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-ink-200 text-[10px] uppercase tracking-wide text-ink-400">
              <th scope="col" className="w-16 py-2" />
              <th scope="col" className="text-left font-medium py-2">Stage name</th>
              <th scope="col" className="text-left font-medium py-2 w-[130px]">Key</th>
              {isSales && <th scope="col" className="text-right font-medium py-2 w-[80px]">Win %</th>}
              <th scope="col" className="text-left font-medium py-2 w-[150px]">
                {isSales ? 'Outcome' : 'Means onboarded'}
              </th>
              <th scope="col" className="text-right font-medium py-2 w-[80px]">{pipeline.cardNoun}</th>
              <th scope="col" className="w-10 py-2" />
            </tr>
          </thead>
          <tbody>
            {stages.map((s, i) => {
              const held = pipeline.counts[s.key] ?? 0;
              const terminal = isSales && s.outcome !== 'open';
              const isSuccess = !isSales && successKey === s.key;
              const undeletable = terminal || (isSuccess && stages.length > 1);
              return (
                <tr key={i} className={`border-b border-ink-100 ${terminal || isSuccess ? 'bg-ink-50/50' : ''}`}>
                  <td className="py-2">
                    <div className="flex gap-0.5">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                              aria-label={`Move ${s.label} earlier`}
                              className="p-1 rounded text-ink-400 hover:text-ink-900 disabled:opacity-30">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === stages.length - 1}
                              aria-label={`Move ${s.label} later`}
                              className="p-1 rounded text-ink-400 hover:text-ink-900 disabled:opacity-30">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <input value={s.label} aria-label="Stage name"
                           onChange={(e) => patch(i, {
                             label: e.target.value,
                             // Only a brand-new stage takes its key from the name.
                             // Renaming an existing one must never orphan its cards.
                             key: held === 0 && !pipeline.stages.some((x) => x.key === s.key)
                               ? slug(e.target.value) : s.key,
                           })}
                           className="w-full text-[13px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5" />
                  </td>
                  <td className="py-2 pr-3">
                    <code className="text-[12px] text-ink-500 font-mono">{s.key || '—'}</code>
                  </td>
                  {isSales && (
                    <td className="py-2 pr-3">
                      <input inputMode="numeric" value={s.probability ?? 0} aria-label="Win probability"
                             disabled={terminal}
                             onChange={(e) => patch(i, { probability: Number(e.target.value.replace(/\D/g, '') || 0) })}
                             className="w-full text-[13px] text-right rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 num disabled:opacity-50" />
                    </td>
                  )}
                  <td className="py-2 pr-3">
                    {isSales ? (
                      terminal ? (
                        <span className={`text-[11px] font-semibold ${s.outcome === 'won' ? 'text-success-600' : 'text-danger-500'}`}>
                          {s.outcome === 'won' ? 'won · links a store' : 'lost · asks why'}
                        </span>
                      ) : <span className="text-[12px] text-ink-400">open</span>
                    ) : (
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name="success" checked={isSuccess}
                               onChange={() => setSuccessKey(s.key)}
                               className="w-3.5 h-3.5 accent-success-600" />
                        <span className={`text-[11px] ${isSuccess ? 'text-success-600 font-semibold' : 'text-ink-400'}`}>
                          {isSuccess ? <><Check className="w-3 h-3 inline" /> onboarded</> : 'in progress'}
                        </span>
                      </label>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right text-[12px] text-ink-600 num">{held || '—'}</td>
                  <td className="py-2">
                    <button type="button" disabled={undeletable || held > 0}
                            title={terminal ? 'Every report counts on this one'
                              : isSuccess ? 'Mark another stage as onboarded first'
                              : held > 0 ? `${held} ${pipeline.cardNoun} are on this stage` : 'Remove'}
                            aria-label={`Remove ${s.label}`}
                            onClick={() => setStages((xs) => xs.filter((_, j) => j !== i))}
                            className="p-1 rounded text-ink-400 hover:text-danger-500 disabled:opacity-25 disabled:hover:text-ink-400">
                      <X className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button type="button"
              onClick={() => setStages((xs) => {
                const next: PipelineStage = isSales
                  ? { key: '', label: '', probability: 50, outcome: 'open' }
                  : { key: '', label: '' };
                const at = isSales ? xs.findIndex((s) => s.outcome !== 'open') : -1;
                return at < 0 ? [...xs, next] : [...xs.slice(0, at), next, ...xs.slice(at)];
              })}
              className="mt-3 w-full rounded-lg border border-dashed border-ink-300 py-2.5 text-[12px] text-ink-500 hover:bg-ink-50">
        + Add stage
      </button>

      <div className="mt-5 rounded-lg border border-ink-200 bg-ink-50 px-4 py-3">
        <div className="text-[11px] font-bold text-ink-700">
          {cols > 0 && `What this editor enforces for ${pipeline.kind === 'sales' ? 'a sales pipeline' : 'an onboarding funnel'}`}
        </div>
        <ul className="mt-2 pl-4 list-disc text-[12px] text-ink-600 space-y-1 leading-relaxed">
          {isSales ? (
            <li>Exactly one won stage and one lost stage. They can be renamed and reordered,
                not removed — every report counts on them.</li>
          ) : (
            <li>Exactly one stage means onboarded. The scoreboard and the thread progress bars
                read it, so it cannot be left unset.</li>
          )}
          <li>A stage holding {pipeline.cardNoun} cannot be deleted, and renaming one never
              changes its key. Either would leave them on a stage that does not exist.</li>
          {isSales && (
            <li>Stuck is not a stage. A deal with nothing logged for fourteen days is badged on
                the board wherever it sits — nothing to configure, nothing to drag into.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
