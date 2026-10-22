'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { addNote, addTask, toggleTask, assignDeal, setTag, moveDeal, updateDeal } from '../actions';
import type { Deal, Note, Task, Stage } from '@/lib/salesCrm';

const KINDS = [['call', 'Call'], ['email', 'Email'], ['meeting', 'Meeting'], ['note', 'Note']] as const;

export function Composer({ dealId, canEdit }: { dealId: number; canEdit: boolean }) {
  const [kind, setKind] = useState<string>('call');
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return null;

  const save = () => {
    setErr(null);
    start(async () => {
      const r = await addNote({ dealId, kind, body });
      if (!r.ok) { setErr(r.error ?? 'Could not save'); return; }
      setBody('');
    });
  };

  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-4">
      <label htmlFor="note" className="block text-[10px] uppercase tracking-wide text-ink-400 mb-2">
        Log what was said
      </label>
      <textarea id="note" rows={2} value={body} onChange={(e) => setBody(e.target.value)}
                placeholder="Called Ankit — wants a rate card before the board meeting on the 28th."
                className="w-full text-[13px] rounded-lg border border-ink-200 bg-surface px-3 py-2.5 resize-y" />
      <div className="flex flex-wrap items-center gap-2 mt-2.5">
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setKind(k)}
                  className={`text-[12px] px-2.5 py-1 rounded-md border ${
                    kind === k ? 'border-brand-600 bg-brand-50 text-brand-700 font-semibold'
                               : 'border-ink-200 text-ink-600'}`}>
            {label}
          </button>
        ))}
        <button type="button" onClick={save} disabled={pending || !body.trim()}
                className="ml-auto text-[12px] font-semibold rounded-md bg-brand-600 text-white px-4 py-1.5 disabled:opacity-50">
          {pending ? 'Saving…' : 'Save note'}
        </button>
      </div>
      {err && <p className="text-[11px] text-danger-500 mt-2">{err}</p>}
    </div>
  );
}

export function Tasks({ dealId, tasks, people, meId, canEdit }: {
  dealId: number; tasks: Task[]; people: { id: number; name: string }[]; meId: number; canEdit: boolean;
}) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [who, setWho] = useState(String(meId));
  const [pending, start] = useTransition();

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    start(async () => {
      await addTask({ dealId, title, dueOn: due || undefined, assigneeId: Number(who) });
      setTitle(''); setDue('');
    });
  };

  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-4">
      <div className="text-[10px] uppercase tracking-wide text-ink-400">Tasks</div>

      <div className="mt-3 space-y-2.5">
        {tasks.map((t) => (
          <label key={t.id} className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={!!t.done_at} disabled={!canEdit}
                   onChange={(e) => start(async () => { await toggleTask({ taskId: t.id, done: e.target.checked }); })}
                   className="mt-0.5 w-[15px] h-[15px] accent-brand-600" />
            <span className="flex-1 min-w-0">
              <span className={`block text-[13px] ${t.done_at ? 'text-ink-400 line-through' : 'text-ink-900'}`}>
                {t.title}
              </span>
              <span className={`block text-[11px] mt-0.5 ${t.late ? 'text-danger-500 font-semibold' : 'text-ink-500'}`}>
                {t.done_at ? `Done ${t.done_at.slice(0, 10)}`
                  : t.due_on ? `Due ${t.due_on}` : 'No date'}
                {t.assignee_name ? ` · ${t.assignee_name}` : ''}
              </span>
            </span>
          </label>
        ))}
        {tasks.length === 0 && <p className="text-[12px] text-ink-400">Nothing committed to yet.</p>}
      </div>

      {canEdit && (
        <form onSubmit={add} className="mt-3 pt-3 border-t border-ink-100 flex flex-wrap gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What has to happen?"
                 aria-label="Task"
                 className="flex-1 min-w-[150px] text-[12px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date"
                 className="text-[12px] rounded-md border border-ink-200 bg-surface px-2 py-1.5" />
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Assign to"
                  className="text-[12px] rounded-md border border-ink-200 bg-surface px-2 py-1.5">
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="submit" disabled={pending}
                  className="text-[12px] rounded-md border border-ink-200 px-3 py-1.5 text-ink-700 font-medium">
            Add
          </button>
        </form>
      )}
    </div>
  );
}

export function Tags({ dealId, tags, canEdit }: { dealId: number; tags: string[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [pending, start] = useTransition();

  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-4">
      <div className="text-[10px] uppercase tracking-wide text-ink-400">Tags</div>
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-100">
            {t}
            {canEdit && (
              <button type="button" aria-label={`Remove ${t}`}
                      onClick={() => start(async () => { await setTag({ dealId, label: t, on: false }); })}
                      className="text-brand-700/60 hover:text-brand-700">×</button>
            )}
          </span>
        ))}
        {canEdit && !adding && (
          <button type="button" onClick={() => setAdding(true)}
                  className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-ink-300 text-ink-500">
            + tag
          </button>
        )}
      </div>
      {adding && (
        <form className="flex gap-2 mt-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!label.trim()) return;
                start(async () => { await setTag({ dealId, label, on: true }); setLabel(''); setAdding(false); });
              }}>
          <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="enterprise"
                 aria-label="New tag"
                 className="flex-1 text-[12px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5" />
          <button type="submit" disabled={pending}
                  className="text-[12px] rounded-md bg-brand-600 text-white px-3 py-1.5 font-semibold">Add</button>
        </form>
      )}
    </div>
  );
}

export function Owner({ dealId, ownerId, ownerName, people, canEdit }: {
  dealId: number; ownerId: number | null; ownerName: string | null;
  people: { id: number; name: string }[]; canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-4">
      <div className="text-[10px] uppercase tracking-wide text-ink-400">Owner</div>
      {canEdit ? (
        <select value={ownerId ?? ''} disabled={pending} aria-label="Deal owner"
                onChange={(e) => start(async () => {
                  await assignDeal({ dealId, ownerId: e.target.value ? Number(e.target.value) : null });
                })}
                className="mt-2.5 w-full text-[13px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5">
          <option value="">Unassigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      ) : (
        <div className="text-[13px] text-ink-900 mt-2">{ownerName ?? 'Unassigned'}</div>
      )}
    </div>
  );
}

/**
 * Closing a deal.
 *
 * Won asks which store it became and will not proceed without one: a won deal
 * pointing nowhere would claim a customer Stores & Orders has never heard of,
 * which is the one state this feature exists to prevent. Atlas cannot create
 * the store — the console does.
 */
export function CloseDeal({ deal, stages, stores, preselect, canEdit }: {
  deal: Deal; stages: Stage[];
  stores: { id: number; name: string; city: string | null }[];
  preselect: string | null; canEdit: boolean;
}) {
  const won = stages.find((s) => s.outcome === 'won');
  const lost = stages.find((s) => s.outcome === 'lost');
  const [mode, setMode] = useState<string | null>(preselect);
  const [storeId, setStoreId] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!canEdit || deal.stage_outcome !== 'open') return null;

  const go = (stageKey: string, extra: { storeId?: number; lostReason?: string }) => {
    setErr(null);
    start(async () => {
      const r = await moveDeal({ dealId: deal.deal_id, stageKey, ...extra });
      if (!r.ok) setErr(r.error ?? 'Could not close it');
    });
  };

  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-4">
      <div className="text-[10px] uppercase tracking-wide text-ink-400">Close this deal</div>

      {!mode && (
        <div className="flex gap-2 mt-2.5">
          {won && (
            <button type="button" onClick={() => setMode(won.key)}
                    className="flex-1 text-[12px] font-semibold rounded-md border border-success-100 bg-success-50 text-success-600 px-3 py-1.5">
              {won.label}
            </button>
          )}
          {lost && (
            <button type="button" onClick={() => setMode(lost.key)}
                    className="flex-1 text-[12px] font-semibold rounded-md border border-ink-200 text-ink-600 px-3 py-1.5">
              {lost.label}
            </button>
          )}
        </div>
      )}

      {mode && won && mode === won.key && (
        <div className="mt-2.5">
          <label htmlFor="store" className="block text-[11px] text-ink-600 mb-1.5">
            Which LabStack store did this become?
          </label>
          <select id="store" value={storeId} onChange={(e) => setStoreId(e.target.value)}
                  className="w-full text-[13px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5">
            <option value="">Pick a store…</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ''}</option>
            ))}
          </select>
          <p className="text-[11px] text-ink-400 mt-1.5 leading-snug">
            Not listed? Create it in the LabStack console first — Atlas only reads stores.
            A store already claimed by another deal is hidden.
          </p>
          <div className="flex gap-2 mt-2.5">
            <button type="button" disabled={pending || !storeId}
                    onClick={() => go(won.key, { storeId: Number(storeId) })}
                    className="text-[12px] font-semibold rounded-md bg-success-600 text-white px-3.5 py-1.5 disabled:opacity-50">
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : `Mark ${won.label}`}
            </button>
            <button type="button" onClick={() => setMode(null)}
                    className="text-[12px] rounded-md border border-ink-200 px-3 py-1.5 text-ink-600">Cancel</button>
          </div>
        </div>
      )}

      {mode && lost && mode === lost.key && (
        <div className="mt-2.5">
          <label htmlFor="reason" className="block text-[11px] text-ink-600 mb-1.5">Why?</label>
          <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)}
                 placeholder="Went with an incumbent on price"
                 className="w-full text-[13px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5" />
          <div className="flex gap-2 mt-2.5">
            <button type="button" disabled={pending || !reason.trim()}
                    onClick={() => go(lost.key, { lostReason: reason })}
                    className="text-[12px] font-semibold rounded-md bg-ink-900 text-white px-3.5 py-1.5 disabled:opacity-50">
              Mark {lost.label}
            </button>
            <button type="button" onClick={() => setMode(null)}
                    className="text-[12px] rounded-md border border-ink-200 px-3 py-1.5 text-ink-600">Cancel</button>
          </div>
        </div>
      )}

      {err && <p className="text-[11px] text-danger-500 mt-2">{err}</p>}
    </div>
  );
}

export function DealFields({ deal, canEdit, types }: {
  deal: Deal; canEdit: boolean; types: { key: string; label: string }[];
}) {
  const [v, setV] = useState(deal.value_inr ?? '');
  const [close, setClose] = useState(deal.expected_close ?? '');
  const [name, setName] = useState(deal.contact_name ?? '');
  const [role, setRole] = useState(deal.contact_role ?? '');
  const [phone, setPhone] = useState(deal.contact_phone ?? '');
  const [email, setEmail] = useState(deal.contact_email ?? '');
  const [type, setType] = useState(deal.account_type ?? '');
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  if (!canEdit) return null;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      await updateDeal({
        dealId: deal.deal_id, value: String(v).replace(/\D/g, ''), expectedClose: close,
        contactName: name, contactRole: role, contactPhone: phone, contactEmail: email,
        city: deal.city ?? '', website: deal.website ?? '', accountType: type,
      });
      setSaved(true); setTimeout(() => setSaved(false), 1600);
    });
  };

  return (
    <form onSubmit={save} className="rounded-xl border border-ink-200 bg-surface p-4 space-y-2.5">
      <div className="text-[10px] uppercase tracking-wide text-ink-400">Deal &amp; contact</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-ink-500">Value ₹
          <input value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))}
                 className="mt-1 w-full text-[13px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 num" />
        </label>
        <label className="text-[11px] text-ink-500">Expected close
          <input type="date" value={close} onChange={(e) => setClose(e.target.value)}
                 className="mt-1 w-full text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-1.5" />
        </label>
      </div>
      <label className="block text-[11px] text-ink-500">Account type
        <select value={type} onChange={(e) => setType(e.target.value)}
                className="mt-1 w-full text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-1.5">
          <option value="">Not set</option>
          {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </label>
      <label className="block text-[11px] text-ink-500">Contact
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ankit Mehrotra"
               className="mt-1 w-full text-[13px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5" />
      </label>
      <label className="block text-[11px] text-ink-500">Their role
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Head of Benefits Ops"
               className="mt-1 w-full text-[13px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-ink-500">Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)}
                 className="mt-1 w-full text-[13px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 num" />
        </label>
        <label className="text-[11px] text-ink-500">Email
          <input value={email} onChange={(e) => setEmail(e.target.value)}
                 className="mt-1 w-full text-[13px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5" />
        </label>
      </div>
      <button type="submit" disabled={pending}
              className="w-full text-[12px] font-semibold rounded-md border border-ink-200 px-3 py-1.5 text-ink-700">
        {pending ? 'Saving…' : saved ? 'Saved' : 'Save details'}
      </button>
      <p className="text-[10px] text-ink-400 leading-snug">
        Editing these does not count as contact — the stuck clock only moves for a note, a task
        or a stage change.
      </p>
    </form>
  );
}

export function Activity({ notes }: { notes: Note[] }) {
  if (notes.length === 0) {
    return <p className="text-[12px] text-ink-400 px-1 py-4">Nothing logged yet.</p>;
  }
  return (
    <div className="rounded-xl border border-ink-200 bg-surface px-4">
      {notes.map((n, i) => (
        <div key={n.id} className={`flex gap-3 py-4 ${i < notes.length - 1 ? 'border-b border-ink-100' : ''}`}>
          <span className="w-6 h-6 shrink-0 rounded-full bg-ink-100 text-ink-600 text-[9px] font-bold flex items-center justify-center">
            {n.kind === 'stage' ? '↗' : n.kind.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="text-[12px] text-ink-500">
              <span className="text-ink-900 font-semibold">{n.author_name ?? 'Someone'}</span>
              {' '}{n.kind === 'stage' ? 'moved the deal' : `logged a ${n.kind}`}
              {' · '}{n.created_at.slice(0, 16).replace('T', ' ')}
            </div>
            {n.body && <p className="text-[13px] text-ink-700 leading-relaxed mt-1 whitespace-pre-line">{n.body}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
