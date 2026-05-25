-- ============================================================================
-- Coverage Model — Provider Kind × Modality matrix
-- Provider kinds:    LAB (merges DIAGNOSTIC_CENTER + COLLECTION_CENTER), HOSPITAL, DOCTOR, PHLEBO, NURSE, PHARMACY
-- Modalities:        CENTER_VISIT, HOME_SAMPLE, HOME_VISIT, DELIVERY
-- Teleconsult excluded (pincode-independent per product decision).
-- Camp excluded as a coverage modality (it's an event lens).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. mv_provider_unified
--    One row per provider entity. Normalizes Lab/Provider/Pharmacy into a
--    single shape: (entity_id, kind, modalities[], pincode, lat, lng, ...).
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_provider_unified CASCADE;

CREATE MATERIALIZED VIEW mv_provider_unified AS
-- Labs (split into kinds by centerType). Filter inactive at source — they are
-- not part of the live network and should not appear in any coverage metric.
SELECT
  'LAB-' || l.id AS entity_id,
  l.id AS source_id,
  'Lab' AS source_table,
  l."labName" AS name,
  CASE l."centerType"::text
    WHEN 'HOSPITAL' THEN 'HOSPITAL'
    -- DIAGNOSTIC_CENTER + COLLECTION_CENTER are both labs from a coverage perspective;
    -- the distinction is operational (full-processing vs collection-only) and lives on
    -- Lab.centerType for Directory sub-tabs.
    ELSE 'LAB'
  END AS kind,
  l.pincode,
  l.latitude,
  l.longitude,
  l.city,
  l.state,
  l.chain_id,
  true AS active,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN COALESCE(l."centerVisit", false) THEN 'CENTER_VISIT' END,
    CASE WHEN COALESCE(l."homeCollection", false) THEN 'HOME_SAMPLE' END
  ], NULL)::text[] AS modalities,
  l."pincodesServiced" AS serviced_pincodes
FROM "Lab" l
WHERE COALESCE(l.active, true) = true

UNION ALL

-- Providers (Doctor / Phlebotomist / Nurse)
SELECT
  'PROV-' || p.id AS entity_id,
  p.id AS source_id,
  'Provider' AS source_table,
  p.name,
  CASE pt."typeName"
    WHEN 'Doctor' THEN 'DOCTOR'
    WHEN 'Phlebotomist' THEN 'PHLEBO'
    WHEN 'Nurse' THEN 'NURSE'
    ELSE 'OTHER'
  END AS kind,
  p.pincode,
  p.latitude,
  p.longitude,
  p.city,
  p.state,
  NULL::int AS chain_id,
  true AS active,
  CASE pt."typeName"
    WHEN 'Doctor' THEN ARRAY['CENTER_VISIT','HOME_VISIT']
    WHEN 'Phlebotomist' THEN ARRAY['HOME_SAMPLE']
    WHEN 'Nurse' THEN ARRAY['HOME_VISIT']
    ELSE ARRAY[]::text[]
  END::text[] AS modalities,
  NULL::text[] AS serviced_pincodes
FROM "Provider" p
JOIN "ProviderType" pt ON pt.id = p."typeId"
WHERE pt."typeName" IN ('Doctor','Phlebotomist','Nurse')

UNION ALL

-- Pharmacies
SELECT
  'PHARM-' || ph.id AS entity_id,
  ph.id AS source_id,
  'Pharmacy' AS source_table,
  ph.name,
  'PHARMACY' AS kind,
  ph.pincode,
  ph.latitude,
  ph.longitude,
  ph.city,
  ph.state,
  NULL::int AS chain_id,
  true AS active,
  ARRAY['CENTER_VISIT','DELIVERY']::text[] AS modalities,
  NULL::text[] AS serviced_pincodes
FROM "Pharmacy" ph;

CREATE UNIQUE INDEX idx_mv_provider_unified_entity ON mv_provider_unified(entity_id);
CREATE INDEX idx_mv_provider_unified_kind ON mv_provider_unified(kind);
CREATE INDEX idx_mv_provider_unified_pin ON mv_provider_unified(pincode);
CREATE INDEX idx_mv_provider_unified_latlng ON mv_provider_unified(latitude, longitude) WHERE latitude IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. mv_pincode_coverage
--    Per (pincode × kind × modality): in-pincode counts + serviced counts.
--    "Local" = provider's home pincode equals this pincode.
--    "Serviced" = pincode is listed in provider's serviced_pincodes (labs only, HOME_SAMPLE).
--    Radius-based coverage is computed live on query (since radius is user-controlled).
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_pincode_coverage CASCADE;

CREATE MATERIALIZED VIEW mv_pincode_coverage AS
WITH expanded AS (
  -- All (kind × modality) combos where the entity is HOSTED in this pincode
  SELECT
    p.pincode AS pincode,
    p.kind,
    m.modality::text AS modality,
    p.entity_id,
    'LOCAL' AS coverage_type
  FROM mv_provider_unified p, unnest(p.modalities) AS m(modality)
  WHERE p.pincode IS NOT NULL AND p.pincode <> '' AND p.active
  UNION ALL
  -- HOME_SAMPLE pincodesServiced (Lab declares it serves these pincodes for home collection)
  SELECT
    sp AS pincode,
    p.kind,
    'HOME_SAMPLE' AS modality,
    p.entity_id,
    'SERVICED' AS coverage_type
  FROM mv_provider_unified p, unnest(COALESCE(p.serviced_pincodes, ARRAY[]::text[])) AS sp
  WHERE 'HOME_SAMPLE' = ANY(p.modalities)
    AND sp IS NOT NULL AND sp <> ''
    AND p.active
)
SELECT
  pincode,
  kind,
  modality,
  COUNT(DISTINCT entity_id)::int AS providers,
  COUNT(DISTINCT entity_id) FILTER (WHERE coverage_type = 'LOCAL')::int AS local_providers,
  COUNT(DISTINCT entity_id) FILTER (WHERE coverage_type = 'SERVICED')::int AS serviced_providers
FROM expanded
GROUP BY pincode, kind, modality;

CREATE INDEX idx_mv_coverage_pin ON mv_pincode_coverage(pincode);
CREATE INDEX idx_mv_coverage_kind ON mv_pincode_coverage(kind);
CREATE INDEX idx_mv_coverage_modality ON mv_pincode_coverage(modality);
CREATE INDEX idx_mv_coverage_compound ON mv_pincode_coverage(kind, modality, providers DESC);

-- ----------------------------------------------------------------------------
-- 3. mv_pincode_city
--    Stable pincode → city mapping (best-effort from Lab/Provider/Profile).
--    Centralized for reuse across views.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_pincode_city CASCADE;

CREATE MATERIALIZED VIEW mv_pincode_city AS
WITH candidates AS (
  -- Locally-derived signal only: whatever Lab / Provider / Profile rows tell us.
  -- The India Post directory backfill happens at the application layer in
  -- lib/pincodeDirectory.ts so this MV stays free of any Atlas-DB dependency.
  SELECT pincode, city, state, COUNT(*) AS n FROM "Lab"
   WHERE pincode IS NOT NULL AND city IS NOT NULL GROUP BY pincode, city, state
  UNION ALL
  SELECT pincode, city, state, COUNT(*) FROM "Provider"
   WHERE pincode IS NOT NULL AND city IS NOT NULL GROUP BY pincode, city, state
  UNION ALL
  SELECT pincode, city, state, COUNT(*) FROM "Profile"
   WHERE pincode IS NOT NULL AND city IS NOT NULL AND TRIM(city) <> '' GROUP BY pincode, city, state
),
ranked AS (
  SELECT pincode, TRIM(city) AS city, TRIM(state) AS state, SUM(n) AS n,
         ROW_NUMBER() OVER (PARTITION BY pincode ORDER BY SUM(n) DESC) AS rn
  FROM candidates
  GROUP BY pincode, TRIM(city), TRIM(state)
)
SELECT
  pincode,
  city,
  -- Normalize the most common free-text state typos so downstream charts
  -- aren't fragmented across multiple labels for the same state.
  CASE TRIM(state)
    WHEN 'TamilNadu'     THEN 'Tamil Nadu'
    WHEN 'Tamil  Nadu'   THEN 'Tamil Nadu'
    WHEN 'Telengana'     THEN 'Telangana'
    WHEN 'Andhrapradesh' THEN 'Andhra Pradesh'
    WHEN 'Chattisgarh'   THEN 'Chhattisgarh'
    WHEN 'TEST ENTRY'    THEN NULL
    WHEN '-'             THEN NULL
    WHEN ''              THEN NULL
    ELSE TRIM(state)
  END AS state
FROM ranked
WHERE rn = 1;

CREATE UNIQUE INDEX idx_mv_pincode_city_pin ON mv_pincode_city(pincode);
CREATE INDEX idx_mv_pincode_city_city ON mv_pincode_city(city);

-- ----------------------------------------------------------------------------
-- 4. mv_city_coverage
--    City-level coverage rollup. For each city × kind × modality:
--    - covered_pincodes (≥1 provider)
--    - well_served_pincodes (≥3 providers)
--    - total active pincodes in the city
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_city_coverage CASCADE;

CREATE MATERIALIZED VIEW mv_city_coverage AS
WITH all_city_pincodes AS (
  SELECT DISTINCT c.city, c.pincode
  FROM mv_pincode_city c
  JOIN mv_pincode_summary s ON s.pincode = c.pincode
  WHERE s.orders_all_time > 0 OR s.network_strength > 0
),
-- Per-pincode coverage joined to city (used for pincode counts)
pincode_cov AS (
  SELECT
    c.city,
    cov.kind,
    cov.modality,
    cov.pincode,
    cov.providers
  FROM mv_pincode_coverage cov
  JOIN mv_pincode_city c ON c.pincode = cov.pincode
),
-- Unique providers per (city, kind, modality):
--   (a) Provider is HOSTED in this city for one of its modalities, OR
--   (b) Provider serves a pincode in this city via pincodesServiced (HOME_SAMPLE only)
city_providers AS (
  SELECT DISTINCT pc.city, p.entity_id, p.kind, m::text AS modality
  FROM mv_provider_unified p
  JOIN mv_pincode_city pc ON pc.pincode = p.pincode
  CROSS JOIN LATERAL unnest(p.modalities) AS m
  WHERE p.active
  UNION
  SELECT DISTINCT pc.city, p.entity_id, p.kind, 'HOME_SAMPLE' AS modality
  FROM mv_provider_unified p
  CROSS JOIN LATERAL unnest(COALESCE(p.serviced_pincodes, ARRAY[]::text[])) AS sp
  JOIN mv_pincode_city pc ON pc.pincode = sp
  WHERE p.active AND 'HOME_SAMPLE' = ANY(p.modalities)
),
unique_providers AS (
  SELECT city, kind, modality, COUNT(*)::int AS unique_providers
  FROM city_providers
  GROUP BY city, kind, modality
),
pincode_rollup AS (
  SELECT
    acp.city,
    pc.kind,
    pc.modality,
    COUNT(DISTINCT pc.pincode) FILTER (WHERE pc.providers >= 1)::int AS covered_pincodes,
    COUNT(DISTINCT pc.pincode) FILTER (WHERE pc.providers >= 3)::int AS well_served_pincodes,
    COUNT(DISTINCT pc.pincode) FILTER (WHERE pc.providers >= 5)::int AS strong_pincodes,
    COUNT(DISTINCT acp.pincode)::int AS total_pincodes
  FROM all_city_pincodes acp
  LEFT JOIN pincode_cov pc ON pc.city = acp.city
  GROUP BY acp.city, pc.kind, pc.modality
)
SELECT
  pr.city,
  pr.kind,
  pr.modality,
  pr.covered_pincodes,
  pr.well_served_pincodes,
  pr.strong_pincodes,
  COALESCE(up.unique_providers, 0) AS total_providers,
  pr.total_pincodes
FROM pincode_rollup pr
LEFT JOIN unique_providers up
  ON up.city = pr.city AND up.kind = pr.kind AND up.modality = pr.modality
WHERE pr.kind IS NOT NULL;

CREATE INDEX idx_mv_city_coverage_city ON mv_city_coverage(city);
CREATE INDEX idx_mv_city_coverage_compound ON mv_city_coverage(kind, modality, covered_pincodes DESC);
