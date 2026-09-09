-- Merge duplicate CRM provider records into one card per organisation.
--
-- Two rows for one hospital split its history: the notes are on one card, the
-- documents on another, and neither reads like the whole story. This folds a
-- duplicate group onto its oldest member, moving every activity, document and
-- thread membership across, and concatenating the notes field so nothing
-- written by hand is lost.
--
--   Dry run (default) — prints what it WOULD merge, changes nothing:
--     psql ... -f sql/crm-merge-duplicate-providers.sql
--   Apply:
--     psql ... -v apply=1 -f sql/crm-merge-duplicate-providers.sql
--
-- Grouping key is the provider name, lowercased, with punctuation and runs of
-- whitespace normalised — "Apollo Hospitals Pvt. Ltd." and "Apollo Hospitals
-- Pvt Ltd" are the same organisation. City is NOT part of the key: the same
-- chain in two cities is genuinely two cards, so a group is only merged when
-- its members agree on city or leave it blank.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif

BEGIN;

CREATE TEMP TABLE dup_groups ON COMMIT DROP AS
WITH normalised AS (
  SELECT id, name, city,
         -- btrim AFTER the substitution too: a trailing "Ltd." leaves a space
         -- where the period was, which would split the group it belongs to.
         btrim(regexp_replace(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g'),
                              '\s+', ' ', 'g')) AS key,
         nullif(lower(btrim(coalesce(city, ''))), '') AS city_key
  FROM atlas.crm_providers
),
grouped AS (
  SELECT key,
         COUNT(*) AS members,
         COUNT(DISTINCT city_key) AS distinct_cities,
         MIN(id) AS keep_id,
         array_agg(id ORDER BY id) AS ids
  FROM normalised
  GROUP BY key
  HAVING COUNT(*) > 1
)
-- Only groups that describe one place. A chain listed in three cities keeps
-- its three cards.
SELECT key, keep_id, members, ids
FROM grouped
WHERE distinct_cities <= 1;

\echo ''
\echo '--- duplicate groups found:'
SELECT g.key AS normalised_name,
       g.keep_id,
       g.members,
       (SELECT string_agg(p.name || ' (#' || p.id || ')', ' | ' ORDER BY p.id)
          FROM atlas.crm_providers p WHERE p.id = ANY(g.ids)) AS records
FROM dup_groups g
ORDER BY g.members DESC, g.key
LIMIT 200;

SELECT COUNT(*) AS groups,
       COALESCE(SUM(members) - COUNT(*), 0) AS records_to_remove
FROM dup_groups;

\if :apply

-- Notes live on the provider row, so they have to be concatenated rather than
-- repointed. Ordered by id to keep the oldest first.
UPDATE atlas.crm_providers k
SET notes = sub.merged, updated_at = now()
FROM (
  SELECT g.keep_id,
         string_agg(p.notes, E'\n\n' ORDER BY p.id) AS merged
  FROM dup_groups g
  JOIN atlas.crm_providers p ON p.id = ANY(g.ids)
  WHERE p.notes IS NOT NULL AND btrim(p.notes) <> ''
  GROUP BY g.keep_id
) sub
WHERE k.id = sub.keep_id
  AND sub.merged IS DISTINCT FROM k.notes;

-- Fill any contact detail the surviving card is missing from its duplicates,
-- rather than losing a phone number someone typed on the second copy.
UPDATE atlas.crm_providers k
SET city           = COALESCE(k.city,           s.city),
    state          = COALESCE(k.state,          s.state),
    pincode        = COALESCE(k.pincode,        s.pincode),
    phone          = COALESCE(k.phone,          s.phone),
    email          = COALESCE(k.email,          s.email),
    contact_person = COALESCE(k.contact_person, s.contact_person),
    source_lab_id  = COALESCE(k.source_lab_id,  s.source_lab_id),
    updated_at     = now()
FROM (
  SELECT g.keep_id,
         (array_remove(array_agg(p.city           ORDER BY p.id), NULL))[1] AS city,
         (array_remove(array_agg(p.state          ORDER BY p.id), NULL))[1] AS state,
         (array_remove(array_agg(p.pincode        ORDER BY p.id), NULL))[1] AS pincode,
         (array_remove(array_agg(p.phone          ORDER BY p.id), NULL))[1] AS phone,
         (array_remove(array_agg(p.email          ORDER BY p.id), NULL))[1] AS email,
         (array_remove(array_agg(p.contact_person ORDER BY p.id), NULL))[1] AS contact_person,
         (array_remove(array_agg(p.source_lab_id  ORDER BY p.id), NULL))[1] AS source_lab_id
  FROM dup_groups g
  JOIN atlas.crm_providers p ON p.id = ANY(g.ids) AND p.id <> g.keep_id
  GROUP BY g.keep_id
) s
WHERE k.id = s.keep_id;

-- History moves wholesale. Activities and docs have no uniqueness to fight.
UPDATE atlas.crm_activities a
SET provider_id = g.keep_id
FROM dup_groups g
WHERE a.provider_id = ANY(g.ids) AND a.provider_id <> g.keep_id;

UPDATE atlas.crm_provider_docs d
SET provider_id = g.keep_id
FROM dup_groups g
WHERE d.provider_id = ANY(g.ids) AND d.provider_id <> g.keep_id;

-- Thread membership is UNIQUE (thread_id, provider_id), so repoint only where
-- the survivor is not already in that thread; the rest are redundant rows and
-- the delete below removes them with their provider. Keep the more advanced
-- stage when both exist, so a merge never walks a provider backwards.
UPDATE atlas.crm_thread_providers keep
SET stage_key  = dupe.stage_key,
    assignee_id = COALESCE(keep.assignee_id, dupe.assignee_id),
    updated_at = now()
FROM dup_groups g
JOIN atlas.crm_thread_providers dupe
  ON dupe.provider_id = ANY(g.ids) AND dupe.provider_id <> g.keep_id
JOIN atlas.crm_funnels f ON TRUE
JOIN atlas.crm_threads t ON t.id = dupe.thread_id AND t.funnel_id = f.id
WHERE keep.provider_id = g.keep_id
  AND keep.thread_id = dupe.thread_id
  AND COALESCE(array_position(ARRAY(SELECT jsonb_array_elements(f.stages) ->> 'key'), dupe.stage_key), 0)
    > COALESCE(array_position(ARRAY(SELECT jsonb_array_elements(f.stages) ->> 'key'), keep.stage_key), 0);

UPDATE atlas.crm_thread_providers tp
SET provider_id = g.keep_id, updated_at = now()
FROM dup_groups g
WHERE tp.provider_id = ANY(g.ids)
  AND tp.provider_id <> g.keep_id
  AND NOT EXISTS (
    SELECT 1 FROM atlas.crm_thread_providers x
    WHERE x.thread_id = tp.thread_id AND x.provider_id = g.keep_id);

-- Anything left pointing at a duplicate is now redundant. ON DELETE CASCADE
-- clears the leftover thread rows.
DELETE FROM atlas.crm_providers p
USING dup_groups g
WHERE p.id = ANY(g.ids) AND p.id <> g.keep_id;

\echo ''
\echo '--- merged. remaining duplicate groups (should be none):'
WITH normalised AS (
  SELECT btrim(regexp_replace(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g'),
                              '\s+', ' ', 'g')) AS key,
         nullif(lower(btrim(coalesce(city, ''))), '') AS city_key
  FROM atlas.crm_providers
)
SELECT COUNT(*) AS still_duplicated
FROM (SELECT key FROM normalised GROUP BY key
      HAVING COUNT(*) > 1 AND COUNT(DISTINCT city_key) <= 1) x;

COMMIT;
\else
\echo ''
\echo '--- DRY RUN. Nothing changed. Re-run with  -v apply=1  to merge.'
ROLLBACK;
\endif
