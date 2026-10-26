'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createDeal } from './actions';
import { startNav } from '@/components/ui/NavProgress';
import { DuplicateWarning } from '@/components/ui/DuplicateWarning';

/**
 * Opening an account.
 *
 * This was four fields in a row, which meant every deal arrived unsized, with
 * no contact and no first meeting — and nobody goes back to fill those in. The
 * form asks for them once, at the only moment somebody has them in front of
 * them, and still requires nothing but a company name: every other field is
 * blank-able, because a half-known account recorded beats a known one that
 * never got typed.
 */

const field = 'w-full text-[13px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 ' +
  'text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200';
const lbl = 'block text-[10px] uppercase tracking-wide text-ink-400 mb-1';
const section = 'text-[11px] font-bold uppercase tracking-wide text-ink-500';

export function NewDeal({ people, meId, types }: {
  people: { id: number; name: string }[];
  meId: number;
  types: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [f, setF] = useState({
    company: '', city: '', website: '', type: '', source: '',
    owner: String(meId), value: '', expectedClose: '',
    premium: '', opd: '', ticket: '',
    contactName: '', contactRole: '', contactPhone: '', contactEmail: '',
    isDm: false, firstMeeting: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const r = await createDeal({
        company: f.company, city: f.city, website: f.website,
        accountType: f.type || undefined, source: f.source,
        value: f.value.replace(/\D/g, ''), expectedClose: f.expectedClose,
        ownerId: Number(f.owner),
        premiumBookCr: f.premium, opdBookCr: f.opd, avgTicketInr: f.ticket,
        contactName: f.contactName, contactRole: f.contactRole,
        contactPhone: f.contactPhone, contactEmail: f.contactEmail,
        contactIsDecisionMaker: f.isDm,
        firstMeetingOn: f.firstMeeting,
      });
      if (!r.ok) { setErr(r.error ?? 'Could not create it'); return; }
      setOpen(false);
      startNav();
      if (r.id) router.push(`/sales/${r.id}`);
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
              className="text-[12px] font-semibold rounded-md bg-brand-600 text-white px-3.5 py-1.5 hover:bg-brand-700">
        + New deal
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-4 sm:p-8">
      <form onSubmit={submit}
            className="w-full max-w-[720px] rounded-xl border border-ink-200 bg-surface shadow-xl">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-ink-200">
          <h2 className="text-[15px] font-bold text-ink-900">New account</h2>
          <span className="text-[11px] text-ink-500">Only the company name is required</span>
          <button type="button" onClick={() => { setOpen(false); setErr(null); }}
                  aria-label="Close"
                  className="ml-auto text-[13px] text-ink-400 hover:text-ink-900 px-1">✕</button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <div>
            <div className={section}>The company</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5">
              <div className="sm:col-span-2">
                <label htmlFor="d-company" className={lbl}>Account name</label>
                <input id="d-company" autoFocus required value={f.company} onChange={set('company')}
                       placeholder="Alliance Insurance" className={field} />
                <div className="mt-2"><DuplicateWarning name={f.company} /></div>
              </div>
              <div>
                <label htmlFor="d-type" className={lbl}>Type of customer</label>
                <select id="d-type" value={f.type} onChange={set('type')} className={field}>
                  <option value="">Not set</option>
                  {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="d-city" className={lbl}>City</label>
                <input id="d-city" value={f.city} onChange={set('city')}
                       placeholder="Bengaluru" className={field} />
              </div>
              <div>
                <label htmlFor="d-site" className={lbl}>Website</label>
                <input id="d-site" value={f.website} onChange={set('website')}
                       placeholder="allianceinsurance.in" className={field} />
              </div>
              <div>
                <label htmlFor="d-owner" className={lbl}>Salesperson</label>
                <select id="d-owner" value={f.owner} onChange={set('owner')} className={field}>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div>
            <div className={section}>How big it could be</div>
            <p className="text-[11px] text-ink-500 mt-1">
              Typed, not inferred — nothing in our data knows what an account is worth to us until
              somebody says. The OPD book and the ticket together are what our share is measured against.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2.5">
              <div>
                <label htmlFor="d-premium" className={lbl}>Premium book ₹Cr / yr</label>
                <input id="d-premium" inputMode="decimal" value={f.premium} onChange={set('premium')}
                       placeholder="2400" className={`${field} num`} />
              </div>
              <div>
                <label htmlFor="d-opd" className={lbl}>Potential OPD book ₹Cr</label>
                <input id="d-opd" inputMode="decimal" value={f.opd} onChange={set('opd')}
                       placeholder="240" className={`${field} num`} />
              </div>
              <div>
                <label htmlFor="d-ticket" className={lbl}>Avg ticket ₹</label>
                <input id="d-ticket" inputMode="decimal" value={f.ticket} onChange={set('ticket')}
                       placeholder="850" className={`${field} num`} />
              </div>
              <div>
                <label htmlFor="d-value" className={lbl}>Deal value ₹</label>
                <input id="d-value" inputMode="numeric" value={f.value} onChange={set('value')}
                       placeholder="5000000" className={`${field} num`} />
              </div>
              <div>
                <label htmlFor="d-close" className={lbl}>Expected close</label>
                <input id="d-close" type="date" value={f.expectedClose} onChange={set('expectedClose')}
                       className={field} />
              </div>
              <div>
                <label htmlFor="d-source" className={lbl}>Where it came from</label>
                <input id="d-source" value={f.source} onChange={set('source')}
                       placeholder="Referral, inbound…" className={field} />
              </div>
            </div>
          </div>

          <div>
            <div className={section}>Who we are talking to</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5">
              <div>
                <label htmlFor="d-cname" className={lbl}>Contact person</label>
                <input id="d-cname" value={f.contactName} onChange={set('contactName')}
                       placeholder="Ankit Mehrotra" className={field} />
              </div>
              <div>
                <label htmlFor="d-crole" className={lbl}>Their role</label>
                <input id="d-crole" value={f.contactRole} onChange={set('contactRole')}
                       placeholder="Head of Benefits Ops" className={field} />
              </div>
              <div>
                <label htmlFor="d-cphone" className={lbl}>Phone</label>
                <input id="d-cphone" value={f.contactPhone} onChange={set('contactPhone')}
                       className={`${field} num`} />
              </div>
              <div>
                <label htmlFor="d-cemail" className={lbl}>Email</label>
                <input id="d-cemail" type="email" value={f.contactEmail} onChange={set('contactEmail')}
                       className={field} />
              </div>
              <div className="sm:col-span-2 flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2 text-[12px] text-ink-700">
                  <input type="checkbox" checked={f.isDm} onChange={set('isDm')} className="w-3.5 h-3.5" />
                  They are the decision maker
                </label>
                <div className="flex items-center gap-2">
                  <label htmlFor="d-met" className="text-[12px] text-ink-700">First meeting</label>
                  <input id="d-met" type="date" value={f.firstMeeting} onChange={set('firstMeeting')}
                         className="text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-1.5" />
                </div>
              </div>
            </div>
            <p className="text-[11px] text-ink-500 mt-2">
              More people — and whoever actually signs — are added on the account itself. A first
              meeting date here starts the clock the board reads.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 py-3.5 border-t border-ink-200">
          <button type="submit" disabled={pending || !f.company.trim()}
                  className="text-[13px] font-semibold rounded-md bg-brand-600 text-white px-4 py-2
                             hover:bg-brand-700 disabled:opacity-50">
            {pending ? 'Creating…' : 'Create account'}
          </button>
          <button type="button" onClick={() => { setOpen(false); setErr(null); }}
                  className="text-[13px] font-medium text-ink-500 px-2 py-2">Cancel</button>
          {err && <span className="text-[12px] text-danger-600">{err}</span>}
        </div>
      </form>
    </div>
  );
}
