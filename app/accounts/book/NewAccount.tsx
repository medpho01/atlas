'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createAccount } from './actions';
import { startNav } from '@/components/ui/NavProgress';

/**
 * Three fields. An account starts in sales with a name and nothing else —
 * everything that makes it useful is typed later, by whoever learns it.
 */
export function NewAccount({ people, meId, types }: {
  people: { id: number; name: string }[];
  meId: number;
  types: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [type, setType] = useState('');
  const [owner, setOwner] = useState(String(meId));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const r = await createAccount({
        name, city, accountType: type || undefined, ownerId: Number(owner),
      });
      if (!r.ok) { setErr(r.error ?? 'Could not create it'); return; }
      setOpen(false); setName(''); setCity(''); setType('');
      startNav();
      if (r.id) router.push(`/accounts/book/${r.id}`);
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
              className="text-[12px] font-semibold rounded-md bg-brand-600 text-white px-3.5 py-1.5 hover:bg-brand-700">
        + New account
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="an" className="block text-[10px] uppercase tracking-wide text-ink-400 mb-1">Company</label>
        <input id="an" autoFocus value={name} onChange={(e) => setName(e.target.value)}
               placeholder="Nova Benefits"
               className="text-[12px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 w-[170px]" />
      </div>
      <div>
        <label htmlFor="ac" className="block text-[10px] uppercase tracking-wide text-ink-400 mb-1">City</label>
        <input id="ac" value={city} onChange={(e) => setCity(e.target.value)}
               placeholder="Bengaluru"
               className="text-[12px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 w-[120px]" />
      </div>
      <div>
        <label htmlFor="at" className="block text-[10px] uppercase tracking-wide text-ink-400 mb-1">Type</label>
        <select id="at" value={type} onChange={(e) => setType(e.target.value)}
                className="text-[12px] rounded-md border border-ink-200 bg-surface px-2 py-1.5 w-[140px]">
          <option value="">Not set</option>
          {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="ao" className="block text-[10px] uppercase tracking-wide text-ink-400 mb-1">Owner</label>
        <select id="ao" value={owner} onChange={(e) => setOwner(e.target.value)}
                className="text-[12px] rounded-md border border-ink-200 bg-surface px-2 py-1.5 w-[140px]">
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <button type="submit" disabled={pending}
              className="text-[12px] font-semibold rounded-md bg-brand-600 text-white px-3.5 py-1.5 hover:bg-brand-700">
        {pending ? 'Adding…' : 'Add'}
      </button>
      <button type="button" onClick={() => { setOpen(false); setErr(null); }}
              className="text-[12px] font-medium text-ink-500 px-2 py-1.5">Cancel</button>
      {err && <span className="text-[11px] text-danger-600">{err}</span>}
    </form>
  );
}
