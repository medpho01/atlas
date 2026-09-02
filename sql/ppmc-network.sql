-- Who is in the PPMC network?
--
-- Lab.isApiPpmc is set on zero labs, so the flag cannot answer this. The
-- working definition instead: a lab is in the PPMC network if it prices an
-- active package belonging to the PPMC store.
--
-- Three readings, loosest to strictest, because they give different answers
-- and the deck should say which one it used:
--   A  mapped to the store            (LabsOnStore — the serviceability gate)
--   B  prices one of its packages     (PoSOnLab)
--   C  prices one that is still ACTIVE (PoSOnLab + Package.active)  <- the ask
--
-- Read-only.
-- Run: docker compose exec -T atlas-db psql -U atlas -d atlas -f - < sql/ppmc-network.sql

\pset pager off
\pset format unaligned
\pset fieldsep '|'
\pset footer off

DO $$ BEGIN
  IF to_regclass('src."PoSOnLab"') IS NULL THEN
    BEGIN
      EXECUTE 'IMPORT FOREIGN SCHEMA public LIMIT TO ("PoSOnLab") FROM SERVER labstack_src INTO src';
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'no src.PoSOnLab: %', SQLERRM; END;
  END IF;
END $$;

\echo '### WHICH STORE — confirm the right one before trusting anything below'
SELECT id, "storeName", active FROM src."Store"
WHERE "storeName" ILIKE '%ppmc%' OR "storeName" ILIKE '%star%'
ORDER BY ("storeName" ILIKE '%ppmc%') DESC, id;

\echo ''
\echo '### A/B/C — labs by definition: definition | labs | pincodes_reached'
WITH ppmc_store AS (
  -- Prefer an explicit PPMC store; fall back to Star, which is what it is called
  -- on some environments.
  SELECT id FROM src."Store"
  WHERE "storeName" ILIKE '%ppmc%'
  UNION ALL
  SELECT id FROM src."Store"
  WHERE "storeName" ILIKE '%star%'
    AND NOT EXISTS (SELECT 1 FROM src."Store" WHERE "storeName" ILIKE '%ppmc%')
),
served AS (
  SELECT o."labId" AS lab_id, btrim(pr.pincode) AS pincode
  FROM src."Order" o
  JOIN src."User" u     ON u.id = o."userId"
  JOIN src."Profile" pr ON pr."profileUserId" = u.id
  WHERE o."labId" IS NOT NULL AND NULLIF(btrim(pr.pincode), '') IS NOT NULL
  GROUP BY 1, 2
),
a AS (SELECT DISTINCT los."labId" AS lab_id FROM src."LabsOnStore" los
      JOIN ppmc_store s ON s.id = los."storeId"),
b AS (SELECT DISTINCT pol."labId" FROM src."PoSOnLab" pol
      JOIN ppmc_store s ON s.id = pol."storeId"),
c AS (SELECT DISTINCT pol."labId" FROM src."PoSOnLab" pol
      JOIN ppmc_store s ON s.id = pol."storeId"
      JOIN src."Package" p ON p.id = pol."packageId"
      WHERE p.active)
SELECT 'A mapped to store', count(DISTINCT a.lab_id),
       (SELECT count(DISTINCT pincode) FROM served WHERE lab_id IN (SELECT lab_id FROM a)) FROM a
UNION ALL
SELECT 'B prices a package', count(*), (SELECT count(DISTINCT pincode) FROM served WHERE lab_id IN (SELECT "labId" FROM b)) FROM b
UNION ALL
SELECT 'C prices an ACTIVE package', count(*), (SELECT count(DISTINCT pincode) FROM served WHERE lab_id IN (SELECT "labId" FROM c)) FROM c;

\echo ''
\echo '### PPMC as a deck row (definition C): providers|added30d|pincodes|pins_added30d|depth|demand_pct'
WITH ppmc_store AS (
  SELECT id FROM src."Store" WHERE "storeName" ILIKE '%ppmc%'
  UNION ALL
  SELECT id FROM src."Store" WHERE "storeName" ILIKE '%star%'
    AND NOT EXISTS (SELECT 1 FROM src."Store" WHERE "storeName" ILIKE '%ppmc%')
),
labs AS (
  SELECT DISTINCT pol."labId" AS lab_id FROM src."PoSOnLab" pol
  JOIN ppmc_store s ON s.id = pol."storeId"
  JOIN src."Package" p ON p.id = pol."packageId"
  WHERE p.active
),
served AS (
  SELECT o."labId" AS lab_id, btrim(pr.pincode) AS pincode,
         min(o."createdAt") AS first_served,
         count(*) FILTER (WHERE o."createdAt" >= now() - interval '90 days') AS orders_90d
  FROM src."Order" o
  JOIN src."User" u     ON u.id = o."userId"
  JOIN src."Profile" pr ON pr."profileUserId" = u.id
  WHERE o."labId" IS NOT NULL AND NULLIF(btrim(pr.pincode), '') IS NOT NULL
  GROUP BY 1, 2
),
mine AS (SELECT s.* FROM served s JOIN labs l ON l.lab_id = s.lab_id),
total_demand AS (SELECT sum(orders_90d) AS n FROM served WHERE orders_90d > 0)
SELECT (SELECT count(*) FROM labs),
       (SELECT count(*) FROM labs l JOIN src."Lab" lb ON lb.id = l.lab_id
        WHERE lb."createdAt" >= now() - interval '30 days'),
       (SELECT count(DISTINCT pincode) FROM mine),
       (SELECT count(DISTINCT pincode) FROM mine WHERE first_served >= now() - interval '30 days'),
       (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY n)::numeric, 1)
        FROM (SELECT pincode, count(DISTINCT lab_id) AS n FROM mine GROUP BY 1) q),
       (SELECT round(100.0 * sum(orders_90d) / nullif((SELECT n FROM total_demand), 0))
        FROM (SELECT DISTINCT pincode FROM mine) d
        JOIN (SELECT pincode, sum(orders_90d) AS orders_90d FROM served GROUP BY 1) t USING (pincode));

\echo ''
\echo '### PPMC by metro: metro|depth'
WITH ppmc_store AS (
  SELECT id FROM src."Store" WHERE "storeName" ILIKE '%ppmc%'
  UNION ALL
  SELECT id FROM src."Store" WHERE "storeName" ILIKE '%star%'
    AND NOT EXISTS (SELECT 1 FROM src."Store" WHERE "storeName" ILIKE '%ppmc%')
),
labs AS (
  SELECT DISTINCT pol."labId" AS lab_id FROM src."PoSOnLab" pol
  JOIN ppmc_store s ON s.id = pol."storeId"
  JOIN src."Package" p ON p.id = pol."packageId" WHERE p.active
),
mine AS (
  SELECT o."labId" AS lab_id, btrim(pr.pincode) AS pincode
  FROM src."Order" o
  JOIN src."User" u     ON u.id = o."userId"
  JOIN src."Profile" pr ON pr."profileUserId" = u.id
  JOIN labs l ON l.lab_id = o."labId"
  WHERE NULLIF(btrim(pr.pincode), '') IS NOT NULL
  GROUP BY 1, 2
),
metro AS (
  SELECT pincode, CASE
    WHEN city ILIKE ANY (ARRAY['%bengaluru%','%bangalore%'])          THEN 'Bengaluru'
    WHEN city ILIKE '%hyderabad%' OR district ILIKE '%hyderabad%'     THEN 'Hyderabad'
    WHEN city ILIKE '%chennai%'   OR district ILIKE '%chennai%'       THEN 'Chennai'
    WHEN city ILIKE ANY (ARRAY['%mumbai%','%thane%','%navi mumbai%']) THEN 'Mumbai'
    WHEN city ILIKE '%pune%'      OR district ILIKE '%pune%'          THEN 'Pune'
    WHEN state ILIKE '%delhi%' OR city ILIKE ANY (ARRAY['%gurugram%','%gurgaon%','%noida%','%ghaziabad%','%faridabad%'])
                                                                     THEN 'Delhi NCR'
    ELSE NULL END AS metro
  FROM atlas.pincode_directory
)
SELECT m.metro, round(avg(n)::numeric, 1)
FROM (SELECT pincode, count(DISTINCT lab_id) AS n FROM mine GROUP BY 1) q
JOIN metro m ON m.pincode = q.pincode
WHERE m.metro IS NOT NULL GROUP BY 1 ORDER BY 1;

\echo ''
\echo '### PPMC by zone: zone|pct_of_reach'
WITH ppmc_store AS (
  SELECT id FROM src."Store" WHERE "storeName" ILIKE '%ppmc%'
  UNION ALL
  SELECT id FROM src."Store" WHERE "storeName" ILIKE '%star%'
    AND NOT EXISTS (SELECT 1 FROM src."Store" WHERE "storeName" ILIKE '%ppmc%')
),
labs AS (
  SELECT DISTINCT pol."labId" AS lab_id FROM src."PoSOnLab" pol
  JOIN ppmc_store s ON s.id = pol."storeId"
  JOIN src."Package" p ON p.id = pol."packageId" WHERE p.active
),
mine AS (
  SELECT DISTINCT btrim(pr.pincode) AS pincode
  FROM src."Order" o
  JOIN src."User" u     ON u.id = o."userId"
  JOIN src."Profile" pr ON pr."profileUserId" = u.id
  JOIN labs l ON l.lab_id = o."labId"
  WHERE NULLIF(btrim(pr.pincode), '') IS NOT NULL
),
z AS (
  SELECT pincode, CASE
    WHEN state ILIKE ANY (ARRAY['%delhi%','%haryana%','%punjab%','%himachal%','%uttarakhand%',
                                '%uttar pradesh%','%kashmir%','%ladakh%','%chandigarh%','%rajasthan%']) THEN 'North'
    WHEN state ILIKE ANY (ARRAY['%maharashtra%','%gujarat%','%goa%','%madhya pradesh%','%dadra%','%daman%']) THEN 'West'
    WHEN state ILIKE ANY (ARRAY['%karnataka%','%tamil%','%kerala%','%andhra%','%telangana%',
                                '%puducherry%','%pondicherry%','%lakshadweep%','%andaman%']) THEN 'South'
    WHEN state ILIKE ANY (ARRAY['%bengal%','%odisha%','%orissa%','%bihar%','%jharkhand%','%assam%','%sikkim%',
                                '%arunachal%','%nagaland%','%manipur%','%mizoram%','%tripura%','%meghalaya%',
                                '%chhattisgarh%']) THEN 'East'
    ELSE 'Unmapped' END AS zone
  FROM atlas.pincode_directory
)
SELECT z.zone, round(100.0 * count(*) / sum(count(*)) OVER ())
FROM mine JOIN z ON z.pincode = mine.pincode GROUP BY 1 ORDER BY 2 DESC;
