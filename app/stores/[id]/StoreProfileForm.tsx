'use client';

import { useState, useTransition } from 'react';
import { Loader2, Save, ShieldAlert } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { UserCog } from 'lucide-react';
import { runAction } from '../../requests/runAction';
import { useActionFlash } from '@/components/ui/useActionFlash';
import { saveStoreProfile, setStoreQueueTracking, type ProfilePatch } from '../actions';

type Person = { id: number; name: string; role: string };

/**
 * The part of a store Atlas is allowed to change.
 *
 * Which is none of the store record. The name, the address, the
 * serviceability and whether the partner exists at all belong to LabStack and
 * are read here without ever being written. What this form holds is the layer
 * beside it: who runs the account, who to ring when an order stalls, and the
 * two thresholds that decide when this partner is worth interrupting somebody
 * about.
 *
 * Saying that on the card rather than only in a doc, because the gap between
 * "edit store" and what this actually does is exactly the sort of thing that
 * costs an afternoon when somebody expects an address change to reach the
 * console.
 */
export function StoreProfileForm({
  storeId, canEdit, isAdmin, owners, initial, tracked, updatedAt, updatedBy,
}: {
  storeId: number;
  canEdit: boolean;
  isAdmin: boolean;
  owners: Person[];
  initial: ProfilePatch;
  tracked: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}) {
  const [form, setForm] = useState<ProfilePatch>(initial);
  const [pending, start] = useTransition();
  // Not useState: a successful save revalidates, which unmounts this component
  // before the update lands, so every save looked like it had done nothing.
  // See useActionFlash.
  const [note, setNote] = useActionFlash(`store-profile-${storeId}`);
  const [isTracked, setIsTracked] = useState(tracked);

  const set = <K extends keyof ProfilePatch>(k: K, v: ProfilePatch[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setNote(null);
  };

  const save = () => start(async () => {
    const r = await runAction(() => saveStoreProfile(storeId, form));
    setNote(r.ok
      ? { kind: 'ok', text: 'Saved.' }
      : { kind: 'bad', text: r.error ?? 'That did not save' });
  });

  const toggleTracked = () => start(async () => {
    const next = !isTracked;
    // Optimistic, then corrected by the server. The real state is whatever
    // came back, never what was clicked.
    setIsTracked(next);
    const r = await runAction(() => setStoreQueueTracking(storeId, next));
    if (!r.ok) {
      setIsTracked(!next);
      setNote({ kind: 'bad', text: r.error ?? 'That did not work' });
    } else {
      setNote({
        kind: 'ok',
        text: next
          ? 'Back in the requests queue.'
          : 'Out of the requests queue. Nothing was deleted — its orders are still here.',
      });
    }
  });

  const field = 'w-full rounded-md border border-ink-200 bg-surface px-2 py-1.5 text-[13px] '
    + 'text-ink-900 placeholder:text-ink-400 outline-none focus:border-brand-500 '
    + 'disabled:opacity-60 disabled:cursor-not-allowed';
  const label = 'block text-[11px] uppercase tracking-wide text-ink-500 mb-1';

  return (
    <Card>
      <CardHeader
        title="How we run this account"
        subtitle="Atlas's own notes. The store record itself lives in LabStack."
        icon={<UserCog className="w-4 h-4" strokeWidth={2.25} />}
      />
      <CardBody className="pt-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className={label}>Account owner</span>
            <select
              value={form.ops_owner_id ?? ''}
              disabled={!canEdit || pending}
              onChange={(e) => set('ops_owner_id', e.target.value ? Number(e.target.value) : null)}
              className={field}
            >
              <option value="">Nobody</option>
              {owners.map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {p.role}</option>
              ))}
            </select>
          </label>

          <label>
            <span className={label}>Who to ring</span>
            <input
              value={form.ops_contact_name}
              disabled={!canEdit || pending}
              maxLength={120}
              onChange={(e) => set('ops_contact_name', e.target.value)}
              placeholder="Their operations lead"
              className={field}
            />
          </label>

          <label>
            <span className={label}>On this number</span>
            <input
              value={form.ops_contact_phone}
              disabled={!canEdit || pending}
              maxLength={40}
              onChange={(e) => set('ops_contact_phone', e.target.value)}
              placeholder="A number somebody answers"
              className={field}
            />
          </label>

          <label className="sm:col-span-2">
            <span className={label}>Email</span>
            <input
              type="email"
              value={form.ops_contact_email}
              disabled={!canEdit || pending}
              maxLength={200}
              onChange={(e) => set('ops_contact_email', e.target.value)}
              className={field}
            />
          </label>

          <label>
            <span className={label}>Delayed after (hours)</span>
            <input
              type="number"
              min={1}
              max={720}
              value={form.delay_alert_hours}
              disabled={!canEdit || pending}
              onChange={(e) => set('delay_alert_hours', Number(e.target.value))}
              className={field}
            />
            <span className="block text-[10px] text-ink-400 mt-1">
              Past the appointment and still unfinished. A camp settles in a day; a home
              collection in a small town does not.
            </span>
          </label>

          <label>
            <span className={label}>Flag when unscheduled reaches</span>
            <input
              type="number"
              min={1}
              max={10000}
              value={form.pending_alert_count}
              disabled={!canEdit || pending}
              onChange={(e) => set('pending_alert_count', Number(e.target.value))}
              className={field}
            />
            <span className="block text-[10px] text-ink-400 mt-1">
              How big the pile of orders with no date may get before the store is called out.
            </span>
          </label>

          <label className="sm:col-span-2">
            <span className={label}>Note</span>
            <textarea
              value={form.coverage_note}
              disabled={!canEdit || pending}
              maxLength={2000}
              rows={3}
              onChange={(e) => set('coverage_note', e.target.value)}
              placeholder="Anything about serving this partner that the console cannot hold."
              className={`${field} resize-y`}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          {canEdit ? (
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5
                         text-[12px] font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
          ) : (
            <p className="text-[12px] text-ink-500">
              Read-only for your role. Accounts, network leads and admins can change this.
            </p>
          )}

          {note && (
            <span className={`text-[12px] ${note.kind === 'ok' ? 'text-success-700' : 'text-danger-500'}`}>
              {note.text}
            </span>
          )}
        </div>

        {updatedAt && (
          <p className="text-[11px] text-ink-400 mt-2">
            Last changed {new Date(updatedAt).toLocaleString('en-IN', {
              day: 'numeric', month: 'short', year: 'numeric',
              hour: '2-digit', minute: '2-digit', hour12: false,
            })}{updatedBy ? ` by ${updatedBy}` : ''}.
          </p>
        )}

        {/* The nearest thing here to removing a store, kept visually apart from
            the fields above and behind a stricter role — it changes what other
            people see on a screen they are working, and a wrong click is
            invisible to them. */}
        <div className="mt-5 pt-4 border-t border-ink-150">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-md">
              <p className="text-[13px] font-medium text-ink-900">
                {isTracked ? 'In the requests queue' : 'Out of the requests queue'}
              </p>
              <p className="text-[11px] text-ink-500 mt-0.5">
                Taking a store out hides its requests and its filter chip from{' '}
                <span className="whitespace-nowrap">/requests</span>. Nothing is deleted, its
                orders stay on this page, and the queue keeps saying how many are hidden.
                Closing a partner properly is a console operation.
              </p>
            </div>
            {isAdmin ? (
              <button
                type="button"
                onClick={toggleTracked}
                disabled={pending}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5
                            text-[12px] font-medium disabled:opacity-50
                            ${isTracked
                              ? 'border-danger-100 bg-danger-50 text-danger-600 hover:bg-danger-100'
                              : 'border-ink-200 text-ink-700 hover:bg-ink-100'}`}
              >
                {pending && <Loader2 className="w-3 h-3 animate-spin" />}
                {isTracked ? 'Take out of the queue' : 'Put back in the queue'}
              </button>
            ) : (
              <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] text-ink-400">
                <ShieldAlert className="w-3.5 h-3.5" />
                Admins only
              </span>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
