'use client';

import { useState, useTransition } from 'react';
import { addTask } from '../actions';

/**
 * Three repeat options, not a recurrence engine.
 *
 * Monthly and quarterly are the cases the team has, and the next copy is
 * written when the current one is ticked rather than by a scheduler — so a
 * month nobody did the review shows up as one overdue task instead of a
 * backlog of twelve that everybody learns to ignore.
 */
export function NewTask({ accounts, people, meId }: {
  accounts: { store_id: number; store_name: string }[];
  people: { id: number; name: string }[];
  meId: number;
}) {
  const [storeId, setStoreId] = useState(String(accounts[0]?.store_id ?? ''));
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [who, setWho] = useState(String(meId));
  const [repeat, setRepeat] = useState('none');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault(); setErr(null);
        start(async () => {
          const r = await addTask({
            storeId: Number(storeId), title, dueOn: due || undefined,
            assigneeId: Number(who), repeat,
          });
          if (!r.ok) { setErr(r.error ?? 'Could not add it'); return; }
          setTitle(''); setDue('');
        });
      }}
      className="rounded-xl border border-ink-200 bg-surface px-4 py-4"
    >
      <div className="text-[10px] uppercase tracking-wide text-ink-500">New task</div>
      <div className="flex flex-wrap gap-2.5 mt-3 items-end">
        <div className="flex-[999_1_240px] min-w-0">
          <label htmlFor="t-title" className="block text-[11px] text-ink-500 mb-1">What has to happen</label>
          <input id="t-title" required value={title} onChange={(e) => setTitle(e.target.value)}
                 placeholder="Quarterly invoice reconciliation"
                 className="w-full text-[13px] rounded-md border border-ink-200 bg-surface px-2.5 py-2" />
        </div>
        <div>
          <label htmlFor="t-store" className="block text-[11px] text-ink-500 mb-1">Account</label>
          <select id="t-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}
                  className="text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-2 max-w-[200px]">
            {accounts.map((a) => <option key={a.store_id} value={a.store_id}>{a.store_name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="t-due" className="block text-[11px] text-ink-500 mb-1">Due</label>
          <input id="t-due" type="date" value={due} onChange={(e) => setDue(e.target.value)}
                 className="text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-2" />
        </div>
        <div>
          <label htmlFor="t-who" className="block text-[11px] text-ink-500 mb-1">Owner</label>
          <select id="t-who" value={who} onChange={(e) => setWho(e.target.value)}
                  className="text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-2">
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="t-rep" className="block text-[11px] text-ink-500 mb-1">Repeat</label>
          <select id="t-rep" value={repeat} onChange={(e) => setRepeat(e.target.value)}
                  className="text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-2">
            <option value="none">Never</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </div>
        <button type="submit" disabled={pending}
                className="text-[13px] font-semibold rounded-md bg-brand-600 text-white px-5 py-2 disabled:opacity-60">
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>
      {err && <p className="text-[12px] text-danger-500 mt-2">{err}</p>}
      <p className="text-[11px] text-ink-400 mt-3 leading-relaxed max-w-3xl">
        A repeating task writes its next copy the moment you tick this one, so a monthly review
        cannot quietly stop happening — and a month nobody did it shows up as one overdue task
        rather than a backlog.
      </p>
    </form>
  );
}
