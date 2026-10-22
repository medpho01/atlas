import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { canManage } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChipButton } from '@/components/ui/Toggle';
import { listAccounts, getAccountPeople, LINES, LINE_LABEL } from '@/lib/accountHealth';
import { Activate } from './Activate';

export const dynamic = 'force-dynamic';

const n = (v: number) => v.toLocaleString('en-IN');

export default async function CrossSellPage({
  searchParams,
}: {
  searchParams: { line?: string; mine?: string };
}) {
  const gate = await requireView('accountHealth', '/accounts/cross-sell');
  if (gate.blocked) return <RoleBlocked area="Account health" detail="accounts, network and admin" />;

  const canEdit = canManage(gate.user, 'accountHealth');
  const missing = LINES.find((l) => l === searchParams.line) ?? 'PHARMA_ORDER';
  const mine = searchParams.mine === '1';

  const [rows, all, people] = await Promise.all([
    listAccounts({ missingLine: missing, manager: mine ? gate.user.id : undefined }),
    listAccounts({}),
    getAccountPeople(),
  ]);

  // How many accounts buy each line at all — the shape of the opportunity.
  const active = Object.fromEntries(LINES.map((l) => [
    l,
    all.filter((a) => a.lines.some((x) => x.stream === l && x.status !== 'never')).length,
  ])) as Record<string, number>;
  const anyLine = all.filter((a) => a.lines_active > 0).length;

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { line: missing, mine: mine ? '1' : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/accounts/cross-sell?${p.toString()}`;
  };

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1500px] mx-auto">
      <div className="text-[13px] text-ink-500 mb-3">
        <Link href="/accounts" className="hover:text-ink-900">Account health</Link>
        <span className="text-ink-300"> / </span>
        <span className="font-semibold text-ink-900">Lines not activated</span>
      </div>

      <PageHeader
        title="Lines not activated"
        subtitle="Accounts already buying one thing from us and nothing else. The only screen here about growth rather than defence."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
        {LINES.map((l) => (
          <div key={l} className="rounded-xl border border-ink-200 bg-surface px-4 py-3">
            <div className="text-[12px] font-bold text-ink-900">{LINE_LABEL[l]}</div>
            <div className="flex items-baseline gap-2 mt-1.5">
              <span className="text-[26px] font-extrabold num text-ink-900">{n(active[l] ?? 0)}</span>
              <span className="text-[11px] text-ink-500">of {n(anyLine)} accounts</span>
            </div>
            <div className="h-1.5 rounded-full bg-ink-150 mt-2.5 overflow-hidden">
              <div className="h-full bg-brand-600"
                   style={{ width: `${anyLine ? Math.round(((active[l] ?? 0) / anyLine) * 100) : 0}%` }} />
            </div>
          </div>
        ))}
      </div>

      <p className="text-[13px] text-ink-600 mt-4 max-w-4xl leading-relaxed">
        Read the other way: <b className="text-ink-900">{n(anyLine - (active[missing] ?? 0))} accounts
        have never placed a {LINE_LABEL[missing].toLowerCase()} order</b>. Every one is already a
        customer, already integrated — which makes this the shortest sales cycle available.
      </p>

      <div className="mt-5 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg
                      border border-ink-200 bg-surface px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Missing line</span>
          {LINES.map((l) => (
            <ChipButton key={l} href={link({ line: l })} active={missing === l}>{LINE_LABEL[l]}</ChipButton>
          ))}
        </div>
        <span className="w-px h-5 bg-ink-200" />
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Manager</span>
          <ChipButton href={link({ mine: undefined })} active={!mine}>Everyone</ChipButton>
          <ChipButton href={link({ mine: '1' })} active={mine}>Mine</ChipButton>
        </div>
        <span className="ml-auto text-[11px] text-ink-500">sorted by what they already send us</span>
      </div>

      <div className="rounded-xl border border-ink-200 bg-surface overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-ink-200 text-[10px] uppercase tracking-wider text-ink-500">
              <th scope="col" className="text-left font-medium px-4 py-2.5">Account</th>
              <th scope="col" className="text-left font-medium px-3 py-2.5 w-[150px]">Manager</th>
              <th scope="col" className="text-right font-medium px-3 py-2.5 w-[130px]">Already sends / mo</th>
              <th scope="col" className="text-left font-medium px-3 py-2.5 w-[150px]">Buys today</th>
              <th scope="col" className="text-left font-medium px-4 py-2.5 w-[170px]">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .slice()
              .sort((a, b) => (b.this_month + b.last_month) - (a.this_month + a.last_month))
              .map((a) => (
                <tr key={a.store_id} className="border-b border-ink-100 last:border-0 hover:bg-ink-50 transition">
                  <td className="px-4 py-2.5">
                    <Link href={`/accounts/${a.store_id}`} className="font-bold text-ink-900 hover:text-brand-600">
                      {a.store_name}
                    </Link>
                    <div className="text-[11px] text-ink-500 mt-0.5">
                      {[a.city, a.state].filter(Boolean).join(', ') || '—'}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-ink-600">
                    {a.account_manager ?? <span className="text-ink-400">Unassigned</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right num font-bold text-ink-900">
                    {n(Math.max(a.this_month, a.last_month))}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-ink-600">
                    {a.lines.filter((l) => l.status !== 'never').map((l) => l.label).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {a.account_manager_id == null ? (
                      <span className="text-[11px] text-ink-400">Assign a manager first</span>
                    ) : (
                      <Activate storeId={a.store_id} stream={missing}
                                label={LINE_LABEL[missing]} canEdit={canEdit} />
                    )}
                  </td>
                </tr>
              ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-ink-500">
                Every account here already buys {LINE_LABEL[missing].toLowerCase()}.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-brand-100 bg-brand-50 px-5 py-4 mt-5 max-w-4xl">
        <div className="text-[10px] uppercase tracking-wide text-brand-700 font-semibold">
          What “start activation” does
        </div>
        <p className="text-[12px] text-ink-700 leading-relaxed mt-2">
          It creates the same four tasks every time — confirm the clinical need, price the line,
          get one pilot order through, review it at thirty days — on the account, owned by its
          manager. The sequence is known, so it should not be re-invented in somebody&rsquo;s notes
          each quarter. Nothing here infers that an account is a good fit: it ranks by what they
          already send us, and the judgement stays with the person who knows them.
        </p>
      </div>
    </div>
  );
}
