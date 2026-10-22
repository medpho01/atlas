'use client';

import { useState, useTransition } from 'react';
import { setAccountManager } from './actions';

/**
 * Who owns the account, changed where it is read.
 *
 * Optimistic: an account manager reassigning fifteen accounts should not wait
 * for each one, and a failure rolls the one row back rather than the batch.
 */
export function ManagerPicker({
  storeId, value, people, canEdit, compact,
}: {
  storeId: number;
  value: number | null;
  people: { id: number; name: string }[];
  canEdit: boolean;
  compact?: boolean;
}) {
  const [shown, setShown] = useState<number | null>(value);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!canEdit) {
    return (
      <span className="text-[12px] text-ink-600">
        {people.find((p) => p.id === shown)?.name ?? 'Unassigned'}
      </span>
    );
  }

  return (
    <span>
      <label htmlFor={`mgr-${storeId}`} className="sr-only">Account manager</label>
      <select
        id={`mgr-${storeId}`}
        value={shown ?? ''}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value ? Number(e.target.value) : null;
          const before = shown;
          setShown(next); setErr(null);
          start(async () => {
            const r = await setAccountManager({ storeId, managerId: next });
            if (!r.ok) { setShown(before); setErr(r.error ?? 'Could not save'); }
          });
        }}
        className={`rounded-md border border-ink-200 bg-surface text-ink-700
                    ${compact ? 'text-[12px] px-1.5 py-0.5' : 'text-[13px] px-2.5 py-1.5'}
                    ${shown == null ? 'text-ink-400' : ''}`}
      >
        <option value="">Unassigned</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {err && <span className="block text-[10px] text-danger-500 mt-0.5">{err}</span>}
    </span>
  );
}
