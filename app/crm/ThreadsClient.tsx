'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Plus, Target, ChevronRight, Settings2, X } from 'lucide-react';
import { createThread, createFunnel, updateThread, setFunnelSuccessStage } from './actions';
import type { Thread, Funnel } from '@/lib/crm';

export function ThreadsClient({ threads, funnels, canWrite, isAdmin }: {
  threads: Thread[]; funnels: Funnel[]; canWrite: boolean; isAdmin: boolean;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [showFunnels, setShowFunnels] = useState(false);
  const [form, setForm] = useState({
    name: '', description: '', funnelId: funnels[0]?.id ?? 0,
    targetCount: 50, providerKind: 'LAB', region: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const res = await createThread(form);
      if (!res.ok) { setErr(res.error ?? 'Failed'); return; }
      window.location.href = `/crm/${res.id}`;
    });
  };

  const setStatus = (threadId: number, status: 'active' | 'paused' | 'done') => {
    startTransition(async () => {
      const res = await updateThread({ threadId, fields: { status } });
      if (!res.ok) { setErr(res.error ?? 'Failed'); return; }
      window.location.reload();
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-ink-200 bg-surface p-4">
        <div className="flex flex-wrap gap-2">
          {canWrite && !showCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-semibold rounded-md bg-ink-900 text-ink-50 hover:bg-ink-800 transition"
            >
              <Plus className="w-4 h-4" /> New thread
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowFunnels(true)}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50 transition"
            >
              <Settings2 className="w-4 h-4" /> Manage funnels ({funnels.length})
            </button>
          )}
        </div>

        {showCreate && (
          <div className="space-y-3 mt-3">
            <div className="grid sm:grid-cols-2 gap-2">
              <input
                type="text" placeholder="Thread name — e.g. Pune labs Q3" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface sm:col-span-2"
              />
              <input
                type="text" placeholder="Description (optional)" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface sm:col-span-2"
              />
              <label className="flex items-center gap-2 text-xs text-ink-600">
                Target
                <input
                  type="number" min={0} value={form.targetCount}
                  onChange={(e) => setForm({ ...form, targetCount: +e.target.value || 0 })}
                  className="h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface w-24 tabular-nums"
                />
                providers
              </label>
              <select
                value={form.providerKind}
                onChange={(e) => setForm({ ...form, providerKind: e.target.value })}
                className="h-9 px-2 text-sm rounded-md border border-ink-200 bg-surface"
              >
                {['LAB','DIAGNOSTICS','HOSPITAL','DOCTOR','PHLEBO','OTHER'].map((k) => <option key={k}>{k}</option>)}
              </select>
              <input
                type="text" placeholder="Region (e.g. Pune)" value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                className="h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface"
              />
              <select
                value={form.funnelId}
                onChange={(e) => setForm({ ...form, funnelId: +e.target.value })}
                className="h-9 px-2 text-sm rounded-md border border-ink-200 bg-surface"
              >
                {funnels.map((f) => (
                  <option key={f.id} value={f.id}>{f.name} ({f.stages.length} stages)</option>
                ))}
              </select>
            </div>
            {err && <p className="text-sm text-danger-500">{err}</p>}
            <div className="flex gap-2">
              <button
                onClick={submit} disabled={pending}
                className="px-4 h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 transition disabled:opacity-40"
              >
                {pending ? 'Creating…' : 'Create thread'}
              </button>
              <button onClick={() => setShowCreate(false)} className="px-3 h-9 text-sm rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {threads.length === 0 ? (
        <div className="rounded-2xl border border-ink-200 bg-surface p-12 text-center text-sm text-ink-500">
          No threads yet. Create the first campaign — e.g. “Onboard 50 labs in Pune”.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {threads.map((t) => {
            const pct = t.target_count > 0 ? Math.min(100, Math.round(100 * t.onboarded_count / t.target_count)) : 0;
            return (
              <Link
                key={t.id}
                href={`/crm/${t.id}`}
                className="rounded-2xl border border-ink-200 bg-surface p-4 hover:border-brand-400 transition group"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="font-semibold text-ink-900 text-[15px] group-hover:text-brand-700 dark:group-hover:text-brand-400 transition">
                    {t.name}
                  </div>
                  {canWrite ? (
                    <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                      <select
                        value={t.status}
                        onChange={(e) => setStatus(t.id, e.target.value as 'active' | 'paused' | 'done')}
                        className={`text-[10px] uppercase font-semibold px-1 py-0.5 rounded border cursor-pointer ${
                          t.status === 'active' ? 'bg-success-50 text-success-600 border-success-100'
                          : t.status === 'done' ? 'bg-brand-50 text-brand-700 dark:text-brand-400 border-brand-100'
                          : 'bg-ink-100 text-ink-500 border-ink-200'
                        }`}
                      >
                        <option value="active">active</option>
                        <option value="paused">paused</option>
                        <option value="done">done</option>
                      </select>
                    </span>
                  ) : (
                    <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded border shrink-0 ${
                      t.status === 'active' ? 'bg-success-50 text-success-600 border-success-100'
                      : t.status === 'done' ? 'bg-brand-50 text-brand-700 dark:text-brand-400 border-brand-100'
                      : 'bg-ink-100 text-ink-500 border-ink-200'
                    }`}>
                      {t.status}
                    </span>
                  )}
                </div>
                {t.description && <p className="text-[12px] text-ink-600 mb-2 line-clamp-2">{t.description}</p>}
                <div className="flex items-center gap-3 text-[12px] text-ink-600 mb-2">
                  <span className="inline-flex items-center gap-1">
                    <Target className="w-3.5 h-3.5" />
                    {t.onboarded_count}/{t.target_count || '∞'} onboarded
                  </span>
                  <span>{t.provider_total} in pipeline</span>
                  {t.region && <span>· {t.region}</span>}
                  {t.provider_kind && <span>· {t.provider_kind}</span>}
                </div>
                <div className="flex h-1.5 rounded-full bg-ink-100 overflow-hidden" title={`${pct}% of target`}>
                  {t.provider_total > 0 ? t.stages.map((s) => {
                    const n = t.stage_counts?.[s.key] ?? 0;
                    if (!n) return null;
                    const isWin = s.key === t.success_stage_key;
                    const isLost = !isWin && /stall|drop|lost|reject|dead/i.test(s.key + s.label);
                    return (
                      <div
                        key={s.key}
                        title={`${s.label}: ${n}`}
                        style={{ width: `${(n / t.provider_total) * 100}%` }}
                        className={isWin ? 'bg-success-500' : isLost ? 'bg-danger-500' : 'bg-brand-500'}
                      />
                    );
                  }) : null}
                </div>
                <div className="mt-2 text-[11px] text-ink-400 flex items-center justify-between">
                  <span>{t.stages.length}-stage funnel</span>
                  <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {showFunnels && <FunnelManager funnels={funnels} onClose={() => setShowFunnels(false)} />}
    </div>
  );
}

function FunnelManager({ funnels, onClose }: { funnels: Funnel[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [stages, setStages] = useState<string[]>(['Identified', 'Contacted', 'Onboarded']);
  const [successIndex, setSuccessIndex] = useState<number | null>(2);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!name.trim()) { setErr('Funnel name is required'); return; }
    const filled = stages.filter((s) => s.trim());
    if (filled.length < 2) { setErr('A funnel needs at least 2 stages'); return; }
    setErr(null);
    startTransition(async () => {
      const res = await createFunnel({
        name,
        stages: filled.map((label) => ({ key: '', label })),
        successIndex: successIndex ?? undefined,
      });
      if (!res.ok) { setErr(res.error ?? 'Failed'); return; }
      window.location.reload();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-surface p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-bold text-ink-900">Funnels</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-900"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-2 mb-4">
          {funnels.map((f) => (
            <div key={f.id} className="rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2">
              <div className="text-[13px] font-medium text-ink-900">
                {f.name} {f.is_default && <span className="text-[10px] text-ink-500">(default)</span>}
              </div>
              <div className="text-[11px] text-ink-500 mt-0.5">
                {f.stages.map((s) => s.label).join(' → ')}
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-ink-600 mt-1.5">
                Counts as onboarded:
                <select
                  value={f.success_stage_key ?? ''}
                  onChange={(e) => startTransition(async () => {
                    const res = await setFunnelSuccessStage({ funnelId: f.id, stageKey: e.target.value });
                    if (!res.ok) { setErr(res.error ?? 'Failed'); return; }
                    window.location.reload();
                  })}
                  className="text-[11px] px-1.5 py-0.5 rounded border border-success-100 bg-success-50 text-success-600 font-semibold"
                >
                  {f.stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
            </div>
          ))}
        </div>

        <div className="border-t border-ink-200 pt-3">
          <div className="text-[12px] font-semibold text-ink-700 mb-2">Create funnel</div>
          <input
            type="text" placeholder="Funnel name — e.g. Hospital onboarding" value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            className={`w-full h-9 px-3 text-sm rounded-md border bg-surface mb-2 ${
              name.trim() ? 'border-ink-200' : 'border-warn-100 focus:border-brand-500'
            }`}
          />
          <div className="space-y-1.5 mb-2">
            {stages.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="text-[11px] text-ink-400 tabular-nums w-4">{i + 1}.</span>
                <input
                  type="text" value={s} placeholder={`Stage ${i + 1}`}
                  onChange={(e) => setStages(stages.map((x, j) => (j === i ? e.target.value : x)))}
                  className="flex-1 h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface"
                />
                <label
                  title="Mark as the onboarded / success stage"
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-1 rounded border cursor-pointer transition ${
                    successIndex === i
                      ? 'bg-success-50 text-success-600 border-success-100'
                      : 'bg-surface text-ink-400 border-ink-200 hover:text-ink-700'
                  }`}
                >
                  <input
                    type="radio" name="successStage" checked={successIndex === i}
                    onChange={() => setSuccessIndex(i)} className="w-3 h-3"
                  />
                  win
                </label>
                <button
                  onClick={() => {
                    setStages(stages.filter((_, j) => j !== i));
                    if (successIndex === i) setSuccessIndex(null);
                    else if (successIndex != null && successIndex > i) setSuccessIndex(successIndex - 1);
                  }}
                  disabled={stages.length <= 2}
                  className="text-ink-400 hover:text-danger-500 disabled:opacity-30 p-1"
                  aria-label="Remove stage"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setStages([...stages, ''])}
            className="text-[12px] font-medium text-brand-700 dark:text-brand-400 hover:underline mb-3"
          >
            + Add stage
          </button>
          {err && <p className="text-sm text-danger-500 mb-2">{err}</p>}
          {!name.trim() && (
            <p className="text-[12px] text-warn-600 mb-2">Give the funnel a name to save it.</p>
          )}
          <button
            onClick={submit} disabled={pending}
            className="w-full h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 transition"
          >
            {pending ? 'Creating…' : 'Create funnel'}
          </button>
          <p className="text-[11px] text-ink-500 mt-2">
            Mark one stage “win” — reaching it counts a provider as onboarded.
            It doesn’t have to be the last stage. Existing threads keep their funnel.
          </p>
        </div>
      </div>
    </div>
  );
}
