'use client';

import { useState, useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2, Archive, AlertTriangle } from 'lucide-react';
import { startNav } from '@/components/ui/NavProgress';
import { runAction } from '../../requests/runAction';
import { planStoreRemoval, removeStore, type RemovalPlan } from '../actions';

/**
 * Remove a store, having first asked what that would actually mean.
 *
 * Two different things wear the same word, and which one happens is decided by
 * the data rather than by the button:
 *
 *   · a store Atlas created with nothing behind it  → deleted
 *   · anything else                                 → archived, because Atlas
 *     cannot delete a LabStack record, and deleting one with orders behind it
 *     would leave the ledger pointing at nothing
 *
 * So the confirmation is fetched, not assumed. It names the store, says which
 * of the two will happen and why, and the server re-derives the whole thing
 * before acting — the dialog may have been open a while, and an order can
 * arrive in that time.
 */
export function RemoveStore({
  storeId, storeName, autoOpen = false,
}: {
  storeId: number;
  storeName: string;
  /**
   * Fetch the plan straight away instead of waiting for a click.
   *
   * Set from the store list, where the row's bin icon has already said
   * "remove" — showing a second button labelled the same thing is a step that
   * asks the same question twice.
   */
  autoOpen?: boolean;
}) {
  const [plan, setPlan] = useState<RemovalPlan | null>(null);
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const router = useRouter();

  const open = () => start(async () => {
    setError(null);
    const r = await runAction(() => planStoreRemoval(storeId));
    if (r.ok && 'plan' in r) setPlan(r.plan as RemovalPlan);
    else setError((r as { error?: string }).error ?? 'Could not work out what removing this would do');
  });

  // Once, on mount, and only when asked. A ref rather than a dependency on
  // `open` so a re-render cannot fire a second plan request.
  const opened = useRef(false);
  useEffect(() => {
    if (autoOpen && !opened.current) { opened.current = true; open(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  const close = () => { setPlan(null); setReason(''); setConfirmName(''); setError(null); };

  const go = () => start(async () => {
    const r = await runAction(() => removeStore(storeId, reason));
    if (r.ok) {
      startNav();
      router.push('/stores');
    } else {
      setError(r.error ?? 'That did not work');
    }
  });

  if (!plan) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={open}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-danger-100
                     bg-danger-50 px-3 py-1.5 text-[12px] font-medium text-danger-600
                     hover:bg-danger-100 disabled:opacity-50"
        >
          {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          Remove this store
        </button>
        {error && <span className="text-[12px] text-danger-500">{error}</span>}
      </div>
    );
  }

  const deleting = plan.mode === 'delete';
  // Typing the name is asked for only where the action cannot be undone.
  const nameMatches = !deleting || confirmName.trim() === plan.name.trim();

  return (
    <div className="rounded-lg border border-danger-100 bg-danger-50 px-4 py-3.5">
      <p className="flex items-start gap-2 text-[13px] font-semibold text-ink-900">
        {deleting
          ? <Trash2 className="w-4 h-4 shrink-0 mt-px text-danger-600" />
          : <Archive className="w-4 h-4 shrink-0 mt-px text-warn-600" />}
        {deleting
          ? `Delete ${plan.name}?`
          : `Archive ${plan.name}?`}
      </p>

      <div className="text-[12px] text-ink-700 mt-2 space-y-1.5">
        {deleting ? (
          <p>
            Nothing is behind this store — no orders, no requests, no flags — and Atlas owns the
            record, so it will be <b>deleted outright</b>. This cannot be undone.
          </p>
        ) : (
          <>
            <p>
              It will be <b>hidden from Stores &amp; Orders</b>. Nothing is deleted: the store
              record and everything behind it stay exactly where they are, and every report
              that reads them keeps reading them. You can put it back.
            </p>
            {(plan.orders > 0 || plan.requests > 0 || plan.flags > 0) && (
              <p className="flex items-start gap-1.5 text-ink-600">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                <span>
                  Behind it:{' '}
                  {[
                    plan.orders > 0 && `${plan.orders.toLocaleString('en-IN')} order${plan.orders === 1 ? '' : 's'}`,
                    plan.requests > 0 && `${plan.requests.toLocaleString('en-IN')} request${plan.requests === 1 ? '' : 's'}`,
                    plan.flags > 0 && `${plan.flags} open reschedule flag${plan.flags === 1 ? '' : 's'}`,
                  ].filter(Boolean).join(', ')}.
                </span>
              </p>
            )}
            {!plan.atlasOwned && (
              <p className="text-ink-600">
                This store belongs to LabStack, so Atlas cannot delete it. Closing a partner
                properly is a console operation.
              </p>
            )}
          </>
        )}
      </div>

      <div className="mt-3 space-y-2.5">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-wide text-ink-500 mb-1">
            Why? *
          </span>
          <input
            autoFocus
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError(null); }}
            maxLength={400}
            placeholder={deleting ? 'Added by mistake' : 'Partnership ended in September'}
            className="w-full rounded-md border border-ink-200 bg-surface px-2.5 py-1.5
                       text-[13px] text-ink-900 placeholder:text-ink-400 outline-none
                       focus:border-brand-500"
          />
        </label>

        {deleting && (
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wide text-ink-500 mb-1">
              Type <b className="text-ink-800">{plan.name}</b> to confirm
            </span>
            <input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              className="w-full rounded-md border border-ink-200 bg-surface px-2.5 py-1.5
                         text-[13px] text-ink-900 outline-none focus:border-brand-500"
            />
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button
          type="button"
          onClick={go}
          disabled={pending || !reason.trim() || !nameMatches}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px]
                      font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed
                      ${deleting ? 'bg-danger-600 hover:bg-danger-700' : 'bg-ink-900 hover:bg-ink-800'}`}
        >
          {pending
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : deleting ? <Trash2 className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
          {deleting ? 'Delete permanently' : 'Archive it'}
        </button>
        <button type="button" onClick={close} disabled={pending}
                className="text-[12px] text-ink-600 hover:underline">
          Cancel
        </button>
        {error && <span className="text-[12px] text-danger-500">{error}</span>}
      </div>
    </div>
  );
}
