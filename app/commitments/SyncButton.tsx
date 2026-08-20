'use client';

import { useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { syncCommitments } from '../requests/actions';

/**
 * The poller already runs every few minutes. This exists for the moment right
 * after someone moves an order in the console and comes back here expecting to
 * see it — that is exactly when a stale screen makes people stop trusting the
 * tool, and waiting five minutes to be believed is a bad trade.
 */
export function SyncButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          const r = await syncCommitments();
          setMsg(!r.ok ? (r.error ?? 'failed')
            : (r.opened || r.closed)
              ? `${r.opened ?? 0} opened, ${r.closed ?? 0} closed`
              : 'already up to date');
        })}
        className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 px-2.5 py-1.5
                   text-xs text-ink-700 hover:bg-ink-100 disabled:opacity-50"
        title="Check the console for orders that have moved on or off the placeholder lab"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${pending ? 'animate-spin' : ''}`} />
        Check console
      </button>
      {msg && <span className="text-[11px] text-ink-500">{msg}</span>}
    </span>
  );
}
