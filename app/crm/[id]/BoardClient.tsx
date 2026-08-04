'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  Plus, X, User as UserIcon, FileText, Upload, CheckCircle2, Circle,
  ArrowRight, StickyNote, Clock, Phone, Mail, MapPin, Upload as UploadIcon, Settings2, Trash2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { createProvider, moveStage, assignProvider, addNote, updateProvider, bulkCreateProviders, addChecklistItem, removeChecklistItem, removeFromThread, bulkUpdateProviders, checkProviderDuplicates, type DupStatus } from '../actions';
import type { Thread, ThreadProvider, ChecklistItem, ProviderDoc, Activity, FunnelStage } from '@/lib/crm';
import { PROVIDER_KINDS } from '@/lib/providerKinds';
import { ProviderDrawer } from '../ProviderDrawer';

type Team = { id: number; name: string; role: string }[];

export function BoardClient({
  thread, initialProviders, checklist, team, canWrite, myId, openProviderId, focusAssigneeId,
}: {
  thread: Thread;
  initialProviders: ThreadProvider[];
  checklist: ChecklistItem[];
  team: Team;
  canWrite: boolean;
  myId: number;
  /** Arriving from the queue: open this provider's panel straight away. */
  openProviderId?: number | null;
  /** …and keep the person filter the queue was showing. */
  focusAssigneeId?: number | null;
}) {
  const [providers, setProviders] = useState(initialProviders);
  const [openId, setOpenId] = useState<number | null>(openProviderId ?? null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [confirmBulkRemove, setConfirmBulkRemove] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState<number | 'all' | 'mine'>(focusAssigneeId ?? 'all');
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

  const togglePick = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const doPatch = (providerId: number, patch: Record<string, string>) => {
    setProviders((ps) => ps.map((p) => (p.id === providerId ? { ...p, ...patch } : p)));
  };

  const doRemove = (providerId: number) => {
    startTransition(async () => {
      const res = await removeFromThread({ threadId: thread.id, providerId });
      if (!res.ok) { setErr(res.error ?? 'Remove failed'); return; }
      setProviders((ps) => ps.filter((p) => p.id !== providerId));
      setPicked((prev) => { const n = new Set(prev); n.delete(providerId); return n; });
      if (openId === providerId) setOpenId(null);
    });
  };

  const doBulk = (op: 'assign' | 'move' | 'remove', value?: string) => {
    const ids = [...picked];
    if (!ids.length) return;
    startTransition(async () => {
      const res = await bulkUpdateProviders({
        threadId: thread.id, providerIds: ids, op,
        assigneeId: op === 'assign' ? (value && value !== '0' ? +value : null) : undefined,
        toStage: op === 'move' ? value : undefined,
      });
      if (!res.ok) { setErr(res.error ?? 'Bulk update failed'); return; }
      if (op === 'remove') {
        setProviders((ps) => ps.filter((p) => !picked.has(p.id)));
      } else if (op === 'assign') {
        const assigneeId = value && value !== '0' ? +value : null;
        const name = team.find((t) => t.id === assigneeId)?.name ?? null;
        setProviders((ps) => ps.map((p) =>
          picked.has(p.id) ? { ...p, assignee_id: assigneeId, assignee_name: name } : p));
      } else {
        setProviders((ps) => ps.map((p) => (picked.has(p.id) ? { ...p, stage_key: value! } : p)));
      }
      setPicked(new Set());
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
          <>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 px-3 h-8 text-[13px] font-semibold rounded-md bg-ink-900 text-ink-50 hover:bg-ink-800 transition"
            >
              <Plus className="w-3.5 h-3.5" /> Add provider
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="inline-flex items-center gap-1.5 px-3 h-8 text-[13px] font-medium rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50 transition"
            >
              <UploadIcon className="w-3.5 h-3.5" /> Import Excel
            </button>
            <button
              onClick={() => setShowChecklist(true)}
              className="inline-flex items-center gap-1.5 px-3 h-8 text-[13px] font-medium rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50 transition"
            >
              <Settings2 className="w-3.5 h-3.5" /> Checklist ({checklist.length})
            </button>
          </>
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
          const isTerminalGood = s.key === thread.success_stage_key;
          const isTerminalBad = !isTerminalGood && /stall|drop|lost|reject|dead/i.test(s.key + s.label);
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
                  <div
                    key={p.id}
                    className={`relative w-full rounded-lg border bg-surface transition ${
                      picked.has(p.id) ? 'border-brand-500 ring-1 ring-brand-500/30' : 'border-ink-200 hover:border-brand-400'
                    }`}
                  >
                    {/* Selection sits outside the card button so ticking a box
                        never opens the drawer. */}
                    {canWrite && (
                      <label
                        className="absolute top-2 right-2 z-10 flex items-center cursor-pointer p-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={picked.has(p.id)}
                          onChange={() => togglePick(p.id)}
                          className="sr-only"
                        />
                        <span className={`inline-flex w-3.5 h-3.5 items-center justify-center rounded border transition ${
                          picked.has(p.id) ? 'bg-brand-600 border-brand-600' : 'border-ink-300 bg-surface'
                        }`}>
                          {picked.has(p.id) && <CheckCircle2 className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                        </span>
                      </label>
                    )}
                  <button
                    onClick={() => setOpenId(p.id)}
                    className="w-full text-left p-2.5"
                  >
                    <div className="text-[13px] font-medium text-ink-900 leading-tight pr-5">{p.name}</div>
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
                  </div>
                ))}
                {cards.length === 0 && (
                  <div className="text-[11px] text-ink-400 text-center py-4">—</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bulk actions — only present when something is selected, so the
          toolbar doesn't carry controls that do nothing most of the time. */}
      {canWrite && picked.size > 0 && (
        <div className="sticky bottom-3 z-30 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/40 bg-surface shadow-lg px-3 py-2">
          <span className="text-[13px] font-semibold text-ink-900">
            {picked.size} selected
          </span>

          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value !== '') { doBulk('assign', e.target.value); e.target.value = ''; } }}
            disabled={pending}
            className="h-8 px-2 text-[12px] rounded-md border border-ink-200 bg-surface"
          >
            <option value="" disabled>Assign to…</option>
            <option value="0">Unassigned</option>
            {team.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}
          </select>

          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) { doBulk('move', e.target.value); e.target.value = ''; } }}
            disabled={pending}
            className="h-8 px-2 text-[12px] rounded-md border border-ink-200 bg-surface"
          >
            <option value="" disabled>Move to…</option>
            {stages.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
          </select>

          {confirmBulkRemove ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-[12px] text-ink-700">Remove {picked.size} from thread?</span>
              <button onClick={() => { doBulk('remove'); setConfirmBulkRemove(false); }} disabled={pending}
                className="text-[12px] font-semibold text-danger-500 hover:underline">Yes</button>
              <button onClick={() => setConfirmBulkRemove(false)}
                className="text-[12px] text-ink-500">Cancel</button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmBulkRemove(true)}
              disabled={pending}
              className="inline-flex items-center gap-1 px-2 h-8 text-[12px] font-semibold rounded-md border border-ink-200 text-ink-600 hover:text-danger-500 hover:border-danger-500/40 transition"
            >
              <Trash2 className="w-3 h-3" /> Remove
            </button>
          )}

          <button onClick={() => setPicked(new Set())} className="ml-auto text-[12px] text-ink-500 hover:text-ink-900">
            Clear
          </button>
        </div>
      )}

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
          onRemove={doRemove}
          onPatch={doPatch}
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

      {showImport && (
        <ImportModal threadId={thread.id} defaultKind={thread.provider_kind ?? 'LAB'} onClose={() => setShowImport(false)} />
      )}

      {showChecklist && (
        <ChecklistModal threadId={thread.id} items={checklist} onClose={() => setShowChecklist(false)} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- drawer */

function AddProviderModal({ threadId, defaultKind, onClose }: {
  threadId: number; defaultKind: string; onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: '', kind: defaultKind, city: '', state: '', pincode: '',
    phone: '', email: '', contactPerson: '', notes: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [dup, setDup] = useState<DupStatus | null>(null);
  const [pending, startTransition] = useTransition();

  // Checked as the name is typed, so a duplicate is visible before the form is
  // filled in rather than after it's submitted.
  const checkName = (name: string) => {
    setDup(null);
    if (!name.trim()) return;
    startTransition(async () => {
      const res = await checkProviderDuplicates({ threadId, names: [name.trim()] });
      setDup(res.statuses?.[name.trim()] ?? null);
    });
  };

  const submit = () => {
    if (dup === 'in_thread') return;
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
          <input placeholder="Provider name *" value={form.name}
            onBlur={(e) => checkName(e.target.value)}
            onChange={(e) => { setForm({ ...form, name: e.target.value }); setDup(null); }}
            className="col-span-2 h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="h-9 px-2 text-sm rounded-md border border-ink-200 bg-surface">
            {PROVIDER_KINDS.map((k) => <option key={k}>{k}</option>)}
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
        {dup === 'in_thread' && (
          <p className="text-sm text-warn-600 mt-2">
            <b>{form.name.trim()}</b> is already on this thread. Open the existing card instead of adding it again.
          </p>
        )}
        {dup === 'in_directory' && (
          <p className="text-sm text-ink-600 mt-2">
            <b>{form.name.trim()}</b> already exists in the directory from other work. Adding it here
            attaches that record rather than creating a second one.
          </p>
        )}
        {err && <p className="text-sm text-danger-500 mt-2">{err}</p>}
        <div className="flex gap-2 mt-3">
          <button onClick={submit} disabled={pending || dup === 'in_thread'}
            className="px-4 h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 transition">
            {pending ? 'Adding…' : dup === 'in_thread' ? 'Already on this thread' : 'Add provider'}
          </button>
          <button onClick={onClose} className="px-3 h-9 text-sm rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- import modal */

const IMPORT_ALIASES: Record<string, string[]> = {
  name:          ['name', 'provider', 'provider name', 'lab name', 'lab', 'hospital'],
  city:          ['city', 'town'],
  state:         ['state'],
  pincode:       ['pincode', 'pin code', 'pin', 'zip'],
  phone:         ['phone', 'mobile', 'contact', 'phone number', 'contact number'],
  email:         ['email', 'mail', 'email address'],
  contactPerson: ['contact person', 'contact name', 'owner', 'poc', 'spoc'],
  notes:         ['notes', 'note', 'remarks', 'comment'],
  kind:          ['kind', 'type', 'provider type'],
};

function matchCol(header: string[], target: string): number {
  const want = IMPORT_ALIASES[target].map((s) => s.toLowerCase().replace(/[_\s]/g, ''));
  return header.findIndex((h) => want.includes((h ?? '').toString().toLowerCase().replace(/[_\s]/g, '')));
}

function ImportModal({ threadId, defaultKind, onClose }: {
  threadId: number; defaultKind: string; onClose: () => void;
}) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [filename, setFilename] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; linked: number; skipped: number } | null>(null);
  const [dups, setDups] = useState<Record<string, DupStatus>>({});
  const [checking, setChecking] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleFile = async (file: File) => {
    setErr(null); setResult(null); setFilename(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const raw: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      if (!raw.length) throw new Error('File is empty');
      const header = raw[0].map((h) => String(h ?? '').trim());
      const iName = matchCol(header, 'name');
      if (iName < 0) throw new Error(`Need a "name" column. Found: ${header.join(', ')}`);
      const idx = {
        city: matchCol(header, 'city'), state: matchCol(header, 'state'),
        pincode: matchCol(header, 'pincode'), phone: matchCol(header, 'phone'),
        email: matchCol(header, 'email'), contactPerson: matchCol(header, 'contactPerson'),
        notes: matchCol(header, 'notes'), kind: matchCol(header, 'kind'),
      };
      const out: Record<string, string>[] = [];
      for (let r = 1; r < raw.length; r++) {
        const row = raw[r];
        if (!row || row.every((c) => c === '' || c == null)) continue;
        const name = String(row[iName] ?? '').trim();
        if (!name) continue;
        const get = (i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '');
        out.push({
          name, kind: get(idx.kind) || defaultKind, city: get(idx.city), state: get(idx.state),
          pincode: get(idx.pincode), phone: get(idx.phone), email: get(idx.email),
          contactPerson: get(idx.contactPerson), notes: get(idx.notes),
        });
      }
      if (!out.length) throw new Error('No rows with a name found');
      setRows(out);
      // Classify before anything is written, so the preview shows what will
      // actually happen rather than reporting it afterwards.
      setChecking(true);
      const check = await checkProviderDuplicates({
        threadId, names: [...new Set(out.map((r) => r.name.trim().toLowerCase()))],
      });
      setDups(check.statuses ?? {});
      setChecking(false);
    } catch (e) {
      setErr((e as Error).message); setRows([]); setDups({}); setChecking(false);
    }
  };

  // Status is per ROW, not per name: a name appearing twice has a real status
  // on its first row and counts as a repeat only from the second onwards.
  // Deriving this from a name-keyed map would drop the first occurrence too.
  const rowStatus: DupStatus[] = (() => {
    const seen = new Set<string>();
    return rows.map((r) => {
      const k = r.name.trim().toLowerCase();
      if (seen.has(k)) return 'in_file' as DupStatus;
      seen.add(k);
      return (dups[k] ?? 'new') as DupStatus;
    });
  })();

  // Directory matches are sent — they attach the existing provider rather than
  // creating a second record for the same organisation.
  const importable = rows.filter((_, i) => rowStatus[i] !== 'in_thread' && rowStatus[i] !== 'in_file');
  const blocked = rows.length - importable.length;

  const commit = () => {
    startTransition(async () => {
      const res = await bulkCreateProviders({ threadId, rows: importable as never });
      if (!res.ok) { setErr(res.error ?? 'Import failed'); return; }
      setResult({ created: res.created ?? 0, linked: res.linked ?? 0, skipped: res.skipped ?? 0 });
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-ink-200 bg-surface p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-bold text-ink-900">Import providers</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-900"><X className="w-4 h-4" /></button>
        </div>

        {result ? (
          <div className="text-center py-6">
            <CheckCircle2 className="w-8 h-8 text-success-600 mx-auto mb-2" />
            <p className="text-sm text-ink-800">
              <b>{result.created}</b> new provider{result.created === 1 ? '' : 's'} added
              {result.linked > 0 && <> · <b>{result.linked}</b> existing linked from the directory</>}
              {result.skipped > 0 && <> · <b>{result.skipped}</b> duplicate{result.skipped === 1 ? '' : 's'} skipped</>}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 transition"
            >
              View board
            </button>
          </div>
        ) : rows.length === 0 ? (
          <>
            <label className="flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed border-ink-300 rounded-xl hover:border-brand-400 transition cursor-pointer">
              <UploadIcon className="w-7 h-7 text-ink-400" />
              <span className="text-sm font-semibold text-ink-900">Click to select Excel / CSV</span>
              <span className="text-xs text-ink-500">Only a “name” column is required</span>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </label>
            <p className="text-[11px] text-ink-500 mt-3">
              Optional columns: city, state, pincode, phone, email, contact person, notes, kind.
              Providers already in this thread (same name) are skipped.
            </p>
            {err && <p className="text-sm text-danger-500 mt-2">{err}</p>}
          </>
        ) : (
          <>
            <div className="text-[13px] text-ink-700 mb-2">
              <b>{rows.length}</b> providers from <span className="font-mono text-[12px]">{filename}</span>
              {checking && <span className="text-ink-500"> · checking for duplicates…</span>}
              {!checking && blocked > 0 && (
                <span className="text-warn-600"> · {blocked} will be skipped as duplicates</span>
              )}
            </div>
            <div className="max-h-[300px] overflow-y-auto rounded-lg border border-ink-200 mb-3">
              <table className="w-full text-[12px]">
                <thead className="bg-ink-50 sticky top-0">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-ink-500">
                    <th className="px-2 py-1.5">Name</th><th className="px-2 py-1.5">City</th><th className="px-2 py-1.5">Phone</th><th className="px-2 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => {
                    const st = rowStatus[i] ?? 'new';
                    const dup = st === 'in_thread' || st === 'in_file';
                    return (
                      <tr key={i} className={`border-t border-ink-100 ${dup ? 'opacity-45' : ''}`}>
                        <td className={`px-2 py-1.5 ${dup ? 'text-ink-500 line-through' : 'text-ink-900'}`}>{r.name}</td>
                        <td className="px-2 py-1.5 text-ink-600">{r.city || '—'}</td>
                        <td className="px-2 py-1.5 text-ink-600 tabular-nums">{r.phone || '—'}</td>
                        <td className="px-2 py-1.5">
                          <span className={`text-[10px] font-semibold ${
                            st === 'in_thread' ? 'text-warn-600'
                            : st === 'in_file' ? 'text-warn-600'
                            : st === 'in_directory' ? 'text-brand-700 dark:text-brand-400'
                            : 'text-success-600'}`}>
                            {st === 'in_thread' ? 'already here'
                              : st === 'in_file' ? 'repeat in file'
                              : st === 'in_directory' ? 'known — will link'
                              : 'new'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 50 && <div className="px-2 py-1.5 text-[11px] text-ink-500 bg-ink-50 border-t border-ink-200">+{rows.length - 50} more rows, checked the same way</div>}
            </div>
            {err && <p className="text-sm text-danger-500 mb-2">{err}</p>}
            <div className="flex gap-2">
              <button onClick={commit} disabled={pending || checking || importable.length === 0}
                className="px-4 h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 transition">
                {pending ? 'Importing…'
                  : checking ? 'Checking…'
                  : importable.length === 0 ? 'Nothing new to import'
                  : `Import ${importable.length} provider${importable.length === 1 ? '' : 's'}`}
              </button>
              <button onClick={() => { setRows([]); setFilename(null); setDups({}); }} className="px-3 h-9 text-sm rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50">
                Choose another file
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- checklist modal */

function ChecklistModal({ threadId, items, onClose }: {
  threadId: number; items: ChecklistItem[]; onClose: () => void;
}) {
  const [label, setLabel] = useState('');
  const [required, setRequired] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const add = () => {
    startTransition(async () => {
      const res = await addChecklistItem({ threadId, label, required });
      if (!res.ok) { setErr(res.error ?? 'Failed'); return; }
      window.location.reload();
    });
  };
  const remove = (itemId: number) => {
    startTransition(async () => {
      const res = await removeChecklistItem({ threadId, itemId });
      if (!res.ok) { setErr(res.error ?? 'Failed'); return; }
      window.location.reload();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-surface p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[15px] font-bold text-ink-900">Document checklist</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-900"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[11px] text-ink-500 mb-3">
          Applies to every provider in this thread. Editing here creates a thread-specific
          checklist — the global default stays untouched for other threads.
        </p>

        <div className="space-y-1.5 mb-4">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2">
              <span className="text-[13px] text-ink-800 flex-1">{it.label}</span>
              {it.required && <span className="text-[9px] uppercase font-semibold text-danger-500">required</span>}
              <button onClick={() => remove(it.id)} disabled={pending}
                className="text-ink-400 hover:text-danger-500 disabled:opacity-30" aria-label="Remove item">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-ink-200 pt-3 space-y-2">
          <input
            type="text" placeholder="New document — e.g. Fire safety certificate" value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface"
          />
          <label className="flex items-center gap-2 text-[12px] text-ink-600">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="w-3.5 h-3.5" />
            Required before a provider can be marked ready
          </label>
          {err && <p className="text-sm text-danger-500">{err}</p>}
          <button onClick={add} disabled={pending || !label.trim()}
            className="w-full h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40 transition">
            {pending ? 'Adding…' : 'Add document'}
          </button>
        </div>
      </div>
    </div>
  );
}
