'use client';

import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { createProvider, checkProviderDuplicates, type DupStatus } from './actions';
import { PROVIDER_KINDS } from '@/lib/providerKinds';

/**
 * Add a provider, from anywhere.
 *
 * Lifted out of the thread board so the queue can open it too — there was no
 * way to create a provider without first navigating into a campaign, which is
 * backwards when the thread is a field on the form.
 */
export function AddProviderModal({ threadId, threads, defaultKind, onClose }: {
  threadId: number;
  threads: { id: number; name: string }[];
  defaultKind: string;
  onClose: () => void;
}) {
  // Defaults to the board you are on, which is nearly always right — but a
  // provider found while working one campaign often belongs to another, and
  // having to close, navigate and re-type was the reason people did not bother.
  const [target, setTarget] = useState(threadId);
  const [form, setForm] = useState({
    name: '', kind: defaultKind, city: '', state: '', pincode: '',
    phone: '', email: '', contactPerson: '', notes: '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [dup, setDup] = useState<DupStatus | null>(null);
  const [similar, setSimilar] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  // Checked as the name is typed, so a duplicate is visible before the form is
  // filled in rather than after it's submitted.
  const checkName = (name: string) => {
    setDup(null); setSimilar([]);
    if (!name.trim()) return;
    startTransition(async () => {
      const res = await checkProviderDuplicates({ threadId, names: [name.trim()] });
      setDup(res.statuses?.[name.trim()] ?? null);
      setSimilar(res.similar?.[name.trim()] ?? []);
    });
  };

  const submit = () => {
    if (dup === 'in_thread') return;
    startTransition(async () => {
      const res = await createProvider({ threadId: target, ...form });
      if (!res.ok) { setErr(res.error ?? 'Failed'); return; }
      window.location.reload();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[15px] font-bold text-ink-900">Add provider</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-900"><X className="w-4 h-4" /></button>
        </div>

        {threads.length > 1 && (
          <label className="block mb-2">
            <span className="text-[11px] uppercase tracking-wide text-ink-400">Thread</span>
            <select
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              className="mt-1 w-full h-9 px-2 text-sm rounded-md border border-ink-200 bg-surface"
            >
              {threads.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
        )}

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
        {dup === 'new' && similar.length > 0 && (
          <div className="mt-2 rounded-md border border-warn-200 bg-warn-50 px-3 py-2">
            <p className="text-sm text-warn-700">
              Already on the board under {similar.length === 1 ? 'a similar name' : 'similar names'}?
            </p>
            <ul className="mt-1 space-y-0.5">
              {similar.map((nm) => (
                <li key={nm} className="text-sm font-medium text-ink-900">{nm}</li>
              ))}
            </ul>
            <p className="text-[11px] text-warn-700 mt-1.5">
              Add it anyway only if this is genuinely a different provider.
            </p>
          </div>
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
