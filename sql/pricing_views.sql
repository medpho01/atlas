-- ============================================================================
-- Pricing intelligence MVs — power the /pricing page.
--
--   analytics.mv_test_rates    one row per (test × lab) with MRP + B2B.
--                              Source: src_local."DOS" (price = customer rate,
--                              labCost = B2B rate LabStack pays the lab).
--   analytics.mv_test_catalog  one row per test with lab counts + rate ranges.
--                              This is what the search box queries.
--
-- Search accuracy comes from Master.name + Master.aliases[] — the same
-- canonical catalog LabStack ops quote from.
-- ============================================================================

-- Schema-drift guard: some LabStack environments carry Master.aliases
-- (denormalized alias array), others don't (aliases live in the MasterAlias
-- table instead). Ensure the snapshot always has the column so the MVs build
-- everywhere; where the source lacks it, alias search simply matches nothing
-- and name search carries the load.
ALTER TABLE src_local."Master"
  ADD COLUMN IF NOT EXISTS aliases text[] DEFAULT ARRAY[]::text[];

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_test_rates CASCADE;

CREATE MATERIALIZED VIEW analytics.mv_test_rates AS
-- DISTINCT ON: source DOS occasionally carries multiple active rows for the
-- same (test, lab) — keep the most recently updated one.
SELECT DISTINCT ON (d.master_id, d.lab_id)
  d.master_id,
  m.name                        AS test_name,
  m."lsId"                      AS ls_id,
  m."testCategory"::text        AS category,
  m.aliases,
  m."isTestProfile"             AS is_profile,
  d.lab_id,
  l."labName"                   AS lab_name,
  l.city                        AS lab_city,
  l.state                       AS lab_state,
  d."dosID"                     AS lab_code,
  d.price                       AS mrp,
  d."labCost"                   AS b2b,
  d."turnAroundTime"            AS tat_hours,
  COALESCE(d."nablCertified", false) AS nabl,
  COALESCE(d."inHouse", false)  AS in_house
FROM src_local."DOS" d
JOIN src_local."Master" m ON m.id = d.master_id
JOIN src_local."Lab"    l ON l.id = d.lab_id
WHERE COALESCE(d.active, false) = true
  AND d.price IS NOT NULL
  AND COALESCE(l.active, true) = true
ORDER BY d.master_id, d.lab_id, d."updatedAt" DESC;

CREATE INDEX idx_mv_test_rates_master ON analytics.mv_test_rates (master_id);
CREATE INDEX idx_mv_test_rates_lab    ON analytics.mv_test_rates (lab_id);
CREATE UNIQUE INDEX idx_mv_test_rates_key ON analytics.mv_test_rates (master_id, lab_id);

ANALYZE analytics.mv_test_rates;

-- ----------------------------------------------------------------------------
-- Test-level rollup for search + availability display.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_test_catalog CASCADE;

CREATE MATERIALIZED VIEW analytics.mv_test_catalog AS
SELECT
  master_id,
  test_name,
  ls_id,
  category,
  aliases,
  is_profile,
  COUNT(DISTINCT lab_id)::int   AS labs_count,
  MIN(mrp)                      AS mrp_min,
  MAX(mrp)                      AS mrp_max,
  MIN(b2b)                      AS b2b_min,
  MAX(b2b)                      AS b2b_max
FROM analytics.mv_test_rates
GROUP BY master_id, test_name, ls_id, category, aliases, is_profile;

CREATE UNIQUE INDEX idx_mv_test_catalog_id ON analytics.mv_test_catalog (master_id);
CREATE INDEX idx_mv_test_catalog_name ON analytics.mv_test_catalog (lower(test_name));

ANALYZE analytics.mv_test_catalog;

-- ----------------------------------------------------------------------------
-- Per-lab packages with composition — powers "nearby packages" suggestions:
-- packages at the selected lab whose component tests overlap the basket.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_lab_packages CASCADE;

CREATE MATERIALIZED VIEW analytics.mv_lab_packages AS
SELECT
  pol."labId"                                         AS lab_id,
  pol."packageId"                                     AS package_id,
  COALESCE(NULLIF(pol."labPackageName", ''), p."packageName") AS package_name,
  p."packageName"                                     AS canonical_name,
  pol."labMrp"                                        AS mrp,
  pol."labCost"::float8                               AS b2b,
  ARRAY(
    SELECT mp."A" FROM src_local."_MasterToPackage" mp
    WHERE mp."B" = p.id ORDER BY mp."A"
  )                                                   AS component_master_ids,
  (SELECT COUNT(*) FROM src_local."_MasterToPackage" mp WHERE mp."B" = p.id)::int
                                                      AS component_count
FROM src_local."PackagesOnLab" pol
JOIN src_local."Package" p ON p.id = pol."packageId"
WHERE COALESCE(p.active, false) = true;

CREATE INDEX idx_mv_lab_packages_lab ON analytics.mv_lab_packages (lab_id);
CREATE UNIQUE INDEX idx_mv_lab_packages_key ON analytics.mv_lab_packages (lab_id, package_id);

ANALYZE analytics.mv_lab_packages;

DO $$
DECLARE n_rates int; n_tests int; n_labs int; n_pkgs int;
BEGIN
  SELECT COUNT(*) INTO n_rates FROM analytics.mv_test_rates;
  SELECT COUNT(*) INTO n_tests FROM analytics.mv_test_catalog;
  SELECT COUNT(DISTINCT lab_id) INTO n_labs FROM analytics.mv_test_rates;
  SELECT COUNT(*) INTO n_pkgs FROM analytics.mv_lab_packages;
  RAISE NOTICE 'mv_test_rates: % rates · % tests · % labs · % lab-packages',
    n_rates, n_tests, n_labs, n_pkgs;
END $$;
