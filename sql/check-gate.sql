-- Is the store gate live, and what should the page be showing?
--
--   docker exec -i atlas-db psql -U atlas -d atlas -v req=28785 -f - < sql/check-gate.sql
--
-- Splits a stale page from stale data. The "Labs that can collect here" card
-- runs this query live — it does not read the materialized view — so if this
-- returns 0 and the page still lists labs, the app was not rebuilt or the
-- browser is holding an old render. If this returns 6, the gate is still off.

\echo '=== Gate state ==='
SELECT (SELECT COUNT(*) FROM src_local."LabsOnStore")  AS mappings,
       atlas.store_lab_gate_active()                   AS gate_active,
       (SELECT COUNT(*) FROM src."LabsOnStore")        AS mappings_at_source;

\echo '=== What the labs card should show for this request ==='
SELECT COUNT(*) AS labs_page_should_show
FROM analytics.mv_request_state s
JOIN analytics.mv_lab_pincode_home lph ON lph.pincode = s.pincode
WHERE s.request_id = :req
  AND (s.store_id IS NULL
       OR NOT atlas.store_lab_gate_active()
       OR EXISTS (SELECT 1 FROM src_local."LabsOnStore" los
                   WHERE los."storeId" = s.store_id AND los."labId" = lph.lab_id));

\echo '=== And what state the request should carry (needs an MV refresh to show) ==='
SELECT request_id, store_id, state AS state_in_mv,
       (SELECT COUNT(*) FROM analytics.mv_lab_pincode_home lph
         WHERE lph.pincode = s.pincode) AS labs_claiming_pincode
FROM analytics.mv_request_state s WHERE request_id = :req;
