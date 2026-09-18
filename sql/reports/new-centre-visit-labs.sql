-- ---------------------------------------------------------------------------
-- Centre-visit labs onboarded recently, with their pincodes and packages.
--
--   docker exec -i atlas-db psql -U atlas -d atlas -f - < sql/reports/new-centre-visit-labs.sql
--
-- Window defaults to 3 months; change it with -v months=6.
-- Section B is the one to export — one row per lab per package.
--
-- Vocabulary, because the source uses three words for two things:
--
--   * A row in "Lab" IS a centre. A branch of a chain is its own Lab row with
--     its own address and pincode, which is why section C rolls them up by
--     chain — 12 Suburban Diagnostics branches are 12 labs and one brand.
--   * "centerVisit" means the patient goes to them. "homeCollection" means a
--     phlebo goes out. A centre can do both; most do only the first.
--   * A centre's OWN pincode is where it stands. "pincodesServiced" is the
--     list it will collect from at home, and is empty for most centre-visit
--     labs — an empty list there is not missing data.
--
-- And one thing that will otherwise mislead: a package assigned to a lab
-- ("PackagesOnLab") is not necessarily orderable at a centre. The package
-- itself carries "orderTypes", and centre_visit_ok is whether CENTER_VISIT is
-- among them. A lab with 20 packages of which 4 are centre-visit can serve
-- four things to somebody walking in.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
\if :{?months} \else \set months 3 \endif

\echo ''
\echo '== A · the labs, one row each ========================================'
SELECT l.id                                        AS lab_id,
       l."labName",
       ch.chain_name,
       l."centerType",
       initcap(trim(l.city))                       AS city,
       l.pincode                                   AS centre_pincode,
       l."createdAt"::date                         AS added,
       cardinality(COALESCE(l."pincodesServiced", ARRAY[]::text[])) AS home_pincodes,
       count(pol."packageId")::int                 AS packages,
       count(*) FILTER (WHERE 'CENTER_VISIT' = ANY(p."orderTypes"::text[]))::int
                                                   AS centre_visit_packages,
       -- Enough of the list to recognise it without opening a second query.
       left(string_agg(p."packageName", ', ' ORDER BY p."packageName"), 120) AS package_sample,
       concat_ws(', ',
         CASE WHEN (l."labFacilities"->>'CT')::bool   THEN 'CT' END,
         CASE WHEN (l."labFacilities"->>'MRI')::bool  THEN 'MRI' END,
         CASE WHEN (l."labFacilities"->>'USG')::bool  THEN 'USG' END,
         CASE WHEN (l."labFacilities"->>'XRay')::bool THEN 'X-ray' END) AS imaging
FROM src_local."Lab" l
LEFT JOIN analytics.mv_chain_summary ch  ON ch.chain_id = l.chain_id
LEFT JOIN src_local."PackagesOnLab" pol  ON pol."labId" = l.id
LEFT JOIN src_local."Package" p          ON p.id = pol."packageId"
WHERE l.active
  AND l."centerVisit"
  AND l."createdAt" >= now() - make_interval(months => :months)
GROUP BY l.id, l."labName", ch.chain_name, l."centerType", l.city, l.pincode,
         l."createdAt", l."pincodesServiced", l."labFacilities"
ORDER BY l."createdAt" DESC, l."labName";

\echo ''
\echo '== B · one row per lab per package (the export) ======================'
SELECT l.id                AS lab_id,
       l."labName",
       ch.chain_name,
       initcap(trim(l.city)) AS city,
       l.pincode           AS centre_pincode,
       l."createdAt"::date AS lab_added,
       p.id                AS package_id,
       p."lsId"            AS ls_id,
       p."packageName",
       pol."labPackageName" AS lab_calls_it,
       'CENTER_VISIT' = ANY(p."orderTypes"::text[]) AS centre_visit_ok,
       pol."labCost",
       pol."labMrp",
       pol."createdAt"::date AS package_added
FROM src_local."Lab" l
JOIN src_local."PackagesOnLab" pol ON pol."labId" = l.id
JOIN src_local."Package" p         ON p.id = pol."packageId"
LEFT JOIN analytics.mv_chain_summary ch ON ch.chain_id = l.chain_id
WHERE l.active
  AND l."centerVisit"
  AND l."createdAt" >= now() - make_interval(months => :months)
  -- Only what somebody could actually book by walking in:
  -- AND 'CENTER_VISIT' = ANY(p."orderTypes"::text[])
ORDER BY l."createdAt" DESC, l."labName", p."packageName";

\echo ''
\echo '== C · rolled up by chain ============================================'
SELECT COALESCE(ch.chain_name, '(independent)')     AS chain,
       count(*)                                     AS centres_added,
       count(DISTINCT l.pincode)                    AS pincodes,
       count(DISTINCT initcap(trim(l.city)))        AS cities,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM src_local."PackagesOnLab" pol WHERE pol."labId" = l.id))
                                                    AS with_packages,
       min(l."createdAt")::date                     AS first_added,
       max(l."createdAt")::date                     AS last_added
FROM src_local."Lab" l
LEFT JOIN analytics.mv_chain_summary ch ON ch.chain_id = l.chain_id
WHERE l.active
  AND l."centerVisit"
  AND l."createdAt" >= now() - make_interval(months => :months)
GROUP BY 1
ORDER BY centres_added DESC, chain;
