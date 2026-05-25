-- ============================================================================
-- atlas.pincode_directory
-- Authoritative pincode → district/state/lat-long reference for India.
-- Source:  https://github.com/dropdevrahul/pincodes-india (MIT, mirrors data.gov.in)
-- Updated: India Post directory (last upstream commit 2024-06-30)
--
-- Run order:
--   psql -d labstack -c "DROP TABLE IF EXISTS atlas.pincode_directory_staging;"
--   psql -d labstack -c "CREATE TABLE atlas.pincode_directory_staging ( ... );"
--   psql -d labstack -c "\copy atlas.pincode_directory_staging FROM '/tmp/pincode-import/dropdevrahul.csv' WITH (FORMAT csv, HEADER true);"
--   psql -d labstack -f sql/pincode_directory.sql
--
-- The script below assumes the staging table is already loaded; it collapses
-- ~157k post-office rows into ~19,300 canonical pincode rows using HO > PO > BO
-- precedence, applies a small city alias map, and indexes for fast joins.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS atlas;

-- ---- Staging table (created prior to \copy if not present) ------------------
CREATE TABLE IF NOT EXISTS atlas.pincode_directory_staging (
  circle_name   text,
  region_name   text,
  division_name text,
  office_name   text,
  pincode       text,
  office_type   text,
  delivery      text,
  district      text,
  state_name    text,
  latitude      text,   -- staged as text; numeric cast happens at collapse time
  longitude     text
);

-- ---- Canonical table (one row per pincode) ---------------------------------
DROP TABLE IF EXISTS atlas.pincode_directory;
CREATE TABLE atlas.pincode_directory (
  pincode      text PRIMARY KEY,
  city         text,           -- alias-cleaned district
  district     text,           -- raw district label from India Post
  state        text,
  office_name  text,           -- chosen HO/PO/BO name
  office_type  text,           -- HO, PO, or BO (precedence picked)
  circle       text,
  latitude     double precision,
  longitude    double precision
);

-- ---- Alias map: collapse common district variants to display city names ----
-- Keep this short and obvious. Add entries only when a noticeable share of
-- pincodes resolve to a district name that the business consistently calls
-- something else (e.g. "BENGALURU URBAN" → "Bengaluru").
-- Wrapped in an explicit transaction so the TEMP table survives until COMMIT.
BEGIN;
CREATE TEMP TABLE _city_alias(district_upper text PRIMARY KEY, city text) ON COMMIT DROP;
INSERT INTO _city_alias VALUES
  ('BENGALURU URBAN',   'Bengaluru'),
  ('BENGALURU RURAL',   'Bengaluru'),
  ('BANGALORE',         'Bengaluru'),
  ('MUMBAI',            'Mumbai'),
  ('MUMBAI SUBURBAN',   'Mumbai'),
  ('THANE',             'Thane'),
  ('NEW DELHI',         'New Delhi'),
  ('CENTRAL DELHI',     'New Delhi'),
  ('NORTH DELHI',       'Delhi'),
  ('SOUTH DELHI',       'Delhi'),
  ('SOUTH EAST DELHI',  'Delhi'),
  ('SOUTH WEST DELHI',  'Delhi'),
  ('EAST DELHI',        'Delhi'),
  ('WEST DELHI',        'Delhi'),
  ('NORTH WEST DELHI',  'Delhi'),
  ('NORTH EAST DELHI',  'Delhi'),
  ('SHAHDARA',          'Delhi'),
  ('CHENNAI',           'Chennai'),
  ('KOLKATA',           'Kolkata'),
  ('HYDERABAD',         'Hyderabad'),
  ('GURUGRAM',          'Gurugram'),
  ('GURGAON',           'Gurugram'),
  ('NOIDA',             'Noida'),
  ('GAUTAM BUDDHA NAGAR', 'Noida'),
  ('GHAZIABAD',         'Ghaziabad'),
  ('FARIDABAD',         'Faridabad'),
  ('PUNE',              'Pune'),
  ('AHMEDABAD',         'Ahmedabad'),
  ('JAIPUR',            'Jaipur'),
  ('LUCKNOW',           'Lucknow'),
  ('KOCHI',             'Kochi'),
  ('ERNAKULAM',         'Kochi'),
  ('THIRUVANANTHAPURAM','Thiruvananthapuram'),
  ('CHANDIGARH',        'Chandigarh');

-- ---- Collapse: HO > PO > BO precedence; ties broken by office_name ----------
WITH ranked AS (
  SELECT
    pincode,
    office_name,
    office_type,
    district,
    state_name,
    circle_name,
    latitude,
    longitude,
    ROW_NUMBER() OVER (
      PARTITION BY pincode
      ORDER BY
        CASE office_type WHEN 'HO' THEN 1 WHEN 'PO' THEN 2 WHEN 'BO' THEN 3 ELSE 4 END,
        delivery DESC,                -- 'Delivery' beats 'Non Delivery'
        office_name
    ) AS rn
  FROM atlas.pincode_directory_staging
  WHERE pincode IS NOT NULL AND length(pincode) = 6
)
INSERT INTO atlas.pincode_directory (pincode, city, district, state, office_name, office_type, circle, latitude, longitude)
SELECT
  r.pincode,
  COALESCE(a.city, initcap(r.district))         AS city,
  r.district                                    AS district,
  initcap(r.state_name)                         AS state,
  r.office_name,
  r.office_type,
  r.circle_name,
  -- Source uses '', 'NA', 'N/A' as null sentinels for lat/long.
  CASE WHEN r.latitude  ~ '^-?[0-9.]+$' THEN r.latitude::double precision  END AS latitude,
  CASE WHEN r.longitude ~ '^-?[0-9.]+$' THEN r.longitude::double precision END AS longitude
FROM ranked r
LEFT JOIN _city_alias a ON a.district_upper = UPPER(TRIM(r.district))
WHERE r.rn = 1;

CREATE INDEX idx_atlas_pin_dir_state ON atlas.pincode_directory(state);
CREATE INDEX idx_atlas_pin_dir_city  ON atlas.pincode_directory(city);

COMMIT;

-- Cleanup: drop staging so it doesn't sit around with 157k rows.
DROP TABLE atlas.pincode_directory_staging;

-- Quick stats so you see what landed.
DO $$
DECLARE
  total_rows int;
  with_latlng int;
  cities int;
  states int;
BEGIN
  SELECT COUNT(*) INTO total_rows FROM atlas.pincode_directory;
  SELECT COUNT(*) INTO with_latlng FROM atlas.pincode_directory WHERE latitude IS NOT NULL;
  SELECT COUNT(DISTINCT city) INTO cities FROM atlas.pincode_directory;
  SELECT COUNT(DISTINCT state) INTO states FROM atlas.pincode_directory;
  RAISE NOTICE 'atlas.pincode_directory loaded: % rows, % with lat/long, % distinct cities, % distinct states',
    total_rows, with_latlng, cities, states;
END$$;
