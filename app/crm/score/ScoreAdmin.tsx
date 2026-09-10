'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Settings2 } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import type { ScoreSettings, Slab, StagePoint, TargetRow } from '@/lib/crmScore';
import { saveStagePoints, saveScoreSettings, saveSlabs, saveTarget } from './actions';

const input = 'h-8 px-2 text-[13px] rounded-md border border-ink-200 bg-surface tabular-nums';

/**
 * Everything about the scoring that is a decision rather than a fact.
 *
 * Kept on the same page as the scores it produces, because a points ladder is
 * only arguable next to what it did to this month's numbers. Admin only: these
 * rows decide what people are paid.
 */
export function ScoreAdmin({
  month, monthLabel, stagePoints, settings, slabs, targets,
}: {
  month: string;
  monthLabel: string;
  stagePoints: StagePoint[];
  settings: ScoreSettings;
  slabs: Slab[];
  targets: TargetRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [ladder, setLadder] = useState(stagePoints);
  const [cfg, setCfg] = useState({
    penaltyMultiplier: Number(settings.penalty_multiplier),
    defaultTarget: settings.default_target,
    incentivePot: Number(settings.incentive_pot),
    bonusPerPoint: Number(settings.bonus_per_point),
    maxPayoutPct: settings.max_payout_pct,
    maxPenaltyPeriods: settings.max_penalty_periods,
  });
  const [rungs, setRungs] = useState(slabs.map((s) => ({ minPct: s.min_pct, payoutPct: s.payout_pct })));

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    startTransition(async () => {
      setErr(null); setNote(null);
      const res = await fn();
      if (!res.ok) { setErr(res.error ?? 'Failed'); return; }
      setNote(ok);
      router.refresh();
      setTimeout(() => setNote(null), 2500);
    });

  const byFunnel = new Map<number, StagePoint[]>();
  for (const s of ladder) {
    const list = byFunnel.get(s.funnel_id);
    if (list) list.push(s); else byFunnel.set(s.funnel_id, [s]);
  }

  const setStage = (funnelId: number, key: string, patch: Partial<StagePoint>) =>
    setLadder((l) => l.map((s) => (s.funnel_id === funnelId && s.stage_key === key ? { ...s, ...patch } : s)));

  return (
    <Card className="mt-5">
      <CardHeader
        title="Scoring rules"
        subtitle="What each stage is worth, how long it may sit, and what a month is worth in rupees."
        icon={<Settings2 className="w-4 h-4" />}
      />
      <CardBody className="space-y-6">
        {[...byFunnel.entries()].map(([funnelId, stages]) => (
          <div key={funnelId}>
            <h3 className="text-[13px] font-semibold text-ink-900 mb-2">{stages[0].funnel_name}</h3>
            <div className="overflow-x-auto">
              <table className="text-sm min-w-[520px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-ink-400 text-left">
                    <th className="pb-1 pr-4 font-medium">Stage</th>
                    <th className="pb-1 pr-4 font-medium">Points</th>
                    <th className="pb-1 pr-4 font-medium">Days allowed</th>
                    <th className="pb-1 font-medium">Overstaying costs</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map((s) => (
                    <tr key={s.stage_key}>
                      <td className="py-1 pr-4 text-ink-800">{s.stage_label}</td>
                      <td className="py-1 pr-4">
                        <input type="number" min={0} value={s.points} className={`${input} w-20`}
                          onChange={(e) => setStage(funnelId, s.stage_key, { points: Number(e.target.value) })} />
                      </td>
                      <td className="py-1 pr-4">
                        <input type="number" min={1} value={s.sla_days ?? ''} placeholder="never"
                          className={`${input} w-24`}
                          onChange={(e) => setStage(funnelId, s.stage_key, {
                            sla_days: e.target.value === '' ? null : Number(e.target.value),
                          })} />
                      </td>
                      <td className="py-1 text-[12px] text-ink-500">
                        {s.sla_days ? `−${Math.round(s.points * cfg.penaltyMultiplier)} per ${s.sla_days}d` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[12px] text-ink-500 mt-2">
              A full journey through this funnel is worth{' '}
              <span className="font-medium text-ink-800 tabular-nums">
                {stages.reduce((n, s) => n + (s.sla_days === null && s.points === 0 ? 0 : s.points), 0)}
              </span>{' '}
              points — which is what a target should be set against.
            </p>
          </div>
        ))}

        <div className="flex flex-wrap items-end gap-4 pt-1 border-t border-ink-150">
          <label className="text-[12px] text-ink-600">
            <div className="mb-1">Overstaying multiplier</div>
            <input type="number" step="0.5" min={0} value={cfg.penaltyMultiplier} className={`${input} w-24`}
              onChange={(e) => setCfg({ ...cfg, penaltyMultiplier: Number(e.target.value) })} />
          </label>
          <label className="text-[12px] text-ink-600">
            <div className="mb-1">Charged at most</div>
            <input type="number" min={0} value={cfg.maxPenaltyPeriods} className={`${input} w-24`}
              onChange={(e) => setCfg({ ...cfg, maxPenaltyPeriods: Number(e.target.value) })} />
          </label>
          <label className="text-[12px] text-ink-600">
            <div className="mb-1">Default target</div>
            <input type="number" min={1} value={cfg.defaultTarget} className={`${input} w-24`}
              onChange={(e) => setCfg({ ...cfg, defaultTarget: Number(e.target.value) })} />
          </label>
          <label className="text-[12px] text-ink-600">
            <div className="mb-1">Incentive at 100% (₹)</div>
            <input type="number" min={0} value={cfg.incentivePot} className={`${input} w-32`}
              onChange={(e) => setCfg({ ...cfg, incentivePot: Number(e.target.value) })} />
          </label>
          <label className="text-[12px] text-ink-600">
            <div className="mb-1">Per point over target (₹)</div>
            <input type="number" min={0} value={cfg.bonusPerPoint} className={`${input} w-28`}
              onChange={(e) => setCfg({ ...cfg, bonusPerPoint: Number(e.target.value) })} />
          </label>
          <label className="text-[12px] text-ink-600">
            <div className="mb-1">Payout cap (% of pot)</div>
            <input type="number" min={100} value={cfg.maxPayoutPct} className={`${input} w-24`}
              onChange={(e) => setCfg({ ...cfg, maxPayoutPct: Number(e.target.value) })} />
          </label>
        </div>

        <div>
          <h3 className="text-[13px] font-semibold text-ink-900 mb-2">Slabs</h3>
          <div className="flex flex-wrap items-end gap-3">
            {rungs.map((r, i) => (
              <div key={i} className="flex items-end gap-1">
                <label className="text-[12px] text-ink-600">
                  <div className="mb-1">At %</div>
                  <input type="number" value={r.minPct} className={`${input} w-20`}
                    onChange={(e) => setRungs(rungs.map((x, j) => (j === i ? { ...x, minPct: Number(e.target.value) } : x)))} />
                </label>
                <label className="text-[12px] text-ink-600">
                  <div className="mb-1">pays %</div>
                  <input type="number" value={r.payoutPct} className={`${input} w-20`}
                    onChange={(e) => setRungs(rungs.map((x, j) => (j === i ? { ...x, payoutPct: Number(e.target.value) } : x)))} />
                </label>
                <button onClick={() => setRungs(rungs.filter((_, j) => j !== i))}
                  className="h-8 px-2 text-[12px] text-ink-500 hover:text-danger-500">×</button>
              </div>
            ))}
            <button onClick={() => setRungs([...rungs, { minPct: 0, payoutPct: 0 }])}
              className="h-8 px-3 text-[12px] rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50">
              Add slab
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button disabled={pending}
            onClick={() => run(() => saveStagePoints(ladder.map((s) => ({
              funnelId: s.funnel_id, stageKey: s.stage_key, points: s.points, slaDays: s.sla_days,
            }))), 'Ladder saved')}
            className="px-3 h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40">
            Save ladder
          </button>
          <button disabled={pending}
            onClick={() => run(() => saveScoreSettings(cfg), 'Settings saved')}
            className="px-3 h-9 text-sm font-semibold rounded-md border border-ink-200 text-ink-800 hover:bg-ink-50 disabled:opacity-40">
            Save settings
          </button>
          <button disabled={pending}
            onClick={() => run(() => saveSlabs(rungs), 'Slabs saved')}
            className="px-3 h-9 text-sm font-semibold rounded-md border border-ink-200 text-ink-800 hover:bg-ink-50 disabled:opacity-40">
            Save slabs
          </button>
          {note && <span className="text-[12px] text-success-600">{note}</span>}
          {err && <span className="text-[12px] text-danger-500">{err}</span>}
        </div>

        <div className="pt-2 border-t border-ink-150">
          <h3 className="text-[13px] font-semibold text-ink-900 mb-1">Targets for {monthLabel}</h3>
          <p className="text-[12px] text-ink-500 mb-2">
            Blank uses the default of {cfg.defaultTarget}. Set a lower one for a joiner or a part-month —
            the percentage is what the incentive reads, so the target is how fairness gets applied.
          </p>
          <div className="flex flex-wrap gap-3">
            {targets.map((t) => (
              <label key={t.user_id} className="text-[12px] text-ink-600">
                <div className="mb-1">{t.name}{t.is_override && <span className="text-brand-600"> ·set</span>}</div>
                <input
                  type="number" min={1} defaultValue={t.is_override ? t.target_points : ''}
                  placeholder={String(cfg.defaultTarget)}
                  className={`${input} w-24`}
                  onBlur={(e) => run(() => saveTarget({
                    userId: t.user_id, month,
                    targetPoints: e.target.value === '' ? null : Number(e.target.value),
                  }), `${t.name}'s target saved`)}
                />
              </label>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
