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

-- Package economics, built bottom-up from composition.
--
-- Packages carry almost no MRP of their own — 15 of 4,870 lab-package rows —
-- but every test in mv_test_catalog carries both MRP and lab cost, and
-- composition is structural via "_MasterToPackage". So the sellable value of a
-- package is computable even though it isn't stored: what its tests would list
-- at individually, against what the labs charge us for them.
--
-- A view, not a materialized view: it is 270 rows over MVs that the nightly
-- refresh already rebuilds, so materializing it would only add a way for it to
-- go stale.
CREATE OR REPLACE VIEW analytics.v_package_economics AS
WITH comp AS (
  SELECT mp."B" AS package_id, mp."A" AS master_id
  FROM src."_MasterToPackage" mp
),
built AS (
  SELECT
    c.package_id,
    COUNT(*)::int                                   AS test_count,
    COUNT(tc.master_id)::int                        AS tests_priced,
    SUM(tc.mrp_min)::numeric                        AS alacarte_low,
    SUM(tc.mrp_max)::numeric                        AS alacarte_high,
    SUM(tc.b2b_min)::numeric                        AS cost_low,
    SUM(tc.b2b_max)::numeric                        AS cost_high
  FROM comp c
  LEFT JOIN analytics.mv_test_catalog tc ON tc.master_id = c.master_id
  GROUP BY c.package_id
),
reach AS (
  SELECT package_id,
         COUNT(DISTINCT lab_id)::int AS labs_offering,
         MIN(b2b)::numeric           AS lab_quote_low,
         MAX(b2b)::numeric           AS lab_quote_high
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
  b.cost_low,
  b.cost_high,
  -- Headroom between what the tests list at individually and what they cost
  -- us. Not a quoted margin — the basis for setting one.
  CASE WHEN b.alacarte_low > 0
       THEN ROUND(100.0 * (b.alacarte_low - b.cost_low) / b.alacarte_low)
  END                                         AS headroom_pct,
  COALESCE(r.labs_offering, 0)                AS labs_offering,
  r.lab_quote_low,
  r.lab_quote_high
FROM src."Package" p
LEFT JOIN built b ON b.package_id = p.id
LEFT JOIN reach r ON r.package_id = p.id
WHERE p.active;
