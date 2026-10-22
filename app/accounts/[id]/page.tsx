import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireView } from '@/lib/guard';
import { canManage } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import {
  getAccount, getAccountMonths, getAccountTasks, getAccountNotes, getContacts,
  getAccountPeople, LINES, LINE_LABEL, STATUS_LABEL, type LineStatus,
} from '@/lib/accountHealth';
import { ManagerPicker } from '../ManagerPicker';
import { STATUS_CHIP } from '../LineDots';
import { Composer, Tasks, Contacts, ActivateLine } from './AccountClient';

export const dynamic = 'force-dynamic';

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN');

/** Bar colour per line. Lightness differs as well as hue. */
const LINE_BAR: Record<string, string> = {
  LAB_ORDER: 'bg-brand-600',
  APPOINTMENT: 'bg-success-600',
  PHARMA_ORDER: 'bg-warn-500',
};

export default async function AccountPage({ params }: { params: { id: string } }) {
  const gate = await requireView('accountHealth', `/accounts/${params.id}`);
  if (gate.blocked) return <RoleBlocked area="Account health" detail="accounts, network and admin" />;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const account = await getAccount(id);
  if (!account) notFound();

  const canEdit = canManage(gate.user, 'accountHealth');
  const [months, tasks, notes, contacts, people] = await Promise.all([
    getAccountMonths(id), getAccountTasks(id), getAccountNotes(id),
    getContacts(id), getAccountPeople(),
  ]);

  // Twelve buckets, newest last, each line stacked inside it.
  const buckets = Array.from(new Set(months.map((m) => m.month))).sort();
  const peak = Math.max(1, ...buckets.map((b) =>
    months.filter((m) => m.month === b).reduce((s, m) => s + m.events, 0)));

  const byStream = new Map(account.lines.map((l) => [l.stream, l]));

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1500px] mx-auto">
      <div className="text-[13px] text-ink-500">
        <Link href="/accounts" className="hover:text-ink-900">Account health</Link>
        <span className="text-ink-300"> / </span>
        <span className="font-semibold text-ink-900">{account.store_name}</span>
      </div>

      <div className="flex flex-wrap gap-5 mt-5 items-start">
        <div className="flex-[999_1_620px] min-w-0 flex flex-col gap-4">

          <div className="rounded-xl border border-ink-200 bg-surface p-5">
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0">
                <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">{account.store_name}</h1>
                <p className="text-[13px] text-ink-500 mt-1">
                  {[account.city, account.state].filter(Boolean).join(', ') || 'No address on file'}
                  {' · '}{account.lines_active} of 3 lines active
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-[11px] text-ink-500">Account manager</span>
                <ManagerPicker storeId={account.store_id} value={account.account_manager_id}
                               people={people} canEdit={canEdit} />
              </div>
            </div>
          </div>

          {/* the line strip */}
          <div className="rounded-xl border border-ink-200 bg-surface p-5">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-[14px] font-bold text-ink-900">Business lines</h2>
              <span className="text-[11px] text-ink-500">each line gets its own verdict — never blended</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3.5">
              {LINES.map((s) => {
                const l = byStream.get(s);
                const st = (l?.status ?? 'never') as LineStatus;
                const never = st === 'never';
                return (
                  <div key={s}
                       className={`rounded-lg border p-3.5 ${never
                         ? 'border-dashed border-ink-200 bg-transparent'
                         : st === 'stopped' ? 'border-warn-100 bg-warn-50'
                         : st === 'declining' ? 'border-danger-100 bg-danger-50'
                         : 'border-success-100 bg-success-50'}`}>
                    <div className="flex items-center gap-2">
                      <span className={`text-[12px] font-bold ${never ? 'text-ink-500' : 'text-ink-900'}`}>
                        {LINE_LABEL[s]}
                      </span>
                      <span className={`ml-auto text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${STATUS_CHIP[st]}`}>
                        {STATUS_LABEL[st]}
                      </span>
                    </div>
                    {never ? (
                      <>
                        <p className="text-[12px] text-ink-500 leading-snug mt-2.5">
                          Never ordered on this line.
                        </p>
                        <ActivateLine storeId={account.store_id} stream={s}
                                      label={LINE_LABEL[s]} canEdit={canEdit} />
                      </>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-2 mt-2.5">
                          <span className="text-[26px] font-extrabold num text-ink-900">{n(l?.this_month)}</span>
                          <span className="text-[11px] text-ink-500">this month</span>
                        </div>
                        <div className="text-[11px] text-ink-600 num mt-1.5">
                          last month {n(l?.last_month)}
                          {(l?.year_ago_month ?? 0) > 0 && ` · a year ago ${n(l?.year_ago_month)}`}
                        </div>
                        {l?.first_month && (
                          <div className="text-[10px] text-ink-400 mt-2 pt-2 border-t border-ink-150">
                            live since {l.first_month.slice(0, 7)}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* twelve months */}
          <div className="rounded-xl border border-ink-200 bg-surface p-5">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-[14px] font-bold text-ink-900">Twelve months</h2>
              <span className="text-[11px] text-ink-500">transactions per month, stacked by line</span>
            </div>
            {buckets.length === 0 ? (
              <p className="text-[12px] text-ink-400 mt-4">No activity in the last twelve months.</p>
            ) : (
              <>
                <div className="flex items-end gap-1.5 h-[150px] mt-4">
                  {buckets.map((b) => {
                    const rows = months.filter((m) => m.month === b);
                    return (
                      <div key={b} className="flex-1 flex flex-col justify-end gap-0.5"
                           title={`${b}: ${rows.reduce((s, m) => s + m.events, 0)} transactions`}>
                        {LINES.filter((s) => rows.some((m) => m.stream === s)).map((s) => {
                          const e = rows.find((m) => m.stream === s)?.events ?? 0;
                          return (
                            <div key={s} className={`${LINE_BAR[s]} rounded-sm`}
                                 style={{ height: `${Math.max(2, Math.round((e / peak) * 140))}px` }} />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-1.5 mt-1.5">
                  {buckets.map((b, i) => (
                    <span key={b}
                          className={`flex-1 text-[10px] text-center ${i === buckets.length - 1 ? 'text-ink-700 font-semibold' : 'text-ink-400'}`}>
                      {b.slice(5)}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-4 mt-3 text-[11px] text-ink-500">
                  {LINES.filter((s) => months.some((m) => m.stream === s)).map((s) => (
                    <span key={s}>
                      <span className={`inline-block w-2.5 h-2.5 rounded-sm mr-1.5 ${LINE_BAR[s]}`} />
                      {LINE_LABEL[s]}
                    </span>
                  ))}
                  <span className="ml-auto text-ink-400">the last bar is a month in progress</span>
                </div>
              </>
            )}
          </div>

          <Composer storeId={account.store_id} canEdit={canEdit} />

          <div className="rounded-xl border border-ink-200 bg-surface px-4">
            {notes.length === 0 ? (
              <p className="text-[12px] text-ink-400 py-5">Nothing logged yet.</p>
            ) : notes.map((note, i) => (
              <div key={note.id} className={`flex gap-3 py-4 ${i < notes.length - 1 ? 'border-b border-ink-100' : ''}`}>
                <span className="w-6 h-6 shrink-0 rounded-full bg-ink-100 text-ink-600 text-[9px] font-bold flex items-center justify-center">
                  {note.kind === 'system' ? '↗' : note.kind.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="text-[12px] text-ink-500">
                    <span className="text-ink-900 font-semibold">{note.author_name ?? 'Someone'}</span>
                    {note.kind === 'system' ? '' : ` logged a ${note.kind}`}
                    {' · '}{note.created_at.slice(0, 16).replace('T', ' ')}
                  </div>
                  {note.body && <p className="text-[13px] text-ink-700 leading-relaxed mt-1 whitespace-pre-line">{note.body}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-[1_1_320px] min-w-[300px] flex flex-col gap-3.5">
          <Tasks storeId={account.store_id} tasks={tasks} people={people}
                 meId={gate.user.id} canEdit={canEdit} />
          <Contacts storeId={account.store_id} contacts={contacts} canEdit={canEdit} />

          <div className="rounded-xl border border-ink-200 bg-surface p-4">
            <div className="text-[10px] uppercase tracking-wide text-ink-500">Elsewhere in Atlas</div>
            <div className="mt-2.5 space-y-1.5 text-[12px]">
              <Link href={`/requests?store=${account.store_id}`} className="block text-brand-600 hover:underline">
                Their requests →
              </Link>
              <Link href={`/order-tracking?store=${account.store_id}`} className="block text-brand-600 hover:underline">
                Orders in flight →
              </Link>
            </div>
            <p className="text-[11px] text-ink-400 mt-3 leading-snug">
              Operational detail is read where it lives rather than copied here.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
