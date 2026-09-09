-- Point analytics.mv_pincode_geo at atlas.pincode_geo.
--
-- The view cannot be redefined in place, and five materialized views depend on
-- it, so this captures their definitions and indexes FROM THE DATABASE, drops
-- the lot, rebuilds the base view, then restores them. Reading the DDL from
-- pg_matviews rather than transcribing it means the restored views are exactly
-- what was running, whatever state this environment is in.
--
-- Idempotent and transactional: if anything fails, nothing changes.

\set ON_ERROR_STOP on

-- Resolve coordinates FIRST.
--
-- This view reads atlas.pincode_geo, and the prefix fallbacks are averages of
-- what is in it — so if it is empty, every pincode resolves to 'none' and the
-- dependent views are rebuilt against nothing. Centre-visit reach silently
-- becomes zero and the map goes blank, with no error anywhere, which is
-- exactly what happened when the refresh that populates it ran from an image
-- that did not yet have the step. Idempotent, so running it here costs a
-- minute and removes the ordering trap entirely.
SELECT * FROM atlas.rebuild_pincode_geo();

DO $check$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM atlas.pincode_geo;
  IF n = 0 THEN
    RAISE EXCEPTION 'atlas.pincode_geo is empty after a rebuild — refusing to swap the view, '
                    'because every pincode would resolve to no coordinates at all. '
                    'Check that src_local."PincodeToLatLong" has been copied by a refresh.';
  END IF;
  RAISE NOTICE 'atlas.pincode_geo holds % located pincodes', n;
END
$check$;

BEGIN;

CREATE TEMP TABLE _saved AS
WITH RECURSIVE deps AS (
  SELECT c.oid, 0 AS depth
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'analytics' AND c.relname = 'mv_pincode_geo'
  UNION
  SELECT dv.oid, d2.depth + 1
  FROM deps d2
  JOIN pg_depend dep ON dep.refobjid = d2.oid
  JOIN pg_rewrite rw ON rw.oid = dep.objid
  JOIN pg_class dv ON dv.oid = rw.ev_class AND dv.oid <> d2.oid
  WHERE dv.relkind = 'm'
)
SELECT n.nspname AS schema, c.relname AS name, MAX(d.depth) AS depth,
       pg_get_viewdef(c.oid, true) AS def
FROM deps d
JOIN pg_class c ON c.oid = d.oid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname <> 'mv_pincode_geo'
GROUP BY 1, 2, c.oid;

CREATE TEMP TABLE _saved_idx AS
SELECT i.schemaname AS schema, i.tablename AS name, i.indexdef
FROM pg_indexes i
WHERE (i.schemaname, i.tablename) IN (SELECT schema, name FROM _saved)
   OR (i.schemaname = 'analytics' AND i.tablename = 'mv_pincode_geo');

\echo '--- dependents captured:'
SELECT depth, schema || '.' || name AS view FROM _saved ORDER BY depth, name;

DROP MATERIALIZED VIEW analytics.mv_pincode_geo CASCADE;

-- The new base view.
--
-- Real coordinates come from atlas.pincode_geo, which resolves LabStack's own
-- table, imported datasets and positions observed in real addresses, keeping
-- track of which. The prefix fallbacks stay, because a map with holes in it is
-- worse than a map with approximate dots — but they are now labelled for what
-- they are, and anything measuring distance uses geo_source = 'exact' only.
CREATE MATERIALIZED VIEW analytics.mv_pincode_geo AS
WITH real_geo AS (
  SELECT pincode, latitude, longitude, provenance FROM atlas.pincode_geo
),
prefix3 AS (
  SELECT substring(pincode, 1, 3) AS prefix, avg(latitude) lat, avg(longitude) lng
  FROM real_geo WHERE pincode ~ '^[0-9]{6}$' GROUP BY 1
),
prefix2 AS (
  SELECT substring(pincode, 1, 2) AS prefix, avg(latitude) lat, avg(longitude) lng
  FROM real_geo WHERE pincode ~ '^[0-9]{6}$' GROUP BY 1
),
all_pincodes AS (SELECT pincode FROM analytics.mv_pincode_summary)
SELECT ap.pincode,
       COALESCE(r.latitude,  p3.lat, p2.lat) AS latitude,
       COALESCE(r.longitude, p3.lng, p2.lng) AS longitude,
       CASE WHEN r.pincode IS NOT NULL THEN 'exact'
            WHEN p3.lat  IS NOT NULL THEN 'prefix3'
            WHEN p2.lat  IS NOT NULL THEN 'prefix2'
            ELSE 'none' END AS geo_source,
       -- Which real source placed it, so a number built on these can say where
       -- its confidence comes from. NULL for the guesses.
       r.provenance AS geo_provenance
FROM all_pincodes ap
LEFT JOIN real_geo r  ON r.pincode = ap.pincode
LEFT JOIN prefix3 p3  ON p3.prefix = substring(ap.pincode, 1, 3) AND ap.pincode ~ '^[0-9]{6}$'
LEFT JOIN prefix2 p2  ON p2.prefix = substring(ap.pincode, 1, 2) AND ap.pincode ~ '^[0-9]{6}$';

-- Restore the dependents, shallowest first, then every index that was on them.
DO $restore$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM _saved ORDER BY depth, name LOOP
    EXECUTE format('CREATE MATERIALIZED VIEW %I.%I AS %s', r.schema, r.name, r.def);
  END LOOP;
  FOR r IN SELECT * FROM _saved_idx LOOP
    EXECUTE r.indexdef;
  END LOOP;
END
$restore$;

COMMIT;

\echo ''
\echo '--- geocoding now:'
SELECT geo_source, geo_provenance, count(*)
FROM analytics.mv_pincode_geo GROUP BY 1, 2 ORDER BY 3 DESC;
