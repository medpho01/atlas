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
-- Order carries no package or test foreign key, but standardizedValues.testValues
-- does: every result row holds a testId matching Master.lsId and, for packaged
-- orders, a packageId matching Package.id. That is 2.5M result rows across
-- 29,662 orders, so it is materialized rather than unnested per request.
--
-- This is deliberately the only demand signal here. Rolled-up money figures --
-- à-la-carte totals, blended lab costs, the headroom between them -- were
-- removed: prices are per-lab and don't add up across labs, so summing them
-- produced numbers nobody could act on. Adoption is a fact about the package.
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_catalogue_demand AS
WITH tv AS (
  SELECT o.id AS order_id, o."userId", o."createdAt",
         jsonb_array_elements(o."standardizedValues" -> 'testValues') AS t
  FROM src."Order" o
  WHERE jsonb_typeof(o."standardizedValues" -> 'testValues') = 'array'
),
rows AS (
  SELECT DISTINCT
    order_id, "userId", "createdAt",
    t ->> 'testId'  AS ls_id,
    CASE WHEN t ->> 'packageId' ~ '^[0-9]+$' THEN (t ->> 'packageId')::int END AS package_id
  FROM tv
)
SELECT
  'PACKAGE'::text                                  AS kind,
  package_id                                       AS entity_id,
  COUNT(DISTINCT order_id)::int                    AS orders,
  COUNT(DISTINCT "userId")::int                    AS patients,
  MAX("createdAt")::date                           AS last_ordered,
  COUNT(DISTINCT order_id) FILTER (
    WHERE "createdAt" >= now() - INTERVAL '90 days')::int AS orders_l90d
FROM rows WHERE package_id IS NOT NULL
GROUP BY package_id
UNION ALL
SELECT
  'TEST'::text,
  m.id,
  COUNT(DISTINCT r.order_id)::int,
  COUNT(DISTINCT r."userId")::int,
  MAX(r."createdAt")::date,
  COUNT(DISTINCT r.order_id) FILTER (
    WHERE r."createdAt" >= now() - INTERVAL '90 days')::int
FROM rows r JOIN src."Master" m ON m."lsId" = r.ls_id
GROUP BY m.id;

CREATE UNIQUE INDEX IF NOT EXISTS mv_catalogue_demand_key
  ON analytics.mv_catalogue_demand (kind, entity_id);

-- Package facts.
--
-- Everything here is a property of the package or of one named lab. There are
-- no cross-lab totals: a package is bought from a single lab, so a figure
-- assembled from several is not a price anyone can pay.
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
LEFT JOIN analytics.mv_catalogue_demand d
       ON d.kind = 'PACKAGE' AND d.entity_id = p.id
WHERE p.active;

-- Which accounts order which packages.
--
-- Same source as mv_catalogue_demand — standardizedValues.testValues — but
-- carrying Order.storeId, so the catalogue can be narrowed to "what does this
-- account actually buy". Separate from the demand MV rather than a column on
-- it, because that one is keyed (kind, entity_id) and adding a store dimension
-- would change its grain.
--
-- Small by nature: only packaged orders with structured results contribute, so
-- this covers the accounts that buy catalogue packages rather than every store.
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_package_store_demand AS
WITH tv AS (
  SELECT o.id AS order_id, o."storeId" AS store_id, o."createdAt",
         jsonb_array_elements(o."standardizedValues" -> 'testValues') AS t
  FROM src."Order" o
  WHERE jsonb_typeof(o."standardizedValues" -> 'testValues') = 'array'
    AND o."storeId" IS NOT NULL
),
rows AS (
  SELECT DISTINCT order_id, store_id, "createdAt",
         (t ->> 'packageId')::int AS package_id
  FROM tv
  WHERE t ->> 'packageId' ~ '^[0-9]+$'
)
SELECT package_id, store_id,
       COUNT(DISTINCT order_id)::int AS orders,
       MAX("createdAt")::date        AS last_ordered
FROM rows
GROUP BY package_id, store_id;

CREATE UNIQUE INDEX IF NOT EXISTS mv_package_store_demand_key
  ON analytics.mv_package_store_demand (package_id, store_id);
