'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { query } from '@/lib/db';

type R = { ok: boolean; error?: string };

/**
 * Only an admin changes what work is worth.
 *
 * These rows decide the month-end payout, so the gate is the strictest one in
 * the CRM: a lead can read every score and set nothing.
 */
async function admin() {
  const me = await getSessionUser();
  if (!me) return { me: null, err: 'unauthenticated' };
  if (me.role !== 'admin') return { me: null, err: 'Only an admin can change scoring' };
  return { me, err: null };
}

export async function saveStagePoints(rows: {
  funnelId: number; stageKey: string; points: number; slaDays: number | null;
  penaltyPoints: number | null;
}[]): Promise<R> {
  const { err } = await admin();
  if (err) return { ok: false, error: err };

  for (const r of rows) {
    if (!Number.isFinite(r.points) || r.points < 0 || r.points > 1000) {
      return { ok: false, error: `Points for ${r.stageKey} must be between 0 and 1000` };
    }
    if (r.slaDays != null && (!Number.isFinite(r.slaDays) || r.slaDays < 1 || r.slaDays > 365)) {
      return { ok: false, error: `Days for ${r.stageKey} must be between 1 and 365, or blank` };
    }
    if (r.penaltyPoints != null && (r.penaltyPoints < 0 || r.penaltyPoints > 1000)) {
      return { ok: false, error: `Cost for ${r.stageKey} must be between 0 and 1000, or blank` };
    }
    await query(
      `INSERT INTO atlas.crm_stage_points (funnel_id, stage_key, points, sla_days, penalty_points)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (funnel_id, stage_key)
       DO UPDATE SET points = EXCLUDED.points, sla_days = EXCLUDED.sla_days,
                     penalty_points = EXCLUDED.penalty_points`,
      [r.funnelId, r.stageKey, Math.round(r.points),
       r.slaDays == null ? null : Math.round(r.slaDays),
       r.penaltyPoints == null ? null : Math.round(r.penaltyPoints)],
    );
  }
  revalidatePath('/crm/score');
  return { ok: true };
}

export async function saveScoreSettings(input: {
  penaltyMultiplier: number; defaultTarget: number; incentivePot: number;
  bonusPerPoint: number; maxPayoutPct: number; maxPenaltyPeriods: number;
}): Promise<R> {
  const { err } = await admin();
  if (err) return { ok: false, error: err };
  if (input.penaltyMultiplier < 0 || input.penaltyMultiplier > 10) {
    return { ok: false, error: 'Penalty multiplier must be between 0 and 10' };
  }
  if (input.defaultTarget < 1) return { ok: false, error: 'Default target must be at least 1' };

  await query(
    `UPDATE atlas.crm_score_settings
        SET penalty_multiplier = $1, default_target = $2, incentive_pot = $3,
            bonus_per_point = $4, max_payout_pct = $5, max_penalty_periods = $6,
            updated_at = now()
      WHERE id`,
    [input.penaltyMultiplier, Math.round(input.defaultTarget), input.incentivePot,
     input.bonusPerPoint, Math.round(input.maxPayoutPct), Math.round(input.maxPenaltyPeriods)],
  );
  revalidatePath('/crm/score');
  return { ok: true };
}

export async function saveSlabs(slabs: { minPct: number; payoutPct: number }[]): Promise<R> {
  const { err } = await admin();
  if (err) return { ok: false, error: err };
  const clean = slabs
    .filter((s) => Number.isFinite(s.minPct) && Number.isFinite(s.payoutPct))
    .map((s) => ({ minPct: Math.round(s.minPct), payoutPct: Math.round(s.payoutPct) }));
  // A ladder with no bottom rung pays out for a blank month, which is exactly
  // the thing the qualifying floor exists to prevent.
  if (!clean.some((s) => s.minPct === 0)) clean.unshift({ minPct: 0, payoutPct: 0 });

  await query(`DELETE FROM atlas.crm_incentive_slabs`);
  for (const s of clean) {
    await query(
      `INSERT INTO atlas.crm_incentive_slabs (min_pct, payout_pct) VALUES ($1, $2)
       ON CONFLICT (min_pct) DO UPDATE SET payout_pct = EXCLUDED.payout_pct`,
      [s.minPct, s.payoutPct],
    );
  }
  revalidatePath('/crm/score');
  return { ok: true };
}

export async function saveTarget(input: {
  userId: number; month: string; targetPoints: number | null;
}): Promise<R> {
  const { me, err } = await admin();
  if (err) return { ok: false, error: err };
  if (!/^\d{4}-\d{2}$/.test(input.month)) return { ok: false, error: 'Bad month' };

  // Blank means "use the default", which is a deletion rather than a zero —
  // a zero target would read as 0% forever and pay nothing.
  if (input.targetPoints == null) {
    await query(`DELETE FROM atlas.crm_point_targets WHERE user_id = $1 AND month = $2::date`,
      [input.userId, `${input.month}-01`]);
  } else {
    if (input.targetPoints < 1 || input.targetPoints > 100000) {
      return { ok: false, error: 'Target must be at least 1' };
    }
    await query(
      `INSERT INTO atlas.crm_point_targets (user_id, month, target_points, set_by)
       VALUES ($1, $2::date, $3, $4)
       ON CONFLICT (user_id, month)
       DO UPDATE SET target_points = EXCLUDED.target_points, set_by = EXCLUDED.set_by, updated_at = now()`,
      [input.userId, `${input.month}-01`, Math.round(input.targetPoints), me!.id],
    );
  }
  revalidatePath('/crm/score');
  return { ok: true };
}
