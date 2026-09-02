-- Every number the provider-network deck needs, in four pasteable blocks.
--
-- Read-only. Builds TEMP views that vanish with the session; nothing is
-- created in Atlas and nothing is written to the source database.
--
-- Run:  docker compose exec -T atlas-db psql -U atlas -d atlas \
--         -f - < sql/network-deck-data.sql > deck-data.txt
--
-- Then paste deck-data.txt back into the chat. Output is pipe-separated and
-- unaligned so it stays small enough to paste.
--
-- Definitions used throughout, matching docs/network-threads.md:
--   pincode reached = a real order was fulfilled there (Order -> User -> Profile),
--                     never Lab.pincodesServiced, which overstates ~6x
--   added (30d)     = provider row created, or first order into that pincode,
--                     inside the window — the second is why growth works at all
--                     without a per-thread snapshot
--   depth           = median providers per pincode the thread actually reaches

\pset pager off
\pset format unaligned
\pset fieldsep '|'
\pset footer off
\timing off

-- Tables that may not have been imported into src yet.
DO $bootstrap$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SlotConfig','Speciality','_ProviderToSpeciality',
                           'MDMLanguage','_MDMLanguageToProvider','Appointment'] LOOP
    IF to_regclass(format('src.%I', t)) IS NULL THEN
      BEGIN
        EXECUTE format('IMPORT FOREIGN SCHEMA public LIMIT TO (%I) FROM SERVER labstack_src INTO src', t);
      EXCEPTION WHEN OTHERS THEN RAISE WARNING 'no src.%: %', t, SQLERRM; END;
    END IF;
  END LOOP;
END $bootstrap$;

-- ---------------------------------------------------------------- threads
-- Which labs belong to which thread. A lab can be in several.
CREATE TEMP VIEW t_lab AS
SELECT id AS lab_id, thread FROM (
  SELECT l.id,
         unnest(ARRAY[
           CASE WHEN l."homeCollection" THEN 'Home sample collection' END,
           CASE WHEN l."centerVisit"    THEN 'Centre visit' END,
           CASE WHEN l."isApiPpmc"      THEN 'PPMC network' END,
           CASE WHEN l."labFacilities"->>'ProcessOtherLabSamples' = 'true'
                THEN 'Processing labs' END,
           CASE WHEN EXISTS (SELECT 1 FROM src."DOS" d JOIN src."Master" m ON m.id = d.master_id
                             WHERE d.lab_id = l.id AND d.active AND m."testCategory" = 'NON_ROUTINE')
                THEN 'Specialised tests' END
         ]) AS thread
  FROM src."Lab" l WHERE l.active
) x WHERE thread IS NOT NULL;

-- Which providers belong to which thread.
CREATE TEMP VIEW t_prov AS
SELECT p.id AS provider_id, pt."typeName" AS thread, p.pincode, p."createdAt"
FROM src."Provider" p JOIN src."ProviderType" pt ON pt.id = p."typeId"
WHERE pt."typeName" IN ('Doctor','Phlebotomist','Nurse')
UNION ALL
SELECT p.id, 'Dental network', p.pincode, p."createdAt"
FROM src."Provider" p
JOIN src."_ProviderToSpeciality" ps ON ps."A" = p.id
JOIN src."Speciality" s ON s.id = ps."B"
WHERE s.name ILIKE '%dent%';

-- Every (thread, entity, pincode) pair the network has actually served, with
-- the date it first happened — that date is what makes growth computable.
CREATE TEMP VIEW served AS
SELECT o."labId" AS lab_id, btrim(pr.pincode) AS pincode,
       min(o."createdAt") AS first_served, count(*) AS orders,
       count(*) FILTER (WHERE o."createdAt" >= now() - interval '90 days') AS orders_90d
FROM src."Order" o
JOIN src."User" u    ON u.id = o."userId"
JOIN src."Profile" pr ON pr."profileUserId" = u.id
WHERE o."labId" IS NOT NULL AND NULLIF(btrim(pr.pincode), '') IS NOT NULL
GROUP BY 1, 2;

CREATE TEMP VIEW thread_pin AS
SELECT tl.thread, tl.lab_id AS entity_id, s.pincode, s.first_served
FROM t_lab tl JOIN served s ON s.lab_id = tl.lab_id
UNION ALL
SELECT tp.thread, tp.provider_id, btrim(tp.pincode), tp."createdAt"
FROM t_prov tp WHERE NULLIF(btrim(tp.pincode), '') IS NOT NULL;

-- Where the orders are — the denominator for "demand covered".
CREATE TEMP VIEW demand AS
SELECT pincode, sum(orders_90d)::int AS orders_90d FROM served
WHERE orders_90d > 0 GROUP BY 1;

CREATE TEMP VIEW zone AS
SELECT pincode, city, state,
  CASE
    WHEN state ILIKE ANY (ARRAY['%delhi%','%haryana%','%punjab%','%himachal%','%uttarakhand%',
                                '%uttar pradesh%','%kashmir%','%ladakh%','%chandigarh%','%rajasthan%'])
      THEN 'North'
    WHEN state ILIKE ANY (ARRAY['%maharashtra%','%gujarat%','%goa%','%madhya pradesh%',
                                '%dadra%','%daman%'])
      THEN 'West'
    WHEN state ILIKE ANY (ARRAY['%karnataka%','%tamil%','%kerala%','%andhra%','%telangana%',
                                '%puducherry%','%pondicherry%','%lakshadweep%','%andaman%'])
      THEN 'South'
    WHEN state ILIKE ANY (ARRAY['%bengal%','%odisha%','%orissa%','%bihar%','%jharkhand%','%assam%',
                                '%sikkim%','%arunachal%','%nagaland%','%manipur%','%mizoram%',
                                '%tripura%','%meghalaya%','%chhattisgarh%'])
      THEN 'East'
    ELSE 'Unmapped' END AS zone,
  CASE
    WHEN city ILIKE ANY (ARRAY['%bengaluru%','%bangalore%'])          THEN 'Bengaluru'
    WHEN city ILIKE '%hyderabad%' OR district ILIKE '%hyderabad%'     THEN 'Hyderabad'
    WHEN city ILIKE '%chennai%'   OR district ILIKE '%chennai%'       THEN 'Chennai'
    WHEN city ILIKE ANY (ARRAY['%mumbai%','%thane%','%navi mumbai%']) THEN 'Mumbai'
    WHEN city ILIKE '%pune%'      OR district ILIKE '%pune%'          THEN 'Pune'
    WHEN state ILIKE '%delhi%' OR city ILIKE ANY (ARRAY['%gurugram%','%gurgaon%','%noida%','%ghaziabad%','%faridabad%'])
                                                                     THEN 'Delhi NCR'
    ELSE NULL END AS metro
FROM atlas.pincode_directory;

-- ============================================================ BLOCK 1
\echo '### BLOCK 1 — slide 1: thread | providers | added30d | pincodes | pins_added30d | depth | demand_pct'
WITH ent AS (
  SELECT thread, entity_id, min(first_served) AS first_seen FROM thread_pin GROUP BY 1, 2
),
new_prov AS (
  SELECT tl.thread, count(*) AS n FROM t_lab tl JOIN src."Lab" l ON l.id = tl.lab_id
  WHERE l."createdAt" >= now() - interval '30 days' GROUP BY 1
  UNION ALL
  SELECT thread, count(*) FROM t_prov WHERE "createdAt" >= now() - interval '30 days' GROUP BY 1
),
tot AS (
  SELECT thread,
         count(DISTINCT entity_id)                                              AS providers,
         count(DISTINCT pincode)                                                AS pincodes,
         count(DISTINCT pincode) FILTER (WHERE first_served >= now() - interval '30 days') AS pins_new
  FROM thread_pin GROUP BY 1
),
dep AS (
  SELECT thread, percentile_cont(0.5) WITHIN GROUP (ORDER BY n) AS depth FROM (
    SELECT thread, pincode, count(DISTINCT entity_id) AS n FROM thread_pin GROUP BY 1, 2
  ) q GROUP BY 1
),
dem AS (
  SELECT tp.thread,
         round(100.0 * sum(d.orders_90d) / nullif((SELECT sum(orders_90d) FROM demand), 0)) AS pct
  FROM (SELECT DISTINCT thread, pincode FROM thread_pin) tp
  JOIN demand d ON d.pincode = tp.pincode GROUP BY 1
)
SELECT t.thread, t.providers,
       COALESCE((SELECT sum(n) FROM new_prov n WHERE n.thread = t.thread), 0) AS added30d,
       t.pincodes, t.pins_new AS pins_added30d,
       round(dep.depth::numeric, 1) AS depth, COALESCE(dem.pct, 0) AS demand_pct
FROM tot t LEFT JOIN dep ON dep.thread = t.thread LEFT JOIN dem ON dem.thread = t.thread
ORDER BY t.providers DESC;

-- ============================================================ BLOCK 2
\echo ''
\echo '### BLOCK 2 — slide 2 metro heatmap: thread | metro | depth'
SELECT tp.thread, z.metro, round(avg(n)::numeric, 1) AS depth FROM (
  SELECT thread, pincode, count(DISTINCT entity_id) AS n FROM thread_pin GROUP BY 1, 2
) tp JOIN zone z ON z.pincode = tp.pincode
WHERE z.metro IS NOT NULL
GROUP BY 1, 2 ORDER BY 1, 2;

-- ============================================================ BLOCK 3
\echo ''
\echo '### BLOCK 3a — slide 2 demand by zone: zone | pct'
SELECT z.zone, round(100.0 * sum(d.orders_90d) / nullif((SELECT sum(orders_90d) FROM demand), 0)) AS pct
FROM demand d JOIN zone z ON z.pincode = d.pincode GROUP BY 1 ORDER BY 2 DESC;

\echo ''
\echo '### BLOCK 3b — slide 2 zonal split per thread: thread | zone | pct_of_that_threads_reach'
WITH tz AS (
  SELECT DISTINCT tp.thread, tp.pincode, z.zone FROM thread_pin tp JOIN zone z ON z.pincode = tp.pincode
)
SELECT thread, zone, round(100.0 * count(*) / sum(count(*)) OVER (PARTITION BY thread)) AS pct
FROM tz GROUP BY 1, 2 ORDER BY 1, 2;

-- ============================================================ BLOCK 4
\echo ''
\echo '### BLOCK 4a — slide 3 teleconsult headline: metric | value | added_30d'
SELECT 'doctors' AS metric, count(*) AS value, count(*) FILTER (WHERE "createdAt" >= now() - interval '30 days')
FROM t_prov WHERE thread = 'Doctor'
UNION ALL
SELECT 'specialities', count(DISTINCT s.id), count(DISTINCT s.id) FILTER (WHERE p."createdAt" >= now() - interval '30 days')
FROM src."_ProviderToSpeciality" ps JOIN src."Speciality" s ON s.id = ps."B"
JOIN src."Provider" p ON p.id = ps."A"
UNION ALL
SELECT 'languages', count(DISTINCT l.id), 0
FROM src."_MDMLanguageToProvider" lp JOIN src."MDMLanguage" l ON l.id = lp."A"
UNION ALL
SELECT 'online appointments (90d)', count(*), 0
FROM src."Appointment" WHERE "appointmentType" = 'ONLINE'
  AND "appointmentDate" >= now() - interval '90 days';

\echo ''
\echo '### BLOCK 4b — slide 3 speciality x hour: speciality | doctors | added30d | h00..h23'
WITH sp AS (
  SELECT s.name, p.id AS provider_id, p."createdAt"
  FROM src."Speciality" s
  JOIN src."_ProviderToSpeciality" ps ON ps."B" = s.id
  JOIN src."Provider" p ON p.id = ps."A"
),
tot AS (
  SELECT name, count(DISTINCT provider_id) AS doctors,
         count(DISTINCT provider_id) FILTER (WHERE "createdAt" >= now() - interval '30 days') AS added30d
  FROM sp GROUP BY 1
),
hours AS (
  -- startTime/endTime are text 'HH:MM', so parse before expanding the range.
  SELECT sp.name, sp.provider_id, generate_series(
           split_part(sc."startTime", ':', 1)::int,
           greatest(split_part(sc."endTime", ':', 1)::int - 1,
                    split_part(sc."startTime", ':', 1)::int)) AS hr
  FROM sp JOIN src."SlotConfig" sc ON sc.provider_id = sp.provider_id
  WHERE sc."isActive"
),
hc AS (SELECT name, hr, count(DISTINCT provider_id) AS n FROM hours GROUP BY 1, 2)
SELECT t.name AS speciality, t.doctors, t.added30d,
       string_agg(COALESCE(hc.n, 0)::text, ',' ORDER BY g.hr) AS h00_h23
FROM tot t
CROSS JOIN generate_series(0, 23) AS g(hr)
LEFT JOIN hc ON hc.name = t.name AND hc.hr = g.hr
GROUP BY t.name, t.doctors, t.added30d
ORDER BY t.doctors DESC LIMIT 12;
