'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Plus, Info } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { startNav } from '@/components/ui/NavProgress';
import { runAction } from '../../requests/runAction';
import { createStore, type NewStore } from '../actions';

const EMPTY: NewStore = {
  store_name: '', legal_name: '', store_type: 'CLINIC',
  address: '', locality: '', city: '', state: '', pincode: '',
  contact_name: '', contact_phone: '', contact_email: '',
  service_pincodes: '', note: '',
};

/**
 * Add a partner.
 *
 * The store lands in Atlas's own table, not in LabStack's. That distinction is
 * on the form rather than only in a doc, because somebody adding a partner
 * here reasonably expects the console to know about it — and it will not, until
 * the console is told separately. A form that hid that would be setting up a
 * morning of "why can't I take their order".
 */
export function NewStoreForm() {
  const [form, setForm] = useState<NewStore>(EMPTY);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const set = <K extends keyof NewStore>(k: K, v: NewStore[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(null);
  };

  const submit = () => start(async () => {
    const r = await runAction(() => createStore(form));
    if (r.ok) {
      // Straight to the store, which is the only useful next screen — there is
      // nothing to look at back on the list that is not on the store itself.
      startNav();
      router.push(`/stores/${(r as { id?: number }).id}`);
    } else {
      setError(r.error ?? 'The store was not created');
    }
  });

  const field = 'w-full rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 text-[13px] '
    + 'text-ink-900 placeholder:text-ink-400 outline-none focus:border-brand-500 '
    + 'disabled:opacity-60';
  const label = 'block text-[11px] uppercase tracking-wide text-ink-500 mb-1';

  return (
    <Card>
      <CardBody className="pt-5">
        <p className="flex items-start gap-2 text-[12px] text-ink-600 bg-ink-50
                      border border-ink-150 rounded-lg px-3 py-2.5 mb-5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px text-ink-400" />
          <span>
            This adds the partner to <b>Atlas</b>. It does not create them in LabStack, so the
            console cannot take an order for them until somebody adds them there too. The
            store will show as <b>Atlas-side</b> until it appears in the console and syncs.
          </span>
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className={label}>Store name *</span>
            <input
              autoFocus
              value={form.store_name}
              disabled={pending}
              maxLength={160}
              onChange={(e) => set('store_name', e.target.value)}
              placeholder="Riverbend Clinic"
              className={field}
            />
          </label>

          <label>
            <span className={label}>Legal name</span>
            <input value={form.legal_name} disabled={pending} maxLength={160}
                   onChange={(e) => set('legal_name', e.target.value)}
                   placeholder="Riverbend Pvt Ltd" className={field} />
          </label>

          <label>
            <span className={label}>Type</span>
            <select value={form.store_type} disabled={pending}
                    onChange={(e) => set('store_type', e.target.value)} className={field}>
              <option value="CLINIC">Clinic</option>
              <option value="CORPORATE">Corporate</option>
              <option value="HOSPITAL">Hospital</option>
              <option value="PHARMACY">Pharmacy</option>
              <option value="OTHER">Other</option>
            </select>
          </label>

          <div className="sm:col-span-2 border-t border-ink-100 pt-4">
            <p className="text-[11px] uppercase tracking-wide text-ink-400 mb-3">Location</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className={label}>Address</span>
                <input value={form.address} disabled={pending} maxLength={300}
                       onChange={(e) => set('address', e.target.value)}
                       placeholder="12, Partner Avenue" className={field} />
              </label>
              <label>
                <span className={label}>Locality</span>
                <input value={form.locality} disabled={pending} maxLength={120}
                       onChange={(e) => set('locality', e.target.value)} className={field} />
              </label>
              <label>
                <span className={label}>City</span>
                <input value={form.city} disabled={pending} maxLength={80}
                       onChange={(e) => set('city', e.target.value)}
                       placeholder="Mumbai" className={field} />
              </label>
              <label>
                <span className={label}>State</span>
                <input value={form.state} disabled={pending} maxLength={80}
                       onChange={(e) => set('state', e.target.value)}
                       placeholder="Maharashtra" className={field} />
              </label>
              <label>
                <span className={label}>Pincode</span>
                <input value={form.pincode} disabled={pending} maxLength={6} inputMode="numeric"
                       onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))}
                       placeholder="400001" className={`${field} num`} />
              </label>
            </div>
          </div>

          <div className="sm:col-span-2 border-t border-ink-100 pt-4">
            <p className="text-[11px] uppercase tracking-wide text-ink-400 mb-3">Contact</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <label>
                <span className={label}>Name</span>
                <input value={form.contact_name} disabled={pending} maxLength={120}
                       onChange={(e) => set('contact_name', e.target.value)} className={field} />
              </label>
              <label>
                <span className={label}>Phone</span>
                <input value={form.contact_phone} disabled={pending} maxLength={40}
                       onChange={(e) => set('contact_phone', e.target.value)} className={field} />
              </label>
              <label>
                <span className={label}>Email</span>
                <input type="email" value={form.contact_email} disabled={pending} maxLength={200}
                       onChange={(e) => set('contact_email', e.target.value)} className={field} />
              </label>
            </div>
          </div>

          <div className="sm:col-span-2 border-t border-ink-100 pt-4">
            <p className="text-[11px] uppercase tracking-wide text-ink-400 mb-3">
              Service coverage
            </p>
            <label>
              <span className={label}>Pincodes this partner sends work from</span>
              <textarea
                value={form.service_pincodes}
                disabled={pending}
                rows={2}
                onChange={(e) => set('service_pincodes', e.target.value)}
                placeholder="400001, 400002, 400003"
                className={`${field} resize-y num`}
              />
              <span className="block text-[10px] text-ink-400 mt-1">
                Separated by commas or spaces. Leave it empty if you do not know yet — it can
                be filled in later and nothing depends on it being right today.
              </span>
            </label>
          </div>

          <label className="sm:col-span-2">
            <span className={label}>Note</span>
            <textarea value={form.note} disabled={pending} rows={2} maxLength={2000}
                      onChange={(e) => set('note', e.target.value)}
                      placeholder="Anything about this partner worth knowing."
                      className={`${field} resize-y`} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-6 pt-4 border-t border-ink-150">
          <button
            type="button"
            onClick={submit}
            disabled={pending || !form.store_name.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3.5 py-2
                       text-[13px] font-medium text-white hover:bg-brand-700
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add the store
          </button>
          <Link href="/stores" onClick={() => startNav()}
                className="text-[13px] text-ink-500 hover:underline">
            Cancel
          </Link>
          {error && <span className="text-[12px] text-danger-500">{error}</span>}
        </div>
      </CardBody>
    </Card>
  );
}
