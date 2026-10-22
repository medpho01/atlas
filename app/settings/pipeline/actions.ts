'use server';

import { revalidatePath } from 'next/cache';
import { query, queryOne } from '@/lib/db';
import { getSessionUser, audit } from '@/lib/auth';
import { canManage } from '@/lib/access';
import type { PipelineKind, PipelineStage } from '@/lib/pipelineKinds';

type R = { ok: boolean; error?: string };

/**
 * Replace a pipeline's stages.
 *
 * Validated here rather than by a CHECK constraint, because the rules are
 * about the array as a whole and the error has to be a sentence somebody can
 * act on — "Pilot still holds 4 deals" is useful, a constraint violation is
 * not.
 *
 * The two kinds are validated and written differently on purpose. A sales
 * stage carries a probability and an outcome; a network stage is a key and a
 * label, with the funnel row naming the one that means onboarded. Writing a
 * sales-shaped stage into a CRM funnel would put fields in the database that
 * nothing reads.
 */
export async function saveStages(input: {
  kind: PipelineKind; pipelineId: number; stages: PipelineStage[]; successKey?: string | null;
}): Promise<R> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!canManage(me, 'admin')) return { ok: false, error: 'Needs the admin role' };

  const isSales = input.kind === 'sales';

  const stages = (input.stages ?? []).map((s) => ({
    key: String(s.key ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
    label: String(s.label ?? '').trim().slice(0, 40),
    ...(isSales ? {
      probability: Math.max(0, Math.min(100, Math.round(Number(s.probability) || 0))),
      outcome: (['open', 'won', 'lost'] as const).includes(s.outcome as never)
        ? s.outcome : 'open',
    } : {}),
  })) as PipelineStage[];

  if (stages.length === 0) return { ok: false, error: 'A pipeline needs at least one stage' };
  if (stages.some((s) => !s.key || !s.label)) {
    return { ok: false, error: 'Every stage needs a name' };
  }
  if (new Set(stages.map((s) => s.key)).size !== stages.length) {
    return { ok: false, error: 'Two stages have the same key — rename one' };
  }

  if (isSales) {
    if (stages.filter((s) => s.outcome === 'won').length !== 1) {
      return { ok: false, error: 'Exactly one won stage. Every report counts on it.' };
    }
    if (stages.filter((s) => s.outcome === 'lost').length !== 1) {
      return { ok: false, error: 'Exactly one lost stage. Every report counts on it.' };
    }
    if (!stages.some((s) => s.outcome === 'open')) {
      return { ok: false, error: 'A pipeline needs at least one open stage to put new deals in' };
    }
  } else {
    if (!input.successKey || !stages.some((s) => s.key === input.successKey)) {
      return { ok: false, error: 'Mark the stage that means onboarded' };
    }
  }

  // A stage holding cards cannot vanish: those cards would be on a stage that
  // no longer exists, which the board would show as nowhere at all.
  const keys = stages.map((s) => s.key);
  const orphan = isSales
    ? await queryOne<{ stage_key: string; n: number }>(`
        SELECT d.stage_key, COUNT(*)::int AS n FROM atlas.sales_deal d
        WHERE d.pipeline_id = $1 AND NOT (d.stage_key = ANY($2::text[]))
        GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, [input.pipelineId, keys])
    : await queryOne<{ stage_key: string; n: number }>(`
        SELECT tp.stage_key, COUNT(*)::int AS n
        FROM atlas.crm_thread_providers tp
        JOIN atlas.crm_threads t ON t.id = tp.thread_id
        WHERE t.funnel_id = $1 AND NOT (tp.stage_key = ANY($2::text[]))
        GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, [input.pipelineId, keys]);

  if (orphan) {
    const noun = isSales ? 'deal' : 'provider';
    return {
      ok: false,
      error: `"${orphan.stage_key}" still holds ${orphan.n} ${noun}${orphan.n === 1 ? '' : 's'} — move them first`,
    };
  }

  if (isSales) {
    await query(
      `UPDATE atlas.sales_pipeline SET stages = $2::jsonb, updated_at = now() WHERE id = $1`,
      [input.pipelineId, JSON.stringify(stages)]);
  } else {
    await query(
      `UPDATE atlas.crm_funnels SET stages = $2::jsonb, success_stage_key = $3 WHERE id = $1`,
      [input.pipelineId, JSON.stringify(stages), input.successKey]);
  }

  audit(me.id, '/settings/pipeline', `save:${input.kind}:${input.pipelineId}`);
  revalidatePath('/settings/pipeline');
  revalidatePath(isSales ? '/sales' : '/crm');
  return { ok: true };
}

/** Rename a pipeline. Its stages and the cards on them are untouched. */
export async function renamePipeline(input: {
  kind: PipelineKind; pipelineId: number; name: string;
}): Promise<R> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!canManage(me, 'admin')) return { ok: false, error: 'Needs the admin role' };
  const name = (input.name ?? '').trim().slice(0, 60);
  if (!name) return { ok: false, error: 'Give it a name' };
  const table = input.kind === 'sales' ? 'atlas.sales_pipeline' : 'atlas.crm_funnels';
  await query(`UPDATE ${table} SET name = $2 WHERE id = $1`, [input.pipelineId, name]);
  audit(me.id, '/settings/pipeline', 'rename');
  revalidatePath('/settings/pipeline');
  return { ok: true };
}


/**
 * Create a pipeline for any CRM.
 *
 * This is the only place a pipeline is made. The Network CRM used to have its
 * own funnel builder in a modal — same idea, different code, different rules,
 * and no way to edit a funnel once created. Two builders meant two answers to
 * "what is a stage", and the one on the board could not fix a typo.
 *
 * A new pipeline starts with the stages its kind needs and nothing else. The
 * editor beside it is where the real shape gets built, and a half-built
 * pipeline with a board already pointing at it is worse than an empty one.
 */
export async function createPipeline(input: { kind: PipelineKind; name: string }): Promise<
  R & { id?: number }
> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!canManage(me, 'admin')) return { ok: false, error: 'Needs the admin role' };

  const name = (input.name ?? '').trim().slice(0, 60);
  if (!name) return { ok: false, error: 'Give it a name' };

  let row: { id: number } | null;
  if (input.kind === 'sales') {
    row = await queryOne<{ id: number }>(`
      INSERT INTO atlas.sales_pipeline (name, stages, is_default, created_by)
      VALUES ($1, $2::jsonb, false, $3) RETURNING id
    `, [name, JSON.stringify([
      { key: 'prospect', label: 'Prospect', probability: 10, outcome: 'open' },
      { key: 'won', label: 'Won', probability: 100, outcome: 'won' },
      { key: 'lost', label: 'Lost', probability: 0, outcome: 'lost' },
    ]), me.id]);
  } else {
    row = await queryOne<{ id: number }>(`
      INSERT INTO atlas.crm_funnels (name, stages, success_stage_key, is_default, created_by)
      VALUES ($1, $2::jsonb, 'onboarded', false, $3) RETURNING id
    `, [name, JSON.stringify([
      { key: 'identified', label: 'Identified' },
      { key: 'contacted', label: 'Contacted' },
      { key: 'onboarded', label: 'Onboarded' },
    ]), me.id]);
  }

  audit(me.id, '/settings/pipeline', `create:${input.kind}`);
  revalidatePath('/settings/pipeline');
  revalidatePath(input.kind === 'sales' ? '/sales' : '/crm');
  return { ok: true, id: row?.id };
}

/**
 * Make one pipeline the default for its CRM.
 *
 * Per kind, not globally: the sales default and the onboarding default are
 * unrelated, and a single flag across both would mean picking one CRM's
 * default unsets the other's.
 */
export async function setDefaultPipeline(input: {
  kind: PipelineKind; pipelineId: number;
}): Promise<R> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!canManage(me, 'admin')) return { ok: false, error: 'Needs the admin role' };

  const table = input.kind === 'sales' ? 'atlas.sales_pipeline' : 'atlas.crm_funnels';
  await query(`UPDATE ${table} SET is_default = (id = $1)`, [input.pipelineId]);
  audit(me.id, '/settings/pipeline', `default:${input.kind}`);
  revalidatePath('/settings/pipeline');
  revalidatePath(input.kind === 'sales' ? '/sales' : '/crm');
  return { ok: true };
}
