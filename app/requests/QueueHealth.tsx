import Link from 'next/link';
import { AlertTriangle, Clock, MapPin, Timer, Wallet } from 'lucide-react';
import {
  STATE_SHORT, STATE_TONE, STATE_OWNER, OWNER_LABEL, TONE_CHIP,
  STAGE_SLA, STAGE_LABEL, type RequestState,
} from '@/lib/requests';

export type QueueHealth = {
  total: number;
  late: number;
  due: number;
  oldest: number | null;
  median: number | null;
  unquoted: number;
  states: { state: string; n: number }[] | null;
  gap_pincodes: { pincode: string; city: string | null; n: number }[] | null;
};

/**
 * One figure, and the sentence that says what it means.
 *
 * Deliberately not a KpiTile: those are for a dashboard somebody is reading,
 * and this is a strip above a worklist somebody is about to start. The label
 * goes under the number rather than over it so the numbers line up as a row
 * and the eye can compare them before it reads anything.
 */
function Figure({
  value, label, hint, tone = 'ink', icon,
}: {
  value: string;
  label: string;
  hint?: string;
  tone?: 'ink' | 'warn' | 'danger' | 'brand';
  icon?: React.ReactNode;
}) {
  const colour = {
    ink: 'text-ink-900',
    warn: 'text-warn-600',
    danger: 'text-danger-500',
    brand: 'text-brand-600',
  }[tone];
  return (
    <div className="min-w-[92px]" title={hint}>
      <div className={`flex items-center gap-1.5 text-[19px] font-semibold leading-none tabular-nums ${colour}`}>
        {icon}
        {value}
      </div>
      <div className="mt-1 text-[11px] text-ink-500">{label}</div>
    </div>
  );
}

/**
 * What this queue is made of, before anybody opens a row.
 *
 * The tabs have always carried a count, and a count is the one thing about a
 * worklist that does not tell you how to work it: thirty-four requests that
 * arrived this morning and thirty-four that have been sitting a fortnight are
 * the same number and opposite situations. The strip answers the three
 * questions that actually change the plan — how far behind are we, how old is
 * the worst of it, and what is it made of — and every part of the mix is a
 * link, because the answer to "what is it made of" is always followed by
 * "show me those".
 */
export function QueueHealth({
  health, statuses, hrefForState, activeState, clearHref,
}: {
  health: QueueHealth;
  /** The stages in scope, so the strip can name the promise it is measuring against. */
  statuses: readonly string[];
  hrefForState: (state: string) => string;
  activeState?: string;
  clearHref: string;
}) {
  if (health.total === 0) return null;

  const states = health.states ?? [];
  const gaps = health.gap_pincodes ?? [];
  // The promise being measured. Where a queue spans two stages with the same
  // threshold — Open and Consented — it is one sentence, not two.
  const slas = [...new Set(statuses.map((st) => STAGE_SLA[st]?.late).filter((n): n is number => n != null))];
  const promise = slas.length === 1
    ? `Late means still sitting after ${slas[0] === 1 ? '1 day' : `${slas[0]} days`} at ${statuses
        .map((st) => STAGE_LABEL[st] ?? st).join(' or ')}.`
    : undefined;

  return (
    <div className="mb-4 rounded-lg border border-ink-200 bg-surface px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-7 gap-y-4">
        <Figure
          value={String(health.late)}
          label="past due"
          tone={health.late > 0 ? 'danger' : 'ink'}
          icon={health.late > 0 ? <AlertTriangle className="w-4 h-4" /> : undefined}
          hint={promise}
        />
        <Figure
          value={String(health.due)}
          label="due today"
          tone={health.due > 0 ? 'warn' : 'ink'}
          icon={health.due > 0 ? <Timer className="w-4 h-4" /> : undefined}
          hint="Inside the window for its stage, but not for much longer."
        />
        <Figure
          value={health.oldest == null ? '—' : `${health.oldest}d`}
          label="oldest wait"
          icon={<Clock className="w-4 h-4 text-ink-400" />}
          hint="The longest anything in this queue has gone untouched."
        />
        <Figure
          value={health.median == null ? '—' : `${health.median}d`}
          label="median wait"
          hint="Half the queue has waited longer than this. The number that says whether a bad day is a bad week."
        />
        {/* Only where it is a queue's actual next action. On "Awaiting
            acceptance" every row is priced by definition, and the figure would
            be the row count wearing a different label. */}
        {health.unquoted > 0 && (
          <Figure
            value={String(health.unquoted)}
            label="priced, not sent"
            tone="brand"
            icon={<Wallet className="w-4 h-4" />}
            hint="Atlas has a price and a date for these and the console has not been told. The answer exists; only the handoff is missing."
          />
        )}

        {/* The mix. Six reasons, three owners, and until now the only way to
            see the split was to read the serviceability column thirty times
            and keep a tally. */}
        {states.length > 0 && (
          <div className="min-w-[280px] flex-1">
            <div className="text-[11px] text-ink-500 mb-1.5">
              What it is made of
              {activeState && (
                <>
                  {' · '}
                  <Link href={clearHref} className="text-brand-600 hover:underline">
                    show all
                  </Link>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {states.map(({ state, n }) => {
                const st = state as RequestState;
                const tone = STATE_TONE[st] ?? 'ink';
                const owner = STATE_OWNER[st];
                const active = activeState === state;
                return (
                  <Link
                    key={state}
                    href={active ? clearHref : hrefForState(state)}
                    title={owner ? `${n} for ${OWNER_LABEL[owner]}` : undefined}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]
                                transition ${TONE_CHIP[tone]}
                                ${active ? 'ring-2 ring-brand-500 ring-offset-1 ring-offset-surface' : 'hover:brightness-110'}`}
                  >
                    <span>{STATE_SHORT[st] ?? state}</span>
                    <span className="font-bold tabular-nums">{n}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Where the same gap keeps coming back. Two requests from one pincode
          is a coincidence the queue cannot show you, because age sorts them
          apart; four is a business case for onboarding a lab there. The link
          goes to the pincode, not to the requests — by the time you are asking
          this question the individual request has stopped being the subject. */}
      {gaps.length > 0 && (
        <div className="mt-3 pt-3 border-t border-ink-150 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="text-[11px] text-ink-500">Gaps repeating in</span>
          {gaps.map((g) => (
            <Link
              key={g.pincode}
              href={`/pincode/${g.pincode}`}
              title={`${g.n} requests in this pincode have no lab that can serve them.`}
              className="inline-flex items-center gap-1.5 rounded-md border border-ink-200
                         px-2 py-1 text-[11px] text-ink-700 hover:bg-ink-100 transition"
            >
              <MapPin className="w-3 h-3 text-ink-400" />
              <span className="num">{g.pincode}</span>
              {g.city && <span className="text-ink-400">{g.city}</span>}
              <span className="font-bold tabular-nums text-danger-500">{g.n}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
