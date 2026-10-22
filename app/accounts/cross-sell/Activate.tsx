'use client';

import { useState, useTransition } from 'react';
import { startActivation } from '../actions';

export function Activate({ storeId, stream, label, canEdit }: {
  storeId: number; stream: string; label: string; canEdit: boolean;
}) {
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!canEdit) return <span className="text-[11px] text-ink-400">Read-only</span>;
  if (done) return <span className="text-[11px] font-semibold text-success-600">4 tasks added</span>;

  return (
    <span>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setErr(null);
          start(async () => {
            const r = await startActivation({ storeId, stream });
            if (!r.ok) { setErr(r.error ?? 'Could not start it'); return; }
            setDone(true);
          });
        }}
        className="text-[11px] font-semibold px-2.5 py-1 rounded-md border border-brand-100
                   bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50"
      >
        {pending ? 'Adding…' : `Start ${label.toLowerCase()}`}
      </button>
      {err && <span className="block text-[10px] text-warn-600 mt-1 leading-tight">{err}</span>}
    </span>
  );
}
