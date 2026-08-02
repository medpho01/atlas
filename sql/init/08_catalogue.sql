-- Catalogue enrichment — Atlas-owned commercial layer over the LabStack catalogue.
--
-- LabStack classifies tests clinically (LabDepartment: Immunology, Biochemistry,
-- Genetics…) and for billing (testCategory: ROUTINE / NON_ROUTINE). Neither is
-- how an account conversation starts — nobody asks for "an Immunology package",
-- they ask what we have for nutrition, or diabetes, or gut health.
--
-- That commercial axis doesn't exist at source and won't unless someone creates
-- it, so Atlas owns it here. Rows are written by scripts/enrich-catalogue.ts and
-- can be corrected by hand; a corrected row is never overwritten by a re-run.
--
-- Nothing in this file writes to LabStack.

CREATE SCHEMA IF NOT EXISTS atlas;

-- The taxonomy itself, so it can be reordered or relabelled without a deploy.
CREATE TABLE IF NOT EXISTS atlas.catalogue_category (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  blurb       text,
  sort_order  int  NOT NULL DEFAULT 100
);

INSERT INTO atlas.catalogue_category (key, label, blurb, sort_order) VALUES
  ('ANNUAL_HEALTH_CHECK', 'Annual health check', 'Broad screening panels sold as a yearly check-up.',            10),
  ('NUTRITION',           'Nutrition',           'Vitamins, minerals, trace elements and deficiency markers.',   20),
  ('DIABETES_METABOLIC',  'Diabetes & metabolic','Glucose, HbA1c, insulin resistance, metabolic syndrome.',      30),
  ('CARDIAC',             'Heart',               'Lipids, cardiac markers and cardiovascular risk.',             40),
  ('THYROID_HORMONE',     'Thyroid & hormones',  'Thyroid function and the wider endocrine panel.',              50),
  ('WOMENS_HEALTH',       'Women’s health',      'Female-specific screening, pregnancy and menopause.',          60),
  ('MENS_HEALTH',         'Men’s health',        'Male-specific screening including prostate and testosterone.', 70),
  ('FERTILITY',           'Fertility',           'Conception, reproductive hormones and semen analysis.',        80),
  ('GUT_HEALTH',          'Gut health',          'Digestive function, coeliac, stool studies and microbiome.',   90),
  ('GENETICS',            'Genetics',            'Genetic, genomic and molecular-pathology testing.',           100),
  ('CANCER_SCREENING',    'Cancer screening',    'Tumour markers, cytology and cancer-risk panels.',            110),
  ('INFECTION',           'Infection',           'Bacterial, viral, fungal and parasitic testing.',             120),
  ('LIVER_KIDNEY',        'Liver & kidney',      'Hepatic and renal function.',                                 130),
  ('BONE_JOINT',          'Bone & joint',        'Bone density markers, arthritis and rheumatology.',           140),
  ('ALLERGY_IMMUNITY',    'Allergy & immunity',  'Allergen panels, autoimmunity and immune status.',            150),
  ('PEDIATRIC',           'Children',            'Tests specific to infants and children.',                     160),
  ('SENIOR',              'Senior',              'Screening aimed at older adults.',                            170),
  ('PRE_SURGICAL',        'Pre-surgical',        'Pre-operative and pre-admission workups.',                    180),
  ('SPORTS_FITNESS',      'Sports & fitness',    'Athlete performance, recovery and body-composition markers.', 190),
  ('SKIN_HAIR',           'Skin & hair',         'Dermatology, hair-loss and cosmetic-adjacent testing.',       200)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, blurb = EXCLUDED.blurb, sort_order = EXCLUDED.sort_order;

-- One row per Master test.
--
-- input_hash is what the classifier last saw. A re-run skips a row whose hash
-- is unchanged, so a second pass over 12k tests costs nothing and only newly
-- added or edited tests are reclassified.
CREATE TABLE IF NOT EXISTS atlas.test_enrichment (
  master_id       int PRIMARY KEY,
  categories      text[] NOT NULL DEFAULT '{}',
  consumer_name   text,          -- what to call it in front of a client
  why_it_matters  text,          -- one line a non-clinician can use
  confidence      numeric(3,2),
  source          text NOT NULL DEFAULT 'llm' CHECK (source IN ('llm', 'human')),
  model           text,
  prompt_version  int,
  input_hash      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS test_enrichment_categories_idx
  ON atlas.test_enrichment USING GIN (categories);

-- One row per Package. Composition comes from src."_MasterToPackage"; this
-- table carries only the commercial read on top of it.
CREATE TABLE IF NOT EXISTS atlas.package_enrichment (
  package_id      int PRIMARY KEY,
  categories      text[] NOT NULL DEFAULT '{}',
  intent          text,          -- who it is for, in one line
  positioning     text,          -- how to pitch it
  confidence      numeric(3,2),
  source          text NOT NULL DEFAULT 'llm' CHECK (source IN ('llm', 'human')),
  model           text,
  prompt_version  int,
  input_hash      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS package_enrichment_categories_idx
  ON atlas.package_enrichment USING GIN (categories);

-- Every classification write, kept so a bad prompt revision can be audited or
-- rolled back without re-running the whole catalogue.
CREATE TABLE IF NOT EXISTS atlas.enrichment_run (
  id             bigserial PRIMARY KEY,
  stage          text NOT NULL,           -- 'tests' | 'packages'
  model          text NOT NULL,
  prompt_version int  NOT NULL,
  considered     int  NOT NULL,
  classified     int  NOT NULL,
  skipped        int  NOT NULL,
  failed         int  NOT NULL,
  input_tokens   bigint,
  output_tokens  bigint,
  cached_tokens  bigint,
  started_at     timestamptz NOT NULL,
  finished_at    timestamptz NOT NULL DEFAULT now(),
  note           text
);

-- Package economics.
--
-- A package is bought from ONE lab. That single fact decides everything here.
--
-- An earlier version of this view summed the cheapest rate per constituent
-- test across the whole network. That number is not purchasable: on a real
-- package the per-test minima came from 24 different labs, and it understated
-- true cost by 21%-371%, which in turn inflated headroom from ~30% to ~72%.
-- Anyone quoting off it would have given away margin they did not have.
--
-- So cost is the lab's own quoted price for the package as a unit
-- (mv_lab_packages.b2b), taken at the cheapest lab that quotes it. That is
-- what buying the package actually costs. It also happens to be the only
-- workable answer for the large panels — no single lab carries rates for all
-- 69 tests in ZOCO Nutritionists Choice, yet labs quote the package happily.
--
-- Quotes at or below Rs.10 are placeholders, not prices (11 of 265 packages),
-- and are excluded rather than shown as a bargain.
--
-- alacarte_low stays, but only as the SELLING reference: what a client would
-- pay buying the same tests individually at list. Headroom is that list value
-- less what the package costs us — the room available to discount.
-- Dropped rather than replaced: the column set changed, and CREATE OR REPLACE
-- cannot rename a view column.
DROP VIEW IF EXISTS analytics.v_package_economics;
CREATE VIEW analytics.v_package_economics AS
WITH comp AS (
  SELECT mp."B" AS package_id, mp."A" AS master_id
  FROM src."_MasterToPackage" mp
),
built AS (
  SELECT
    c.package_id,
    COUNT(*)::int            AS test_count,
    COUNT(tc.master_id)::int AS tests_priced,
    SUM(tc.mrp_min)::numeric AS alacarte_low,
    SUM(tc.mrp_max)::numeric AS alacarte_high
  FROM comp c
  LEFT JOIN analytics.mv_test_catalog tc ON tc.master_id = c.master_id
  GROUP BY c.package_id
),
-- The cheapest lab that actually quotes this package, and its price.
best_quote AS (
  SELECT DISTINCT ON (lp.package_id)
    lp.package_id, lp.lab_id AS best_lab_id, lp.b2b::numeric AS pkg_cost
  FROM analytics.mv_lab_packages lp
  WHERE lp.b2b > 10
  ORDER BY lp.package_id, lp.b2b
),
reach AS (
  SELECT package_id,
         COUNT(*)::int                              AS labs_quoting,
         COUNT(*) FILTER (WHERE b2b > 10)::int      AS labs_quoting_credibly
  FROM analytics.mv_lab_packages
  GROUP BY package_id
)
SELECT
  p.id                                        AS package_id,
  p."packageName"                             AS package_name,
  p."isCustom"                                AS is_custom,
  p.description,
  p."orderTypes"::text[]                      AS order_types,
  p."defaultTat"                              AS tat_hours,
  COALESCE(b.test_count, 0)                   AS test_count,
  COALESCE(b.tests_priced, 0)                 AS tests_priced,
  b.alacarte_low,
  b.alacarte_high,
  -- What the package costs, at one lab.
  q.pkg_cost,
  q.best_lab_id,
  l."labName"                                 AS best_lab_name,
  l.city                                      AS best_lab_city,
  -- Room between the list value of the tests and what the package costs us.
  CASE WHEN b.alacarte_low > 0 AND q.pkg_cost IS NOT NULL
       THEN ROUND(100.0 * (b.alacarte_low - q.pkg_cost) / b.alacarte_low)
  END                                         AS headroom_pct,
  COALESCE(r.labs_quoting, 0)                 AS labs_quoting,
  COALESCE(r.labs_quoting_credibly, 0)        AS labs_quoting_credibly
FROM src."Package" p
LEFT JOIN built      b ON b.package_id = p.id
LEFT JOIN best_quote q ON q.package_id = p.id
LEFT JOIN src."Lab"  l ON l.id = q.best_lab_id
LEFT JOIN reach      r ON r.package_id = p.id
WHERE p.active;
