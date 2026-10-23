import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { canManage } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChipButton } from '@/components/ui/Toggle';
import { InfoTip } from '@/components/ui/InfoTip';
import { getAccountTypes } from '@/lib/salesCrm';
import {
  listAccounts, getStageCounts, getPeople, STAGE_LABEL, STAGES, type Stage,
} from '@/lib/lifecycle';
import { NewAccount } from './NewAccount';
import { BookSearch } from './BookSearch';

export const dynamic = 'force-dynamic';

const STAGE_TONE: Record<Stage, string> = {
  sales: 'bg-brand-50 text-brand-400 border-brand-100',
  onboarding: 'bg-warn-50 text-warn-600 border-warn-100',
  managed: 'bg-success-50 text-success-700 border-success-100',
  churned: 'bg-danger-50 text-danger-600 border-danger-100',
  lost: 'bg-ink-100 text-ink-600 border-ink-200',
};

/** Where a row goes when you click it: each stage has its own working screen. */
const rowHref = (a: { account_id: number }) => `/accounts/book/${a.account_id}`;

const days = (iso: string | null) => {
  if (!iso) return null;
  const then = new Date(`${iso}T00:00:00Z`).getTime();
  return Math.round((Date.now() - then) / 86400000);
};

function Due({ a }: { a: { next_review_on: string | null; next_meeting_on: string | null; late_tasks: number } }) {
  if (a.late_tasks > 0) {
    return <span className="text-danger-600 font-semibold">{a.late_tasks} late task{a.late_tasks > 1 ? 's' : ''}</span>;
  }
  if (a.next_review_on) {
    const d = days(a.next_review_on)!;
    if (d > 0) return <span className="text-danger-600 font-semibold">Review {d}d late</span>;
    if (d > -8) return <span className="text-warn-600 font-semibold">Review in {-d}d</span>;
    return <span className="text-ink-500">Review in {-d}d</span>;
  }
  if (a.next_meeting_on) return <span className="text-ink-700">Meeting {a.next_meeting_on}</span>;
  return <span className="text-ink-400">nothing booked</span>;
}

export default async function BookPage({
  searchParams,
}: {
  searchParams: { stage?: string; type?: string; mine?: string; q?: string; due?: string };
}) {
  const gate = await requireView('accountHealth', '/accounts/book');
  if (gate.blocked) return <RoleBlocked area="Accounts" detail="accounts, sales and admin" />;

  const canEdit = canManage(gate.user, 'accountHealth');
  const stage = (STAGES as readonly string[]).includes(searchParams.stage ?? '')
    ? searchParams.stage as Stage : undefined;
  const mine = searchParams.mine === '1';

  const [accounts, counts, types, people] = await Promise.all([
    listAccounts({
      stage,
      owner: mine ? gate.user.id : undefined,
      type: searchParams.type,
      q: searchParams.q,
      reviewDue: searchParams.due === '1',
    }),
    getStageCounts(),
    getAccountTypes(),
    getPeople(),
  ]);

  const count = (s: Stage) => counts.find((c) => c.lifecycle === s)?.n ?? 0;

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      stage: searchParams.stage, type: searchParams.type,
      mine: mine ? '1' : undefined, q: searchParams.q,
      due: searchParams.due === '1' ? '1' : undefined,
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return `/accounts/book${qs ? `?${qs}` : ''}`;
  };

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Accounts"
        subtitle="Every company we are selling to, onboarding, or running — one row each, from first meeting to quarterly review."
        actions={
          <InfoTip
            title="The accounts book"
            shows="One row per company, whatever stage it is at."
            computed={
              <>
                A row is created by sales and keeps its identity for life: the same row is the deal,
                the onboarding plan and the managed account. <b>Our share</b> appears only once
                somebody has typed the account&rsquo;s OPD book and what one service is worth to
                them — it is measured in services, never rupees.
              </>
            }
            drives="Winning a deal and going live both move this row rather than creating a new one, so meetings, contacts and promises survive every handover."
          />
        }
      />

      {/* The lifecycle, as the filter it already is */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
        {(['sales', 'onboarding', 'managed'] as Stage[]).map((s) => (
          <Link key={s} href={link({ stage: stage === s ? undefined : s })}
                className={`rounded-xl border px-4 py-3 transition-colors ${
                  stage === s ? 'border-brand-200 bg-brand-50' : 'border-ink-200 bg-surface hover:border-ink-300'}`}>
            <div className="text-[10px] uppercase tracking-wide text-ink-500">{STAGE_LABEL[s]}</div>
            <div className="text-[22px] font-extrabold mt-1 num text-ink-900">{count(s)}</div>
            <div className="text-[11px] text-ink-500 mt-0.5">
              {s === 'sales' ? 'in the funnel' : s === 'onboarding' ? 'going live' : 'live accounts'}
            </div>
          </Link>
        ))}
        <Link href={link({ due: searchParams.due === '1' ? undefined : '1', stage: undefined })}
              className={`rounded-xl border px-4 py-3 transition-colors ${
                searchParams.due === '1' ? 'border-warn-200 bg-warn-50' : 'border-ink-200 bg-surface hover:border-ink-300'}`}>
          <div className="text-[10px] uppercase tracking-wide text-ink-500">Review overdue</div>
          <div className="text-[22px] font-extrabold mt-1 num text-warn-600">
            {accounts.filter((a) => a.next_review_on && days(a.next_review_on)! > 0).length}
          </div>
          <div className="text-[11px] text-ink-500 mt-0.5">past their own cadence</div>
        </Link>
      </div>

      <div className="mt-5 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg
                      border border-ink-200 bg-surface px-4 py-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Stage</span>
          <ChipButton href={link({ stage: undefined })} active={!stage}>All</ChipButton>
          {STAGES.map((s) => (
            <ChipButton key={s} href={link({ stage: s })} active={stage === s}>
              {STAGE_LABEL[s]} <span className="text-ink-400">{count(s)}</span>
            </ChipButton>
          ))}
        </div>

        <span className="w-px h-5 bg-ink-200" />
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Owner</span>
          <ChipButton href={link({ mine: undefined })} active={!mine}>Everyone</ChipButton>
          <ChipButton href={link({ mine: '1' })} active={mine}>Mine</ChipButton>
        </div>

        <span className="w-px h-5 bg-ink-200" />
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Type</span>
          <ChipButton href={link({ type: undefined })} active={!searchParams.type}>All</ChipButton>
          {types.slice(0, 5).map((t) => (
            <ChipButton key={t.key} href={link({ type: t.key })} active={searchParams.type === t.key}>
              {t.label}
            </ChipButton>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <BookSearch q={searchParams.q ?? ''} />
          {canEdit && <NewAccount people={people} meId={gate.user.id} types={types} />}
        </div>
      </div>

      <div className="rounded-xl border border-ink-200 bg-surface overflow-x-auto">
        <table className="w-full min-w-[1040px] text-[13px]">
          <thead>
            <tr className="border-b border-ink-200">
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-4 py-2.5">Account</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Stage</th>
              <th className="text-right text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">OPD book</th>
              <th className="text-right text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Our share</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Owner</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Last met</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-4 py-2.5">Next due</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const since = days(a.last_met_on);
              return (
                <tr key={a.account_id} className="border-b border-ink-100 last:border-0 hover:bg-ink-50/50">
                  <td className="px-4 py-2.5">
                    <Link href={rowHref(a)} className="font-semibold text-ink-900 hover:text-brand-400">
                      {a.name}
                    </Link>
                    <div className="text-[11px] text-ink-500 mt-0.5">
                      {[a.account_type_label, a.city].filter(Boolean).join(' · ') || 'No type set'}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STAGE_TONE[a.lifecycle]}`}>
                      {STAGE_LABEL[a.lifecycle]}
                      {a.lifecycle === 'onboarding' && a.plan_steps > 0 && ` · ${a.plan_done}/${a.plan_steps}`}
                      {a.lifecycle === 'managed' && a.review_cadence !== 'none' && ` · ${a.review_cadence}`}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right num">
                    {a.opd_book_cr ? <span className="font-semibold">₹{Number(a.opd_book_cr)} Cr</span>
                      : <span className="text-ink-400">not set</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right num">
                    {a.share_pct ? <span className="font-semibold">{Number(a.share_pct)}%</span>
                      : <span className="text-ink-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[12px]">
                    {a.owner ?? <span className="text-ink-400">Unassigned</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-ink-600">
                    {a.last_met_on
                      ? <>{a.last_met_on} <span className="text-ink-400">· {since}d ago</span></>
                      : <span className="text-ink-400">never</span>}
                  </td>
                  <td className="px-4 py-2.5 text-[12px]"><Due a={a} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {accounts.length === 0 && (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-semibold text-ink-900">Nothing matches.</p>
            <p className="text-sm text-ink-500 mt-1">Clear a filter, or add the company you are talking to.</p>
          </div>
        )}
      </div>

      <p className="text-[11px] text-ink-500 mt-3 max-w-[96ch] leading-relaxed">
        Sorted the way somebody would work it: overdue reviews first, then late tasks, then whoever we
        have not seen in longest. <b>Our share</b> stays blank until both the OPD book and an average
        ticket have been typed on the account — a column that guesses is worse than one that admits it
        does not know.
      </p>
    </div>
  );
}
