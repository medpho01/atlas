import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { canManage } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChipButton } from '@/components/ui/Toggle';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  listAccounts, getAccountSummary, getAccountPeople,
  LINES, LINE_LABEL, STATUS_LABEL, type LineStatus,
} from '@/lib/accountHealth';
import { LineDots, STATUS_CHIP } from './LineDots';
import { ManagerPicker } from './ManagerPicker';
import { AccountSearch } from './AccountSearch';

export const dynamic = 'force-dynamic';

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN');

/** The month names the columns carry, derived once so the header cannot drift. */
function monthLabels() {
  const now = new Date();
  const f = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-IN', opts);
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  return {
    this: f(now, { month: 'short' }),
    last: f(last, { month: 'short' }),
    year: `${f(year, { month: 'short' })} ’${String(year.getFullYear()).slice(2)}`,
  };
}

function Metric({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'warn' | 'good' | 'info';
}) {
  const box = tone === 'warn' ? 'border-warn-100 bg-warn-50'
    : tone === 'info' ? 'border-brand-100 bg-brand-50' : 'border-ink-200 bg-surface';
  const num = tone === 'warn' ? 'text-warn-600'
    : tone === 'good' ? 'text-success-600' : tone === 'info' ? 'text-brand-700' : 'text-ink-900';
  return (
    <div className={`rounded-xl border ${box} px-4 py-3`}>
      <div className="text-[10px] uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`text-[22px] font-extrabold mt-1 num ${num}`}>{value}</div>
      {sub && <div className="text-[11px] text-ink-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: { manager?: string; mine?: string; status?: string; line?: string; q?: string };
}) {
  const gate = await requireView('accountHealth', '/accounts');
  if (gate.blocked) return <RoleBlocked area="Account health" detail="accounts, network and admin" />;

  const canEdit = canManage(gate.user, 'accountHealth');
  const mine = searchParams.mine === '1';
  const unassigned = searchParams.manager === 'none';
  const managerId = !unassigned && searchParams.manager ? Number(searchParams.manager) : undefined;
  const status = (['stopped', 'declining', 'growing', 'active'] as LineStatus[])
    .find((s) => s === searchParams.status);
  const line = LINES.find((l) => l === searchParams.line);

  const [rows, summary, people] = await Promise.all([
    listAccounts({
      manager: mine ? gate.user.id : managerId,
      unassigned,
      status,
      line,
      q: searchParams.q,
    }),
    getAccountSummary(),
    getAccountPeople(),
  ]);

  const m = monthLabels();
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      manager: searchParams.manager, mine: mine ? '1' : undefined,
      status: searchParams.status, line: searchParams.line, q: searchParams.q,
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return `/accounts${qs ? `?${qs}` : ''}`;
  };

  const momDelta = summary && summary.last_month > 0
    ? Math.round(((summary.this_month - summary.last_month) / summary.last_month) * 100) : null;
  const yoyDelta = summary && summary.year_ago > 0
    ? Math.round(((summary.this_month - summary.year_ago) / summary.year_ago) * 100) : null;

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Account health"
        subtitle={`${n(summary?.accounts)} accounts route demand through the platform, across diagnostics, consultations and pharmacy.`}
        actions={
          <InfoTip
            title="Account health"
            shows="Every store that sends us business, what it sent this month, and which of its business lines are live."
            computed={
              <>
                Counts are <b>transactions</b> — lab orders, consultations and pharmacy orders —
                by calendar month. Requests are excluded: an enquiry is not a transaction. Status
                is worked out <b>per line</b>, never blended, because an account flat on
                diagnostics with pharmacy at zero is declining on pharmacy.
              </>
            }
            drives="Assign a manager, commit to what happens next, and see which lines an account has never bought."
          />
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-5">
        <Metric label={`${m.this} so far`} value={n(summary?.this_month)} sub="transactions, all lines" />
        <Metric label={m.last} value={n(summary?.last_month)}
                sub={momDelta == null ? undefined : `${momDelta >= 0 ? '+' : ''}${momDelta}% on the month`} />
        <Metric label={m.year} value={n(summary?.year_ago)}
                sub={yoyDelta == null ? undefined : `${yoyDelta >= 0 ? '+' : ''}${yoyDelta}% year on year`}
                tone={yoyDelta != null && yoyDelta > 0 ? 'good' : undefined} />
        <Metric label="A line stopped" value={n(summary?.stopped)} sub="was ordering, now zero"
                tone={(summary?.stopped ?? 0) > 0 ? 'warn' : undefined} />
        <Metric label="One line only" value={n(summary?.one_line_only)} tone="info"
                sub={`${n(summary?.unassigned)} unassigned`} />
      </div>

      <div className="mt-5 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg
                      border border-ink-200 bg-surface px-4 py-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Manager</span>
          <ChipButton href={link({ manager: undefined, mine: undefined })}
                      active={!mine && !searchParams.manager}>Everyone</ChipButton>
          <ChipButton href={link({ mine: '1', manager: undefined })} active={mine}>Mine</ChipButton>
          <ChipButton href={link({ manager: 'none', mine: undefined })} active={unassigned}>
            Unassigned <span className="text-ink-400">{n(summary?.unassigned)}</span>
          </ChipButton>
          {people.slice(0, 4).map((p) => (
            <ChipButton key={p.id} href={link({ manager: String(p.id), mine: undefined })}
                        active={managerId === p.id}>
              {p.name.split(' ')[0]}
            </ChipButton>
          ))}
        </div>

        <span className="w-px h-5 bg-ink-200" />
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Line</span>
          <ChipButton href={link({ line: undefined })} active={!line}>All</ChipButton>
          {LINES.map((l) => (
            <ChipButton key={l} href={link({ line: l })} active={line === l}>{LINE_LABEL[l]}</ChipButton>
          ))}
        </div>

        <span className="w-px h-5 bg-ink-200" />
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Status</span>
          <ChipButton href={link({ status: undefined })} active={!status}>All</ChipButton>
          {(['stopped', 'declining', 'growing'] as LineStatus[]).map((s) => (
            <ChipButton key={s} href={link({ status: s })} active={status === s}>
              {STATUS_LABEL[s]}
            </ChipButton>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-4">
          <AccountSearch initial={searchParams.q} />
          <Link href="/accounts/cross-sell"
                className="text-[12px] font-semibold text-brand-600 hover:underline whitespace-nowrap">
            Lines not activated →
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-ink-200 bg-surface overflow-x-auto">
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr className="border-b border-ink-200 text-[10px] uppercase tracking-wider text-ink-500">
              <th scope="col" className="text-left font-medium px-4 py-2.5">Account</th>
              <th scope="col" className="text-left font-medium px-3 py-2.5 w-[160px]">Manager</th>
              <th scope="col" className="text-left font-medium px-3 py-2.5 w-[190px]">Lines</th>
              <th scope="col" className="text-right font-medium px-3 py-2.5 w-[80px]">{m.this}</th>
              <th scope="col" className="text-right font-medium px-3 py-2.5 w-[80px]">{m.last}</th>
              <th scope="col" className="text-right font-medium px-3 py-2.5 w-[90px]">{m.year}</th>
              <th scope="col" className="text-left font-medium px-3 py-2.5">Next task</th>
              <th scope="col" className="text-left font-medium px-4 py-2.5 w-[110px]">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.store_id} className="border-b border-ink-100 last:border-0 hover:bg-ink-50 transition">
                <td className="px-4 py-2.5">
                  <Link href={`/accounts/${a.store_id}`} className="font-bold text-ink-900 hover:text-brand-600">
                    {a.store_name}
                  </Link>
                  <div className="text-[11px] text-ink-500 mt-0.5">
                    {[a.city, a.state].filter(Boolean).join(', ') || '—'}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <ManagerPicker storeId={a.store_id} value={a.account_manager_id}
                                 people={people} canEdit={canEdit} compact />
                </td>
                <td className="px-3 py-2.5"><LineDots lines={a.lines} /></td>
                <td className="px-3 py-2.5 text-right num font-bold text-ink-900">{n(a.this_month)}</td>
                <td className="px-3 py-2.5 text-right num text-ink-600">{n(a.last_month)}</td>
                <td className="px-3 py-2.5 text-right num text-ink-500">
                  {a.year_ago_month > 0 ? n(a.year_ago_month) : '—'}
                </td>
                <td className="px-3 py-2.5">
                  {a.next_task ? (
                    <>
                      <span className={`text-[12px] ${a.next_task_late ? 'text-danger-500 font-semibold' : 'text-ink-700'}`}>
                        {a.next_task}
                      </span>
                      {a.next_task_due && (
                        <span className="block text-[11px] text-ink-500">{a.next_task_due}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-[12px] text-ink-400">Nothing scheduled</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_CHIP[a.worst_line_status]}`}>
                    {STATUS_LABEL[a.worst_line_status]}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-5 py-12 text-center">
                <p className="text-sm font-semibold text-ink-900">
                  {searchParams.q ? `Nothing matches “${searchParams.q}”.` : 'No accounts match these filters.'}
                </p>
                {searchParams.q && (
                  <p className="text-sm text-ink-500 mt-1">
                    Searching looks at the account name, its city and its manager.
                  </p>
                )}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-5 mt-4 text-[11px] text-ink-500">
        <span><span className="inline-block w-[7px] h-[7px] rounded-full bg-success-600 mr-1.5" />ordering this month</span>
        <span><span className="inline-block w-[7px] h-[7px] rounded-full bg-warn-500 mr-1.5" />ordered before, nothing now</span>
        <span><span className="inline-block w-[7px] h-[7px] rounded-full bg-danger-500 mr-1.5" />declining</span>
        <span><span className="inline-block w-[7px] h-[7px] rounded-full bg-ink-300 mr-1.5" />never ordered on this line</span>
      </div>
    </div>
  );
}
