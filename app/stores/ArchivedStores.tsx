'use client';

import { useState, useTransition } from 'react';
import { Archive, Loader2, Undo2 } from 'lucide-react';
import { runAction } from '../requests/runAction';
import { restoreStore } from './actions';
import { shortDate } from '@/lib/stores';

type Row = {
  store_id: number; name: string; city: string | null; source: string;
  reason: string | null; archived_at: string; archived_by: string | null; orders: number;
};

/**
 * What has been taken off the screen, and the way back.
 *
 * Shown only when there is something in it, and only to an admin — a fold-out
 * rather than a filter chip, because this is not a view of the queue, it is
 * the record of a decision somebody may need to undo. A remove with no visible
 * undo is a remove people are afraid to use, and then they work around it.
 */
export function ArchivedStores({ rows, canRestore }: { rows: Row[]; canRestore: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (rows.length === 0) return null;

  const restore = (id: number) => start(async () => {
    const r = await runAction(() => restoreStore(id));
    if (!r.ok) setError(r.error ?? 'That did not work');
    else setError(null);
  });

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-500 hover:text-ink-800
                   rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <Archive className="w-3.5 h-3.5" />
        {rows.length} archived store{rows.length === 1 ? '' : 's'}
        <span className="text-ink-400">{open ? '— hide' : '— show'}</span>
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-ink-200 bg-surface divide-y divide-ink-100">
          {rows.map((r) => (
            <div key={r.store_id}
                 className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <div className="flex-1 min-w-[200px]">
                <span className="text-[13px] font-medium text-ink-900">{r.name}</span>
                {r.city && <span className="text-[11px] text-ink-500 ml-2">{r.city}</span>}
                <span className="block text-[11px] text-ink-500">
                  {r.reason ?? 'No reason given'}
                  <span className="text-ink-400">
                    {' · '}{r.archived_by ?? 'a deleted user'}, {shortDate(r.archived_at)}
                  </span>
                </span>
              </div>
              {/* Said out loud, because "archived" reads like "gone" and the
                  orders are the reason it is archived and not deleted. */}
              <span className="text-[11px] text-ink-500 num">
                {r.orders > 0
                  ? `${r.orders.toLocaleString('en-IN')} orders kept`
                  : 'no orders'}
              </span>
              {canRestore && (
                <button
                  type="button"
                  onClick={() => restore(r.store_id)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md border border-ink-200
                             px-2.5 py-1 text-[11px] font-medium text-ink-700
                             hover:bg-ink-100 disabled:opacity-50"
                >
                  {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                  Put it back
                </button>
              )}
            </div>
          ))}
          {error && <p className="px-4 py-2 text-[12px] text-danger-500">{error}</p>}
        </div>
      )}
    </div>
  );
}
