-- ---------------------------------------------------------------------------
-- Readiness by SEGMENT.
--
-- mv_city_readiness scores by category, and "Diagnostics" is too coarse to act
-- on: it folds home collection, imaging centres and hospital labs into one
-- number, and those are different networks with different gaps. A city can be
-- thick with diagnostic centres and have nobody who will collect at home, and
-- the category score cannot say so.
--
-- Segment membership comes from the provider's own configuration —
-- Lab.homeCollection, Lab.centerVisit and Lab.centerType — not from inference,
-- so every lab is classified. A lab that does both home collection and centre
-- visits appears in both segments: this is capability, not a partition.
--
-- mv_city_readiness is left alone. The corporate overlay and the category view
-- still read it, and the two answer different questions.
-- ---------------------------------------------------------------------------

-- Norms for the new segments.
--
-- These are starting points, not measurements: nobody has yet said how many
-- imaging centres a C1 city needs before it is sellable. They are set from the
-- size of each segment relative to the diagnostics network as a whole
-- (radiology is 1,309 of 1,774 centres, hospitals 437, home sample 198), which
-- makes them defensible rather than correct. They live in the same table as
-- every other norm, so the network team can change them with an UPDATE and the
-- scores move with no deploy.
INSERT INTO atlas.density_norms (band, category, min_providers, min_pincodes, tiers_expected) VALUES
 ('C1','LAB_HOME_SAMPLE',      20, 100, 2), ('C2','LAB_HOME_SAMPLE',       8,  40, 2), ('C3','LAB_HOME_SAMPLE',      3, 12, 1),
 ('C1','LAB_CENTER_RADIOLOGY', 45,  90, 3), ('C2','LAB_CENTER_RADIOLOGY', 18,  35, 2), ('C3','LAB_CENTER_RADIOLOGY', 6, 12, 1),
 ('C1','LAB_CENTER_HOSPITAL',  15,  30, 2), ('C2','LAB_CENTER_HOSPITAL',   6,  12, 1), ('C3','LAB_CENTER_HOSPITAL',  2,  4, 1),
 ('C1','DOCTOR_CENTER',        25,  40, 2), ('C2','DOCTOR_CENTER',        10,  15, 2), ('C3','DOCTOR_CENTER',        4,  6, 1)
ON CONFLICT (band, category) DO NOTHING;

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_city_readiness_segment CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_city_readiness_segment AS
WITH lab_cfg AS (
  SELECT id, "homeCollection" AS home, "centerVisit" AS centre, "centerType" AS ctype
  FROM src_local."Lab"
),
-- One row per (provider, segment). A lab offering both services is in both.
seg AS (
  SELECT p.entity_id, atlas.city_key(p.city) AS city_key, p.pincode,
         p.serviced_pincodes, s.segment
  FROM analytics.mv_provider_unified p
  LEFT JOIN lab_cfg l ON p.source_table = 'Lab' AND l.id = p.source_id
  CROSS JOIN LATERAL (
    SELECT unnest(
      CASE
        WHEN p.kind IN ('LAB','HOSPITAL') THEN
          ARRAY_REMOVE(ARRAY[
            CASE WHEN l.home   THEN 'LAB_HOME_SAMPLE' END,
            CASE WHEN l.centre AND l.ctype = 'HOSPITAL'          THEN 'LAB_CENTER_HOSPITAL' END,
            CASE WHEN l.centre AND l.ctype <> 'HOSPITAL'         THEN 'LAB_CENTER_RADIOLOGY' END
          ], NULL)
        WHEN p.kind = 'DOCTOR' AND 'CENTER_VISIT' = ANY(p.modalities) THEN ARRAY['DOCTOR_CENTER']
        WHEN p.kind = 'NURSE'    THEN ARRAY['HOME_CARE']
        WHEN p.kind = 'PHARMACY' THEN ARRAY['PHARMACY']
      END) AS segment
  ) s
  WHERE NULLIF(TRIM(p.city), '') IS NOT NULL
    AND s.segment IS NOT NULL

  UNION ALL

  -- Wellness has no lab configuration to read; it keeps its category as its
  -- segment so the page can show every tab from one relation.
  SELECT NULL::text, atlas.city_key(w.city), w.pincode, NULL::text[],
         CASE WHEN w.kind = 'INSTRUCTOR' THEN 'WELLNESS_ONLINE' ELSE 'WELLNESS_OFFLINE' END
  FROM atlas.wellness_provider w
  WHERE NULLIF(TRIM(w.city), '') IS NOT NULL
),
-- Where a segment actually reaches, which is not the same question per
-- segment. Home sample is the pincodes a lab has declared it will collect
-- from; centre visit is the pincodes within travelling distance of the
-- building; everything else has no service area recorded, so the provider's
-- own pincode is the only honest answer.
--
-- This was counting the provider's own pincode for every segment, which for
-- home sample is badly wrong: Bengaluru's home-sample labs SIT in 26 pincodes
-- and SERVE 118, and the page reported 28 covered and 114 with "no supply".
city_pin AS (
  SELECT atlas.city_key(city) AS city_key, pincode
  FROM analytics.mv_pincode_city
  WHERE NULLIF(TRIM(city), '') IS NOT NULL
),
cover AS (
  SELECT DISTINCT g.city_key, g.segment, sp AS pincode
  FROM seg g, LATERAL unnest(COALESCE(g.serviced_pincodes, ARRAY[]::text[])) sp
  WHERE g.segment = 'LAB_HOME_SAMPLE' AND NULLIF(sp, '') IS NOT NULL

  UNION

  -- Exact coordinates only: a 'prefix3' pincode shares one guessed point with
  -- a dozen others, so a centre near it would "reach" all of them at zero km.
  SELECT DISTINCT g.city_key, g.segment, r.covered_pincode
  FROM seg g
  JOIN analytics.mv_pincode_cv_reach r ON r.entity_id = g.entity_id
  JOIN analytics.mv_pincode_geo pg
    ON pg.pincode = r.covered_pincode AND pg.geo_source = 'exact'
  WHERE g.segment LIKE 'LAB\_CENTER%' AND r.distance_km <= 10::numeric

  UNION

  SELECT DISTINCT g.city_key, g.segment, g.pincode
  FROM seg g
  WHERE g.segment NOT LIKE 'LAB\_%' AND g.pincode IS NOT NULL
),
-- Only the city's own pincodes count towards its coverage. A Bengaluru lab
-- that also serves Mysore is not making Bengaluru readier.
cover_in_city AS (
  SELECT c.city_key, c.segment, COUNT(DISTINCT c.pincode)::int AS pincodes_covered
  FROM cover c
  JOIN city_pin cp ON cp.city_key = c.city_key AND cp.pincode = c.pincode
  GROUP BY c.city_key, c.segment
),
city_pincodes AS (
  SELECT atlas.city_key(city) AS city_key, COUNT(DISTINCT pincode)::int AS total_pincodes
  FROM analytics.mv_pincode_city
  WHERE NULLIF(TRIM(city), '') IS NOT NULL
  GROUP BY 1
),
lab_city AS (
  SELECT l.id AS lab_id, atlas.city_key(l.city) AS city_key
  FROM src_local."Lab" l WHERE NULLIF(TRIM(l.city), '') IS NOT NULL
),
tier_by_city AS (
  SELECT lc.city_key, COUNT(DISTINCT pt.tier)::int AS tiers_present
  FROM lab_city lc JOIN atlas.provider_tier pt ON pt.lab_id = lc.lab_id
  WHERE pt.tier <> 'Unknown' GROUP BY lc.city_key
),
integration_by_city AS (
  SELECT lc.city_key,
         NULLIF(COUNT(*) FILTER (WHERE pi.f_level >= 3), 0)::numeric / NULLIF(COUNT(*), 0) AS ratio
  FROM lab_city lc JOIN atlas.provider_integration pi ON pi.lab_id = lc.lab_id
  GROUP BY lc.city_key
),
sla_by_city AS (
  SELECT atlas.city_key(q.city) AS city_key,
         AVG(LEAST(q.delivered_pct / NULLIF(t.target, 0), 1)) AS ratio
  FROM analytics.mv_lab_quality_v2 q
  CROSS JOIN atlas.sla_targets t
  WHERE t.kind = 'LAB' AND t.metric = 'delivered_pct' AND q.orders_total > 0
  GROUP BY 1
),
per_seg AS (
  SELECT g.city_key, g.segment,
         COUNT(*)::int AS providers,
         COALESCE((SELECT ci.pincodes_covered FROM cover_in_city ci
                    WHERE ci.city_key = g.city_key AND ci.segment = g.segment), 0)::int AS pincodes_covered,
         -- The centre/home split that mv_city_readiness carries per category
         -- is what a segment already is, so it collapses to the segment's own
         -- counts. Kept so the row shape matches and the shared gap logic can
         -- read it without special-casing.
         CASE WHEN g.segment LIKE 'LAB\_CENTER%' OR g.segment = 'DOCTOR_CENTER'
              THEN COUNT(*) ELSE 0 END::int AS providers_center,
         CASE WHEN g.segment IN ('LAB_HOME_SAMPLE','HOME_CARE')
              THEN COUNT(*) ELSE 0 END::int AS providers_home,
         CASE WHEN g.segment LIKE 'LAB\_CENTER%' OR g.segment = 'DOCTOR_CENTER'
              THEN COALESCE((SELECT ci.pincodes_covered FROM cover_in_city ci
                              WHERE ci.city_key = g.city_key AND ci.segment = g.segment), 0)
              ELSE 0 END::int AS pincodes_center,
         CASE WHEN g.segment IN ('LAB_HOME_SAMPLE','HOME_CARE')
              THEN COALESCE((SELECT ci.pincodes_covered FROM cover_in_city ci
                              WHERE ci.city_key = g.city_key AND ci.segment = g.segment), 0)
              ELSE 0 END::int AS pincodes_home,
         -- Tier, integration and SLA are lab facts, so they only apply to the
         -- lab segments. On a doctor or nurse segment they would silently
         -- borrow the diagnostics network's maturity; NULL instead, and the
         -- weight redistributes to what is actually measured.
         CASE WHEN g.segment LIKE 'LAB\_%'
              THEN (SELECT t.tiers_present FROM tier_by_city t WHERE t.city_key = g.city_key) END AS tiers_present,
         CASE WHEN g.segment LIKE 'LAB\_%'
              THEN (SELECT i.ratio FROM integration_by_city i WHERE i.city_key = g.city_key) END AS integration_ratio,
         CASE WHEN g.segment LIKE 'LAB\_%'
              THEN (SELECT s.ratio FROM sla_by_city s WHERE s.city_key = g.city_key) END        AS sla_ratio
  FROM seg g
  GROUP BY g.city_key, g.segment
),
scored AS (
  SELECT b.city, b.city_key, b.band, p.segment,
         p.providers, p.pincodes_covered, cp.total_pincodes,
         p.providers_center, p.providers_home, p.pincodes_center, p.pincodes_home,
         p.tiers_present, n.min_providers, n.min_pincodes, n.tiers_expected,
         CASE WHEN cp.total_pincodes IS NULL OR cp.total_pincodes = 0 THEN NULL
              ELSE LEAST(p.pincodes_covered::numeric / cp.total_pincodes, 1) END AS coverage_score,
         CASE WHEN n.min_providers IS NULL OR n.min_providers = 0 THEN NULL
              ELSE LEAST(p.providers::numeric / n.min_providers, 1) END          AS density_score,
         p.integration_ratio AS integration_score,
         p.sla_ratio         AS sla_score,
         CASE WHEN p.tiers_present IS NULL OR n.tiers_expected IS NULL OR n.tiers_expected = 0
              THEN NULL ELSE LEAST(p.tiers_present::numeric / n.tiers_expected, 1) END AS price_score
  FROM per_seg p
  JOIN atlas.city_band b     ON b.city_key = p.city_key
  JOIN atlas.density_norms n ON n.band = b.band AND n.category = p.segment
  LEFT JOIN city_pincodes cp ON cp.city_key = p.city_key
),
weighted AS (
  SELECT s.*,
         (SELECT weight FROM atlas.readiness_weights WHERE subscore='coverage')    AS w_cov,
         (SELECT weight FROM atlas.readiness_weights WHERE subscore='density')     AS w_den,
         (SELECT weight FROM atlas.readiness_weights WHERE subscore='integration') AS w_int,
         (SELECT weight FROM atlas.readiness_weights WHERE subscore='sla')         AS w_sla,
         (SELECT weight FROM atlas.readiness_weights WHERE subscore='price')       AS w_pri
  FROM scored s
)
SELECT w.city, w.city_key, w.band, w.segment,
       COALESCE(ct.tier, 'Unknown') AS city_tier,
       w.providers, w.pincodes_covered, w.total_pincodes,
       w.providers_center, w.providers_home, w.pincodes_center, w.pincodes_home,
       w.tiers_present, w.min_providers, w.min_pincodes, w.tiers_expected,
       ROUND(w.coverage_score, 3)    AS coverage_score,
       ROUND(w.density_score, 3)     AS density_score,
       ROUND(w.integration_score, 3) AS integration_score,
       ROUND(w.sla_score, 3)         AS sla_score,
       ROUND(w.price_score, 3)       AS price_score,
       ROUND(100 * (
           COALESCE(w.coverage_score, 0)    * w_cov
         + COALESCE(w.density_score, 0)     * w_den
         + COALESCE(w.integration_score, 0) * w_int
         + COALESCE(w.sla_score, 0)         * w_sla
         + COALESCE(w.price_score, 0)       * w_pri
       ) / NULLIF(
           (CASE WHEN w.coverage_score    IS NULL THEN 0 ELSE w_cov END)
         + (CASE WHEN w.density_score     IS NULL THEN 0 ELSE w_den END)
         + (CASE WHEN w.integration_score IS NULL THEN 0 ELSE w_int END)
         + (CASE WHEN w.sla_score         IS NULL THEN 0 ELSE w_sla END)
         + (CASE WHEN w.price_score       IS NULL THEN 0 ELSE w_pri END), 0)
       )::int AS score,
       (CASE WHEN w.coverage_score    IS NULL THEN 0 ELSE 1 END)
     + (CASE WHEN w.density_score     IS NULL THEN 0 ELSE 1 END)
     + (CASE WHEN w.integration_score IS NULL THEN 0 ELSE 1 END)
     + (CASE WHEN w.sla_score         IS NULL THEN 0 ELSE 1 END)
     + (CASE WHEN w.price_score       IS NULL THEN 0 ELSE 1 END) AS subscores_present
FROM weighted w
LEFT JOIN atlas.city_tier_canon ct ON ct.city_key = w.city_key

UNION ALL

-- "All segments": the average of a city's segment scores, not a re-scoring of
-- the union. A composite built from summed providers against summed norms
-- reads as precise and is not — a lab appears in several segments, so the
-- numerator and denominator count different things. The mean says exactly what
-- it is: how ready this city is across the services it has, each weighted the
-- same. Providers and pincodes are deduplicated, so those stay true counts.
SELECT w.city, w.city_key, w.band, 'ALL' AS segment,
       COALESCE(ct.tier, 'Unknown') AS city_tier,
       (SELECT COUNT(DISTINCT g.entity_id)::int FROM seg g WHERE g.city_key = w.city_key) AS providers,
       (SELECT COUNT(DISTINCT c.pincode)::int FROM cover c
         JOIN city_pin cp ON cp.city_key = c.city_key AND cp.pincode = c.pincode
        WHERE c.city_key = w.city_key)                                        AS pincodes_covered,
       MAX(w.total_pincodes)                                                  AS total_pincodes,
       SUM(w.providers_center)::int  AS providers_center,
       SUM(w.providers_home)::int    AS providers_home,
       MAX(w.pincodes_center)::int   AS pincodes_center,
       MAX(w.pincodes_home)::int     AS pincodes_home,
       MAX(w.tiers_present)          AS tiers_present,
       SUM(w.min_providers)::int     AS min_providers,
       SUM(w.min_pincodes)::int      AS min_pincodes,
       MAX(w.tiers_expected)::int    AS tiers_expected,
       ROUND(AVG(w.coverage_score), 3)    AS coverage_score,
       ROUND(AVG(w.density_score), 3)     AS density_score,
       ROUND(AVG(w.integration_score), 3) AS integration_score,
       ROUND(AVG(w.sla_score), 3)         AS sla_score,
       ROUND(AVG(w.price_score), 3)       AS price_score,
       ROUND(AVG(w.score))::int           AS score,
       MAX(w.subscores_present)           AS subscores_present
FROM (
  SELECT s.*,
         ROUND(100 * (
             COALESCE(s.coverage_score, 0)    * s.w_cov
           + COALESCE(s.density_score, 0)     * s.w_den
           + COALESCE(s.integration_score, 0) * s.w_int
           + COALESCE(s.sla_score, 0)         * s.w_sla
           + COALESCE(s.price_score, 0)       * s.w_pri
         ) / NULLIF(
             (CASE WHEN s.coverage_score    IS NULL THEN 0 ELSE s.w_cov END)
           + (CASE WHEN s.density_score     IS NULL THEN 0 ELSE s.w_den END)
           + (CASE WHEN s.integration_score IS NULL THEN 0 ELSE s.w_int END)
           + (CASE WHEN s.sla_score         IS NULL THEN 0 ELSE s.w_sla END)
           + (CASE WHEN s.price_score       IS NULL THEN 0 ELSE s.w_pri END), 0))::int AS score,
           (CASE WHEN s.coverage_score    IS NULL THEN 0 ELSE 1 END)
         + (CASE WHEN s.density_score     IS NULL THEN 0 ELSE 1 END)
         + (CASE WHEN s.integration_score IS NULL THEN 0 ELSE 1 END)
         + (CASE WHEN s.sla_score         IS NULL THEN 0 ELSE 1 END)
         + (CASE WHEN s.price_score       IS NULL THEN 0 ELSE 1 END) AS subscores_present
  FROM weighted s
) w
LEFT JOIN atlas.city_tier_canon ct ON ct.city_key = w.city_key
GROUP BY w.city, w.city_key, w.band, ct.tier;

CREATE UNIQUE INDEX IF NOT EXISTS mv_city_readiness_segment_key
  ON analytics.mv_city_readiness_segment (city_key, segment);
CREATE INDEX IF NOT EXISTS mv_city_readiness_segment_seg
  ON analytics.mv_city_readiness_segment (segment, score DESC);
