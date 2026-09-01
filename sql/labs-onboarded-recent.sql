-- Labs onboarded in the last 30 days, and who did it.
--
-- Read-only against the LabStack source replica via the src.* foreign tables.
-- "Onboarded" is deliberately answered three ways, because the console records
-- three different moments and they do not always coincide:
--   A. the Lab row was created
--   B. the lab was first mapped to a store   (LabsOnStore  — the serviceability gate)
--   C. the lab first got a price list        (PackagesOnLab — what makes it orderable)
--
-- Attribution: Lab itself has no createdBy and there is no audit table. The only
-- author fields in the schema are LabsOnStore.assignedBy and PackagesOnLab.assignedBy,
-- both free text written by the console. Query 0 tells you whether they hold real
-- names on this database or just a role.

\pset pager off
\timing off

\echo '=== 0. Does assignedBy name a person on this database? ==='
SELECT 'LabsOnStore' AS source, COALESCE(NULLIF("assignedBy",''),'(blank)') AS assigned_by,
       count(*) AS rows, count(DISTINCT "labId") AS labs, max("assignedAt")::date AS latest
FROM src."LabsOnStore" GROUP BY 1,2
UNION ALL
SELECT 'PackagesOnLab', COALESCE(NULLIF("assignedBy",''),'(blank)'),
       count(*), count(DISTINCT "labId"), max("assignedAt")::date
FROM src."PackagesOnLab" GROUP BY 1,2
ORDER BY 1, 3 DESC;

\echo ''
\echo '=== A. Lab rows created in the last 30 days ==='
SELECT l.id,
       l."labName",
       l.city, l.state,
       c."chainName"                            AS chain,
       l."createdAt"::date                      AS created,
       l.active,
       l."homeCollection",
       l."centerVisit",
       l."apiProvider",
       l."vendorCode",
       cardinality(l."pincodesServiced")        AS pincodes_claimed,
       l."mouStartDate"::date                   AS mou_start,
       NULLIF(l."internalNotes",'')             AS internal_notes,
       l.pocs                                   AS lab_contacts
FROM src."Lab" l
LEFT JOIN src."Chain" c ON c.id = l.chain_id
WHERE l."createdAt" >= now() - interval '30 days'
ORDER BY l."createdAt" DESC;

\echo ''
\echo '=== B. Labs first mapped to a store in the last 30 days (who, and to which stores) ==='
WITH first_map AS (
  SELECT "labId", min("assignedAt") AS first_assigned
  FROM src."LabsOnStore" GROUP BY 1
)
SELECT l.id,
       l."labName",
       l.city, l.state,
       f.first_assigned::date                                   AS first_mapped,
       l."createdAt"::date                                      AS lab_created,
       count(*)                                                 AS stores,
       string_agg(DISTINCT COALESCE(NULLIF(los."assignedBy",''),'(blank)'), ', ') AS assigned_by,
       string_agg(DISTINCT s."storeName", ', ')                   AS store_names
FROM first_map f
JOIN src."Lab" l           ON l.id  = f."labId"
JOIN src."LabsOnStore" los ON los."labId" = f."labId"
LEFT JOIN src."Store" s    ON s.id  = los."storeId"
WHERE f.first_assigned >= now() - interval '30 days'
GROUP BY l.id, l."labName", l.city, l.state, f.first_assigned, l."createdAt"
ORDER BY f.first_assigned DESC;

\echo ''
\echo '=== C. Labs that first got a price list in the last 30 days ==='
WITH first_pkg AS (
  SELECT "labId", min("assignedAt") AS first_priced, count(*) AS packages
  FROM src."PackagesOnLab" GROUP BY 1
)
SELECT l.id,
       l."labName",
       l.city, l.state,
       p.first_priced::date                                     AS first_priced,
       p.packages,
       string_agg(DISTINCT COALESCE(NULLIF(pol."assignedBy",''),'(blank)'), ', ') AS assigned_by
FROM first_pkg p
JOIN src."Lab" l            ON l.id = p."labId"
JOIN src."PackagesOnLab" pol ON pol."labId" = p."labId"
WHERE p.first_priced >= now() - interval '30 days'
GROUP BY l.id, l."labName", l.city, l.state, p.first_priced, p.packages
ORDER BY p.first_priced DESC;

\echo ''
\echo '=== D. Monthly trend, so 30 days has context ==='
SELECT to_char("createdAt",'YYYY-MM') AS month, count(*) AS labs_created
FROM src."Lab"
WHERE "createdAt" >= now() - interval '12 months'
GROUP BY 1 ORDER BY 1;
