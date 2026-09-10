-- Retire the CRM provider types that the new list replaced.
--
-- The picker now offers eleven types, keyed as in lib/providerKinds.ts. Two of
-- the old values have no home in that list:
--
--   DIAGNOSTICS  → RADIOLOGY  (the old pair was LAB for pathology and
--                              DIAGNOSTICS for imaging; "Radiology centre" is
--                              what that second option now says)
--   OTHER        → left alone (nothing in the new list means "unclassified",
--                              and guessing a type for these is worse than a
--                              handful of cards reading "Other")
--
-- Anything the app already writes as LAB, HOSPITAL, CLINIC, COLLECTION_CENTRE,
-- PHARMACY, DOCTOR or PHLEBO keeps its key — those seven did not change.
--
-- Safe to run more than once. Run against atlas-db:
--   docker compose exec -T atlas-db psql -U atlas -d atlas -f - < sql/crm-provider-kinds.sql

\echo 'Before:'
SELECT kind, count(*) FROM atlas.crm_providers GROUP BY 1 ORDER BY 2 DESC;

UPDATE atlas.crm_providers
   SET kind = 'RADIOLOGY'
 WHERE upper(kind) IN ('DIAGNOSTICS', 'DIAGNOSTIC', 'IMAGING', 'RADIOLOGY_CENTRE');

UPDATE atlas.crm_threads
   SET provider_kind = 'RADIOLOGY'
 WHERE upper(provider_kind) IN ('DIAGNOSTICS', 'DIAGNOSTIC', 'IMAGING', 'RADIOLOGY_CENTRE');

-- Spelling drift from spreadsheet imports, folded into the keys the app writes.
UPDATE atlas.crm_providers
   SET kind = 'COLLECTION_CENTRE'
 WHERE upper(replace(kind, ' ', '_')) IN ('COLLECTION_CENTER', 'COLLECTION_POINT');

\echo 'After:'
SELECT kind, count(*) FROM atlas.crm_providers GROUP BY 1 ORDER BY 2 DESC;
