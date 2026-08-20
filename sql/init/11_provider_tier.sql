-- ============================================================================
-- Experience tier — Affordable / Prime / Elite / Uber.
--
-- Per centre, not per chain. A chain's flagship and its suburban collection
-- point are not the same experience, and tiering by brand would erase exactly
-- the distinction the tier exists to capture.
--
-- Nothing at source encodes this, so it is classified. But unlike city tier —
-- where the model knows the answer from general knowledge — a provider's tier
-- is a judgement about *this* network's data, so the classifier is given
-- measured inputs and asked to weigh them, not asked to recall a fact.
-- ============================================================================

CREATE TABLE IF NOT EXISTS atlas.provider_tier (
  lab_id      int PRIMARY KEY,
  tier        text NOT NULL CHECK (tier IN ('Affordable', 'Prime', 'Elite', 'Uber', 'Unknown')),
  rationale   text,
  confidence  numeric(3,2),
  -- Signals the classifier saw, kept so a surprising tier can be argued with
  -- rather than only overridden.
  evidence    jsonb NOT NULL DEFAULT '{}'::jsonb,
  source      text NOT NULL DEFAULT 'llm' CHECK (source IN ('llm', 'human')),
  model       text,
  prompt_version int,
  input_hash  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_tier_tier_idx ON atlas.provider_tier (tier);

-- What the classifier reads: one row per lab with the measurable signals.
--
-- price_index is the centre's median B2B against the national median for the
-- same tests — the only signal here that directly reflects positioning, and
-- the reason it is computed per test and then aggregated rather than as a
-- straight average of prices (which would just measure which tests a centre
-- happens to offer).
CREATE OR REPLACE VIEW analytics.v_provider_tier_input AS
WITH national AS (
  SELECT master_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY b2b) AS median_b2b
  FROM analytics.mv_test_rates WHERE b2b > 10
  GROUP BY master_id
),
per_lab AS (
  SELECT r.lab_id,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY r.b2b / NULLIF(n.median_b2b, 0)) AS price_index,
         COUNT(*)::int AS priced_tests,
         COUNT(*) FILTER (WHERE r.nabl)::int AS nabl_tests
  FROM analytics.mv_test_rates r
  JOIN national n ON n.master_id = r.master_id
  WHERE r.b2b > 10
  GROUP BY r.lab_id
)
SELECT
  l.id                       AS lab_id,
  l."labName"                AS lab_name,
  l."centerType"::text       AS center_type,
  c."chainName"              AS chain_name,
  TRIM(l.city)               AS city,
  ct.tier                    AS city_tier,
  ROUND(p.price_index::numeric, 3) AS price_index,
  p.priced_tests,
  p.nabl_tests > 0           AS has_nabl,
  q.health_score_v2          AS health_score,
  q.orders_total,
  q.repeat_rate_pct
-- src_local for Lab: same standby-conflict reasoning as mv_city_readiness.
-- Chain has no snapshot and is small, so it stays on the live foreign table.
FROM src_local."Lab" l
LEFT JOIN src."Chain" c ON c.id = l.chain_id
LEFT JOIN atlas.city_tier ct
  ON ct.city_key = atlas.city_key(l.city)
LEFT JOIN per_lab p ON p.lab_id = l.id
LEFT JOIN analytics.mv_lab_quality_v2 q ON q.lab_id = l.id
WHERE l.active;
