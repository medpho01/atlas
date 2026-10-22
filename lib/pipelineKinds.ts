/**
 * The pipeline vocabulary, with no database in it.
 *
 * Separate from lib/pipelines.ts because the list in the settings screen is a
 * client component: it needs these types and labels, and importing them from a
 * `server-only` module takes the whole pg client into the browser bundle —
 * which is the same reason lib/access.ts stays pure.
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
  network: 'Provider onboarding',
};

export const KIND_BLURB: Record<PipelineKind, string> = {
  sales: 'Signing new stores. Stages carry a win probability, and one of them means signed.',
  network: 'Onboarding providers. Stages are a checklist; one of them means onboarded.',
};
