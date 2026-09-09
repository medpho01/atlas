-- One CRM card per lab, however many commitments it fulfils.
--
-- atlas.close_commitment_to_crm() built its `allocated` set from
-- atlas.commitment, which has one row per REQUEST. A lab that fulfilled three
-- commitments therefore produced three identical provider rows in a single
-- statement — same name, same city, created_at identical to the microsecond,
-- differing only in the "Onboarded to fulfil request #N" note.
--
-- The NOT EXISTS guard could not catch it: a statement cannot see the rows it
-- is inserting. ON CONFLICT DO NOTHING could not either, because nothing was
-- unique. Both are fixed here — DISTINCT ON collapses the set to one row per
-- lab, and the partial unique index gives ON CONFLICT something real to hit,
-- so a second poller run can never re-create the row.
--
-- Run sql/crm-merge-duplicate-providers.sql FIRST: the index cannot be built
-- while duplicates are still in the table.

\set ON_ERROR_STOP on

DO $guard$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM (
    SELECT source_lab_id FROM atlas.crm_providers
    WHERE source_lab_id IS NOT NULL
    GROUP BY source_lab_id HAVING COUNT(*) > 1
  ) x;
  IF n > 0 THEN
    RAISE EXCEPTION
      'still % lab(s) with more than one CRM row — run sql/crm-merge-duplicate-providers.sql -v apply=1 first', n;
  END IF;
END
$guard$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_providers_source_lab
  ON atlas.crm_providers (source_lab_id)
  WHERE source_lab_id IS NOT NULL;

CREATE OR REPLACE FUNCTION atlas.close_commitment_to_crm()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  WITH allocated AS (
    -- One row per LAB, not per commitment. Without this a lab that fulfilled
    -- several requests was inserted once per request, and no guard inside the
    -- statement could see the copies it was making.
    SELECT DISTINCT ON (cm.allocated_lab_id)
           cm.id, cm.allocated_lab_id, cm.attributed_to, cm.request_id,
           l."labName", l.city, l.state, l.pincode
    FROM atlas.commitment cm
    JOIN src_local."Lab" l ON l.id = cm.allocated_lab_id
    WHERE cm.outcome = 'allocated'
      AND cm.allocated_lab_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM atlas.crm_providers cp WHERE cp.source_lab_id = cm.allocated_lab_id
      )
    -- The earliest request is the one that actually earned the relationship.
    ORDER BY cm.allocated_lab_id, cm.request_id
  ),
  ins AS (
    INSERT INTO atlas.crm_providers
      (name, kind, city, state, pincode, source, source_lab_id, created_by, notes)
    SELECT a."labName", 'LAB', a.city, a.state, a.pincode,
           'commitment', a.allocated_lab_id, a.attributed_to,
           'Onboarded to fulfil request #' || a.request_id
    FROM allocated a
    ON CONFLICT (source_lab_id) WHERE source_lab_id IS NOT NULL DO NOTHING
    RETURNING source_lab_id
  )
  SELECT COUNT(*)::int INTO n FROM ins;

  UPDATE atlas.commitment cm
     SET notes = COALESCE(cm.notes, '') ||
                 CASE WHEN cm.notes IS NULL THEN '' ELSE ' · ' END ||
                 'CRM provider #' || cp.id,
         updated_at = now()
  FROM atlas.crm_providers cp
  WHERE cp.source_lab_id = cm.allocated_lab_id
    AND cm.outcome = 'allocated'
    AND COALESCE(cm.notes, '') NOT LIKE '%CRM provider #%';

  RETURN n;
END $$;

\echo 'close_commitment_to_crm() now inserts one row per lab.'
