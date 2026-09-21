-- ===========================================================================
-- specialities.sql — the speciality master, as the console holds it.
--
-- Four tables carry all of it:
--
--   "Speciality"                id, name
--   "SubSpeciality"             id, name, speciality_id  → its parent
--   "_ProviderToSpeciality"     A = Provider.id, B = Speciality.id
--   "_ProviderToSubSpeciality"  A = Provider.id, B = SubSpeciality.id
--
-- The two join tables are Prisma's implicit many-to-many, so the columns are
-- called A and B and the only way to know which is which is that Prisma orders
-- them alphabetically: Provider before Speciality. Verified, not assumed —
-- every A matches a Provider and every B a Speciality.
--
-- Read-only: src.* is the foreign-table view of the LabStack database and is
-- never written to.
--
-- Run the \copy commands in sql/reports/specialities-export.sh, or paste the
-- SELECTs below into psql to look at them first.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The master: one row per speciality, with what hangs off it.
-- ---------------------------------------------------------------------------
SELECT s.id                                         AS speciality_id,
       s.name                                       AS speciality,
       COUNT(DISTINCT ss.id)::int                   AS sub_specialities,
       COUNT(DISTINCT ps."A")::int                  AS providers,
       (s."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS created_on,
       (s."updatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS updated_on
FROM src."Speciality" s
LEFT JOIN src."SubSpeciality" ss        ON ss.speciality_id = s.id
LEFT JOIN src."_ProviderToSpeciality" ps ON ps."B" = s.id
GROUP BY s.id, s.name, s."createdAt", s."updatedAt"
ORDER BY s.name;

-- ---------------------------------------------------------------------------
-- 2. Sub-specialities, each under its parent.
-- ---------------------------------------------------------------------------
SELECT ss.id                                        AS sub_speciality_id,
       ss.name                                      AS sub_speciality,
       s.id                                         AS speciality_id,
       s.name                                       AS speciality,
       COUNT(DISTINCT pss."A")::int                 AS providers,
       (ss."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS created_on,
       (ss."updatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS updated_on
FROM src."SubSpeciality" ss
JOIN src."Speciality" s ON s.id = ss.speciality_id
LEFT JOIN src."_ProviderToSubSpeciality" pss ON pss."B" = ss.id
GROUP BY ss.id, ss.name, s.id, s.name, ss."createdAt", ss."updatedAt"
ORDER BY s.name, ss.name;

-- ---------------------------------------------------------------------------
-- 3. Every speciality and sub-speciality in one flat list.
--
-- A speciality with no sub-specialities still appears, with the sub columns
-- blank — otherwise the twenty-odd that have none would vanish from the file
-- that is meant to be the whole master.
--
-- The provider count is a CASE, not a COALESCE. COUNT(*) over no rows is 0,
-- not NULL, so a COALESCE never falls through: every speciality without a
-- sub-speciality reported zero providers while plainly having some.
-- ---------------------------------------------------------------------------
SELECT s.id                      AS speciality_id,
       s.name                    AS speciality,
       ss.id                     AS sub_speciality_id,
       ss.name                   AS sub_speciality,
       CASE WHEN ss.id IS NULL THEN 'speciality' ELSE 'sub_speciality' END AS level,
       CASE WHEN ss.id IS NULL
            THEN (SELECT COUNT(*) FROM src."_ProviderToSpeciality"    y WHERE y."B" = s.id)
            ELSE (SELECT COUNT(*) FROM src."_ProviderToSubSpeciality" x WHERE x."B" = ss.id)
       END::int                  AS providers
FROM src."Speciality" s
LEFT JOIN src."SubSpeciality" ss ON ss.speciality_id = s.id
ORDER BY s.name, ss.name NULLS FIRST;

-- ---------------------------------------------------------------------------
-- 4. The mapping: which provider is tagged with what.
--
-- Both links in one file, because a provider can carry a speciality directly
-- and a sub-speciality of another, and two files would hide that.
-- ---------------------------------------------------------------------------
SELECT p.id                      AS provider_id,
       p.name                    AS provider,
       p.city,
       p.pincode,
       s.id                      AS speciality_id,
       s.name                    AS speciality,
       NULL::int                 AS sub_speciality_id,
       NULL::text                AS sub_speciality,
       'speciality'              AS link
FROM src."_ProviderToSpeciality" ps
JOIN src."Provider" p    ON p.id = ps."A"
JOIN src."Speciality" s  ON s.id = ps."B"
UNION ALL
SELECT p.id, p.name, p.city, p.pincode,
       s.id, s.name, ss.id, ss.name, 'sub_speciality'
FROM src."_ProviderToSubSpeciality" pss
JOIN src."Provider" p       ON p.id = pss."A"
JOIN src."SubSpeciality" ss ON ss.id = pss."B"
JOIN src."Speciality" s     ON s.id = ss.speciality_id
ORDER BY provider, speciality, sub_speciality NULLS FIRST;

-- ---------------------------------------------------------------------------
-- 5. Specialities nobody is tagged with — the part of a master that has gone
--    stale, which is the usual reason for pulling one.
-- ---------------------------------------------------------------------------
SELECT s.id AS speciality_id, s.name AS speciality,
       (s."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS created_on
FROM src."Speciality" s
WHERE NOT EXISTS (SELECT 1 FROM src."_ProviderToSpeciality" ps WHERE ps."B" = s.id)
  AND NOT EXISTS (SELECT 1 FROM src."SubSpeciality" ss WHERE ss.speciality_id = s.id)
ORDER BY s.name;
