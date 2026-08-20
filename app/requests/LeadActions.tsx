'use client';

import { useState, useTransition } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { promoteDiscoveredLab, dismissDiscoveredLab } from './actions';

/**
 * Two buttons on an unverified lead: it's real, or it isn't.
 *
 * Dismiss marks rather than deletes — the search cost is already paid, and a
 * lead that was wrong is worth remembering so the next run doesn't re-surface
 * it as a discovery.
 */
export function LeadActions({ leadId, promoted }: { leadId: number; promoted: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  if (promoted) return <span className="text-[10px] text-success-600">in CRM</span>;

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          const r = await promoteDiscoveredLab(leadId);
          setMsg(r.ok ? null : r.error ?? 'failed');
        })}
        className="inline-flex items-center gap-1 rounded border border-brand-200 bg-brand-50
                   text-brand-700 px-1.5 py-0.5 text-[11px] hover:bg-brand-100 disabled:opacity-50"
      >
        {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
        Add to CRM
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { await dismissDiscoveredLab(leadId); })}
        className="inline-flex items-center gap-1 rounded border border-ink-200 text-ink-500
                   px-1.5 py-0.5 text-[11px] hover:bg-ink-100 disabled:opacity-50"
        title="Not a real lab, or not usable"
      >
        <X className="w-3 h-3" /> Dismiss
      </button>
      {msg && <span className="text-[10px] text-danger-500">{msg}</span>}
    </span>
  );
}
