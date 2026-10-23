'use client';

import { useState, useTransition } from 'react';
import { addNote, addTask, toggleTask, addContact, removeContact, startActivation } from '../../actions';
import type { AccountTask } from '@/lib/accountHealth';

const KINDS = [['call', 'Call'], ['email', 'Email'], ['meeting', 'Meeting'], ['note', 'Note']] as const;

export function Composer({ storeId, canEdit }: { storeId: number; canEdit: boolean }) {
  const [kind, setKind] = useState('call');
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return null;

  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-4">
      <label htmlFor="note" className="block text-[10px] uppercase tracking-wide text-ink-500 mb-2">
        Log what was said
      </label>
      <textarea id="note" rows={2} value={body} onChange={(e) => setBody(e.target.value)}
                placeholder="Monthly review — volumes steady, they asked about turnaround in Pune."
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
        <button type="button" disabled={pending || !body.trim()}
                onClick={() => start(async () => {
                  const r = await addNote({ storeId, kind, body });
                  if (!r.ok) { setErr(r.error ?? 'Could not save'); return; }
                  setBody(''); setErr(null);
                })}
                className="ml-auto text-[12px] font-semibold rounded-md bg-brand-600 text-white px-4 py-1.5 disabled:opacity-50">
          {pending ? 'Saving…' : 'Save note'}
        </button>
      </div>
      {err && <p className="text-[11px] text-danger-500 mt-2">{err}</p>}
    </div>
  );
}

export function Tasks({ storeId, tasks, people, meId, canEdit }: {
  storeId: number; tasks: AccountTask[]; people: { id: number; name: string }[];
  meId: number; canEdit: boolean;
}) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [repeat, setRepeat] = useState('none');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-4">
      <div className="text-[10px] uppercase tracking-wide text-ink-500">Tasks</div>

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
                {t.done_at ? `Done ${t.done_at.slice(0, 10)}` : t.due_on ? `Due ${t.due_on}` : 'No date'}
                {t.assignee_name ? ` · ${t.assignee_name}` : ''}
                {t.repeat_every !== 'none' ? ` · repeats ${t.repeat_every}` : ''}
              </span>
            </span>
          </label>
        ))}
        {tasks.length === 0 && <p className="text-[12px] text-ink-400">Nothing committed to yet.</p>}
      </div>

      {canEdit && (
        <form className="mt-3 pt-3 border-t border-ink-100 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!title.trim()) return;
                start(async () => {
                  const r = await addTask({
                    storeId, title, dueOn: due || undefined,
                    assigneeId: meId, repeat,
                  });
                  if (!r.ok) { setErr(r.error ?? 'Could not add it'); return; }
                  setTitle(''); setDue(''); setRepeat('none'); setErr(null);
                });
              }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
                 placeholder="What has to happen?" aria-label="Task"
                 className="flex-1 min-w-[140px] text-[12px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date"
                 className="text-[12px] rounded-md border border-ink-200 bg-surface px-2 py-1.5" />
          <select value={repeat} onChange={(e) => setRepeat(e.target.value)} aria-label="Repeat"
                  className="text-[12px] rounded-md border border-ink-200 bg-surface px-2 py-1.5">
            <option value="none">Once</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
          <button type="submit" disabled={pending}
                  className="text-[12px] rounded-md border border-ink-200 px-3 py-1.5 text-ink-700 font-medium">
            Add
          </button>
          {err && <p className="w-full text-[11px] text-danger-500">{err}</p>}
        </form>
      )}
    </div>
  );
}

export function Contacts({ storeId, contacts, canEdit }: {
  storeId: number;
  contacts: { id: number; name: string; role: string | null; phone: string | null; email: string | null }[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [phone, setPhone] = useState('');
  const [pending, start] = useTransition();

  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-4">
      <div className="text-[10px] uppercase tracking-wide text-ink-500">Who to call</div>
      <div className="mt-2.5 space-y-3">
        {contacts.map((c) => (
          <div key={c.id} className="group">
            <div className="flex items-start gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-ink-900">{c.name}</div>
                {c.role && <div className="text-[11px] text-ink-500">{c.role}</div>}
                {c.phone && <a href={`tel:${c.phone}`} className="block text-[12px] text-brand-600 mt-0.5 num">{c.phone}</a>}
                {c.email && <a href={`mailto:${c.email}`} className="block text-[12px] text-brand-600">{c.email}</a>}
              </div>
              {canEdit && (
                <button type="button" aria-label={`Remove ${c.name}`}
                        onClick={() => start(async () => { await removeContact({ contactId: c.id, storeId }); })}
                        className="ml-auto text-ink-300 hover:text-danger-500 text-[14px] leading-none">×</button>
              )}
            </div>
          </div>
        ))}
        {contacts.length === 0 && <p className="text-[12px] text-ink-400">Nobody recorded yet.</p>}
      </div>

      {canEdit && (open ? (
        <form className="mt-3 pt-3 border-t border-ink-100 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                start(async () => {
                  await addContact({ storeId, name, role, phone });
                  setName(''); setRole(''); setPhone(''); setOpen(false);
                });
              }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Contact name"
                 className="w-full text-[12px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5" />
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role" aria-label="Their role"
                 className="w-full text-[12px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" aria-label="Phone"
                 className="w-full text-[12px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5" />
          <div className="flex gap-2">
            <button type="submit" disabled={pending}
                    className="flex-1 text-[12px] font-semibold rounded-md bg-brand-600 text-white py-1.5">Add</button>
            <button type="button" onClick={() => setOpen(false)}
                    className="text-[12px] rounded-md border border-ink-200 px-3 py-1.5 text-ink-600">Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)}
                className="w-full mt-3 text-[12px] rounded-md border border-dashed border-ink-300 py-1.5 text-ink-500 hover:bg-ink-50">
          + Add contact
        </button>
      ))}
    </div>
  );
}

export function ActivateLine({ storeId, stream, label, canEdit }: {
  storeId: number; stream: string; label: string; canEdit: boolean;
}) {
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return null;
  if (done) return <p className="text-[11px] font-semibold text-success-600 mt-3">Four tasks added</p>;
  return (
    <>
      <button type="button" disabled={pending}
              onClick={() => start(async () => {
                const r = await startActivation({ storeId, stream });
                if (!r.ok) { setErr(r.error ?? 'Could not start it'); return; }
                setDone(true);
              })}
              className="mt-3 text-[12px] font-semibold px-3 py-1.5 rounded-md border border-brand-100
                         bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50">
        {pending ? 'Adding…' : 'Start activation'}
      </button>
      {err && <p className="text-[10px] text-warn-600 mt-1.5 leading-tight">{err}</p>}
      <span className="sr-only">{label}</span>
    </>
  );
}
