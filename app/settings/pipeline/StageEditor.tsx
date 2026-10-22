'use client';

import { useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { saveStages } from './actions';
import type { Stage } from '@/lib/salesCrm';

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function StageEditor({ pipelineId, initial, counts }: {
  pipelineId: number;
  initial: Stage[];
  counts: Record<string, number>;
}) {
  const [stages, setStages] = useState<Stage[]>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const patch = (i: number, next: Partial<Stage>) =>
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
      const r = await saveStages({ pipelineId, stages });
      if (!r.ok) { setErr(r.error ?? 'Could not save'); return; }
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[15px] font-bold text-ink-900">Stages</h2>
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
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-ink-200 text-[10px] uppercase tracking-wide text-ink-400">
              <th scope="col" className="w-16 py-2" />
              <th scope="col" className="text-left font-medium py-2">Stage name</th>
              <th scope="col" className="text-left font-medium py-2 w-[130px]">Key</th>
              <th scope="col" className="text-right font-medium py-2 w-[90px]">Win %</th>
              <th scope="col" className="text-left font-medium py-2 w-[150px]">Outcome</th>
              <th scope="col" className="text-right font-medium py-2 w-[80px]">Deals</th>
              <th scope="col" className="w-10 py-2" />
            </tr>
          </thead>
          <tbody>
            {stages.map((s, i) => {
              const held = counts[s.key] ?? 0;
              const terminal = s.outcome !== 'open';
              return (
                <tr key={i} className={`border-b border-ink-100 ${terminal ? 'bg-ink-50/50' : ''}`}>
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
                             // Only a brand-new stage gets its key from the name;
                             // renaming an existing one must not orphan its deals.
                             key: held === 0 && !initial.some((x) => x.key === s.key)
                               ? slug(e.target.value) : s.key,
                           })}
                           className="w-full text-[13px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5" />
                  </td>
                  <td className="py-2 pr-3">
                    <code className="text-[12px] text-ink-500 font-mono">{s.key}</code>
                  </td>
                  <td className="py-2 pr-3">
                    <input inputMode="numeric" value={s.probability} aria-label="Win probability"
                           disabled={terminal}
                           onChange={(e) => patch(i, { probability: Number(e.target.value.replace(/\D/g, '') || 0) })}
                           className="w-full text-[13px] text-right rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 num disabled:opacity-50" />
                  </td>
                  <td className="py-2 pr-3">
                    {terminal ? (
                      <span className={`text-[11px] font-semibold ${s.outcome === 'won' ? 'text-success-600' : 'text-danger-500'}`}>
                        {s.outcome === 'won' ? 'won · links a store' : 'lost · asks why'}
                      </span>
                    ) : (
                      <span className="text-[12px] text-ink-400">open</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right text-[12px] text-ink-600 num">{held || '—'}</td>
                  <td className="py-2">
                    <button type="button" disabled={terminal || held > 0}
                            title={terminal ? 'Every report counts on this one'
                              : held > 0 ? `${held} deals are on this stage` : 'Remove'}
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
                const at = xs.findIndex((s) => s.outcome !== 'open');
                const next = { key: '', label: '', probability: 50, outcome: 'open' as const };
                return at < 0 ? [...xs, next] : [...xs.slice(0, at), next, ...xs.slice(at)];
              })}
              className="mt-3 w-full rounded-lg border border-dashed border-ink-300 py-2.5 text-[12px] text-ink-500 hover:bg-ink-50">
        + Add stage
      </button>
    </div>
  );
}
