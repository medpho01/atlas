#!/usr/bin/env bash
# Dump the speciality master to CSV.
#
#   ./sql/reports/specialities-export.sh            # writes into ./speciality-export-YYYY-MM-DD/
#   ./sql/reports/specialities-export.sh /tmp/out   # or wherever you say
#
# Runs inside the atlas-db container and reads src.* — the foreign tables that
# mirror the LabStack database. Read-only; nothing is written to the source.
set -euo pipefail

OUT="${1:-speciality-export-$(date +%F)}"
mkdir -p "$OUT"
PSQL=(docker compose exec -T atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1)

dump () {  # dump <filename> <sql>
  echo "  $1"
  "${PSQL[@]}" -c "\copy ($2) TO STDOUT WITH (FORMAT csv, HEADER true)" > "$OUT/$1"
}

echo "Writing to $OUT/"

dump specialities.csv "
SELECT s.id AS speciality_id, s.name AS speciality,
       COUNT(DISTINCT ss.id)::int  AS sub_specialities,
       COUNT(DISTINCT ps.\"A\")::int AS providers,
       (s.\"createdAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS created_on,
       (s.\"updatedAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS updated_on
FROM src.\"Speciality\" s
LEFT JOIN src.\"SubSpeciality\" ss ON ss.speciality_id = s.id
LEFT JOIN src.\"_ProviderToSpeciality\" ps ON ps.\"B\" = s.id
GROUP BY s.id, s.name, s.\"createdAt\", s.\"updatedAt\"
ORDER BY s.name"

dump sub-specialities.csv "
SELECT ss.id AS sub_speciality_id, ss.name AS sub_speciality,
       s.id AS speciality_id, s.name AS speciality,
       COUNT(DISTINCT pss.\"A\")::int AS providers,
       (ss.\"createdAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS created_on,
       (ss.\"updatedAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS updated_on
FROM src.\"SubSpeciality\" ss
JOIN src.\"Speciality\" s ON s.id = ss.speciality_id
LEFT JOIN src.\"_ProviderToSubSpeciality\" pss ON pss.\"B\" = ss.id
GROUP BY ss.id, ss.name, s.id, s.name, ss.\"createdAt\", ss.\"updatedAt\"
ORDER BY s.name, ss.name"

dump speciality-tree.csv "
SELECT s.id AS speciality_id, s.name AS speciality,
       ss.id AS sub_speciality_id, ss.name AS sub_speciality,
       CASE WHEN ss.id IS NULL THEN 'speciality' ELSE 'sub_speciality' END AS level,
       CASE WHEN ss.id IS NULL
            THEN (SELECT COUNT(*) FROM src.\"_ProviderToSpeciality\" y WHERE y.\"B\" = s.id)
            ELSE (SELECT COUNT(*) FROM src.\"_ProviderToSubSpeciality\" x WHERE x.\"B\" = ss.id)
       END::int AS providers
FROM src.\"Speciality\" s
LEFT JOIN src.\"SubSpeciality\" ss ON ss.speciality_id = s.id
ORDER BY s.name, ss.name NULLS FIRST"

dump provider-specialities.csv "
SELECT p.id AS provider_id, p.name AS provider, p.city, p.pincode,
       s.id AS speciality_id, s.name AS speciality,
       NULL::int AS sub_speciality_id, NULL::text AS sub_speciality, 'speciality' AS link
FROM src.\"_ProviderToSpeciality\" ps
JOIN src.\"Provider\" p   ON p.id = ps.\"A\"
JOIN src.\"Speciality\" s ON s.id = ps.\"B\"
UNION ALL
SELECT p.id, p.name, p.city, p.pincode, s.id, s.name, ss.id, ss.name, 'sub_speciality'
FROM src.\"_ProviderToSubSpeciality\" pss
JOIN src.\"Provider\" p       ON p.id = pss.\"A\"
JOIN src.\"SubSpeciality\" ss ON ss.id = pss.\"B\"
JOIN src.\"Speciality\" s     ON s.id = ss.speciality_id
ORDER BY provider, speciality, sub_speciality NULLS FIRST"

dump unused-specialities.csv "
SELECT s.id AS speciality_id, s.name AS speciality,
       (s.\"createdAt\" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS created_on
FROM src.\"Speciality\" s
WHERE NOT EXISTS (SELECT 1 FROM src.\"_ProviderToSpeciality\" ps WHERE ps.\"B\" = s.id)
  AND NOT EXISTS (SELECT 1 FROM src.\"SubSpeciality\" ss WHERE ss.speciality_id = s.id)
ORDER BY s.name"

echo
for f in "$OUT"/*.csv; do
  printf '%-32s %6s rows\n' "$(basename "$f")" "$(( $(wc -l < "$f") - 1 ))"
done
