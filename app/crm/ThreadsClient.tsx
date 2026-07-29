'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Plus, Target, ChevronRight } from 'lucide-react';
import { createThread, setThreadStatus } from './actions';
import type { Thread, Funnel } from '@/lib/crm';

export function ThreadsClient({ threads, funnels, canWrite }: {
  threads: Thread[]; funnels: Funnel[]; canWrite: boolean;
}) {
  const [showCreate, setShowCreate] = useState(false);
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

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="rounded-2xl border border-ink-200 bg-surface p-4">
          {!showCreate ? (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-semibold rounded-md bg-ink-900 text-ink-50 hover:bg-ink-800 transition"
            >
              <Plus className="w-4 h-4" /> New thread
            </button>
          ) : (
            <div className="space-y-3">
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
                  {['LAB','HOSPITAL','DOCTOR','PHLEBO','OTHER'].map((k) => <option key={k}>{k}</option>)}
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
      )}

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
                  <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded border shrink-0 ${
                    t.status === 'active' ? 'bg-success-50 text-success-600 border-success-100'
                    : t.status === 'done' ? 'bg-brand-50 text-brand-700 dark:text-brand-400 border-brand-100'
                    : 'bg-ink-100 text-ink-500 border-ink-200'
                  }`}>
                    {t.status}
                  </span>
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
                <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
                  <div className="h-full bg-success-500 transition-all" style={{ width: `${pct}%` }} />
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
    </div>
  );
}
