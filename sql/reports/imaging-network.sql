-- ---------------------------------------------------------------------------
-- The imaging network: how many centres, doing what, added when.
--
--   docker exec -i atlas-db psql -U atlas -d atlas -f - < sql/reports/imaging-network.sql
--
-- Read-only. Change the window with -v months=3 (default 4):
--
--   docker exec -i atlas-db psql -U atlas -d atlas -v months=6 -f - < sql/reports/imaging-network.sql
--
-- Where the numbers come from
-- ---------------------------
-- Lab."labFacilities" is a jsonb of booleans the console records per centre —
-- CT, MRI, USG, XRay, Mammogram, BMD, ECG, TMT, EMG, TwoDEcho, PapSmear. That
-- is the modality answer, and it is the one to trust.
--
-- Lab."centerVisit" is what "centre visit" means: the patient goes to them.
-- It is not the same as homeCollection, and a centre can be both.
--
-- Lab."createdAt" is when the centre was added to LabStack, which is as close
-- to "onboarded" as the data gets — there is no separate go-live date.
--
-- Two caveats worth knowing before quoting any of this:
--
--   * A modality flag is a claim, not a rate card. Only ~127 of the centres
--     have DOS rows (a priced test list) at all — query D is the subset you
--     can actually transact against.
--   * October 2025 shows ~1,250 centres "added". That is the initial bulk
--     load, not a month of onboarding. Read months since then.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
\if :{?months} \else \set months 4 \endif

\echo ''
\echo '== A · the network today ============================================='
SELECT count(*) FILTER (WHERE active)                       AS active_centres,
       count(*) FILTER (WHERE active AND "centerVisit")     AS centre_visit,
       count(*) FILTER (WHERE active AND "homeCollection")  AS home_collection,
       count(*) FILTER (WHERE active AND "centerVisit"
                          AND (("labFacilities"->>'CT')::bool
                            OR ("labFacilities"->>'MRI')::bool))  AS ct_or_mri,
       count(DISTINCT initcap(trim(city))) FILTER (WHERE active)  AS cities,
       count(DISTINCT pincode) FILTER (WHERE active)              AS pincodes
FROM src_local."Lab";

\echo ''
\echo '== B · centres by modality, and how many arrived in the window ======='
WITH f(key, label) AS (VALUES
  ('CT','CT'), ('MRI','MRI'), ('USG','Ultrasound'), ('XRay','X-ray'),
  ('Mammogram','Mammogram'), ('BMD','Bone density'), ('TwoDEcho','2D Echo'),
  ('TMT','TMT'), ('ECG','ECG'), ('EMG','EMG'), ('PapSmear','Pap smear'))
SELECT f.label AS modality,
       count(*) FILTER (WHERE has)                        AS centres,
       count(*) FILTER (WHERE has AND recent)             AS added_in_window,
       count(DISTINCT initcap(trim(l.city))) FILTER (WHERE has) AS cities
FROM src_local."Lab" l
CROSS JOIN f
CROSS JOIN LATERAL (SELECT
  COALESCE((l."labFacilities"->>f.key)::bool, false)                       AS has,
  l."createdAt" >= now() - make_interval(months => :months)                AS recent) x
WHERE l.active AND l."centerVisit"
GROUP BY f.label
ORDER BY centres DESC;

\echo ''
\echo '== C · centres added per month, last 12 months ======================='
SELECT to_char(m, 'Mon YYYY')  AS month,
       centres_added, with_ct, with_mri, with_usg, with_xray
FROM (
  SELECT date_trunc('month', l."createdAt")                      AS m,
         count(*)                                                AS centres_added,
         count(*) FILTER (WHERE (l."labFacilities"->>'CT')::bool)   AS with_ct,
         count(*) FILTER (WHERE (l."labFacilities"->>'MRI')::bool)  AS with_mri,
         count(*) FILTER (WHERE (l."labFacilities"->>'USG')::bool)  AS with_usg,
         count(*) FILTER (WHERE (l."labFacilities"->>'XRay')::bool) AS with_xray
  FROM src_local."Lab" l
  WHERE l.active AND l."centerVisit"
    AND l."createdAt" >= now() - interval '12 months'
  GROUP BY 1
) x
ORDER BY m DESC;

\echo ''
\echo '== D · priced imaging: rate-card lines added per month ==============='
-- DOS is the per-lab rate card. A centre can claim MRI in labFacilities and
-- still have no MRI line here, which is the difference between "they have the
-- machine" and "we can sell it".
SELECT to_char(m, 'Mon YYYY') AS month, labs, lines_added, ct_or_mri_lines
FROM (
  SELECT date_trunc('month', d."createdAt")   AS m,
         count(DISTINCT d.lab_id)             AS labs,
         count(*)                             AS lines_added,
         count(*) FILTER (WHERE m2.name ~* '(\mmri\M|\mct\M|ct scan)') AS ct_or_mri_lines
  FROM src_local."DOS" d
  JOIN src_local."Master" m2 ON m2.id = d.master_id
  WHERE d.active
    AND atlas.test_discipline(m2.name) = 'RADIOLOGY'
    AND d."createdAt" >= now() - interval '12 months'
  GROUP BY 1
) x
ORDER BY m DESC;

\echo ''
\echo '== E · every CT / MRI centre, newest first ==========================='
SELECT l.id, l."labName", initcap(trim(l.city)) AS city, l.pincode,
       l."createdAt"::date AS added,
       concat_ws(', ',
         CASE WHEN (l."labFacilities"->>'CT')::bool        THEN 'CT' END,
         CASE WHEN (l."labFacilities"->>'MRI')::bool       THEN 'MRI' END,
         CASE WHEN (l."labFacilities"->>'USG')::bool       THEN 'USG' END,
         CASE WHEN (l."labFacilities"->>'XRay')::bool      THEN 'X-ray' END,
         CASE WHEN (l."labFacilities"->>'Mammogram')::bool THEN 'Mammo' END) AS modalities,
       EXISTS (SELECT 1 FROM src_local."DOS" d WHERE d.lab_id = l.id AND d.active) AS has_rate_card
FROM src_local."Lab" l
WHERE l.active AND l."centerVisit"
  AND (("labFacilities"->>'CT')::bool OR ("labFacilities"->>'MRI')::bool)
ORDER BY l."createdAt" DESC;

\echo ''
\echo '== F · imaging reach by city ========================================='
-- City is free text in the source, so "Bengaluru" and "Bangalore" are two
-- rows unless they are folded. initcap(trim()) catches the casing; it does
-- not catch the spelling.
SELECT initcap(trim(l.city)) AS city,
       count(*)                                                   AS centres,
       count(*) FILTER (WHERE (l."labFacilities"->>'CT')::bool)   AS ct,
       count(*) FILTER (WHERE (l."labFacilities"->>'MRI')::bool)  AS mri,
       count(*) FILTER (WHERE (l."labFacilities"->>'USG')::bool)  AS usg,
       count(*) FILTER (WHERE (l."labFacilities"->>'XRay')::bool) AS xray
FROM src_local."Lab" l
WHERE l.active AND l."centerVisit"
  AND (("labFacilities"->>'CT')::bool OR ("labFacilities"->>'MRI')::bool
    OR ("labFacilities"->>'USG')::bool OR ("labFacilities"->>'XRay')::bool)
GROUP BY 1
ORDER BY centres DESC, ct DESC;
