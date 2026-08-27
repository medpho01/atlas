'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { runAction } from './runAction';
import { refreshRequests } from './actions';

const ago = (iso: string | null) => {
  if (!iso) return null;
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
};

/**
 * Pull new requests on demand, and say how current the queue is.
 *
 * The freshness label matters more than the button. A queue fed by a poller
 * looks identical whether it is current or the pipeline died four days ago,
 * and that ambiguity has already cost an afternoon here.
 */
export function RefreshRequests({ newestAt }: { newestAt: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [secs, setSecs] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [at, setAt] = useState(newestAt);

  useEffect(() => { setAt(newestAt); }, [newestAt]);
  useEffect(() => {
    if (!pending) { setSecs(0); return; }
    const t = setInterval(() => setSecs((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [pending]);

  const stale = at ? Date.now() - new Date(at).getTime() > 36 * 3600_000 : false;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        title="Pull anything created in LabStack in the last six hours"
        onClick={() => start(async () => {
          const r = await runAction(() => refreshRequests());
          if (!r.ok) { setMsg(r.error ?? 'failed'); return; }
          const res = r as { synced?: number; newestAt?: string | null };
          setAt(res.newestAt ?? at);
          setMsg(res.synced ? `${res.synced} synced` : 'up to date');
          router.refresh();
        })}
        className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 px-2.5 py-1.5
                   text-xs text-ink-700 hover:bg-ink-100 disabled:opacity-50"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${pending ? 'animate-spin' : ''}`} />
        {pending ? `Checking… ${secs}s` : 'Check for new'}
      </button>
      {msg ? (
        <span className="text-[11px] text-ink-500">{msg}</span>
      ) : at ? (
        <span className={`text-[11px] ${stale ? 'text-warn-600' : 'text-ink-400'}`}>
          newest {ago(at)}
        </span>
      ) : null}
    </span>
  );
}
