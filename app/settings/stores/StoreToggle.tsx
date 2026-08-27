'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { runAction } from '../../requests/runAction';
import { setStoreTracked } from './actions';

/** On/off for one store. Optimistic label, real state from the server. */
export function StoreToggle({ storeId, tracked }: { storeId: number; tracked: boolean }) {
  const [on, setOn] = useState(tracked);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={pending}
        onClick={() => start(async () => {
          const next = !on;
          setOn(next);
          const r = await runAction(() => setStoreTracked(storeId, next));
          if (!r.ok) { setOn(!next); setErr(r.error ?? 'failed'); }
          else setErr(null);
        })}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition
          ${on ? 'bg-brand-500' : 'bg-ink-300'} disabled:opacity-50`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition
          ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      {pending && <Loader2 className="w-3 h-3 animate-spin text-ink-400" />}
      {err && <span className="text-[10px] text-danger-500">{err}</span>}
    </span>
  );
}
