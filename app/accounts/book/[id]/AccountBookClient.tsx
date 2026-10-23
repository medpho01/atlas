'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  logMeeting, addContact, removeContact, setService, clearService,
  updateAccount, updateSizing, moveStage, addTask, toggleTask,
} from '../actions';
import {
  CADENCES, CADENCE_LABEL, MEETING_KIND_LABEL, SERVICE_STATUS_LABEL,
  STAGE_LABEL, STAGES, LINE_LABEL, LINES,
  type Account, type Contact, type Meeting, type Service, type Task,
} from '@/lib/lifecycleKinds';
import { startNav } from '@/components/ui/NavProgress';

type Person = { id: number; name: string };

const card = 'rounded-xl border border-ink-200 bg-surface';
const input = 'text-[13px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 w-full';
const label = 'block text-[10px] uppercase tracking-wide text-ink-400 mb-1';

// ---------------------------------------------------------------- the sizing

/**
 * The two book sizes and what one service is worth. Nothing in our data can
 * infer any of them, and without the ticket a ₹Cr book cannot become a number
 * of services — so share stays blank rather than resting on a made-up constant.
 */
export function Sizing({ account, canEdit }: { account: Account; canEdit: boolean }) {
  const [premium, setPremium] = useState(account.premium_book_cr ?? '');
  const [opd, setOpd] = useState(account.opd_book_cr ?? '');
  const [ticket, setTicket] = useState(account.avg_ticket_inr ?? '');
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!canEdit) {
    return (
      <div className={`${card} p-4`}>
        <div className="text-[10px] uppercase tracking-wide text-ink-400">How big this account is</div>
        <div className="grid grid-cols-3 gap-3 mt-3 text-[13px]">
          <div><div className="text-ink-500 text-[11px]">Premium book</div>
            <div className="font-bold num">{account.premium_book_cr ? `₹${account.premium_book_cr} Cr` : '—'}</div></div>
          <div><div className="text-ink-500 text-[11px]">OPD book</div>
            <div className="font-bold num">{account.opd_book_cr ? `₹${account.opd_book_cr} Cr` : '—'}</div></div>
          <div><div className="text-ink-500 text-[11px]">Avg ticket</div>
            <div className="font-bold num">{account.avg_ticket_inr ? `₹${account.avg_ticket_inr}` : '—'}</div></div>
        </div>
      </div>
    );
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      await updateSizing({
        accountId: account.account_id,
        premiumBookCr: String(premium), opdBookCr: String(opd), avgTicketInr: String(ticket),
      });
      setSaved(true); setTimeout(() => setSaved(false), 1600);
      router.refresh();
    });
  };

  return (
    <form onSubmit={save} className={`${card} p-4`}>
      <div className="flex items-baseline gap-2">
        <div className="text-[10px] uppercase tracking-wide text-ink-400">How big this account is</div>
        <span className="text-[11px] text-ink-500">typed by sales — nothing in our data can infer it</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        <div>
          <label htmlFor="pb" className={label}>Premium book ₹Cr</label>
          <input id="pb" value={premium} onChange={(e) => setPremium(e.target.value)}
                 inputMode="decimal" placeholder="2400" className={`${input} num`} />
        </div>
        <div>
          <label htmlFor="ob" className={label}>Potential OPD book ₹Cr</label>
          <input id="ob" value={opd} onChange={(e) => setOpd(e.target.value)}
                 inputMode="decimal" placeholder="240" className={`${input} num`} />
        </div>
        <div>
          <label htmlFor="tk" className={label}>Avg ticket ₹</label>
          <input id="tk" value={ticket} onChange={(e) => setTicket(e.target.value)}
                 inputMode="decimal" placeholder="850" className={`${input} num`} />
        </div>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button type="submit" disabled={pending}
                className="text-[12px] font-semibold rounded-md border border-ink-200 px-3 py-1.5 text-ink-700">
          {pending ? 'Saving…' : saved ? 'Saved' : 'Save sizing'}
        </button>
        <span className="text-[11px] text-ink-500">
          {account.services_expected
            ? `≈ ${Number(account.services_expected).toLocaleString('en-IN')} services a year at that ticket`
            : 'Both the book and the ticket are needed before share can be shown'}
        </span>
      </div>
    </form>
  );
}

// --------------------------------------------------------------- stage + owner

export function StageControl({ account, people, canEdit }: {
  account: Account; people: Person[]; canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canEdit) return null;

  const move = (stage: string) => start(async () => {
    await moveStage({ accountId: account.account_id, stage });
    startNav(); router.refresh();
  });

  const setOwner = (id: string) => start(async () => {
    await updateAccount({ accountId: account.account_id, ownerId: Number(id) });
    router.refresh();
  });

  const setCadence = (c: string) => start(async () => {
    await updateAccount({ accountId: account.account_id, cadence: c });
    router.refresh();
  });

  return (
    <div className={`${card} p-4 space-y-3`}>
      <div>
        <div className={label}>Stage</div>
        <div className="flex flex-wrap gap-1.5">
          {STAGES.map((s) => (
            <button key={s} type="button" disabled={pending} onClick={() => move(s)}
                    className={`text-[12px] px-2.5 py-1 rounded-md border ${
                      account.lifecycle === s
                        ? 'border-brand-400 bg-brand-50 text-brand-400 font-semibold'
                        : 'border-ink-200 text-ink-600 hover:border-ink-300'}`}>
              {STAGE_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="own" className={label}>Owner</label>
        <select id="own" value={String(account.owner_id ?? '')} disabled={pending}
                onChange={(e) => setOwner(e.target.value)} className={input}>
          <option value="">Unassigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="cad" className={label}>Review cadence</label>
        <select id="cad" value={account.review_cadence} disabled={pending}
                onChange={(e) => setCadence(e.target.value)} className={input}>
          {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
        </select>
        <p className="text-[10px] text-ink-400 mt-1.5 leading-snug">
          The cadence belongs to the account, not to a task, so the rhythm cannot stop because
          somebody deleted a reminder. The next review is simply the last one plus the interval.
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- meetings

export function Meetings({ accountId, meetings, people, canEdit }: {
  accountId: number; meetings: Meeting[]; people: Person[]; canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('meeting');
  const [when, setWhen] = useState<'happened' | 'scheduled'>('happened');
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState('');
  const [attendees, setAttendees] = useState('');
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState('');
  const [stepDue, setStepDue] = useState('');
  const [stepOwner, setStepOwner] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const r = await logMeeting({
        accountId, kind,
        happenedOn: when === 'happened' ? on : undefined,
        scheduledOn: when === 'scheduled' ? on : undefined,
        title, attendees, notes,
        nextStep: step, nextStepDue: stepDue,
        nextStepOwnerId: stepOwner ? Number(stepOwner) : undefined,
      });
      if (!r.ok) { setErr(r.error ?? 'Could not save it'); return; }
      setOpen(false); setTitle(''); setAttendees(''); setNotes('');
      setStep(''); setStepDue(''); setStepOwner('');
      router.refresh();
    });
  };

  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-[14px] font-bold text-ink-900">Meetings</h2>
        <span className="text-[11px] text-ink-500">
          {meetings.filter((m) => m.happened_on).length} done
        </span>
        {canEdit && !open && (
          <button type="button" onClick={() => setOpen(true)}
                  className="ml-auto text-[12px] font-semibold rounded-md bg-brand-600 text-white px-3 py-1.5 hover:bg-brand-700">
            + Log a meeting
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="mt-3 rounded-lg border border-ink-200 bg-ink-50/40 p-3 space-y-2.5">
          <div className="flex flex-wrap gap-2">
            <div>
              <label htmlFor="mk" className={label}>Kind</label>
              <select id="mk" value={kind} onChange={(e) => setKind(e.target.value)}
                      className="text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-1.5">
                {Object.entries(MEETING_KIND_LABEL).map(([k, v]) =>
                  <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="mw" className={label}>When</label>
              <select id="mw" value={when} onChange={(e) => setWhen(e.target.value as any)}
                      className="text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-1.5">
                <option value="happened">It happened</option>
                <option value="scheduled">It is booked</option>
              </select>
            </div>
            <div>
              <label htmlFor="md" className={label}>Date</label>
              <input id="md" type="date" value={on} onChange={(e) => setOn(e.target.value)}
                     className="text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-1.5" />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label htmlFor="mt" className={label}>What it was about</label>
              <input id="mt" value={title} onChange={(e) => setTitle(e.target.value)}
                     placeholder="Rate card review" className={input} />
            </div>
          </div>
          <div>
            <label htmlFor="ma" className={label}>Who was there</label>
            <input id="ma" value={attendees} onChange={(e) => setAttendees(e.target.value)}
                   placeholder="Priya Nair, Ankit Mehrotra" className={input} />
          </div>
          <div>
            <label htmlFor="mn" className={label}>Notes</label>
            <textarea id="mn" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
                      placeholder="What was said, and what they actually want."
                      className={`${input} resize-y`} />
          </div>
          <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-2.5">
            <div className="text-[10px] uppercase tracking-wide text-brand-400 mb-1.5">Next step</div>
            <div className="flex flex-wrap gap-2">
              <input value={step} onChange={(e) => setStep(e.target.value)}
                     aria-label="Next step"
                     placeholder="Send the two-band rate card"
                     className="text-[13px] rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 flex-1 min-w-[180px]" />
              <input type="date" value={stepDue} onChange={(e) => setStepDue(e.target.value)}
                     aria-label="Next step due"
                     className="text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-1.5" />
              <select value={stepOwner} onChange={(e) => setStepOwner(e.target.value)}
                      aria-label="Next step owner"
                      className="text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-1.5">
                <option value="">Me</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <p className="text-[10px] text-ink-500 mt-1.5">
              A next step with a date also becomes a task — an agreement nobody is chased for is a note.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending}
                    className="text-[12px] font-semibold rounded-md bg-brand-600 text-white px-3.5 py-1.5">
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => { setOpen(false); setErr(null); }}
                    className="text-[12px] text-ink-500">Cancel</button>
            {err && <span className="text-[11px] text-danger-600">{err}</span>}
          </div>
        </form>
      )}

      {meetings.length === 0 ? (
        <p className="text-[12px] text-ink-400 py-6">Nothing logged yet.</p>
      ) : (
        <ol className="mt-4 border-l border-ink-200 pl-4 space-y-4">
          {meetings.map((m) => (
            <li key={m.id} className="relative">
              <span className={`absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-surface ${
                m.scheduled_on ? 'bg-brand-600' : 'bg-ink-300'}`} />
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[13px] font-bold text-ink-900">{m.scheduled_on ?? m.happened_on}</span>
                {m.scheduled_on && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-400 border border-brand-100">
                    booked
                  </span>
                )}
                {(m.kind === 'mbr' || m.kind === 'qbr') && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-success-50 text-success-700 border border-success-100">
                    {MEETING_KIND_LABEL[m.kind]}
                  </span>
                )}
                <span className="text-[12px] text-ink-600">
                  {[m.title, m.attendees].filter(Boolean).join(' · ')}
                </span>
              </div>
              {m.notes && <p className="text-[12px] text-ink-700 mt-1 whitespace-pre-line">{m.notes}</p>}
              {m.next_step && (
                <div className="mt-2 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-brand-400">Next step</div>
                  <div className="text-[12px] text-ink-900 mt-0.5">
                    {m.next_step}
                    {m.next_step_owner && <> — <b>{m.next_step_owner}</b></>}
                    {m.next_step_due && <> · due {m.next_step_due}</>}
                    {m.next_step_late && <span className="text-danger-600 font-semibold"> · late</span>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- contacts

export function Contacts({ accountId, contacts, canEdit }: {
  accountId: number; contacts: Contact[]; canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [dm, setDm] = useState(false);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      await addContact({ accountId, name, role, phone, email, decisionMaker: dm });
      setOpen(false); setName(''); setRole(''); setPhone(''); setEmail(''); setDm(false);
      router.refresh();
    });
  };

  const drop = (id: number) => start(async () => {
    await removeContact({ accountId, contactId: id });
    router.refresh();
  });

  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center">
        <div className="text-[10px] uppercase tracking-wide text-ink-400">People</div>
        {canEdit && !open && (
          <button type="button" onClick={() => setOpen(true)}
                  className="ml-auto text-[11px] font-semibold rounded-md border border-ink-200 px-2.5 py-1 text-ink-600">
            + Add
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="mt-3 space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
                 aria-label="Name" placeholder="Dr. Sunita Rao" className={input} />
          <input value={role} onChange={(e) => setRole(e.target.value)}
                 aria-label="Their role" placeholder="Head of Claims" className={input} />
          <div className="flex gap-2">
            <input value={phone} onChange={(e) => setPhone(e.target.value)}
                   aria-label="Phone" placeholder="Phone" className={`${input} num`} />
            <input value={email} onChange={(e) => setEmail(e.target.value)}
                   aria-label="Email" placeholder="Email" className={input} />
          </div>
          <label className="flex items-center gap-2 text-[12px] text-ink-700">
            <input type="checkbox" checked={dm} onChange={(e) => setDm(e.target.checked)}
                   className="w-3.5 h-3.5" />
            They decide
          </label>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending}
                    className="text-[12px] font-semibold rounded-md bg-brand-600 text-white px-3 py-1.5">
              {pending ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-ink-500">Cancel</button>
          </div>
        </form>
      )}

      <div className="mt-3 space-y-2">
        {contacts.length === 0 && !open && (
          <p className="text-[12px] text-ink-400">Nobody recorded yet.</p>
        )}
        {contacts.map((c) => (
          <div key={c.id} className={`rounded-lg border px-3 py-2 ${
            c.is_decision_maker ? 'border-brand-100 bg-brand-50/60' : 'border-ink-200'}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-semibold text-ink-900">{c.name}</span>
              {c.is_decision_maker && (
                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-100 text-brand-400">
                  Decision maker
                </span>
              )}
              {canEdit && (
                <button type="button" onClick={() => drop(c.id)} disabled={pending}
                        className="ml-auto text-[11px] text-ink-400 hover:text-danger-600">Remove</button>
              )}
            </div>
            <div className="text-[11px] text-ink-500 mt-0.5">
              {[c.role, c.phone, c.email].filter(Boolean).join(' · ') || 'No details'}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-ink-400 mt-3 leading-snug">
        Who decides and who you talk to are rarely the same person, and account management needs
        both a year later.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------- services

export function Services({ accountId, services, canEdit }: {
  accountId: number; services: Service[]; canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const set = (stream: string, status: string) => start(async () => {
    if (status === '') await clearService({ accountId, stream });
    else await setService({ accountId, stream, status });
    router.refresh();
  });

  const byStream = new Map(services.map((s) => [s.stream, s]));

  return (
    <div className={`${card} p-4`}>
      <div className="text-[10px] uppercase tracking-wide text-ink-400">Contracted vs ordered</div>
      <div className="mt-3 space-y-2">
        {LINES.map((stream) => {
          const s = byStream.get(stream);
          const soldNeverUsed = s && s.status !== 'discussed' && (s.ever ?? 0) === 0;
          return (
            <div key={stream} className={`rounded-lg border px-3 py-2.5 ${
              soldNeverUsed ? 'border-warn-100 bg-warn-50' : 'border-ink-200'}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold text-ink-900">{LINE_LABEL[stream]}</span>
                <span className="text-[11px] text-ink-500">
                  {s ? SERVICE_STATUS_LABEL[s.status] : 'Not contracted'}
                </span>
                {canEdit && (
                  <select value={s?.status ?? ''} disabled={pending}
                          aria-label={`${LINE_LABEL[stream]} status`}
                          onChange={(e) => set(stream, e.target.value)}
                          className="ml-auto text-[11px] rounded-md border border-ink-200 bg-surface px-1.5 py-1">
                    <option value="">Not contracted</option>
                    <option value="discussed">Discussed</option>
                    <option value="contracted">Contracted</option>
                    <option value="live">Live</option>
                    <option value="paused">Paused</option>
                  </select>
                )}
              </div>
              <div className="text-[11px] mt-1">
                {s === undefined ? (
                  <span className="text-ink-400">
                    {(byStream.get(stream)?.ever ?? 0) > 0 ? 'Ordered without a contract on file' : 'Nothing ordered'}
                  </span>
                ) : soldNeverUsed ? (
                  <span className="text-warn-600 font-semibold">
                    Contracted and never once ordered
                  </span>
                ) : (
                  <span className="text-ink-600 num">
                    {Number(s.last_month ?? 0).toLocaleString('en-IN')} last month ·{' '}
                    {Number(s.ever ?? 0).toLocaleString('en-IN')} ever
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-ink-400 mt-3 leading-snug">
        Atlas knows what an account ordered; only a person knows what it is entitled to order. The gap
        between the two is the cross-sell and the never-activated line.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------- tasks

export function Tasks({ accountId, tasks, people, departments, canEdit }: {
  accountId: number; tasks: Task[]; people: Person[];
  departments: { key: string; label: string }[]; canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [dept, setDept] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      await addTask({
        accountId, title, department: dept || undefined,
        assigneeId: assignee ? Number(assignee) : undefined, dueOn: due,
      });
      setOpen(false); setTitle(''); setDue('');
      router.refresh();
    });
  };

  const flip = (id: number, done: boolean) => start(async () => {
    await toggleTask({ accountId, taskId: id, done });
    router.refresh();
  });

  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-[14px] font-bold text-ink-900">Action items</h2>
        <span className="text-[11px] text-ink-500">owned across departments</span>
        {canEdit && !open && (
          <button type="button" onClick={() => setOpen(true)}
                  className="ml-auto text-[11px] font-semibold rounded-md border border-ink-200 px-2.5 py-1 text-ink-600">
            + Add
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px]">
            <label htmlFor="tt" className={label}>What has to happen</label>
            <input id="tt" autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
                   placeholder="Why did pharmacy never start?" className={input} />
          </div>
          <div>
            <label htmlFor="td" className={label}>Department</label>
            <select id="td" value={dept} onChange={(e) => setDept(e.target.value)}
                    className="text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-1.5">
              <option value="">None</option>
              {departments.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ta" className={label}>Owner</label>
            <select id="ta" value={assignee} onChange={(e) => setAssignee(e.target.value)}
                    className="text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-1.5">
              <option value="">Nobody</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="tdue" className={label}>Due</label>
            <input id="tdue" type="date" value={due} onChange={(e) => setDue(e.target.value)}
                   className="text-[13px] rounded-md border border-ink-200 bg-surface px-2 py-1.5" />
          </div>
          <button type="submit" disabled={pending}
                  className="text-[12px] font-semibold rounded-md bg-brand-600 text-white px-3.5 py-1.5">
            {pending ? 'Adding…' : 'Add'}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-ink-500 px-1">Cancel</button>
        </form>
      )}

      <div className="mt-3 space-y-2">
        {tasks.length === 0 && <p className="text-[12px] text-ink-400 py-2">Nothing committed to yet.</p>}
        {tasks.map((t) => (
          <div key={t.id} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
            t.late ? 'border-danger-100 bg-danger-50' : 'border-ink-200'} ${t.done_at ? 'opacity-60' : ''}`}>
            <input type="checkbox" checked={!!t.done_at} disabled={!canEdit || pending}
                   onChange={(e) => flip(t.id, e.target.checked)}
                   aria-label={t.title}
                   className="mt-0.5 w-3.5 h-3.5" />
            <div className="min-w-0 flex-1">
              <div className={`text-[13px] font-semibold text-ink-900 ${t.done_at ? 'line-through' : ''}`}>
                {t.title}
              </div>
              <div className="text-[11px] text-ink-500 mt-0.5">
                {t.department_label && <b className="text-brand-400">{t.department_label}</b>}
                {t.department_label && (t.assignee || t.due_on) && ' · '}
                {t.assignee ?? 'nobody'}
                {t.due_on && ` · due ${t.due_on}`}
              </div>
            </div>
            {t.late && <span className="text-[11px] font-bold text-danger-600 whitespace-nowrap">late</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
