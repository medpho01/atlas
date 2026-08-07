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

-- What people actually take.
--
-- Package demand comes from "_OrderToPackage", the Prisma join between Order
-- and Package. An earlier version reconstructed this by unnesting 2.5M result
-- rows out of Order.standardizedValues, because the foreign key wasn't in the
-- imported table set and so appeared not to exist. That undercounted badly —
-- 20 packages with demand instead of 135, and PL - Baseline Health at 7,543
-- orders instead of 15,884 — because only orders carrying structured results
-- contributed. The join table carries every order.
--
-- Test-level demand still comes from standardizedValues: there is no
-- order-to-test foreign key, and the result payload is the only record of
-- which individual tests an order actually covered.
--
-- Order is read from src_local (the source is a hot standby, and a long scan
-- over the FDW gets killed by recovery conflicts). The join tables themselves
-- are small enough to read live.
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_catalogue_demand AS
WITH pkg AS (
  SELECT op."B" AS package_id, o.id AS order_id, o."userId", o."createdAt"
  FROM src."_OrderToPackage" op
  JOIN src_local."Order" o ON o.id = op."A"
),
tv AS (
  SELECT o.id AS order_id, o."userId", o."createdAt",
         jsonb_array_elements(o."standardizedValues" -> 'testValues') AS t
  FROM src_local."Order" o
  WHERE jsonb_typeof(o."standardizedValues" -> 'testValues') = 'array'
),
test_rows AS (
  SELECT DISTINCT order_id, "userId", "createdAt", t ->> 'testId' AS ls_id FROM tv
)
SELECT
  'PACKAGE'::text                                  AS kind,
  package_id                                       AS entity_id,
  COUNT(DISTINCT order_id)::int                    AS orders,
  COUNT(DISTINCT "userId")::int                    AS patients,
  MAX("createdAt")::date                           AS last_ordered,
  COUNT(DISTINCT order_id) FILTER (
    WHERE "createdAt" >= now() - INTERVAL '90 days')::int AS orders_l90d
FROM pkg
GROUP BY package_id
UNION ALL
SELECT
  'TEST'::text, m.id,
  COUNT(DISTINCT r.order_id)::int,
  COUNT(DISTINCT r."userId")::int,
  MAX(r."createdAt")::date,
  COUNT(DISTINCT r.order_id) FILTER (
    WHERE r."createdAt" >= now() - INTERVAL '90 days')::int
FROM test_rows r JOIN src."Master" m ON m."lsId" = r.ls_id
GROUP BY m.id;

CREATE UNIQUE INDEX IF NOT EXISTS mv_catalogue_demand_key
  ON analytics.mv_catalogue_demand (kind, entity_id);

-- Which packages an account can actually sell.
--
-- "PackagesOnStore" is the mapping — what has been assigned to that account,
-- with the account's own price for it. This is a different and larger set than
-- what the account has ordered — Plum has dozens mapped against the 7 that
-- order-derived demand used to show.
-- The catalogue filter wants the mapping, because the question behind it is
-- "what does this client have access to", not "what have they used so far".
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_package_store AS
SELECT
  ps."packageId"          AS package_id,
  ps."storeId"            AS store_id,
  ps."storePackageName"   AS store_package_name,
  ps."storePrice"::numeric AS store_price,
  ps."storeMrp"::numeric   AS store_mrp,
  COALESCE(d.orders, 0)   AS orders
FROM src."PackagesOnStore" ps
LEFT JOIN (
  SELECT op."B" AS package_id, o."storeId" AS store_id, COUNT(DISTINCT o.id)::int AS orders
  FROM src."_OrderToPackage" op
  JOIN src_local."Order" o ON o.id = op."A"
  WHERE o."storeId" IS NOT NULL
  GROUP BY op."B", o."storeId"
) d ON d.package_id = ps."packageId" AND d.store_id = ps."storeId";

CREATE UNIQUE INDEX IF NOT EXISTS mv_package_store_key
  ON analytics.mv_package_store (package_id, store_id);

-- Package facts.
--
-- Everything here is a property of the package or of one named lab. There are
-- no cross-lab totals: a package is bought from a single lab, so a figure
-- assembled from several is not a price anyone can pay.

-- ---------------------------------------------------------------------------
-- Sample types, in language someone collecting the sample would use.
--
-- The source has 114 distinct values, most of them one-offs ("CENTRAL VENOUS
-- CATHEIER TIP SWAB"). Shown raw they are noise; the question the catalogue is
-- being asked is "what do we need from the patient", and the answer is a
-- handful of buckets. The raw value stays available on the test itself.
--
-- Some rows carry two ("BLOOD, RANDOM URINE"), so the entry point splits on
-- comma first — otherwise a blood-and-urine test reads as urine only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.sample_bucket(raw text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE
    WHEN raw IS NULL THEN NULL
    WHEN raw ILIKE '%URINE%'                             THEN 'Urine'
    WHEN raw ILIKE '%BLOOD%' OR raw ILIKE '%SERUM%'
      OR raw ILIKE '%PLASMA%'                            THEN 'Blood'
    WHEN raw ILIKE '%STOOL%'                             THEN 'Stool'
    WHEN raw ILIKE '%SPUTUM%'                            THEN 'Sputum'
    WHEN raw ILIKE '%SEMEN%'                             THEN 'Semen'
    WHEN raw ILIKE '%SWAB%'  OR raw ILIKE '%SMEAR%'      THEN 'Swab'
    WHEN raw ILIKE '%BIOPSY%' OR raw ILIKE '%TISSUE%'
      OR raw ILIKE '%BONE%'   OR raw ILIKE '%FNAC%'
      OR raw ILIKE '%ASPIRAT%'                           THEN 'Tissue'
    WHEN raw ILIKE '%FLUID%' OR raw = 'CSF'
      OR raw ILIKE '%LAVAGE%' OR raw ILIKE '%WASHING%'
      OR raw ILIKE '%SECRETION%' OR raw ILIKE '%DISCHARGE%'
      OR raw ILIKE '%BILE%'  OR raw ILIKE '%PUS%'        THEN 'Fluid'
    WHEN raw ILIKE '%SKIN%' OR raw ILIKE '%NAIL%'
      OR raw ILIKE '%HAIR%'                              THEN 'Skin, nail or hair'
    ELSE 'Other'
  END
$fn$;

CREATE OR REPLACE FUNCTION atlas.sample_buckets(raw text) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE WHEN raw IS NULL THEN NULL ELSE
    ARRAY(SELECT DISTINCT atlas.sample_bucket(btrim(part))
          FROM unnest(string_to_array(raw, ',')) AS part
          WHERE btrim(part) <> '')
  END
$fn$;

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_package_store_demand CASCADE;
DROP VIEW IF EXISTS analytics.v_package_economics;
CREATE VIEW analytics.v_package_economics AS
WITH comp AS (
  SELECT mp."B" AS package_id, mp."A" AS master_id
  FROM src."_MasterToPackage" mp
),
built AS (
  SELECT c.package_id,
         COUNT(*)::int                            AS test_count,
         COUNT(DISTINCT m."labDepartment_id")::int AS department_count,
         COUNT(DISTINCT m."sampleType_id")::int    AS sample_type_count
  FROM comp c LEFT JOIN src."Master" m ON m.id = c.master_id
  GROUP BY c.package_id
),
-- The cheapest lab that quotes this package, and its price. Quotes at or below
-- Rs.10 are placeholders rather than prices and are ignored.
best_quote AS (
  SELECT DISTINCT ON (lp.package_id)
    lp.package_id, lp.lab_id AS best_lab_id, lp.b2b::numeric AS pkg_cost
  FROM analytics.mv_lab_packages lp
  WHERE lp.b2b > 10
  ORDER BY lp.package_id, lp.b2b
),
reach AS (
  SELECT package_id, COUNT(*) FILTER (WHERE b2b > 10)::int AS labs_quoting
  FROM analytics.mv_lab_packages GROUP BY package_id
),
-- What has to be collected for this package: the distinct buckets across its
-- tests, blood first because that is what a phlebotomist plans around.
pkg_sample AS (
  SELECT c.package_id, s.b
  FROM comp c
  JOIN src."Master" m      ON m.id = c.master_id
  JOIN src."SampleType" st ON st.id = m."sampleType_id"
  CROSS JOIN LATERAL unnest(atlas.sample_buckets(st."sampleType")) AS s(b)
  GROUP BY 1, 2
),
samples AS (
  SELECT package_id,
         array_agg(b ORDER BY CASE b WHEN 'Blood' THEN 1 WHEN 'Urine' THEN 2 ELSE 3 END, b) AS sample_types
  FROM pkg_sample GROUP BY package_id
),
-- Counted, not hidden: 29% of tests carry no sample type at source, so a
-- package's list can be incomplete and the screen should be able to say so.
untyped AS (
  SELECT c.package_id, COUNT(*) FILTER (WHERE m."sampleType_id" IS NULL)::int AS tests_without_sample
  FROM comp c LEFT JOIN src."Master" m ON m.id = c.master_id
  GROUP BY 1
)
SELECT
  p.id                                        AS package_id,
  p."packageName"                             AS package_name,
  p."isCustom"                                AS is_custom,
  p.description,
  p."orderTypes"::text[]                      AS order_types,
  p."defaultTat"                              AS tat_hours,
  COALESCE(b.test_count, 0)                   AS test_count,
  COALESCE(b.department_count, 0)             AS department_count,
  COALESCE(b.sample_type_count, 0)            AS sample_type_count,
  COALESCE(sm.sample_types, '{}')             AS sample_types,
  COALESCE(ut.tests_without_sample, 0)        AS tests_without_sample,
  q.pkg_cost,
  l."labName"                                 AS best_lab_name,
  l.city                                      AS best_lab_city,
  COALESCE(r.labs_quoting, 0)                 AS labs_quoting,
  COALESCE(d.orders, 0)                       AS orders,
  COALESCE(d.patients, 0)                     AS patients,
  COALESCE(d.orders_l90d, 0)                  AS orders_l90d,
  d.last_ordered
FROM src."Package" p
LEFT JOIN built      b ON b.package_id = p.id
LEFT JOIN best_quote q ON q.package_id = p.id
LEFT JOIN src."Lab"  l ON l.id = q.best_lab_id
LEFT JOIN reach      r ON r.package_id = p.id
LEFT JOIN samples    sm ON sm.package_id = p.id
LEFT JOIN untyped    ut ON ut.package_id = p.id
LEFT JOIN analytics.mv_catalogue_demand d
       ON d.kind = 'PACKAGE' AND d.entity_id = p.id
WHERE p.active;

-- ---------------------------------------------------------------------------
-- City tier.
--
-- City, state and pincode all exist on Lab and need no inference — every lab
-- that quotes a package carries all three. Tier does not exist anywhere at
-- source, and it is the axis network planning actually uses: a price in a
-- metro and the same price in a tier-3 town mean different things.
--
-- Classified once per city by scripts/enrich-city-tiers.ts and cached here,
-- rather than inferred per export. 419 cities appear across the quoting labs,
-- so this is one small job, not a per-row cost.
--
-- Keyed on the city name alone, punctuation and case stripped. City+state
-- would be more precise but the state column is not usable: Chennai appears as
-- both 'Tamil  Nadu' and 'TamilNadu', and every Orange Health and Thyrocare lab
-- carries '-'. Keying on the pair split single cities into several rows.
--
-- The cost is that same-named cities in different states collapse into one row
-- (Aurangabad in Maharashtra is Tier 2, in Bihar Tier 3). The states a city
-- appears with are passed to the classifier as context, and such a row can be
-- corrected by hand. Rows with source='human' are never overwritten.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.city_tier (
  city_key    text PRIMARY KEY,          -- regexp_replace(lower(trim(city)), '[^a-z0-9]', '', 'g')
  city        text NOT NULL,
  states      text,          -- every spelling seen at source, for context
  tier        text NOT NULL CHECK (tier IN ('Tier 1', 'Tier 2', 'Tier 3', 'Unknown')),
  rationale   text,
  confidence  numeric(3,2),
  source      text NOT NULL DEFAULT 'llm' CHECK (source IN ('llm', 'human')),
  model       text,
  prompt_version int,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
