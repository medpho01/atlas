-- ============================================================================
-- atlas-db init #2: load India Post pincode directory.
-- Runs only on first boot (when the data volume is empty).
-- Reads /docker-entrypoint-initdb.d/pincode_directory_india_post.csv (mounted
-- from sql/pincode_directory_india_post.csv via docker-compose).
-- ============================================================================

-- Staging table — matches the upstream CSV column order exactly.
CREATE TEMP TABLE _pincode_staging (
  circle_name text, region_name text, division_name text, office_name text,
  pincode text, office_type text, delivery text, district text, state_name text,
  latitude text, longitude text
);

\copy _pincode_staging FROM '/docker-entrypoint-initdb.d/pincode_directory_india_post.csv' WITH (FORMAT csv, HEADER true)

-- City alias map: collapse district variants the operational world doesn't
-- use (e.g. "BENGALURU URBAN") into the friendly city name everyone says.
CREATE TEMP TABLE _city_alias (district_upper text PRIMARY KEY, city text);
INSERT INTO _city_alias VALUES
  ('BENGALURU URBAN',     'Bengaluru'),
  ('BENGALURU RURAL',     'Bengaluru'),
  ('BANGALORE',           'Bengaluru'),
  ('MUMBAI',              'Mumbai'),
  ('MUMBAI SUBURBAN',     'Mumbai'),
  ('THANE',               'Thane'),
  ('NEW DELHI',           'New Delhi'),
  ('CENTRAL DELHI',       'New Delhi'),
  ('NORTH DELHI',         'Delhi'),
  ('SOUTH DELHI',         'Delhi'),
  ('SOUTH EAST DELHI',    'Delhi'),
  ('SOUTH WEST DELHI',    'Delhi'),
  ('EAST DELHI',          'Delhi'),
  ('WEST DELHI',          'Delhi'),
  ('NORTH WEST DELHI',    'Delhi'),
  ('NORTH EAST DELHI',    'Delhi'),
  ('SHAHDARA',            'Delhi'),
  ('CHENNAI',             'Chennai'),
  ('KOLKATA',             'Kolkata'),
  ('HYDERABAD',           'Hyderabad'),
  ('GURUGRAM',            'Gurugram'),
  ('GURGAON',             'Gurugram'),
  ('NOIDA',               'Noida'),
  ('GAUTAM BUDDHA NAGAR', 'Noida'),
  ('GHAZIABAD',           'Ghaziabad'),
  ('FARIDABAD',           'Faridabad'),
  ('PUNE',                'Pune'),
  ('AHMEDABAD',           'Ahmedabad'),
  ('JAIPUR',              'Jaipur'),
  ('LUCKNOW',             'Lucknow'),
  ('KOCHI',               'Kochi'),
  ('ERNAKULAM',           'Kochi'),
  ('THIRUVANANTHAPURAM',  'Thiruvananthapuram'),
  ('CHANDIGARH',          'Chandigarh');

-- Collapse multi-office rows to one per pincode using HO > PO > BO precedence.
WITH ranked AS (
  SELECT
    pincode, office_name, office_type, district, state_name, circle_name, latitude, longitude,
    ROW_NUMBER() OVER (
      PARTITION BY pincode
      ORDER BY
        CASE office_type WHEN 'HO' THEN 1 WHEN 'PO' THEN 2 WHEN 'BO' THEN 3 ELSE 4 END,
        delivery DESC,
        office_name
    ) AS rn
  FROM _pincode_staging
  WHERE pincode IS NOT NULL AND length(pincode) = 6
)
INSERT INTO atlas.pincode_directory (pincode, city, district, state, office_name, office_type, circle, latitude, longitude)
SELECT
  r.pincode,
  COALESCE(a.city, initcap(r.district))     AS city,
  r.district,
  initcap(r.state_name)                     AS state,
  r.office_name,
  r.office_type,
  r.circle_name,
  CASE WHEN r.latitude  ~ '^-?[0-9.]+$' THEN r.latitude::double precision  END,
  CASE WHEN r.longitude ~ '^-?[0-9.]+$' THEN r.longitude::double precision END
FROM ranked r
LEFT JOIN _city_alias a ON a.district_upper = UPPER(TRIM(r.district))
WHERE r.rn = 1
ON CONFLICT (pincode) DO NOTHING;

DO $$
DECLARE
  n int; geo int; cities int; states int;
BEGIN
  SELECT COUNT(*), COUNT(latitude), COUNT(DISTINCT city), COUNT(DISTINCT state)
    INTO n, geo, cities, states FROM atlas.pincode_directory;
  RAISE NOTICE 'atlas.pincode_directory ready: % rows, % with lat/long, % cities, % states', n, geo, cities, states;
END$$;
