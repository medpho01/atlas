-- ===========================================================================
-- mediassist-coverage.sql — every number the MediAssist benefit-coverage deck
-- needs, for the five cities they asked about, in pasteable blocks.
--
-- Read-only. Nothing is created and nothing is written to the source database.
--
-- Run:  docker compose exec -T atlas-db psql -U atlas -d atlas \
--         -f - < sql/reports/mediassist-coverage.sql > mediassist.txt
--
-- Then paste mediassist.txt back into the chat. Output is pipe-separated and
-- unaligned so it stays small enough to paste.
--
-- Two different meanings of "coverage" appear below, and the deck must not
-- blur them:
--
--   SERVICEABLE — a provider declares it will travel to that pincode
--                 (Lab.pincodesServiced). It is what a network can promise.
--   PROVEN      — an order was actually fulfilled in that pincode. It is what
--                 the network has done. Historically the first overstates the
--                 second by roughly 6x, so a deck that quotes only the first
--                 is a deck that will be audited.
-- ===========================================================================

\pset pager off
\pset format unaligned
\pset fieldsep '|'
\pset footer off
\timing off

-- The five cities, plus the NCR satellites that Delhi - NCR has to include.
CREATE TEMP VIEW deck_city AS
SELECT pincode, CASE WHEN ck IN ('delhi','gurugram','noida','ghaziabad','faridabad')
                     THEN 'delhi-ncr' ELSE ck END AS city
FROM (SELECT pincode, atlas.city_key(city) AS ck FROM analytics.mv_pincode_city) z
WHERE ck IN ('bengaluru','hyderabad','mumbai','pune',
             'delhi','gurugram','noida','ghaziabad','faridabad');

\echo '=== 1. CENTRE VISIT DIAGNOSTICS — centres, chains, pincodes by city ==='
SELECT c.city,
       COUNT(*) FILTER (WHERE p.kind = 'LAB')::int                       AS lab_centres,
       COUNT(*) FILTER (WHERE p.kind = 'HOSPITAL')::int                  AS hospital_centres,
       COUNT(DISTINCT p.chain_id) FILTER (WHERE p.chain_id IS NOT NULL)::int AS chains,
       COUNT(DISTINCT p.pincode)::int                                    AS pincodes_with_a_centre
FROM deck_city c
JOIN analytics.mv_provider_unified p ON p.pincode = c.pincode
WHERE p.active AND 'CENTER_VISIT' = ANY(p.modalities)
  AND p.kind IN ('LAB', 'HOSPITAL')
GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== 2. CENTRE VISIT — the named chains per city (for logos) ==='
SELECT c.city, l.chain_id, MIN(l."labName") AS example_name, COUNT(*)::int AS branches
FROM deck_city c
JOIN analytics.mv_provider_unified p ON p.pincode = c.pincode
JOIN src_local."Lab" l ON l.id = p.source_id AND p.source_table = 'Lab'
WHERE p.active AND 'CENTER_VISIT' = ANY(p.modalities) AND l.chain_id IS NOT NULL
GROUP BY 1, 2 HAVING COUNT(*) >= 2 ORDER BY c.city, 4 DESC;

\echo ''
\echo '=== 3. HOME SAMPLE COLLECTION — serviceable vs proven, by city ==='
WITH served AS (
  SELECT DISTINCT sp AS pincode, p.entity_id, p.kind
  FROM analytics.mv_provider_unified p
  CROSS JOIN LATERAL unnest(COALESCE(p.serviced_pincodes, ARRAY[]::text[])) sp
  WHERE p.active AND 'HOME_SAMPLE' = ANY(p.modalities)
),
proven AS (
  SELECT DISTINCT pr.pincode
  FROM src_local."Order" o
  JOIN src_local."User" u ON u.id = o."userId"
  JOIN src_local."Profile" pr ON pr."profileUserId" = u.id
  WHERE o."orderType" = 'HOME_SAMPLE'
    AND o."orderStatus" IN ('REPORT_DELIVERED','SAMPLE_PROCESSED','SAMPLE_DELIVERED')
)
SELECT c.city,
       COUNT(DISTINCT s.pincode)::int                      AS serviceable_pincodes,
       COUNT(DISTINCT s.pincode) FILTER (WHERE pv.pincode IS NOT NULL)::int AS proven_pincodes,
       COUNT(DISTINCT s.entity_id)::int                    AS collecting_providers,
       COUNT(DISTINCT s.entity_id) FILTER (WHERE s.kind = 'PHLEBO')::int    AS own_phlebos
FROM deck_city c
JOIN served s ON s.pincode = c.pincode
LEFT JOIN proven pv ON pv.pincode = s.pincode
GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== 4. HOME COLLECTION — partner labs doing it, nationally (for logos) ==='
SELECT COALESCE(l.chain_id::text, 'independent') AS chain,
       MIN(l."labName")                          AS example_name,
       COUNT(DISTINCT l.id)::int                 AS labs,
       COUNT(DISTINCT sp)::int                   AS serviceable_pincodes
FROM src_local."Lab" l
CROSS JOIN LATERAL unnest(COALESCE(l."pincodesServiced", ARRAY[]::text[])) sp
WHERE l.active AND l."homeCollection"
GROUP BY 1 ORDER BY 4 DESC LIMIT 25;

\echo ''
\echo '=== 5. DOCTOR CONSULT, CENTRE VISIT — hospitals and doctors by city ==='
SELECT c.city,
       COUNT(DISTINCT p.entity_id) FILTER (WHERE p.kind = 'HOSPITAL')::int AS hospitals,
       COUNT(DISTINCT p.entity_id) FILTER (WHERE p.kind = 'DOCTOR')::int   AS doctors,
       COUNT(DISTINCT p.pincode)::int                                      AS pincodes
FROM deck_city c
JOIN analytics.mv_provider_unified p ON p.pincode = c.pincode
WHERE p.active AND 'CENTER_VISIT' = ANY(p.modalities)
  AND p.kind IN ('HOSPITAL', 'DOCTOR')
GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== 6. ONLINE CONSULT — specialities, and how many providers hold each ==='
SELECT s.name AS speciality,
       COUNT(DISTINCT ps."A")::int AS providers,
       COUNT(DISTINCT ss.id)::int  AS sub_specialities
FROM src."Speciality" s
LEFT JOIN src."_ProviderToSpeciality" ps ON ps."B" = s.id
LEFT JOIN src."SubSpeciality" ss         ON ss.speciality_id = s.id
GROUP BY 1 HAVING COUNT(DISTINCT ps."A") > 0
ORDER BY 2 DESC;

\echo ''
\echo '=== 7. ONLINE CONSULT — the hours actually staffed, IST ==='
SELECT LEFT(sc."startTime", 2)::int                         AS hour_from,
       COUNT(DISTINCT sc.provider_id)::int                  AS providers,
       COUNT(*)::int                                        AS slot_rules
FROM src_local."SlotConfig" sc
WHERE sc."isActive"
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '=== 8. ONLINE CONSULT — days of the week covered ==='
SELECT d AS day_of_week, COUNT(DISTINCT sc.provider_id)::int AS providers
FROM src_local."SlotConfig" sc
CROSS JOIN LATERAL unnest(sc."daysOfWeek") d
WHERE sc."isActive"
GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '=== 9. HOW FRESH IS THIS — the snapshot the numbers came from ==='
SELECT MAX(o."createdAt")::date AS newest_order,
       (SELECT COUNT(*) FROM src_local."Lab" WHERE active)::int   AS active_labs,
       (SELECT COUNT(*) FROM src_local."Provider")::int           AS providers
FROM src_local."Order" o;
