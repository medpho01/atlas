-- ===========================================================================
-- check-labstack-columns.sql — will this run against the real LabStack mirror?
--
-- Run it on the production atlas-db BEFORE merging. It reads nothing but the
-- catalogue, writes nothing, and takes a second:
--
--   docker exec -i atlas-db psql -U atlas -d atlas -f - \
--     < scripts/check-labstack-columns.sql
--
-- Every column Stores & Orders reads from the mirrored LabStack tables, checked
-- against what that database actually has. A column named here and absent there
-- means the view will not create and the page will not render — which is worth
-- finding now rather than after a deploy.
--
-- The list is generated from the SQL and the query modules, so it is what the
-- code asks for rather than what somebody remembered to write down.
-- ===========================================================================

\pset pager off

WITH wanted(tbl, col) AS (VALUES
  ('Lab', 'apiProvider'),
  ('Lab', 'centerType'),
  ('Lab', 'city'),
  ('Lab', 'id'),
  ('Lab', 'labName'),
  ('Lab', 'pincode'),
  ('Lab', 'state'),
  ('LabDepartment', 'id'),
  ('LabDepartment', 'name'),
  ('Master', 'id'),
  ('Master', 'labDepartment_id'),
  ('Master', 'name'),
  ('Master', 'sampleType_id'),
  ('Order', 'appointmentTime'),
  ('Order', 'assignedAt'),
  ('Order', 'assignedBy'),
  ('Order', 'cancelReason'),
  ('Order', 'createdAt'),
  ('Order', 'id'),
  ('Order', 'labId'),
  ('Order', 'orderStatus'),
  ('Order', 'orderType'),
  ('Order', 'phleboName'),
  ('Order', 'phleboNumber'),
  ('Order', 'referenceId'),
  ('Order', 'requestId'),
  ('Order', 'statusUpdatedAt'),
  ('Order', 'storeId'),
  ('Order', 'updatedAt'),
  ('Order', 'userId'),
  ('Profile', 'city'),
  ('Profile', 'name'),
  ('Profile', 'pincode'),
  ('Profile', 'profileUserId'),
  ('Request', 'convertedOrderId'),
  ('Request', 'id'),
  ('Store', 'active'),
  ('Store', 'address'),
  ('Store', 'apiEnabled'),
  ('Store', 'city'),
  ('Store', 'createdAt'),
  ('Store', 'id'),
  ('Store', 'legalName'),
  ('Store', 'locality'),
  ('Store', 'pincode'),
  ('Store', 'pocs'),
  ('Store', 'state'),
  ('Store', 'storeName'),
  ('Store', 'storeType'),
  ('User', 'id'),
  ('User', 'name')
)
SELECT
  CASE WHEN c.column_name IS NULL THEN 'FAIL' ELSE 'PASS' END AS result,
  w.tbl AS "table",
  w.col AS "column",
  COALESCE(c.data_type, '— NOT IN THIS DATABASE —') AS type
FROM wanted w
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'src_local'
 AND c.table_name  = w.tbl
 AND c.column_name = w.col
ORDER BY (c.column_name IS NOT NULL), w.tbl, w.col;

\echo ''
\echo '--- summary ---'

WITH wanted(tbl, col) AS (VALUES
  ('Lab', 'apiProvider'),
  ('Lab', 'centerType'),
  ('Lab', 'city'),
  ('Lab', 'id'),
  ('Lab', 'labName'),
  ('Lab', 'pincode'),
  ('Lab', 'state'),
  ('LabDepartment', 'id'),
  ('LabDepartment', 'name'),
  ('Master', 'id'),
  ('Master', 'labDepartment_id'),
  ('Master', 'name'),
  ('Master', 'sampleType_id'),
  ('Order', 'appointmentTime'),
  ('Order', 'assignedAt'),
  ('Order', 'assignedBy'),
  ('Order', 'cancelReason'),
  ('Order', 'createdAt'),
  ('Order', 'id'),
  ('Order', 'labId'),
  ('Order', 'orderStatus'),
  ('Order', 'orderType'),
  ('Order', 'phleboName'),
  ('Order', 'phleboNumber'),
  ('Order', 'referenceId'),
  ('Order', 'requestId'),
  ('Order', 'statusUpdatedAt'),
  ('Order', 'storeId'),
  ('Order', 'updatedAt'),
  ('Order', 'userId'),
  ('Profile', 'city'),
  ('Profile', 'name'),
  ('Profile', 'pincode'),
  ('Profile', 'profileUserId'),
  ('Request', 'convertedOrderId'),
  ('Request', 'id'),
  ('Store', 'active'),
  ('Store', 'address'),
  ('Store', 'apiEnabled'),
  ('Store', 'city'),
  ('Store', 'createdAt'),
  ('Store', 'id'),
  ('Store', 'legalName'),
  ('Store', 'locality'),
  ('Store', 'pincode'),
  ('Store', 'pocs'),
  ('Store', 'state'),
  ('Store', 'storeName'),
  ('Store', 'storeType'),
  ('User', 'id'),
  ('User', 'name')
)
SELECT count(*) AS columns_checked,
       count(*) FILTER (WHERE c.column_name IS NULL) AS missing,
       CASE WHEN count(*) FILTER (WHERE c.column_name IS NULL) = 0
            THEN 'PASS — every column this feature reads exists here'
            ELSE 'FAIL — the rows marked FAIL above will break their view' END AS verdict
FROM wanted w
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'src_local' AND c.table_name = w.tbl AND c.column_name = w.col;

\echo ''
\echo '--- the one that is worth a second look ---'
\echo 'LabDepartment: this feature reads d.name. If the column below is'
\echo 'called something else, /catalogue/tests needs the other name.'

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'src_local' AND table_name = 'LabDepartment'
ORDER BY ordinal_position;
