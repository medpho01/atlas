import Link from 'next/link';
import type { Deal } from '@/lib/salesCrm';

/**
 * The pipeline as a table.
 *
 * A board answers "what stage is everything at". It cannot answer "who have we
 * not met in a month", "which insurers are unsized", or "what do we owe people
 * this week" — the questions a pipeline review actually opens with, which want
 * one row per account and every field beside it.
 */

const inr = (v: string | null) => {
  if (v == null) return '—';
  const n = Number(v);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
};

const daysAgo = (iso: string) =>
  Math.round((Date.now() - new Date(`${iso}T00:00:00Z`).getTime()) / 86400000);

const th = 'text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5 whitespace-nowrap';
const td = 'px-3 py-2.5 align-top';

export function DealTable({ deals }: { deals: Deal[] }) {
  if (deals.length === 0) return null;

  return (
    <div className="rounded-xl border border-ink-200 bg-surface overflow-x-auto">
      <table className="w-full min-w-[1440px] text-[13px]">
        <thead>
          <tr className="border-b border-ink-200">
            <th scope="col" className={th}>Account</th>
            <th scope="col" className={th}>Stage</th>
            <th scope="col" className={th}>Salesperson</th>
            <th scope="col" className={th}>Contact</th>
            <th scope="col" className={th}>Decision maker</th>
            <th scope="col" className={`${th} text-right`}>Premium book</th>
            <th scope="col" className={`${th} text-right`}>OPD book</th>
            <th scope="col" className={`${th} text-right`}>Deal value</th>
            <th scope="col" className={`${th} text-center`}>Meetings</th>
            <th scope="col" className={th}>First met</th>
            <th scope="col" className={th}>Last met</th>
            <th scope="col" className={th}>Next meeting</th>
            <th scope="col" className={th}>Follow-up due</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr key={d.deal_id} className="border-b border-ink-100 last:border-0 hover:bg-ink-50/50">
              <td className={td}>
                <Link href={`/sales/${d.deal_id}`} className="font-semibold text-ink-900 hover:text-brand-400">
                  {d.company}
                </Link>
                <div className="text-[11px] text-ink-500 mt-0.5">
                  {[d.account_type_label, d.city].filter(Boolean).join(' · ') || 'No type set'}
                </div>
              </td>
              <td className={td}>
                <span className="text-[11px] font-semibold text-ink-700">{d.stage_label ?? d.stage_key}</span>
                <div className="text-[10px] text-ink-500 mt-0.5">{d.days_in_stage}d in stage</div>
              </td>
              <td className={`${td} text-[12px] text-ink-600`}>
                {d.owner_name ?? <span className="text-ink-400">Unassigned</span>}
              </td>
              <td className={`${td} text-[12px] text-ink-600`}>
                {d.primary_contact ?? <span className="text-ink-400">—</span>}
                {d.primary_contact_role && (
                  <div className="text-[10px] text-ink-500">{d.primary_contact_role}</div>
                )}
              </td>
              <td className={`${td} text-[12px]`}>
                {d.decision_maker
                  ? <span className="text-ink-700 font-medium">{d.decision_maker}</span>
                  : <span className="text-ink-400">not identified</span>}
              </td>
              <td className={`${td} text-right num`}>
                {d.premium_book_cr
                  ? `₹${Number(d.premium_book_cr)}Cr`
                  : <span className="text-ink-400">not sized</span>}
              </td>
              <td className={`${td} text-right num`}>
                {d.opd_book_cr
                  ? <span className="font-semibold">₹{Number(d.opd_book_cr)}Cr</span>
                  : <span className="text-ink-400">not sized</span>}
              </td>
              <td className={`${td} text-right num font-semibold`}>{inr(d.value_inr)}</td>
              <td className={`${td} text-center num font-semibold`}>{d.meetings_done ?? 0}</td>
              <td className={`${td} text-[12px] text-ink-600 num`}>
                {d.first_met_on ?? <span className="text-ink-400">—</span>}
              </td>
              <td className={`${td} text-[12px] num`}>
                {d.last_met_on
                  ? <>{d.last_met_on}<div className="text-[10px] text-ink-500">{daysAgo(d.last_met_on)}d ago</div></>
                  : <span className="text-ink-400">never</span>}
              </td>
              <td className={`${td} text-[12px] num`}>
                {d.next_meeting_on
                  ? <span className="text-success-700 font-semibold">{d.next_meeting_on}</span>
                  : <span className="text-ink-400">none booked</span>}
              </td>
              <td className={`${td} text-[12px] num`}>
                {d.next_task_due
                  ? <span className={d.next_task_late ? 'text-danger-600 font-semibold' : 'text-ink-700'}>
                      {d.next_task_due}
                      <div className="text-[10px] text-ink-500 font-normal max-w-[160px] truncate">{d.next_task}</div>
                    </span>
                  : <span className="text-ink-400">nothing owed</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
