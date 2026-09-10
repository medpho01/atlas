'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Plus, Target, ChevronRight, Settings2, X } from 'lucide-react';
import { createThread, createFunnel, updateThread, setFunnelSuccessStage,
         renameThread, setThreadMembers, deleteThread } from './actions';
import type { Thread, Funnel, ThreadMember } from '@/lib/crm';
import { PROVIDER_KINDS } from '@/lib/providerKinds';

function CardAction({ onClick, danger, children }: {
  onClick: () => void; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[12px] rounded-md border px-2 py-1 transition ${
        danger
          ? 'border-danger-500/30 text-danger-500 hover:bg-danger-500/10'
          : 'border-ink-200 text-ink-700 hover:bg-ink-100'
      }`}
    >
      {children}
    </button>
  );
}

export function ThreadsClient({ threads, funnels, canWrite, isAdmin, members, team }: {
  threads: Thread[]; funnels: Funnel[]; canWrite: boolean; isAdmin: boolean;
  members: ThreadMember[];
  team: { id: number; name: string; role: string }[];
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [showFunnels, setShowFunnels] = useState(false);
  const [renaming, setRenaming] = useState<Thread | null>(null);
  const [assigning, setAssigning] = useState<Thread | null>(null);
  const [deleting, setDeleting] = useState<Thread | null>(null);

  const membersByThread = useMemo(() => {
    const m = new Map<number, ThreadMember[]>();
    for (const r of members) {
      if (!m.has(r.thread_id)) m.set(r.thread_id, []);
      m.get(r.thread_id)!.push(r);
    }
    return m;
  }, [members]);
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
      // Stay here. Creating a thread is usually one of several things being
      // done in a sitting — name it, staff it, maybe create the next one — and
      // being thrown onto an empty board meant navigating back every time.
      // The new thread appears in the list below with its own controls.
      window.location.reload();
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
          {isAdmin && !showCreate && (
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
                {PROVIDER_KINDS.map((k) => <option key={k}>{k}</option>)}
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
              /* Not a link any more. Clicking a card used to drop you into
                 the Kanban board, which is the wrong default here: this tab is
                 where you manage the campaign — its name, its people, whether
                 it is running — and the board is one action among several. */
              <div
                key={t.id}
                className="rounded-2xl border border-ink-200 bg-surface p-4 transition"
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
                <div className="mt-2 text-[11px] text-ink-400">
                  {t.stages.length}-stage funnel
                </div>

                {/* Who is on it. Membership is the thread's own roster, not a
                    roll-up of who happens to hold a card today. */}
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-ink-400 mr-0.5">People</span>
                  {(membersByThread.get(t.id) ?? []).map((m) => (
                    <span key={m.user_id}
                          className="text-[11px] rounded-full bg-ink-100 text-ink-700 px-2 py-0.5">
                      {m.name}
                    </span>
                  ))}
                  {!(membersByThread.get(t.id) ?? []).length && (
                    <span className="text-[11px] text-ink-400">Nobody assigned</span>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-ink-100 flex flex-wrap items-center gap-1.5">
                  <Link href={`/crm/${t.id}`}
                        className="text-[12px] font-medium text-brand-600 hover:text-brand-700 mr-auto inline-flex items-center gap-0.5">
                    Open board <ChevronRight className="w-3 h-3" />
                  </Link>
                  {canWrite && (
                    <>
                      <CardAction onClick={() => setRenaming(t)}>Rename</CardAction>
                      <CardAction onClick={() => setAssigning(t)}>Assign people</CardAction>
                      <CardAction onClick={() => setStatus(t.id, t.status === 'paused' ? 'active' : 'paused')}>
                        {t.status === 'paused' ? 'Resume' : 'Pause'}
                      </CardAction>
                      {t.status !== 'done' && (
                        <CardAction onClick={() => setStatus(t.id, 'done')}>Complete</CardAction>
                      )}
                      {isAdmin && (
                        <CardAction danger onClick={() => setDeleting(t)}>Delete</CardAction>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showFunnels && <FunnelManager funnels={funnels} onClose={() => setShowFunnels(false)} />}
      {renaming && (
        <RenameThread thread={renaming} onClose={() => setRenaming(null)} />
      )}
      {assigning && (
        <AssignPeople
          thread={assigning}
          team={team}
          current={(membersByThread.get(assigning.id) ?? []).map((m) => m.user_id)}
          onClose={() => setAssigning(null)}
        />
      )}
      {deleting && (
        <DeleteThread
          thread={deleting}
          others={threads.filter((t) => t.id !== deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
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


/** Small modal shell — the three thread dialogs share it. */
function Dialog({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-surface p-5"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-bold text-ink-900">{title}</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-900"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RenameThread({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  const [name, setName] = useState(thread.name);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog title="Rename thread" onClose={onClose}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface"
      />
      {err && <p className="text-sm text-danger-500 mt-2">{err}</p>}
      <div className="flex gap-2 mt-3">
        <button
          disabled={pending || !name.trim()}
          onClick={() => start(async () => {
            const r = await renameThread({ threadId: thread.id, name });
            if (!r.ok) { setErr(r.error ?? 'Failed'); return; }
            onClose(); window.location.reload();
          })}
          className="px-4 h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onClose} className="px-3 h-9 text-sm rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50">
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

/**
 * A thread can have any number of people on it — that is the point of a
 * roster, and a campaign is rarely one person's job.
 */
function AssignPeople({ thread, team, current, onClose }: {
  thread: Thread; team: { id: number; name: string; role: string }[];
  current: number[]; onClose: () => void;
}) {
  const [picked, setPicked] = useState<number[]>(current);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Dialog title={`People on ${thread.name}`} onClose={onClose}>
      <div className="max-h-72 overflow-y-auto space-y-1">
        {team.map((t) => (
          <label key={t.id}
                 className="flex items-center gap-2 text-sm rounded-md px-2 py-1.5 hover:bg-ink-100 cursor-pointer">
            <input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />
            <span className="text-ink-900">{t.name}</span>
            <span className="ml-auto text-[11px] text-ink-400">{t.role}</span>
          </label>
        ))}
        {!team.length && <p className="text-sm text-ink-500 p-2">No network users yet.</p>}
      </div>
      {err && <p className="text-sm text-danger-500 mt-2">{err}</p>}
      <div className="flex gap-2 mt-3">
        <button
          disabled={pending}
          onClick={() => start(async () => {
            const r = await setThreadMembers({ threadId: thread.id, userIds: picked });
            if (!r.ok) { setErr(r.error ?? 'Failed'); return; }
            onClose(); window.location.reload();
          })}
          className="px-4 h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
        >
          {pending ? 'Saving…' : `Save ${picked.length} ${picked.length === 1 ? 'person' : 'people'}`}
        </button>
        <button onClick={onClose} className="px-3 h-9 text-sm rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50">
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Deleting takes the thread's cards with it, so the first question is where
 * the providers should go. Moving them is the default; dropping them is a
 * deliberate second choice.
 */
function DeleteThread({ thread, others, onClose }: {
  thread: Thread; others: Thread[]; onClose: () => void;
}) {
  const [target, setTarget] = useState<number | ''>(others[0]?.id ?? '');
  const [drop, setDrop] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog title={`Delete ${thread.name}`} onClose={onClose}>
      <p className="text-sm text-ink-600 mb-3">
        {thread.provider_total} provider{thread.provider_total === 1 ? '' : 's'} are on this thread.
        The provider records are shared and are never deleted — only their place on this campaign.
      </p>

      {others.length > 0 && (
        <label className="flex items-start gap-2 text-sm mb-2">
          <input type="radio" checked={!drop} onChange={() => setDrop(false)} className="mt-1" />
          <span className="flex-1">
            Move them to
            <select
              value={target}
              onChange={(e) => { setTarget(Number(e.target.value)); setDrop(false); }}
              className="ml-2 h-8 px-2 text-sm rounded-md border border-ink-200 bg-surface"
            >
              {others.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <span className="block text-[11px] text-ink-500 mt-1">
              Stages carry across where the target funnel has the same stage, otherwise they start
              at the beginning — guessing an equivalent stage between two funnels would quietly move
              someone&rsquo;s work.
            </span>
          </span>
        </label>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input type="radio" checked={drop} onChange={() => setDrop(true)} className="mt-1" />
        <span>
          Just delete the thread
          <span className="block text-[11px] text-ink-500">
            The providers stay in the directory but lose their stage on this campaign.
          </span>
        </span>
      </label>

      {err && <p className="text-sm text-danger-500 mt-2">{err}</p>}
      <div className="flex gap-2 mt-4">
        <button
          disabled={pending}
          onClick={() => start(async () => {
            const r = await deleteThread({
              threadId: thread.id,
              reassignToThreadId: drop ? null : (target === '' ? null : Number(target)),
            });
            if (!r.ok) { setErr(r.error ?? 'Failed'); return; }
            onClose(); window.location.reload();
          })}
          className="px-4 h-9 text-sm font-semibold rounded-md bg-danger-500 text-white hover:opacity-90 disabled:opacity-40"
        >
          {pending ? 'Deleting…' : 'Delete thread'}
        </button>
        <button onClick={onClose} className="px-3 h-9 text-sm rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50">
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
