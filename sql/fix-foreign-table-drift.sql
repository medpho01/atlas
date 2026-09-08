-- Repair foreign tables whose definition has drifted from the source.
--
-- When the source DROPS or RENAMES a column, Atlas's foreign table keeps
-- listing it and every full-width read fails against the source with
--     ERROR: column "x" does not exist
--     CONTEXT: remote SQL command: SELECT ... FROM public."Lab"
-- while count(*) still works, because postgres_fdw only sends the columns a
-- query actually needs. That asymmetry is why this hides: the table looks
-- alive, and only the nightly snapshot copy — which reads every column — dies.
--
-- The existing self-heal drops and re-imports the foreign table, which fails
-- whenever anything depends on it, and then skips the repair. This reconciles
-- the columns IN PLACE instead, so dependent views are never touched.
--
-- Read-only against the source. Safe to re-run.

\set ON_ERROR_STOP on

DO $fix$
DECLARE
  t          text;
  col        record;
  probe_name text;
  n_dropped  int := 0;
  n_added    int := 0;
BEGIN
  -- A scratch schema holding what the source looks like TODAY.
  DROP SCHEMA IF EXISTS src_probe CASCADE;
  CREATE SCHEMA src_probe;

  FOREACH t IN ARRAY ARRAY[
    'Chain','ProviderType','Pharmacy','Store','PincodeToLatLong','Lab','Provider',
    'Profile','User','Request','Order','Appointment','PharmaOrder','Master','DOS',
    'Package','PackagesOnLab','PackagesOnStore','LabsOnStore','_MasterToPackage'
  ] LOOP
    IF to_regclass(format('src.%I', t)) IS NULL THEN CONTINUE; END IF;

    BEGIN
      EXECUTE format(
        'IMPORT FOREIGN SCHEMA public LIMIT TO (%I) FROM SERVER labstack_src INTO src_probe', t);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'could not probe %: %', t, SQLERRM;
      CONTINUE;
    END;

    -- In src but gone from the source -> drop it, this is what breaks reads.
    FOR col IN
      SELECT a.attname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'src' AND c.relname = t AND a.attnum > 0 AND NOT a.attisdropped
        AND NOT EXISTS (
          SELECT 1 FROM pg_attribute a2
          JOIN pg_class c2 ON c2.oid = a2.attrelid
          JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
          WHERE n2.nspname = 'src_probe' AND c2.relname = t
            AND a2.attname = a.attname AND a2.attnum > 0 AND NOT a2.attisdropped)
    LOOP
      EXECUTE format('ALTER FOREIGN TABLE src.%I DROP COLUMN %I', t, col.attname);
      RAISE NOTICE 'src.%: dropped stale column %', t, col.attname;
      n_dropped := n_dropped + 1;
    END LOOP;

    -- New on the source -> add it, so the snapshot picks the data up.
    FOR col IN
      SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS ftype
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'src_probe' AND c.relname = t AND a.attnum > 0 AND NOT a.attisdropped
        AND NOT EXISTS (
          SELECT 1 FROM pg_attribute a2
          JOIN pg_class c2 ON c2.oid = a2.attrelid
          JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
          WHERE n2.nspname = 'src' AND c2.relname = t
            AND a2.attname = a.attname AND a2.attnum > 0 AND NOT a2.attisdropped)
    LOOP
      EXECUTE format('ALTER FOREIGN TABLE src.%I ADD COLUMN %I %s', t, col.attname, col.ftype);
      RAISE NOTICE 'src.%: added new column % %', t, col.attname, col.ftype;
      n_added := n_added + 1;
    END LOOP;

    -- The snapshot must be able to receive whatever src now carries.
    IF to_regclass(format('src_local.%I', t)) IS NOT NULL THEN
      FOR col IN
        SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS ftype
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'src' AND c.relname = t AND a.attnum > 0 AND NOT a.attisdropped
          AND NOT EXISTS (
            SELECT 1 FROM pg_attribute a2
            JOIN pg_class c2 ON c2.oid = a2.attrelid
            JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
            WHERE n2.nspname = 'src_local' AND c2.relname = t
              AND a2.attname = a.attname AND a2.attnum > 0 AND NOT a2.attisdropped)
      LOOP
        EXECUTE format('ALTER TABLE src_local.%I ADD COLUMN %I %s', t, col.attname, col.ftype);
        RAISE NOTICE 'src_local.%: added column %', t, col.attname;
      END LOOP;
    END IF;
  END LOOP;

  DROP SCHEMA IF EXISTS src_probe CASCADE;
  RAISE NOTICE 'drift repair done: % stale columns dropped, % new columns added', n_dropped, n_added;
END
$fix$;

\echo ''
\echo '--- verifying every foreign table now survives a full-width read:'
DO $verify$
DECLARE t text; bad text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY['Chain','ProviderType','Pharmacy','Store','PincodeToLatLong',
    'Lab','Provider','Profile','User','Request','Master','DOS','Package','PackagesOnLab',
    'PackagesOnStore','LabsOnStore'] LOOP
    IF to_regclass(format('src.%I', t)) IS NULL THEN CONTINUE; END IF;
    BEGIN
      EXECUTE format('SELECT * FROM src.%I LIMIT 1', t);
    EXCEPTION WHEN OTHERS THEN
      bad := bad || t || ' (' || SQLERRM || '); ';
    END;
  END LOOP;
  IF bad = '' THEN RAISE NOTICE 'all foreign tables readable';
  ELSE RAISE WARNING 'still failing: %', bad; END IF;
END
$verify$;
