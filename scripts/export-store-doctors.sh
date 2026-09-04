#!/usr/bin/env bash
# Export every provider attached to a store, with everything the source holds
# about them, as CSV.
#
#   ./scripts/export-store-doctors.sh 117            > store-117-doctors.csv
#   ./scripts/export-store-doctors.sh 117 Doctor     > store-117-doctors.csv
#
# Providers reach a store two ways — attached directly (ProvidersOnStore) or
# through a provider group the store subscribes to — and the console shows
# both, so both are included and the `attached_via` column says which.
#
# Read-only. Runs inside the atlas-db container, so no local psql is needed.
set -euo pipefail

STORE="${1:?usage: export-store-doctors.sh <storeId> [providerType]}"
TYPE="${2:-}"

case "$STORE" in ''|*[!0-9]*) echo "storeId must be a number" >&2; exit 1;; esac

TYPE_FILTER=""
if [ -n "$TYPE" ]; then
  TYPE_ESCAPED=$(printf "%s" "$TYPE" | sed "s/'/''/g")
  TYPE_FILTER="AND pt.\"typeName\" = '${TYPE_ESCAPED}'"
fi

docker compose exec -T atlas-db psql -q -U atlas -d atlas --csv -v ON_ERROR_STOP=1 <<SQL
SET statement_timeout = '300s';

-- These are rarely queried, so they may not be in src yet. Importing only
-- touches Atlas's own catalog; the source database is never written to.
DO \$boot\$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ProvidersOnStore','ProviderGroupsOnStore','_ProviderToProviderGroup',
                           'ProviderGroup','Speciality','_ProviderToSpeciality','SubSpeciality',
                           '_ProviderToSubSpeciality','MDMLanguage','_MDMLanguageToProvider',
                           'SlotConfig','ProviderMetadata'] LOOP
    IF to_regclass(format('src.%I', t)) IS NULL THEN
      BEGIN
        EXECUTE format('IMPORT FOREIGN SCHEMA public LIMIT TO (%I) FROM SERVER labstack_src INTO src', t);
      EXCEPTION WHEN OTHERS THEN RAISE WARNING 'src.% unavailable: %', t, SQLERRM;
      END;
    END IF;
  END LOOP;
END \$boot\$;

WITH direct AS (
  SELECT "providerId" AS id, 'direct'::text AS via, "createdAt" AS linked_at
  FROM src."ProvidersOnStore" WHERE "storeId" = ${STORE}
),
via_group AS (
  SELECT pg."A" AS id, 'group: ' || g.name AS via, gs."createdAt" AS linked_at
  FROM src."ProviderGroupsOnStore" gs
  JOIN src."ProviderGroup" g          ON g.id = gs."providerGroupId"
  JOIN src."_ProviderToProviderGroup" pg ON pg."B" = g.id
  WHERE gs."storeId" = ${STORE}
),
linked AS (
  SELECT id, string_agg(DISTINCT via, '; ') AS attached_via, min(linked_at) AS linked_at
  FROM (SELECT * FROM direct UNION ALL SELECT * FROM via_group) u
  GROUP BY id
)
SELECT
  p.id                                                        AS provider_id,
  p.name,
  pt."typeName"                                               AS provider_type,
  l.attached_via,
  l.linked_at::date                                           AS attached_on,
  p.mobile,
  p.email,
  p.gender,
  p.about,
  p."registrationNum"                                         AS registration_no,
  p."registrationBody"                                        AS registration_body,
  p."isVerified"                                              AS verified,
  p."verificationLink"                                        AS verification_link,
  p."experienceStart"                                         AS experience_start,
  date_part('year', age(now(), p."experienceStart"))::int      AS years_experience,
  p."profileUrl"                                              AS profile_url,
  p."unitFloorBuilding"                                       AS address_line_1,
  p.address,
  p.locality,
  p.city,
  p.state,
  p.pincode,
  p.latitude,
  p.longitude,
  (SELECT string_agg(DISTINCT s.name, '; ' ORDER BY s.name)
     FROM src."_ProviderToSpeciality" ps JOIN src."Speciality" s ON s.id = ps."B"
    WHERE ps."A" = p.id)                                      AS specialities,
  (SELECT string_agg(DISTINCT ss.name, '; ' ORDER BY ss.name)
     FROM src."_ProviderToSubSpeciality" pss JOIN src."SubSpeciality" ss ON ss.id = pss."B"
    WHERE pss."A" = p.id)                                     AS sub_specialities,
  (SELECT string_agg(DISTINCT ml.name, '; ' ORDER BY ml.name)
     FROM src."_MDMLanguageToProvider" mp JOIN src."MDMLanguage" ml ON ml.id = mp."A"
    WHERE mp."B" = p.id)                                      AS languages,
  (SELECT string_agg(DISTINCT g2.name, '; ' ORDER BY g2.name)
     FROM src."_ProviderToProviderGroup" pg2 JOIN src."ProviderGroup" g2 ON g2.id = pg2."B"
    WHERE pg2."A" = p.id)                                     AS provider_groups,
  (SELECT count(*) FROM src."SlotConfig" sc
    WHERE sc.provider_id = p.id AND sc."isActive")             AS active_slot_configs,
  (SELECT string_agg(sc."startTime" || '-' || sc."endTime", '; ' ORDER BY sc."startTime")
     FROM src."SlotConfig" sc WHERE sc.provider_id = p.id AND sc."isActive") AS slot_hours,
  p."sendEmailCommunication"                                  AS comms_email,
  p."sendWhatsAppCommunication"                               AS comms_whatsapp,
  p.main_store_id,
  p."userId"                                                  AS user_id,
  p."createdAt"                                               AS created_at,
  p."updatedAt"                                               AS updated_at
FROM linked l
JOIN src."Provider" p        ON p.id = l.id
LEFT JOIN src."ProviderType" pt ON pt.id = p."typeId"
WHERE TRUE ${TYPE_FILTER}
ORDER BY pt."typeName" NULLS LAST, p.name;
SQL
