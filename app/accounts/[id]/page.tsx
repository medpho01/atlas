import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireView } from '@/lib/guard';
import { canManage } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import {
  getAccount, getContacts, getMeetings, getServices, getTasks,
  getPeople, getDepartments, STAGE_LABEL, CADENCE_LABEL,
} from '@/lib/lifecycle';
import {
  Sizing, StageControl, Meetings, Contacts, Services, Tasks,
} from './AccountBookClient';

export const dynamic = 'force-dynamic';

const days = (iso: string | null) => {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(`${iso}T00:00:00Z`).getTime()) / 86400000);
};

function Stat({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'warn' | 'good' | 'bad';
}) {
  const border = tone === 'warn' ? 'border-warn-100 bg-warn-50'
    : tone === 'bad' ? 'border-danger-100 bg-danger-50'
    : tone === 'good' ? 'border-success-100 bg-success-50'
    : 'border-ink-200 bg-surface';
  const num = tone === 'warn' ? 'text-warn-600' : tone === 'bad' ? 'text-danger-600'
    : tone === 'good' ? 'text-success-700' : 'text-ink-900';
  return (
    <div className={`rounded-xl border ${border} px-4 py-3`}>
      <div className="text-[10px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`text-[20px] font-extrabold mt-1 num ${num}`}>{value}</div>
      {sub && <div className="text-[11px] text-ink-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default async function AccountBookPage({ params }: { params: { id: string } }) {
  const gate = await requireView('accountHealth', `/accounts/${params.id}`);
  if (gate.blocked) return <RoleBlocked area="Accounts" detail="accounts, sales and admin" />;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const account = await getAccount(id);
  if (!account) notFound();

  const canEdit = canManage(gate.user, 'accountHealth');
  const [contacts, meetings, services, tasks, people, departments] = await Promise.all([
    getContacts(id), getMeetings(id), getServices(id, account.store_id),
    getTasks(id), getPeople(), getDepartments(),
  ]);

  const reviewIn = days(account.next_review_on);
  const sinceMet = days(account.last_met_on);

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1500px] mx-auto">
      <div className="text-[13px] text-ink-500">
        <Link href="/accounts" className="hover:text-ink-900">Accounts</Link>
        <span className="text-ink-300"> / </span>
        <span className="font-semibold text-ink-900">{account.name}</span>
      </div>

      <div className="flex flex-wrap items-start gap-4 mt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">{account.name}</h1>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-ink-100 text-ink-600 border border-ink-200">
              {STAGE_LABEL[account.lifecycle]}
            </span>
            {account.account_type_label && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-ink-50 text-ink-600 border border-ink-200">
                {account.account_type_label}
              </span>
            )}
          </div>
          <div className="text-[12px] text-ink-500 mt-1">
            {[account.city, account.owner ? `owned by ${account.owner}` : 'unassigned',
              CADENCE_LABEL[account.review_cadence]].filter(Boolean).join(' · ')}
            {account.store_id && (
              <> · <Link href={`/accounts/health/${account.store_id}`} className="text-brand-400 hover:underline">
                store {account.store_id} health
              </Link></>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-5">
        <Stat label="Meetings done" value={String(account.meetings_done)}
              sub={account.first_met_on ? `since ${account.first_met_on}` : 'none yet'} />
        <Stat label="Last met" value={sinceMet === null ? '—' : `${sinceMet}d ago`}
              sub={account.last_met_on ?? 'never'} />
        <Stat label="Next review"
              value={reviewIn === null ? '—' : reviewIn > 0 ? `${reviewIn}d late` : `in ${-reviewIn}d`}
              sub={account.review_cadence === 'none' ? 'no cadence set' : account.next_review_on ?? 'after the first review'}
              tone={reviewIn !== null && reviewIn > 0 ? 'bad' : undefined} />
        <Stat label="Our share"
              value={account.share_pct ? `${Number(account.share_pct)}%` : '—'}
              sub={account.share_pct
                ? `${Number(account.services_twelve_months).toLocaleString('en-IN')} of ≈${Number(account.services_expected).toLocaleString('en-IN')} services`
                : 'needs an OPD book and a ticket'} />
        <Stat label="Open items" value={String(account.open_tasks)}
              sub={account.late_tasks > 0 ? `${account.late_tasks} late` : 'none late'}
              tone={account.late_tasks > 0 ? 'warn' : undefined} />
      </div>

      <div className="flex flex-wrap gap-5 mt-5 items-start">
        <div className="flex-[999_1_600px] min-w-0 flex flex-col gap-4">
          <Sizing account={account} canEdit={canEdit} />
          <Meetings accountId={id} meetings={meetings} people={people} canEdit={canEdit} />
          <Tasks accountId={id} tasks={tasks} people={people}
                 departments={departments} canEdit={canEdit} />
        </div>

        <div className="flex-[1_1_320px] min-w-0 flex flex-col gap-4">
          <StageControl account={account} people={people} canEdit={canEdit} />
          <Contacts accountId={id} contacts={contacts} canEdit={canEdit} />
          <Services accountId={id} services={services} canEdit={canEdit} />
        </div>
      </div>
    </div>
  );
}
