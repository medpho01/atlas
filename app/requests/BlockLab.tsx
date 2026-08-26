'use client';

import { runAction } from './runAction';

import { useState, useTransition } from 'react';
import { Ban, Loader2 } from 'lucide-react';
import { blockLabForPincode } from './actions';

/**
 * "The console will not offer this lab here."
 *
 * The mapping in LabStack says the lab serves the pincode; the console applies
 * something further that Atlas cannot see. This is how the person who can see
 * both records which is right — once, for everyone, instead of re-discovering
 * it on every request in that pincode.
 */
export function BlockLab({ labId, pincode }: { labId: number; pincode: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  if (msg === 'done') return <span className="text-[10px] text-ink-400">removed</span>;

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={pending}
        title="The console will not offer this lab in this pincode — stop showing it"
        onClick={() => start(async () => {
          const r = await runAction(() => blockLabForPincode(labId, pincode, 'Console does not offer it here'));
          setMsg(r.ok ? 'done' : (r.error ?? 'failed'));
        })}
        className="inline-flex items-center gap-1 rounded border border-ink-200 text-ink-500
                   px-1.5 py-0.5 text-[11px] hover:bg-ink-100 hover:text-danger-500
                   disabled:opacity-50"
      >
        {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
        Not here
      </button>
      {msg && msg !== 'done' && <span className="text-[10px] text-danger-500">{msg}</span>}
    </span>
  );
}
