import { redirect } from 'next/navigation';
import Link from 'next/link';
import { KanbanSquare, TrendingUp, Clock, Trophy, Download } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ChipButton } from '@/components/ui/Toggle';
import { canLeadCrm } from '@/lib/crm';
import {
  monthBounds, shiftMonth, getScoreboard, getEarnedByStage, getPenalties,
  getStagePoints, getScoreSettings, getSlabs, getTargets,
} from '@/lib/crmScore';
import { CrmTabs } from '../CrmTabs';
import { ScoreAdmin } from './ScoreAdmin';

export const dynamic = 'force-dynamic';

const money = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export default async function ScorePage({
  searchParams,
}: {
  searchParams: { month?: string; who?: string };
}) {
  const me = await getSessionUser();
  if (!me) redirect('/login?next=/crm/score');
  if (!canAccess(me, 'providerPipeline')) {
    return <RoleBlocked area="The network CRM" detail="the network and admin teams" />;
  }

  const isLead = canLeadCrm(me);
  const month = monthBounds(searchParams.month);
  // A member reads their own score, whatever the URL says. Points feed the
  // month-end incentive, so whose row you can open is not cosmetic.
  const viewingId = isLead && searchParams.who ? Number(searchParams.who) || me.id : me.id;

  const [board, earned, penalties, settings, slabs] = await Promise.all([
    getScoreboard(month.from, month.to),
    getEarnedByStage(viewingId, month.from, month.to),
    getPenalties(viewingId, month.from, month.to),
    getScoreSettings(),
    getSlabs(),
  ]);
  const [stagePoints, targets] = isLead
    ? await Promise.all([getStagePoints(), getTargets(month.key)])
    : [[], []];

  const mine = board.find((r) => r.user_id === viewingId);
  const net = mine?.net ?? 0;
  const target = mine?.target ?? settings.default_target;
  const pct = mine?.pct ?? 0;
  const payout = Number(mine?.payout ?? 0);
  const short = Math.max(target - net, 0);
  const earnedTotal = mine?.earned ?? 0;
  const penaltyTotal = mine?.penalty ?? 0;

  const months = [0, 1, 2, 3].map((i) => shiftMonth(month.key, -i)).reverse();
  const href = (patch: { month?: string; who?: string }) => {
    const q = new URLSearchParams();
    const m = patch.month ?? month.key;
    const w = 'who' in patch ? patch.who : (viewingId === me.id ? undefined : String(viewingId));
    if (m !== monthBounds().key) q.set('month', m);
    if (w) q.set('who', w);
    const qs = q.toString();
    return `/crm/score${qs ? `?${qs}` : ''}`;
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex items-center gap-2 mb-1">
        <KanbanSquare className="w-5 h-5 text-brand-600" />
        <h1 className="text-2xl font-bold text-ink-900">Network CRM</h1>
      </div>
      <CrmTabs active="/crm/score" isLead={isLead} />

      <div className="flex flex-wrap items-center gap-1.5 mt-5 mb-2">
        <span className="w-14 shrink-0 text-[11px] uppercase tracking-wide text-ink-400">Month</span>
        {months.map((m) => (
          <ChipButton key={m} href={href({ month: m })} active={m === month.key}>
            {new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })}
          </ChipButton>
        ))}
      </div>

      {isLead && board.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-5">
          <span className="w-14 shrink-0 text-[11px] uppercase tracking-wide text-ink-400">Whose</span>
          {board.map((r) => (
            <ChipButton key={r.user_id} href={href({ who: String(r.user_id) })} active={r.user_id === viewingId}>
              {r.name}
            </ChipButton>
          ))}
        </div>
      )}

      {/* The score itself, and what it is short of.

          Laid out as one headline and a row of equal cells rather than as
          free-floating figures: the numbers are read against each other, so
          they need a shared baseline and a shared column width. CardBody has
          no top padding of its own — it is built to sit under a CardHeader —
          so this card sets its own. */}
      <Card className="mb-5">
        <div className="p-5">
          <div className="flex flex-wrap items-start gap-x-12 gap-y-5">
            <div className="min-w-[11rem] pr-6 border-r border-ink-150">
              <div className="text-[11px] uppercase tracking-wide text-ink-400">
                {viewingId === me.id ? 'My score' : board.find((r) => r.user_id === viewingId)?.name} · {month.label}
              </div>
              <div className="flex items-baseline gap-2 mt-1.5">
                <span className={`text-[40px] leading-none font-bold tabular-nums ${net < 0 ? 'text-danger-500' : 'text-ink-900'}`}>{net}</span>
                <span className="text-sm text-ink-500">of {target} points</span>
              </div>
            </div>

            <dl className="flex flex-wrap gap-x-10 gap-y-4">
              <div className="min-w-[5.5rem]">
                <dt className="text-[11px] uppercase tracking-wide text-ink-400">Earned</dt>
                <dd className="text-2xl leading-none font-semibold tabular-nums text-success-600 mt-1.5">
                  {earnedTotal > 0 ? `+${earnedTotal}` : '0'}
                </dd>
              </div>
              <div className="min-w-[5.5rem]">
                <dt className="text-[11px] uppercase tracking-wide text-ink-400">Lost to waiting</dt>
                <dd className={`text-2xl leading-none font-semibold tabular-nums mt-1.5 ${penaltyTotal > 0 ? 'text-danger-500' : 'text-ink-400'}`}>
                  {penaltyTotal > 0 ? `−${penaltyTotal}` : '0'}
                </dd>
              </div>
              <div className="min-w-[5.5rem]">
                <dt className="text-[11px] uppercase tracking-wide text-ink-400">Of target</dt>
                <dd className="text-2xl leading-none font-semibold tabular-nums text-ink-900 mt-1.5">{pct}%</dd>
              </div>
              {Number(settings.incentive_pot) > 0 && (
                <div className="min-w-[5.5rem]">
                  <dt className="text-[11px] uppercase tracking-wide text-ink-400">Incentive at this rate</dt>
                  <dd className="text-2xl leading-none font-semibold tabular-nums text-brand-700 dark:text-brand-400 mt-1.5">{money(payout)}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="mt-5">
            <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-success-500' : pct >= 60 ? 'bg-brand-500' : 'bg-warn-500'}`}
                style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
              />
            </div>
            <div className="flex items-baseline justify-between mt-1.5 text-[11px] text-ink-400 tabular-nums">
              <span>{short > 0 ? `${short} points to target` : 'Target reached'}</span>
              <span>{target}</span>
            </div>
          </div>

          <p className="text-[12px] leading-relaxed text-ink-500 mt-4 max-w-3xl">
            Moving a provider forward earns that stage&apos;s points once. A card left past its
            stage&apos;s allowance costs {String(settings.penalty_multiplier)}× those points, and again
            every further period{settings.max_penalty_periods > 0 ? `, up to ${settings.max_penalty_periods} times` : ''}.
          </p>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Where the points came from"
            subtitle="One award per provider per stage — moving a card back and forth earns nothing twice."
            icon={<TrendingUp className="w-4 h-4" />}
          />
          <CardBody>
            {earned.length === 0 ? (
              <p className="text-sm text-ink-500 py-6 text-center">No stage moves this month.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-ink-400 text-left">
                    <th className="pb-2 pr-4 font-medium">Stage</th>
                    <th className="pb-2 pr-4 font-medium text-right">Providers</th>
                    <th className="pb-2 font-medium text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {earned.map((e) => (
                    <tr key={e.stage_key} className="border-t border-ink-150">
                      <td className="py-2 pr-4 text-ink-800">{e.stage_label}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-ink-600">{e.moves}</td>
                      <td className="py-2 text-right tabular-nums font-medium text-success-600">+{e.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="What sitting cost"
            subtitle="Worst first. Every one of these is a card to move today."
            icon={<Clock className="w-4 h-4" />}
          />
          <CardBody>
            {penalties.length === 0 ? (
              <p className="text-sm text-ink-500 py-6 text-center">Nothing went stale this month.</p>
            ) : (
              <ul className="divide-y divide-ink-150">
                {penalties.map((p) => (
                  <li key={`${p.thread_id}-${p.provider_id}-${p.stage_key}`} className="py-2 flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/crm/${p.thread_id}?provider=${p.provider_id}`}
                        className="text-sm text-ink-900 hover:text-brand-600 font-medium"
                      >
                        {p.provider_name}
                      </Link>
                      <div className="text-[11px] text-ink-500">
                        {p.stage_label} · {p.days_sitting}d · {p.thread_name}
                      </div>
                    </div>
                    <span className="text-sm tabular-nums font-medium text-danger-500 shrink-0">−{p.points}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {isLead && (
        <Card className="mt-5">
          <CardHeader
            title="The team this month"
            subtitle="Same arithmetic for everyone. Click a name above to see what is behind a number."
            icon={<Trophy className="w-4 h-4" />}
            actions={
              <a
                href={`/api/crm/score?month=${month.key}`}
                className="inline-flex items-center gap-1.5 px-3 h-8 text-[12px] font-medium rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50"
              >
                <Download className="w-3.5 h-3.5" /> Download CSV
              </a>
            }
          />
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-ink-400 text-left">
                    <th className="pb-2 font-medium">Person</th>
                    <th className="pb-2 font-medium text-right">Earned</th>
                    <th className="pb-2 font-medium text-right">Lost</th>
                    <th className="pb-2 font-medium text-right">Net</th>
                    <th className="pb-2 font-medium text-right">Target</th>
                    <th className="pb-2 font-medium text-right">%</th>
                    {Number(settings.incentive_pot) > 0 && <th className="pb-2 font-medium text-right">Incentive</th>}
                  </tr>
                </thead>
                <tbody>
                  {board.map((r) => (
                    <tr key={r.user_id} className="border-t border-ink-150">
                      <td className="py-2 pr-4">
                        <Link href={href({ who: String(r.user_id) })} className="text-ink-900 hover:text-brand-600">{r.name}</Link>
                      </td>
                      <td className={`py-2 text-right tabular-nums ${r.earned > 0 ? 'text-success-600' : 'text-ink-400'}`}>
                        {r.earned > 0 ? `+${r.earned}` : '0'}
                      </td>
                      <td className={`py-2 text-right tabular-nums ${r.penalty > 0 ? 'text-danger-500' : 'text-ink-400'}`}>
                        {r.penalty > 0 ? `−${r.penalty}` : '0'}
                      </td>
                      <td className={`py-2 text-right tabular-nums font-semibold ${r.net < 0 ? 'text-danger-500' : 'text-ink-900'}`}>{r.net}</td>
                      <td className="py-2 text-right tabular-nums text-ink-500">{r.target}</td>
                      <td className="py-2 text-right tabular-nums text-ink-800">{r.pct}%</td>
                      {Number(settings.incentive_pot) > 0 && (
                        <td className="py-2 text-right tabular-nums text-brand-700 dark:text-brand-400">{money(Number(r.payout))}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[12px] text-ink-500 mt-3">
              Slabs: {slabs.map((s) => `${s.min_pct}% → ${s.payout_pct}%`).join(' · ')} of {money(Number(settings.incentive_pot))}
              {Number(settings.bonus_per_point) > 0 && `, then ${money(Number(settings.bonus_per_point))} per point over target`}
              , capped at {settings.max_payout_pct}%.
            </p>
          </CardBody>
        </Card>
      )}

      {me.role === 'admin' && (
        <ScoreAdmin
          month={month.key}
          monthLabel={month.label}
          stagePoints={stagePoints}
          settings={settings}
          slabs={slabs}
          targets={targets}
        />
      )}
    </main>
  );
}
