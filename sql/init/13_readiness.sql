-- ============================================================================
-- E3 · City Readiness Score.
--
-- One number per city per category, 0-100, answering "could we sell into this
-- city tomorrow". The number is not the point — the subscores and the gap list
-- behind it are. A score with no explanation is a score nobody acts on.
--
-- Three config tables so the model is arguable without a deploy: the band a
-- city sits in, the density expected in that band, and the weight each
-- subscore carries. All three are the sort of thing that gets challenged in a
-- meeting, and being able to change them live is worth more than the tidiness
-- of hardcoding them.
-- ============================================================================

-- Which cities matter, and how much. Seeded from live demand rather than a
-- static list — the PRD's call, and the right one: the cities that matter are
-- the ones corporate clients actually order from, which Atlas already knows.
CREATE TABLE IF NOT EXISTS atlas.city_band (
  city_key   text PRIMARY KEY,
  city       text NOT NULL,
  band       text NOT NULL CHECK (band IN ('C1', 'C2', 'C3')),
  rationale  text,
  source     text NOT NULL DEFAULT 'demand' CHECK (source IN ('demand', 'human')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- How much supply a city in each band should have, per category. Targets, not
-- observations: this is the yardstick the score measures against.
CREATE TABLE IF NOT EXISTS atlas.density_norms (
  band          text NOT NULL CHECK (band IN ('C1', 'C2', 'C3')),
  category      text NOT NULL,
  min_providers int NOT NULL,
  min_pincodes  int NOT NULL,
  -- Tiers a corporate buyer expects to be able to choose between.
  tiers_expected int NOT NULL DEFAULT 2,
  PRIMARY KEY (band, category)
);

INSERT INTO atlas.density_norms (band, category, min_providers, min_pincodes, tiers_expected) VALUES
 ('C1','DIAGNOSTICS',60,120,3), ('C1','CONSULTS',25,40,2), ('C1','HOME_CARE',15,30,2),
 ('C1','PHARMACY',20,40,2),     ('C1','WELLNESS_OFFLINE',15,25,2), ('C1','WELLNESS_ONLINE',5,0,1),
 ('C2','DIAGNOSTICS',25,50,2),  ('C2','CONSULTS',10,15,2), ('C2','HOME_CARE',6,12,1),
 ('C2','PHARMACY',8,15,1),      ('C2','WELLNESS_OFFLINE',6,10,1), ('C2','WELLNESS_ONLINE',3,0,1),
 ('C3','DIAGNOSTICS',8,15,1),   ('C3','CONSULTS',4,6,1),   ('C3','HOME_CARE',2,4,1),
 ('C3','PHARMACY',3,5,1),       ('C3','WELLNESS_OFFLINE',2,3,1), ('C3','WELLNESS_ONLINE',1,0,1)
ON CONFLICT (band, category) DO UPDATE SET
  min_providers = EXCLUDED.min_providers, min_pincodes = EXCLUDED.min_pincodes,
  tiers_expected = EXCLUDED.tiers_expected;

CREATE TABLE IF NOT EXISTS atlas.readiness_weights (
  subscore text PRIMARY KEY,
  weight   int  NOT NULL CHECK (weight BETWEEN 0 AND 100),
  label    text NOT NULL
);

INSERT INTO atlas.readiness_weights (subscore, weight, label) VALUES
 ('coverage',    30, 'Coverage'),
 ('density',     25, 'Density'),
 ('integration', 20, 'Integration'),
 ('sla',         15, 'SLA'),
 ('price',       10, 'Price')
ON CONFLICT (subscore) DO UPDATE SET weight = EXCLUDED.weight, label = EXCLUDED.label;

-- Seed bands from demand. C1 = the cities carrying the top 60% of orders,
-- C2 = the next 30%, C3 = the tail. Cumulative share rather than a fixed count
-- so the split follows the business instead of a round number.
CREATE OR REPLACE FUNCTION atlas.seed_city_bands()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  INSERT INTO atlas.city_band (city_key, city, band, rationale, source)
  SELECT city_key, city,
         CASE WHEN cum <= 0.60 THEN 'C1' WHEN cum <= 0.90 THEN 'C2' ELSE 'C3' END,
         'orders ' || orders || ', cumulative share ' || ROUND(cum * 100) || '%',
         'demand'
  FROM (
    -- Grouped on the normalised key alone. Including the raw name here let
    -- 'Bangalore' and 'BANGALORE' become two rows with the same key, which
    -- ON CONFLICT then rejected outright.
    SELECT atlas.city_key(city) AS city_key,
           MIN(atlas.city_display(city)) AS city,
           SUM(orders_all_time)::bigint AS orders,
           SUM(SUM(orders_all_time)) OVER (ORDER BY SUM(orders_all_time) DESC)::numeric
             / NULLIF(SUM(SUM(orders_all_time)) OVER (), 0) AS cum
    FROM analytics.mv_city_rollup
    WHERE NULLIF(TRIM(city), '') IS NOT NULL
    GROUP BY 1
  ) x
  ON CONFLICT (city_key) DO UPDATE SET
    -- city included: without it the display name is frozen at whatever was
    -- first inserted, so adding a spelling alias later fixes the grouping but
    -- leaves the old label on screen.
    city = EXCLUDED.city,
    band = EXCLUDED.band, rationale = EXCLUDED.rationale, updated_at = now()
  -- A human decision about which band a city belongs in outranks the data.
  WHERE atlas.city_band.source <> 'human';

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END$$;

-- ---------------------------------------------------------------------------
-- The score.
--
-- Five subscores, each 0-1, combined with the weights above. The important
-- design decision is what happens when a subscore has no data: it returns NULL
-- and its weight is redistributed across the subscores that do, rather than
-- scoring zero.
--
-- Scoring zero would be wrong and badly so. Integration data barely exists yet
-- (92 labs at F1, 78 at F3, everything else awaiting the network team), so a
-- zero would drag every city down for a data-collection reason and make the
-- whole score read as "we are not ready anywhere" — which is a statement about
-- our records, not our network. Redistribution says "of what we can measure,
-- here is how ready this city is", which is the honest claim.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_city_readiness CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_city_readiness AS
WITH supply AS (
  SELECT kind, city, pincode, active FROM analytics.mv_provider_unified
  UNION ALL
  SELECT kind, city, pincode, active FROM atlas.wellness_provider
),
categorised AS (
  SELECT atlas.city_key(s.city) AS city_key,
         CASE
           WHEN s.kind IN ('LAB','HOSPITAL','PHLEBO') THEN 'DIAGNOSTICS'
           WHEN s.kind = 'DOCTOR'                     THEN 'CONSULTS'
           WHEN s.kind = 'NURSE'                      THEN 'HOME_CARE'
           WHEN s.kind = 'PHARMACY'                   THEN 'PHARMACY'
           WHEN s.kind IN ('GYM','STUDIO','PHYSIO')   THEN 'WELLNESS_OFFLINE'
           WHEN s.kind = 'INSTRUCTOR'                 THEN 'WELLNESS_ONLINE'
         END AS category,
         s.pincode, s.active, s.kind
  FROM supply s
  WHERE NULLIF(TRIM(s.city), '') IS NOT NULL
),
-- Read from src_local, not src.
--
-- src."Lab" is a foreign table on a hot standby. The tier and integration
-- subscores began as correlated subqueries joining it once per city — ~1,200
-- remote scans in one statement, which the standby killed with "conflict with
-- recovery" partway through every refresh. Collapsing that to a single scan
-- helped but still touched the standby, and still failed on production.
--
-- src_local."Lab" is the nightly snapshot the refresh already maintains for
-- exactly this reason, and it is what mv_catalogue_demand reads too. A day-old
-- lab list is fine for a readiness score, and it cannot be cancelled mid-flight
-- by replication.
lab_city AS (
  SELECT l.id AS lab_id, atlas.city_key(l.city) AS city_key
  FROM src_local."Lab" l
  WHERE NULLIF(TRIM(l.city), '') IS NOT NULL
),
tier_by_city AS (
  SELECT lc.city_key, COUNT(DISTINCT pt.tier)::int AS tiers_present
  FROM lab_city lc
  JOIN atlas.provider_tier pt ON pt.lab_id = lc.lab_id
  WHERE pt.tier <> 'Unknown'
  GROUP BY lc.city_key
),
integration_by_city AS (
  SELECT lc.city_key,
         NULLIF(COUNT(*) FILTER (WHERE pi.f_level >= 3), 0)::numeric
           / NULLIF(COUNT(*), 0) AS ratio
  FROM lab_city lc
  JOIN atlas.provider_integration pi ON pi.lab_id = lc.lab_id
  GROUP BY lc.city_key
),
city_pincodes AS (
  SELECT atlas.city_key(city) AS city_key,
         COUNT(DISTINCT pincode)::int AS total_pincodes
  FROM analytics.mv_pincode_city
  WHERE NULLIF(TRIM(city), '') IS NOT NULL
  GROUP BY 1
),
per_cat AS (
  SELECT c.city_key, c.category,
         COUNT(*)::int                                              AS providers,
         COUNT(DISTINCT c.pincode) FILTER (WHERE c.pincode IS NOT NULL)::int AS pincodes_covered,
         -- Tier spread: how many distinct experience tiers a buyer can choose
         -- between here. Only diagnostics carries tiers today.
         -- Tier, integration and SLA all come from lab data, so they are only
         -- meaningful for DIAGNOSTICS. Applied to CONSULTS or HOME_CARE they
         -- would silently borrow the diagnostics network's maturity and score
         -- a city as consult-ready on the strength of its labs. NULL instead,
         -- and the weight redistributes to what is actually measured.
         CASE WHEN c.category = 'DIAGNOSTICS'
              THEN (SELECT t.tiers_present FROM tier_by_city t WHERE t.city_key = c.city_key)
         END                                                        AS tiers_present,
         -- Integration: share of this city's labs wired in at F3 or better.
         -- NULL when nothing is recorded, so the weight redistributes.
         CASE WHEN c.category = 'DIAGNOSTICS'
              THEN (SELECT i.ratio FROM integration_by_city i WHERE i.city_key = c.city_key)
         END                                                        AS integration_ratio,
         -- SLA: delivered-vs-target across this city's labs.
         CASE WHEN c.category = 'DIAGNOSTICS' THEN
           (SELECT AVG(LEAST(q.delivered_pct / NULLIF(t.target, 0), 1))
            FROM analytics.mv_lab_quality_v2 q
            CROSS JOIN atlas.sla_targets t
            WHERE t.kind = 'LAB' AND t.metric = 'delivered_pct'
              AND atlas.city_key(q.city) = c.city_key
              AND q.orders_total > 0)
         END                                                        AS sla_ratio
  FROM categorised c
  WHERE c.category IS NOT NULL
  GROUP BY c.city_key, c.category
),
scored AS (
  SELECT b.city, b.city_key, b.band, p.category,
         p.providers, p.pincodes_covered, cp.total_pincodes,
         p.tiers_present, n.min_providers, n.min_pincodes, n.tiers_expected,
         -- Guarded, not LEAST(...) alone: LEAST ignores NULLs in Postgres, so
         -- LEAST(NULL, 1) is 1. Without the guard a category with no data
         -- scored a perfect 1.000 — the exact opposite of the truth, and
         -- silently, since the subscore then also counted as "present".
         CASE WHEN cp.total_pincodes IS NULL OR cp.total_pincodes = 0 THEN NULL
              ELSE LEAST(p.pincodes_covered::numeric / cp.total_pincodes, 1) END AS coverage_score,
         CASE WHEN n.min_providers IS NULL OR n.min_providers = 0 THEN NULL
              ELSE LEAST(p.providers::numeric / n.min_providers, 1) END          AS density_score,
         p.integration_ratio                                                  AS integration_score,
         p.sla_ratio                                                          AS sla_score,
         -- "Price" in the PRD's weighting is really choice: can a buyer pick a
         -- price point here at all. Measured as tier spread against the norm.
         CASE WHEN p.tiers_present IS NULL OR n.tiers_expected IS NULL OR n.tiers_expected = 0
              THEN NULL
              ELSE LEAST(p.tiers_present::numeric / n.tiers_expected, 1) END      AS price_score
  FROM per_cat p
  JOIN atlas.city_band b   ON b.city_key = p.city_key
  JOIN atlas.density_norms n ON n.band = b.band AND n.category = p.category
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
SELECT city, city_key, band, category,
       providers, pincodes_covered, total_pincodes,
       tiers_present, min_providers, min_pincodes, tiers_expected,
       ROUND(coverage_score, 3)    AS coverage_score,
       ROUND(density_score, 3)     AS density_score,
       ROUND(integration_score, 3) AS integration_score,
       ROUND(sla_score, 3)         AS sla_score,
       ROUND(price_score, 3)       AS price_score,
       -- Weight redistribution: divide by the weight actually applied, not the
       -- full 100, so a missing subscore neither helps nor hurts.
       ROUND(100 * (
           COALESCE(coverage_score, 0)    * w_cov
         + COALESCE(density_score, 0)     * w_den
         + COALESCE(integration_score, 0) * w_int
         + COALESCE(sla_score, 0)         * w_sla
         + COALESCE(price_score, 0)       * w_pri
       ) / NULLIF(
           (CASE WHEN coverage_score    IS NULL THEN 0 ELSE w_cov END)
         + (CASE WHEN density_score     IS NULL THEN 0 ELSE w_den END)
         + (CASE WHEN integration_score IS NULL THEN 0 ELSE w_int END)
         + (CASE WHEN sla_score         IS NULL THEN 0 ELSE w_sla END)
         + (CASE WHEN price_score       IS NULL THEN 0 ELSE w_pri END), 0)
       )::int                      AS score,
       -- Which subscores actually contributed, so the UI can say "scored on 3
       -- of 5" rather than implying the number is complete.
       (CASE WHEN coverage_score    IS NULL THEN 0 ELSE 1 END)
     + (CASE WHEN density_score     IS NULL THEN 0 ELSE 1 END)
     + (CASE WHEN integration_score IS NULL THEN 0 ELSE 1 END)
     + (CASE WHEN sla_score         IS NULL THEN 0 ELSE 1 END)
     + (CASE WHEN price_score       IS NULL THEN 0 ELSE 1 END) AS subscores_present
FROM weighted;

CREATE UNIQUE INDEX IF NOT EXISTS mv_city_readiness_key
  ON analytics.mv_city_readiness (city_key, category);
