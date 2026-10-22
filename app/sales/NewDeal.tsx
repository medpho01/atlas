'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createDeal } from './actions';
import { startNav } from '@/components/ui/NavProgress';

/** Four fields. A longer form at the moment of capture is a deal nobody logs. */
export function NewDeal({ people, meId }: { people: { id: number; name: string }[]; meId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState('');
  const [city, setCity] = useState('');
  const [value, setValue] = useState('');
  const [owner, setOwner] = useState(String(meId));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const r = await createDeal({ company, city, value, ownerId: Number(owner) });
      if (!r.ok) { setErr(r.error ?? 'Could not create it'); return; }
      setOpen(false); setCompany(''); setCity(''); setValue('');
      startNav();
      if (r.id) router.push(`/sales/${r.id}`);
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
              className="text-[12px] font-semibold rounded-md bg-brand-600 text-white px-3.5 py-1.5 hover:bg-brand-700">
        + New deal
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="company" className="block text-[10px] uppercase tracking-wide text-ink-400 mb-1">Company</label>
        <input id="company" autoFocus required value={company} onChange={(e) => setCompany(e.target.value)}
               placeholder="Nova Benefits"
               className="text-[12px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 w-[190px]" />
      </div>
      <div>
        <label htmlFor="city" className="block text-[10px] uppercase tracking-wide text-ink-400 mb-1">City</label>
        <input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Bengaluru"
               className="text-[12px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 w-[130px]" />
      </div>
      <div>
        <label htmlFor="value" className="block text-[10px] uppercase tracking-wide text-ink-400 mb-1">Value ₹</label>
        <input id="value" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
               placeholder="600000"
               className="text-[12px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 w-[110px] num" />
      </div>
      <div>
        <label htmlFor="owner" className="block text-[10px] uppercase tracking-wide text-ink-400 mb-1">Owner</label>
        <select id="owner" value={owner} onChange={(e) => setOwner(e.target.value)}
                className="text-[12px] rounded-md border border-ink-200 bg-surface px-2 py-1.5 w-[140px]">
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <button type="submit" disabled={pending}
              className="text-[12px] font-semibold rounded-md bg-brand-600 text-white px-3.5 py-1.5 hover:bg-brand-700 disabled:opacity-60">
        {pending ? 'Adding…' : 'Add'}
      </button>
      <button type="button" onClick={() => { setOpen(false); setErr(null); }}
              className="text-[12px] rounded-md border border-ink-200 px-3 py-1.5 text-ink-600">
        Cancel
      </button>
      {err && <p className="w-full text-[11px] text-danger-500">{err}</p>}
    </form>
  );
}
