'use client';

import { useState, useTransition } from 'react';
import {
  X, User as UserIcon, FileText, Upload, CheckCircle2, Circle,
  ArrowRight, StickyNote, Clock, Phone, Mail, MapPin, Trash2,
} from 'lucide-react';
import { moveStage, assignProvider, addNote, updateProvider, removeFromThread } from './actions';
import type { Thread, ThreadProvider, ChecklistItem, ProviderDoc, Activity, FunnelStage } from '@/lib/crm';
import { PROVIDER_KINDS } from '@/lib/providerKinds';

export type Team = { id: number; name: string; role: string }[];

/**
 * The provider panel, shared by the thread board and the queue.
 *
 * It used to live inside BoardClient, which meant the only way to see a
 * provider was to be on its thread — so opening one from the queue had to
 * navigate there first. Nothing in here actually needs the board; it needs a
 * provider, its funnel's stages and a checklist.
 */
export function ProviderDrawer({
  thread, provider, stages, checklist, team, canWrite, pending, onClose, onMove, onAssign, onRemove, onPatch,
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
  onRemove: (providerId: number) => void;
  onPatch: (providerId: number, patch: Record<string, string>) => void;
  onAssign: (providerId: number, assigneeId: number | null) => void;
  onNoteAdded: () => void;
}) {
  const [tab, setTab] = useState<'journey' | 'docs'>('journey');
  const [note, setNote] = useState('');
  const blank = {
    name: provider.name ?? '', kind: provider.kind ?? 'LAB',
    city: provider.city ?? '', state: provider.state ?? '', pincode: provider.pincode ?? '',
    phone: provider.phone ?? '', email: provider.email ?? '',
    contact_person: provider.contact_person ?? '', notes: provider.notes ?? '',
  };
  const [fields, setFields] = useState(blank);
  const [moveTo, setMoveTo] = useState(provider.stage_key);
  const [ownerTo, setOwnerTo] = useState<number | null>(provider.assignee_id ?? null);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
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

  const setField = (k: keyof typeof blank, v: string) => {
    setFields((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  const fieldsDirty = (Object.keys(blank) as (keyof typeof blank)[]).some((k) => fields[k] !== blank[k]);
  const stageDirty = moveTo !== provider.stage_key;
  const ownerDirty = ownerTo !== (provider.assignee_id ?? null);
  const dirty = fieldsDirty || stageDirty || ownerDirty || note.trim().length > 0;

  const resetDraft = () => {
    setFields(blank); setMoveTo(provider.stage_key);
    setOwnerTo(provider.assignee_id ?? null); setNote(''); setSaveErr(null);
  };

  /**
   * One save for everything on the card.
   *
   * Order matters: fields first so a rename is in place before the move is
   * logged, then the stage (which carries the note, so the note explains the
   * move), then the owner. A note with no stage change is posted on its own.
   */
  const saveAll = async () => {
    setBusy(true); setSaveErr(null);
    try {
      const patch: Record<string, string> = {};
      if (fieldsDirty) {
        (Object.keys(blank) as (keyof typeof blank)[]).forEach((k) => {
          if (fields[k] !== blank[k]) patch[k] = fields[k];
        });
        const res = await updateProvider({ providerId: provider.id, threadId: thread.id, fields: patch });
        if (!res.ok) { setSaveErr(res.error ?? 'Could not save details'); return; }
      }
      if (stageDirty) onMove(provider.id, moveTo, note.trim() || undefined);
      else if (note.trim()) {
        const res = await addNote({ threadId: thread.id, providerId: provider.id, body: note.trim() });
        if (!res.ok) { setSaveErr(res.error ?? 'Could not post note'); return; }
      }
      if (ownerDirty) onAssign(provider.id, ownerTo);
      if (fieldsDirty) onPatch(provider.id, patch);

      setNote('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      setTimeout(loadActivities, 700);
    } finally { setBusy(false); }
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
              {provider.state && <span>· {provider.state}</span>}
            </div>
            {/* Captured on the add form but previously never shown, so a note
                written while creating a provider was effectively write-only. */}
            {provider.notes && (
              <p className="text-[12px] text-ink-600 mt-1.5 whitespace-pre-wrap border-l-2 border-ink-200 pl-2">
                {provider.notes}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canWrite && (
              confirmRemove ? (
                <span className="inline-flex items-center gap-1.5 mr-1">
                  <span className="text-[11px] text-ink-600">Remove?</span>
                  <button onClick={() => onRemove(provider.id)} disabled={pending}
                    className="text-[11px] font-semibold text-danger-500 hover:underline">Yes</button>
                  <button onClick={() => setConfirmRemove(false)}
                    className="text-[11px] text-ink-500">No</button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmRemove(true)}
                  title="Remove from this thread — the provider stays in the directory"
                  className="text-ink-400 hover:text-danger-500 p-1 transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )
            )}
            <button onClick={onClose} className="text-ink-400 hover:text-ink-900 p-1"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* One editable card: every provider field, the stage, the owner and
              an optional note, saved together. Three separate save buttons
              meant three ways to lose an edit by clicking the wrong one. */}
          {canWrite && (
            <div className="rounded-xl border border-ink-200 bg-ink-50 p-3 space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <input value={fields.name} onChange={(e) => setField('name', e.target.value)}
                  placeholder="Provider name"
                  className="col-span-2 h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface font-medium" />
                <select value={fields.kind} onChange={(e) => setField('kind', e.target.value)}
                  className="h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface">
                  {PROVIDER_KINDS.map((k) =>
                    <option key={k} value={k}>{k}</option>)}
                </select>
                <input value={fields.contact_person} onChange={(e) => setField('contact_person', e.target.value)}
                  placeholder="Contact person"
                  className="h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface" />
                <input value={fields.phone} onChange={(e) => setField('phone', e.target.value)}
                  placeholder="Phone"
                  className="h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface tabular-nums" />
                <input value={fields.email} onChange={(e) => setField('email', e.target.value)}
                  placeholder="Email"
                  className="h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface" />
                <input value={fields.city} onChange={(e) => setField('city', e.target.value)}
                  placeholder="City"
                  className="h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface" />
                <input value={fields.state} onChange={(e) => setField('state', e.target.value)}
                  placeholder="State"
                  className="h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface" />
                <input value={fields.pincode} maxLength={6}
                  onChange={(e) => setField('pincode', e.target.value.replace(/\D/g, ''))}
                  placeholder="Pincode"
                  className="h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface tabular-nums" />
                <textarea value={fields.notes} rows={2} onChange={(e) => setField('notes', e.target.value)}
                  placeholder="Notes"
                  className="col-span-2 text-[13px] rounded-md border border-ink-200 bg-surface p-2" />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold w-16">Stage</span>
                <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}
                  className="flex-1 h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface font-medium">
                  {stages.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold w-16">Owner</span>
                <select value={ownerTo ?? ''} onChange={(e) => setOwnerTo(e.target.value ? +e.target.value : null)}
                  className="flex-1 h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface">
                  <option value="">Unassigned</option>
                  {team.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}
                </select>
              </div>

              <div className="flex items-start gap-2">
                <StickyNote className="w-4 h-4 text-ink-400 mt-2" />
                <textarea value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note — saved with these changes"
                  rows={2}
                  className="flex-1 text-[13px] rounded-md border border-ink-200 bg-surface p-2" />
              </div>

              <div className="flex items-center gap-2 pt-0.5">
                <button
                  onClick={saveAll}
                  disabled={pending || busy || !dirty}
                  className="inline-flex items-center gap-1 px-3 h-8 text-[12px] font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 transition"
                >
                  {saved && !dirty ? <><CheckCircle2 className="w-3 h-3" /> Saved</> : busy ? 'Saving…' : 'Save changes'}
                </button>
                {dirty && (
                  <button onClick={resetDraft} className="text-[12px] text-ink-500 hover:text-ink-900">
                    Discard
                  </button>
                )}
                {saveErr && <span className="text-[12px] text-danger-500">{saveErr}</span>}
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
