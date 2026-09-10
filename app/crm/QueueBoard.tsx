'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Clock } from 'lucide-react';
import type { QueueRow, QueueFunnelStage, Thread, ThreadProvider, ChecklistItem, FunnelStage } from '@/lib/crm';
import { ProviderDrawer, type Team } from './ProviderDrawer';
import { moveStage, assignProvider, removeFromThread, addProvidersToThread } from './actions';

type Loaded = {
  thread: Thread;
  provider: ThreadProvider;
  stages: FunnelStage[];
  checklist: ChecklistItem[];
  team: Team;
  canWrite: boolean;
};

/**
 * A person's open work laid out as the funnel, not as a list.
 *
 * The thread board shows one campaign's providers by stage; this shows one
 * person's providers by stage across every campaign. Same shape, different
 * axis — so someone who has learned to read one can read the other.
 *
 * Within a column, longest-untouched first. That ordering is the whole reason
 * this view exists: the failure it guards against is forgetting something, and
 * a forgotten provider is an untouched one.
 *
 * Every stage gets a column, including the terminal ones. Hiding onboarded
 * here made this view disagree with the thread board about the same providers
 * — a stage reading 3 there and 0 here — which is worse than a column someone
 * has to scroll past.
 *
 * Cards open the provider's panel here, without leaving the page. Sending
 * someone to the thread first threw away the view they were working — the
 * person and stage they had filtered to — to show them one provider.
 */
export function QueueBoard({
  rows,
  stages,
  staleAfter,
  emptyLabel,
  otherThreads = [],
}: {
  rows: QueueRow[];
  stages: QueueFunnelStage[];
  staleAfter: number;
  emptyLabel: string;
  /** Live threads, so a card can be put on one without opening its board. */
  otherThreads?: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Selection lives on provider_id, not the thread-provider pair: adding the
  // same organisation to a campaign twice from two of its cards would be one
  // no-op and one insert, which is confusing to report.
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const togglePick = (id: number) =>
    setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const openProvider = async (r: QueueRow) => {
    setLoadingId(r.provider_id); setErr(null);
    try {
      const res = await fetch(`/api/crm/provider?thread=${r.thread_id}&provider=${r.provider_id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'Could not open that provider');
      setLoaded(body as Loaded);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoadingId(null);
    }
  };

  // The queue is server-rendered, so a change made in the panel has to come
  // back through the server for the board behind it to agree with the panel.
  const refresh = () => startTransition(() => router.refresh());

  if (!rows.length) {
    return <p className="px-5 py-10 text-sm text-ink-500 text-center">{emptyLabel}</p>;
  }

  const columns = stages;
  const byStage = new Map<string, QueueRow[]>();
  for (const r of rows) {
    const list = byStage.get(r.stage_key);
    if (list) list.push(r);
    else byStage.set(r.stage_key, [r]);
  }
  for (const list of byStage.values()) list.sort((a, b) => b.days_stale - a.days_stale);

  // A stage a provider sits in that no funnel declares would otherwise vanish
  // from the board without trace. Append it rather than drop the rows.
  const known = new Set(columns.map((c) => c.stage_key));
  const orphans = [...byStage.keys()].filter((k) => !known.has(k));

  return (
    <div className="overflow-x-auto px-5 pb-1">
      <div className="flex gap-3 min-w-min">
        {[...columns.map((c) => ({ key: c.stage_key, label: c.stage_label, win: c.is_success })),
          ...orphans.map((k) => ({ key: k, label: byStage.get(k)![0].stage_label, win: false }))]
          .map((col) => {
            const list = byStage.get(col.key) ?? [];
            const lost = !col.win && /stall|drop|lost|reject|dead/i.test(col.key + col.label);
            return (
              <div key={col.key} className="w-[260px] shrink-0">
                <div
                  className={`flex items-center justify-between px-2.5 py-2 rounded-t-md border ${
                    col.win ? 'bg-success-500/10 border-success-500/30'
                    : lost ? 'bg-danger-500/10 border-danger-500/30'
                    : 'bg-ink-100/60 border-ink-200'
                  }`}
                >
                  <span
                    className={`text-xs font-medium truncate ${
                      col.win ? 'text-success-600' : lost ? 'text-danger-500' : 'text-ink-700'
                    }`}
                    title={col.label}
                  >
                    {col.label}
                  </span>
                  <span className="text-xs num text-ink-500">{list.length}</span>
                </div>

                <div className="border border-t-0 border-ink-200 rounded-b-md p-2 space-y-2 min-h-[5rem] bg-surface">
                  {list.length === 0 ? (
                    <p className="text-center text-xs text-ink-300 py-5">—</p>
                  ) : (
                    list.map((r) => (
                      <div
                        key={`${r.thread_id}-${r.provider_id}`}
                        className={`relative rounded-md border bg-surface transition ${
                          picked.has(r.provider_id)
                            ? 'border-brand-500 ring-1 ring-brand-500/30'
                            : 'border-ink-200 hover:border-brand-400'
                        }`}
                      >
                      {otherThreads.length > 0 && (
                        // Outside the card button, so ticking never opens the drawer.
                        <label
                          className="absolute top-1.5 right-1.5 z-10 p-1 cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={picked.has(r.provider_id)}
                            onChange={() => togglePick(r.provider_id)}
                          />
                        </label>
                      )}
                      <button
                        type="button"
                        onClick={() => openProvider(r)}
                        className={`block w-full text-left px-2.5 py-2 ${
                          loadingId === r.provider_id ? 'opacity-60' : ''
                        }`}
                      >
                        <div className="text-sm font-medium text-ink-900 leading-snug">
                          {r.provider_name}
                        </div>
                        <div className="text-[11px] text-ink-500 mt-0.5">
                          {r.kind}{r.city ? ` · ${r.city}` : ''}
                        </div>
                        <div className="text-[11px] text-ink-600 mt-1.5 truncate" title={r.thread_name}>
                          {r.thread_name}
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[11px] text-ink-500 truncate">
                            {r.assignee_name ?? <span className="text-warn-600">unassigned</span>}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] tabular-nums shrink-0 ${
                              r.days_stale >= staleAfter * 2 ? 'text-danger-500 font-semibold'
                              : r.days_stale >= staleAfter ? 'text-warn-600 font-medium'
                              : 'text-ink-400'
                            }`}
                          >
                            <Clock className="w-3 h-3" />
                            {r.days_stale === 0 ? 'today' : `${r.days_stale}d`}
                          </span>
                        </div>
                      </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {otherThreads.length > 0 && picked.size > 0 && (
        <div className="sticky bottom-3 z-30 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/40 bg-surface shadow-lg px-3 py-2">
          <span className="text-[13px] font-semibold text-ink-900">{picked.size} selected</span>
          <select
            defaultValue=""
            disabled={pending}
            onChange={(e) => {
              const id = Number(e.target.value);
              e.target.value = '';
              if (!id) return;
              startTransition(async () => {
                setErr(null);
                const res = await addProvidersToThread({
                  providerIds: [...picked], threadId: id,
                });
                if (!res.ok) { setErr(res.error ?? 'Failed'); return; }
                const name = otherThreads.find((t) => t.id === id)?.name ?? 'thread';
                setBulkNote(res.already
                  ? `Added ${res.added} to ${name} · ${res.already} already there`
                  : `Added ${res.added} to ${name}`);
                setPicked(new Set());
                router.refresh();
              });
            }}
            className="h-8 px-2 text-[12px] rounded-md border border-ink-200 bg-surface"
          >
            <option value="" disabled>Add to thread…</option>
            {otherThreads.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {bulkNote && <span className="text-[12px] text-success-600">{bulkNote}</span>}
          <button
            onClick={() => { setPicked(new Set()); setBulkNote(null); }}
            className="ml-auto text-[12px] text-ink-500 hover:text-ink-900"
          >
            Clear
          </button>
        </div>
      )}

      {err && (
        <p className="mt-2 text-xs text-danger-500">{err}</p>
      )}

      {loaded && (
        <ProviderDrawer
          thread={loaded.thread}
          provider={loaded.provider}
          stages={loaded.stages}
          checklist={loaded.checklist}
          team={loaded.team}
          canWrite={loaded.canWrite}
          pending={pending}
          onClose={() => setLoaded(null)}
          onMove={(providerId, toStage, note) => {
            startTransition(async () => {
              const res = await moveStage({ threadId: loaded.thread.id, providerId, toStage, note });
              if (!res.ok) { setErr(res.error ?? 'Move failed'); return; }
              setLoaded((l) => (l ? { ...l, provider: { ...l.provider, stage_key: toStage } } : l));
              router.refresh();
            });
          }}
          onAssign={(providerId, assigneeId) => {
            startTransition(async () => {
              const res = await assignProvider({ threadId: loaded.thread.id, providerId, assigneeId });
              if (!res.ok) { setErr(res.error ?? 'Assign failed'); return; }
              const name = loaded.team.find((t) => t.id === assigneeId)?.name ?? null;
              setLoaded((l) => (l ? { ...l, provider: { ...l.provider, assignee_id: assigneeId, assignee_name: name } } : l));
              router.refresh();
            });
          }}
          onRemove={(providerId) => {
            startTransition(async () => {
              const res = await removeFromThread({ threadId: loaded.thread.id, providerId });
              if (!res.ok) { setErr(res.error ?? 'Remove failed'); return; }
              setLoaded(null);
              router.refresh();
            });
          }}
          onPatch={(providerId, patch) => {
            setLoaded((l) => (l ? { ...l, provider: { ...l.provider, ...patch } } : l));
            refresh();
          }}
          otherThreads={otherThreads}
          onNoteAdded={refresh}
        />
      )}
    </div>
  );
}
