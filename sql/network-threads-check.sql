-- Do the eleven provider threads exist on prod, and how thin are they?
--
-- Several counts on the local April snapshot look like snapshot artefacts
-- rather than reality (isApiPpmc = 0, one pharmacy, 22 online appointments).
-- This settles which threads the deck can actually carry. Read-only.
--
-- Run: docker compose exec -T atlas-db psql -U atlas -d atlas -f - < sql/network-threads-check.sql

\pset pager off

-- Some of these tables have never been needed before, so they may not be in
-- src yet. Import what is missing; this touches only Atlas's own catalog, and
-- never the source database. A failure here is a warning, not a stop — the
-- section that needs the table reports it as unavailable instead.
DO $bootstrap$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SlotConfig', 'Speciality', '_ProviderToSpeciality',
                           'MDMLanguage', '_MDMLanguageToProvider', 'Appointment'] LOOP
    IF to_regclass(format('src.%I', t)) IS NULL THEN
      BEGIN
        EXECUTE format('IMPORT FOREIGN SCHEMA public LIMIT TO (%I) FROM SERVER labstack_src INTO src', t);
        RAISE NOTICE 'Imported src.%', t;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Could not import src.%: %', t, SQLERRM;
      END;
    END IF;
  END LOOP;
END $bootstrap$;

\echo '=== 1-5. Lab-backed threads ==='
SELECT count(*)                                        AS active_labs,
       count(*) FILTER (WHERE "homeCollection")        AS home_sample,
       count(*) FILTER (WHERE "centerVisit")           AS centre_visit,
       count(*) FILTER (WHERE "isApiPpmc")             AS ppmc,
       count(*) FILTER (WHERE "labFacilities" IS NOT NULL
                          AND "labFacilities" <> '{}'::jsonb) AS has_facilities
FROM src."Lab" WHERE active;

\echo ''
\echo '=== 2. Centre visit — can radiology be told from pathology? ==='
WITH cv AS (
  SELECT (SELECT bool_or(v::text = 'true') FROM jsonb_each("labFacilities") f(k, v)
          WHERE k IN ('XRay','USG','CT','MRI','Mammogram','TwoDEcho','BMD','TMT','EMG')) AS radiology,
         ("labFacilities" IS NULL OR "labFacilities" = '{}'::jsonb) AS unknown
  FROM src."Lab" WHERE active AND "centerVisit"
)
SELECT count(*) FILTER (WHERE NOT unknown AND radiology)     AS radiology,
       count(*) FILTER (WHERE NOT unknown AND NOT radiology) AS pathology_only,
       count(*) FILTER (WHERE unknown)                       AS unclassified,
       round(100.0 * count(*) FILTER (WHERE unknown) / nullif(count(*), 0)) AS pct_unknown
FROM cv;

\echo ''
\echo '=== 3. Specialised tests — labs offering a NON_ROUTINE master ==='
SELECT count(DISTINCT d.lab_id) AS labs, count(*) AS dos_rows
FROM src."DOS" d JOIN src."Master" m ON m.id = d.master_id
WHERE m."testCategory" = 'NON_ROUTINE' AND d.active;

\echo ''
\echo '=== 4. Processing labs ==='
SELECT count(*) FILTER (WHERE "labFacilities"->>'ProcessOtherLabSamples' = 'true') AS processing_labs
FROM src."Lab" WHERE active;

\echo ''
\echo '=== 7, 9, 10. Provider-type threads ==='
SELECT pt."typeName", count(p.id) AS providers
FROM src."ProviderType" pt LEFT JOIN src."Provider" p ON p."typeId" = pt.id
GROUP BY 1 HAVING count(p.id) > 0 ORDER BY 2 DESC;

\echo ''
\echo '=== 8. Pharmacy ==='
SELECT count(*) AS pharmacies FROM src."Pharmacy";

\echo ''
\echo '=== 6. Teleconsult — is it live? ==='
SELECT a."appointmentType", count(*) AS appointments,
       count(*) FILTER (WHERE a."appointmentDate" >= now() - interval '90 days') AS last_90d,
       max(a."appointmentDate")::date AS latest
FROM src."Appointment" a GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== 6. Hour-of-day coverage is buildable only if SlotConfig is populated ==='
SELECT count(*) AS slot_configs, count(*) FILTER (WHERE "isActive") AS active,
       count(DISTINCT provider_id) AS providers_with_slots
FROM src."SlotConfig";

\echo ''
\echo '=== 11. Dental — type vs speciality ==='
SELECT 'as provider type' AS via, count(p.id) AS providers
FROM src."ProviderType" pt LEFT JOIN src."Provider" p ON p."typeId" = pt.id
WHERE pt."typeName" = 'Dentist'
UNION ALL
SELECT 'as speciality', count(*)
FROM src."_ProviderToSpeciality" ps JOIN src."Speciality" s ON s.id = ps."B"
WHERE s.name ILIKE '%dent%';

\echo ''
\echo '=== State field cleanliness — zonal view depends on it ==='
SELECT count(DISTINCT state) AS distinct_state_values,
       count(DISTINCT lower(btrim(state))) AS after_normalising
FROM src."Lab" WHERE active AND state IS NOT NULL;

\echo ''
\echo '=== Growth — can "pincodes added" be computed, or is a snapshot needed? ==='
SELECT to_regclass('atlas.network_snapshot') AS snapshot_table;
