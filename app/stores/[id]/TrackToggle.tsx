'use client';

import { useState, useTransition } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { runAction } from '../../requests/runAction';
import { setStoreTracked } from '../actions';

/**
 * Whether this partner is one the desk watches.
 *
 * Says what it does in the label rather than being a bare switch, because
 * "tracked" on its own does not tell you what changes — and what changes is
 * whether the two numbers beside it exist at all.
 */
export function TrackToggle({
  storeId, tracked, canEdit,
}: { storeId: number; tracked: boolean; canEdit: boolean }) {
  const [on, setOn] = useState(tracked);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (!canEdit) {
    return (
      <span className="text-[11px] text-ink-400">
        {on ? 'Tracked' : 'Not tracked'}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        aria-pressed={on}
        onClick={() => start(async () => {
          const next = !on;
          // Optimistic, then corrected by the server. The real state is
          // whatever came back, never what was clicked.
          setOn(next);
          const r = await runAction(() => setStoreTracked(storeId, next));
          if (!r.ok) { setOn(!next); setErr(r.error ?? 'That did not work'); }
          else setErr(null);
        })}
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5
                    text-[12px] font-medium transition disabled:opacity-50
                    ${on ? 'border-brand-100 bg-brand-50 text-brand-700 hover:bg-brand-100'
                         : 'border-ink-200 text-ink-700 hover:bg-ink-100'}`}
      >
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : on ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        {on ? 'Tracking this store' : 'Track this store'}
      </button>
      {/* Said out loud, because "stop tracking" reads like a delete. */}
      <span className="text-[10px] text-ink-400">
        {on ? 'Click to stop. Nothing is deleted.' : 'Counts its orders here.'}
      </span>
      {err && <span className="text-[11px] text-danger-500">{err}</span>}
    </span>
  );
}
