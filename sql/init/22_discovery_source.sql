-- ============================================================================
-- 22_discovery_source.sql — record which source produced a lead.
--
-- 20_lab_discovery_ranking.sql made everything downstream of the source
-- source-agnostic: the scoring, the reasons, the card, promote-to-CRM. What it
-- did not need, because there was only ever one source, was a column saying
-- which one answered. There are four now — mappls, ola, google and the model —
-- so the question "where did this lead come from" has to be answerable from
-- the data rather than from the date.
--
-- Three things need it:
--
--   * Google's terms. They permit keeping a place id indefinitely but treat
--     name, address and phone as cached content with an expiry, and
--     promote-to-CRM is exactly that retention. Marking Google rows is what
--     makes a retention job possible at all; without the column there is no
--     way to tell them apart.
--   * Cost. discovery_run.source next to found and ran_at is what makes "what
--     is the page load costing us, and on which source" answerable.
--   * Trust. A lead from a places directory and a lead a model read off the
--     open web are not equally well evidenced, and the person dialling the
--     number should be able to see which they are holding.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS throughout, and the backfill is bounded
-- by source IS NULL. Safe to run twice, and safe to run on a database that
-- already has rows.
-- ============================================================================

ALTER TABLE atlas.discovered_lab
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE atlas.discovery_run
  ADD COLUMN IF NOT EXISTS source text;

-- Every row that predates this migration came from the model path, because it
-- was the only path. Saying so beats leaving a NULL that reads as "unknown
-- source" forever.
UPDATE atlas.discovered_lab
   SET source = 'llm'
 WHERE source IS NULL AND model IS NOT NULL;

UPDATE atlas.discovery_run
   SET source = 'llm'
 WHERE source IS NULL AND model IS NOT NULL;

COMMENT ON COLUMN atlas.discovered_lab.source IS
  'Which source produced this row: mappls | ola | google | llm. Google rows '
  'are the ones whose name/address/phone are cached content under Google''s '
  'terms; the others are not.';

COMMENT ON COLUMN atlas.discovery_run.source IS
  'Which source answered for this pincode on the last run. NULL when nothing '
  'answered.';

-- Answering "how many Google rows are we retaining" should not be a seq scan
-- over every lead ever found.
CREATE INDEX IF NOT EXISTS idx_discovered_lab_source
  ON atlas.discovered_lab (source);
