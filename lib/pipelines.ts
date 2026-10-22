import 'server-only';
import { query } from './db';

/**
 * Every pipeline in Atlas, whichever CRM owns it.
 *
 * There are two shapes, and they are genuinely different rather than
 * accidentally so:
 *
 *   sales    atlas.sales_pipeline — stages carry a probability and an outcome
 *            (open / won / lost), because a sales board weights its forecast
 *            and has to know which column means signed.
 *   network  atlas.crm_funnels    — stages are key and label only, and the
 *            funnel row names its success stage. Onboarding a provider is not
 *            weighted and nothing reads a probability.
 *
 * This file does NOT flatten them into one. Writing an `outcome` into a CRM
 * funnel would put a field in the database that nothing reads, and a reader
 * later would reasonably believe it. The screen adapts instead.
 */
export type PipelineKind = 'sales' | 'network';

export type PipelineStage = {
  key: string;
  label: string;
  /** Sales only. */
  probability?: number;
  /** Sales only: open | won | lost. */
  outcome?: 'open' | 'won' | 'lost';
};

export type PipelineSummary = {
  kind: PipelineKind;
  id: number;
  name: string;
  isDefault: boolean;
  stages: PipelineStage[];
  /** Network only: the stage that means onboarded. */
  successKey: string | null;
  /** How many cards sit on each stage, keyed by stage key. */
  counts: Record<string, number>;
  /** What the cards on this pipeline are called, for the editor's column. */
  cardNoun: string;
  /** Where this pipeline's board lives. */
  href: string;
};

export const KIND_LABEL: Record<PipelineKind, string> = {
  sales: 'Sales CRM',
  network: 'Network CRM',
};

export const KIND_BLURB: Record<PipelineKind, string> = {
  sales: 'Signing new stores. Stages carry a win probability, and one of them means signed.',
  network: 'Onboarding providers. Stages are a checklist; one of them means onboarded.',
};

export async function listPipelines(): Promise<PipelineSummary[]> {
  const [sales, salesCounts, funnels, funnelCounts] = await Promise.all([
    query<{ id: number; name: string; stages: PipelineStage[]; is_default: boolean }>(
      `SELECT id, name, stages, is_default FROM atlas.sales_pipeline ORDER BY is_default DESC, id`),
    query<{ pipeline_id: number; stage_key: string; n: number }>(
      `SELECT pipeline_id, stage_key, COUNT(*)::int AS n FROM atlas.sales_deal GROUP BY 1, 2`),
    query<{ id: number; name: string; stages: PipelineStage[]; is_default: boolean; success_stage_key: string | null }>(
      `SELECT id, name, stages, is_default, success_stage_key FROM atlas.crm_funnels ORDER BY is_default DESC, name`),
    query<{ funnel_id: number; stage_key: string; n: number }>(`
      SELECT t.funnel_id, tp.stage_key, COUNT(*)::int AS n
      FROM atlas.crm_thread_providers tp
      JOIN atlas.crm_threads t ON t.id = tp.thread_id
      GROUP BY 1, 2`),
  ]);

  const countsFor = (rows: { stage_key: string; n: number }[]) =>
    Object.fromEntries(rows.map((r) => [r.stage_key, r.n]));

  return [
    ...sales.map((p): PipelineSummary => ({
      kind: 'sales', id: p.id, name: p.name, isDefault: p.is_default,
      stages: p.stages ?? [], successKey: null,
      counts: countsFor(salesCounts.filter((c) => c.pipeline_id === p.id)),
      cardNoun: 'deals', href: '/sales',
    })),
    ...funnels.map((f): PipelineSummary => ({
      kind: 'network', id: f.id, name: f.name, isDefault: f.is_default,
      stages: f.stages ?? [], successKey: f.success_stage_key,
      counts: countsFor(funnelCounts.filter((c) => c.funnel_id === f.id)),
      cardNoun: 'providers', href: '/crm',
    })),
  ];
}
