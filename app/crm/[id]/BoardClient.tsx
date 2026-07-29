'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  Plus, X, User as UserIcon, FileText, Upload, CheckCircle2, Circle,
  ArrowRight, StickyNote, Clock, Phone, Mail, MapPin,
} from 'lucide-react';
import { createProvider, moveStage, assignProvider, addNote } from '../actions';
import type { Thread, ThreadProvider, ChecklistItem, ProviderDoc, Activity, FunnelStage } from '@/lib/crm';

type Team = { id: number; name: string; role: string }[];

export function BoardClient({
  thread, initialProviders, checklist, team, canWrite, myId,
}: {
  thread: Thread;
  initialProviders: ThreadProvider[];
  checklist: ChecklistItem[];
  team: Team;
  canWrite: boolean;
  myId: number;
}) {
  const [providers, setProviders] = useState(initialProviders);
  const [openId, setOpenId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState<number | 'all' | 'mine'>('all');
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const stages: FunnelStage[] = thread.stages;
  const open = providers.find((p) => p.id === openId) ?? null;

  const filtered = useMemo(() => {
    if (assigneeFilter === 'all') return providers;
    const target = assigneeFilter === 'mine' ? myId : assigneeFilter;
    return providers.filter((p) => p.assignee_id === target);
  }, [providers, assigneeFilter, myId]);

  const byStage = useMemo(() => {
    const m = new Map<string, ThreadProvider[]>();
    stages.forEach((s) => m.set(s.key, []));
    filtered.forEach((p) => {
      if (!m.has(p.stage_key)) m.set(p.stage_key, []);
      m.get(p.stage_key)!.push(p);
    });
    return m;
  }, [filtered, stages]);

  const doMove = (providerId: number, toStage: string, note?: string) => {
    startTransition(async () => {
      const res = await moveStage({ threadId: thread.id, providerId, toStage, note });
      if (!res.ok) { setErr(res.error ?? 'Move failed'); return; }
      setProviders((ps) => ps.map((p) => (p.id === providerId ? { ...p, stage_key: toStage } : p)));
    });
  };

  const doAssign = (providerId: number, assigneeId: number | null) => {
    startTransition(async () => {
      const res = await assignProvider({ threadId: thread.id, providerId, assigneeId });
      if (!res.ok) { setErr(res.error ?? 'Assign failed'); return; }
      const name = team.find((t) => t.id === assigneeId)?.name ?? null;
      setProviders((ps) => ps.map((p) => (p.id === providerId ? { ...p, assignee_id: assigneeId, assignee_name: name } : p)));
    });
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {canWrite && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-3 h-8 text-[13px] font-semibold rounded-md bg-ink-900 text-ink-50 hover:bg-ink-800 transition"
          >
            <Plus className="w-3.5 h-3.5" /> Add provider
          </button>
        )}
        <select
          value={String(assigneeFilter)}
          onChange={(e) => {
            const v = e.target.value;
            setAssigneeFilter(v === 'all' ? 'all' : v === 'mine' ? 'mine' : +v);
          }}
          className="h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface"
        >
          <option value="all">Everyone's providers</option>
          <option value="mine">Assigned to me</option>
          {team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {err && <span className="text-[12px] text-danger-500">{err}</span>}
        <span className="ml-auto text-[12px] text-ink-500">{filtered.length} providers shown</span>
      </div>

      {/* Board */}
      <div className="flex gap-3 overflow-x-auto pb-4 items-start">
        {stages.map((s) => {
          const cards = byStage.get(s.key) ?? [];
          const isTerminalGood = s.key === 'onboarded';
          const isTerminalBad = s.key === 'dropped';
          return (
            <div key={s.key} className="w-[260px] shrink-0">
              <div className={`px-3 py-2 rounded-t-xl border border-b-0 text-[12px] font-semibold flex items-center justify-between ${
                isTerminalGood ? 'bg-success-50 text-success-600 border-success-100'
                : isTerminalBad ? 'bg-danger-50 text-danger-500 border-danger-100'
                : 'bg-ink-50 text-ink-700 border-ink-200'
              }`}>
                {s.label}
                <span className="tabular-nums font-bold">{cards.length}</span>
              </div>
              <div className="border border-ink-200 rounded-b-xl bg-ink-50/40 p-2 space-y-2 min-h-[120px]">
                {cards.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setOpenId(p.id)}
                    className="w-full text-left rounded-lg border border-ink-200 bg-surface p-2.5 hover:border-brand-400 transition"
                  >
                    <div className="text-[13px] font-medium text-ink-900 leading-tight">{p.name}</div>
                    <div className="text-[11px] text-ink-500 mt-0.5">
                      {p.kind}{p.city ? ` · ${p.city}` : ''}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-ink-500">
                      <span className={`inline-flex items-center gap-0.5 ${p.assignee_name ? 'text-brand-700 dark:text-brand-400 font-medium' : ''}`}>
                        <UserIcon className="w-3 h-3" /> {p.assignee_name ?? 'unassigned'}
                      </span>
                      {p.docs_count > 0 && (
                        <span className="inline-flex items-center gap-0.5">
                          <FileText className="w-3 h-3" /> {p.docs_count}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
                {cards.length === 0 && (
                  <div className="text-[11px] text-ink-400 text-center py-4">—</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Drawer */}
      {open && (
        <ProviderDrawer
          key={open.id}
          thread={thread}
          provider={open}
          stages={stages}
          checklist={checklist}
          team={team}
          canWrite={canWrite}
          pending={pending}
          onClose={() => setOpenId(null)}
          onMove={doMove}
          onAssign={doAssign}
          onNoteAdded={() => {}}
        />
      )}

      {/* Add provider modal */}
      {showAdd && (
        <AddProviderModal
          threadId={thread.id}
          defaultKind={thread.provider_kind ?? 'LAB'}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- drawer */

function ProviderDrawer({
  thread, provider, stages, checklist, team, canWrite, pending, onClose, onMove, onAssign,
}: {
  thread: Thread;
  provider: ThreadProvider;
  stages: FunnelStage[];
  checklist: ChecklistItem[];
  team: Team;
  canWrite: boolean;
  pending: boolean;
  onClose: () => void;
  onMove: (providerId: number, toStage: string, note?: string) => void;
  onAssign: (providerId: number, assigneeId: number | null) => void;
  onNoteAdded: () => void;
}) {
  const [tab, setTab] = useState<'journey' | 'docs'>('journey');
  const [note, setNote] = useState('');
  const [moveTo, setMoveTo] = useState(provider.stage_key);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [docs, setDocs] = useState<ProviderDoc[] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadActivities = async () => {
    const r = await fetch(`/api/crm/activities?provider=${provider.id}&thread=${thread.id}`);
    const d = await r.json();
    setActivities(d.activities ?? []);
  };
  const loadDocs = async () => {
    const r = await fetch(`/api/crm/docs?provider=${provider.id}`);
    const d = await r.json();
    setDocs(d.docs ?? []);
  };
  // Lazy-load on first open of each tab
  if (activities === null && tab === 'journey') loadActivities();
  if (docs === null && tab === 'docs') loadDocs();

  const submitNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      const res = await addNote({ threadId: thread.id, providerId: provider.id, body: note });
      if (res.ok) { setNote(''); await loadActivities(); }
    } finally { setBusy(false); }
  };

  const submitMove = () => {
    if (moveTo === provider.stage_key) return;
    onMove(provider.id, moveTo, note.trim() || undefined);
    setNote('');
    setTimeout(loadActivities, 600);
  };

  const uploadDoc = async (file: File, checklistItemId: number | null) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('provider_id', String(provider.id));
      fd.set('thread_id', String(thread.id));
      if (checklistItemId != null) fd.set('checklist_item_id', String(checklistItemId));
      const r = await fetch('/api/crm/upload', { method: 'POST', body: fd });
      if (r.ok) await loadDocs();
    } finally { setBusy(false); }
  };

  const stageLabel = (key: string) => stages.find((s) => s.key === key)?.label ?? key;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-lg h-full bg-surface border-l border-ink-200 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-surface border-b border-ink-200 px-5 py-3 flex items-start justify-between gap-3 z-10">
          <div>
            <div className="text-[15px] font-bold text-ink-900">{provider.name}</div>
            <div className="text-[12px] text-ink-500 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
              <span>{provider.kind}</span>
              {provider.city && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{provider.city}{provider.pincode ? ` ${provider.pincode}` : ''}</span>}
              {provider.phone && <a href={`tel:${provider.phone}`} className="inline-flex items-center gap-1 text-brand-700 dark:text-brand-400"><Phone className="w-3 h-3" />{provider.phone}</a>}
              {provider.email && <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />{provider.email}</span>}
              {provider.contact_person && <span>· {provider.contact_person}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-900 p-1"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Stage + assignee controls */}
          {canWrite && (
            <div className="rounded-xl border border-ink-200 bg-ink-50 p-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold w-16">Stage</span>
                <select
                  value={moveTo}
                  onChange={(e) => setMoveTo(e.target.value)}
                  className="flex-1 h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface font-medium"
                >
                  {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <button
                  onClick={submitMove}
                  disabled={pending || moveTo === provider.stage_key}
                  className="inline-flex items-center gap-1 px-2.5 h-8 text-[12px] font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 transition"
                >
                  Move <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold w-16">Owner</span>
                <select
                  value={provider.assignee_id ?? ''}
                  onChange={(e) => onAssign(provider.id, e.target.value ? +e.target.value : null)}
                  className="flex-1 h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface"
                >
                  <option value="">Unassigned</option>
                  {team.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}
                </select>
              </div>
              <div className="flex items-start gap-2">
                <StickyNote className="w-4 h-4 text-ink-400 mt-2" />
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note — attached to the move, or post standalone"
                  rows={2}
                  className="flex-1 text-[13px] rounded-md border border-ink-200 bg-surface p-2"
                />
                <button
                  onClick={submitNote}
                  disabled={busy || !note.trim()}
                  className="px-2.5 h-8 text-[12px] font-semibold rounded-md border border-ink-200 text-ink-700 hover:bg-ink-100 disabled:opacity-40 transition self-end"
                >
                  Post
                </button>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 border-b border-ink-200">
            {(['journey', 'docs'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 text-[13px] font-medium border-b-2 -mb-px transition ${
                  tab === t ? 'border-brand-600 text-brand-700 dark:text-brand-400' : 'border-transparent text-ink-500 hover:text-ink-900'
                }`}
              >
                {t === 'journey' ? 'Journey' : `Documents (${provider.docs_count})`}
              </button>
            ))}
          </div>

          {tab === 'journey' && (
            <div className="space-y-3">
              {activities === null ? (
                <p className="text-[13px] text-ink-500">Loading…</p>
              ) : activities.length === 0 ? (
                <p className="text-[13px] text-ink-500">No activity yet.</p>
              ) : (
                activities.map((a) => (
                  <div key={a.id} className="flex gap-2.5">
                    <div className="mt-1 shrink-0">
                      {a.type === 'stage_change' ? <ArrowRight className="w-3.5 h-3.5 text-brand-600" />
                        : a.type === 'note' ? <StickyNote className="w-3.5 h-3.5 text-warn-600" />
                        : a.type === 'doc_upload' ? <FileText className="w-3.5 h-3.5 text-success-600" />
                        : <Clock className="w-3.5 h-3.5 text-ink-400" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] text-ink-800">
                        {a.type === 'stage_change' && a.meta && (
                          <span className="font-medium">
                            {stageLabel(String((a.meta as Record<string, unknown>).from))} → {stageLabel(String((a.meta as Record<string, unknown>).to))}
                          </span>
                        )}
                        {a.body && <span>{a.type === 'stage_change' ? ' — ' : ''}{a.body}</span>}
                      </div>
                      <div className="text-[11px] text-ink-400">
                        {a.author_name ?? 'system'} · {new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'docs' && (
            <div className="space-y-2">
              {checklist.map((item) => {
                const uploaded = (docs ?? []).filter((d) => d.checklist_item_id === item.id);
                const done = uploaded.length > 0;
                return (
                  <div key={item.id} className="rounded-lg border border-ink-200 bg-surface px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {done
                          ? <CheckCircle2 className="w-4 h-4 text-success-600 shrink-0" />
                          : <Circle className={`w-4 h-4 shrink-0 ${item.required ? 'text-danger-500' : 'text-ink-300'}`} />}
                        <span className="text-[13px] text-ink-800 truncate">{item.label}</span>
                        {item.required && !done && <span className="text-[9px] uppercase font-semibold text-danger-500">required</span>}
                      </div>
                      {canWrite && (
                        <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 dark:text-brand-400 cursor-pointer hover:underline shrink-0">
                          <Upload className="w-3 h-3" /> Upload
                          <input
                            type="file" className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadDoc(f, item.id);
                              e.currentTarget.value = '';
                            }}
                          />
                        </label>
                      )}
                    </div>
                    {uploaded.map((d) => (
                      <a
                        key={d.id}
                        href={`/api/crm/file/${d.id}`}
                        className="block mt-1.5 ml-6 text-[12px] text-brand-700 dark:text-brand-400 hover:underline truncate"
                      >
                        {d.filename}
                        <span className="text-ink-400"> · {d.uploaded_by_name ?? '—'} · {new Date(d.uploaded_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                      </a>
                    ))}
                  </div>
                );
              })}
              {/* Other docs, not tied to checklist */}
              {(docs ?? []).filter((d) => d.checklist_item_id == null).length > 0 && (
                <div className="rounded-lg border border-ink-200 bg-surface px-3 py-2.5">
                  <div className="text-[12px] font-semibold text-ink-700 mb-1">Other documents</div>
                  {(docs ?? []).filter((d) => d.checklist_item_id == null).map((d) => (
                    <a key={d.id} href={`/api/crm/file/${d.id}`} className="block text-[12px] text-brand-700 dark:text-brand-400 hover:underline truncate">
                      {d.filename}
                    </a>
                  ))}
                </div>
              )}
              {canWrite && (
                <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-600 cursor-pointer hover:text-ink-900 transition">
                  <Upload className="w-3.5 h-3.5" /> Upload other document
                  <input
                    type="file" className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadDoc(f, null);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
              )}
              {busy && <p className="text-[12px] text-ink-500">Uploading…</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- add modal */

function AddProviderModal({ threadId, defaultKind, onClose }: {
  threadId: number; defaultKind: string; onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: '', kind: defaultKind, city: '', state: '', pincode: '',
    phone: '', email: '', contactPerson: '', notes: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const res = await createProvider({ threadId, ...form });
      if (!res.ok) { setErr(res.error ?? 'Failed'); return; }
      window.location.reload();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-bold text-ink-900">Add provider to thread</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-900"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Provider name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="col-span-2 h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="h-9 px-2 text-sm rounded-md border border-ink-200 bg-surface">
            {['LAB','HOSPITAL','DOCTOR','PHLEBO','OTHER'].map((k) => <option key={k}>{k}</option>)}
          </select>
          <input placeholder="Contact person" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
            className="h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface" />
          <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface" />
          <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface" />
          <input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
            className="h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface" />
          <input placeholder="Pincode" value={form.pincode} maxLength={6}
            onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, '') })}
            className="h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface tabular-nums" />
          <textarea placeholder="Notes" value={form.notes} rows={2} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="col-span-2 text-sm rounded-md border border-ink-200 bg-surface p-2" />
        </div>
        {err && <p className="text-sm text-danger-500 mt-2">{err}</p>}
        <div className="flex gap-2 mt-3">
          <button onClick={submit} disabled={pending}
            className="px-4 h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 transition">
            {pending ? 'Adding…' : 'Add provider'}
          </button>
          <button onClick={onClose} className="px-3 h-9 text-sm rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}
