'use server';

import { revalidatePath } from 'next/cache';
import { query, queryOne } from '@/lib/db';
import { getSessionUser, audit } from '@/lib/auth';
import { canManage } from '@/lib/access';
import type { Stage } from '@/lib/salesCrm';

type R = { ok: boolean; error?: string };

/**
 * Replace a pipeline's stages.
 *
 * Validated here rather than by a CHECK constraint, because the rules are
 * about the array as a whole and the error has to be a sentence somebody can
 * act on — "Pilot still holds 4 deals" is useful, a constraint violation is
 * not.
 */
export async function saveStages(input: { pipelineId: number; stages: Stage[] }): Promise<R> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!canManage(me, 'admin')) return { ok: false, error: 'Needs the admin role' };

  const stages = (input.stages ?? []).map((s) => ({
    key: String(s.key ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    label: String(s.label ?? '').trim().slice(0, 40),
    probability: Math.max(0, Math.min(100, Math.round(Number(s.probability) || 0))),
    outcome: (['open', 'won', 'lost'] as const).includes(s.outcome) ? s.outcome : 'open',
  }));

  if (stages.some((s) => !s.key || !s.label)) {
    return { ok: false, error: 'Every stage needs a name' };
  }
  if (new Set(stages.map((s) => s.key)).size !== stages.length) {
    return { ok: false, error: 'Two stages have the same key — rename one' };
  }
  if (stages.filter((s) => s.outcome === 'won').length !== 1) {
    return { ok: false, error: 'Exactly one won stage. Every report counts on it.' };
  }
  if (stages.filter((s) => s.outcome === 'lost').length !== 1) {
    return { ok: false, error: 'Exactly one lost stage. Every report counts on it.' };
  }
  if (!stages.some((s) => s.outcome === 'open')) {
    return { ok: false, error: 'A pipeline needs at least one open stage to put new deals in' };
  }

  // A stage holding deals cannot vanish: those deals would be on a stage that
  // no longer exists, which the board would show as nowhere at all.
  const orphan = await queryOne<{ stage_key: string; n: number }>(`
    SELECT d.stage_key, COUNT(*)::int AS n
    FROM atlas.sales_deal d
    WHERE d.pipeline_id = $1 AND NOT (d.stage_key = ANY($2::text[]))
    GROUP BY 1 ORDER BY 2 DESC LIMIT 1
  `, [input.pipelineId, stages.map((s) => s.key)]);
  if (orphan) {
    return {
      ok: false,
      error: `"${orphan.stage_key}" still holds ${orphan.n} deal${orphan.n === 1 ? '' : 's'} — move them first`,
    };
  }

  await query(
    `UPDATE atlas.sales_pipeline SET stages = $2::jsonb, updated_at = now() WHERE id = $1`,
    [input.pipelineId, JSON.stringify(stages)],
  );
  audit(me.id, '/settings/pipeline', 'save-stages');
  revalidatePath('/sales');
  revalidatePath('/settings/pipeline');
  return { ok: true };
}
