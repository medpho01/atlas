-- Finding supply near a pincode, rather than in it.
--
-- Both reference screens, /nabl and /franchisees, could only be searched by
-- exact pincode. That almost never hits: a request lands in 110016 and the
-- lab that can serve it sits in 110017, two kilometres away, so the screen
-- says there is nothing there. For picking up an order what matters is
-- distance, not whether two six-digit codes happen to be equal.
--
-- This gives every reference row a usable location and a way to measure from
-- it. Two parts:
--
--   geo_lat / geo_lon — the row's own coordinates where the source published
--   them AND they agree with its own pincode, else the centroid of that
--   pincode. geo_source says which, because a centroid is the middle of an
--   area that can be several kilometres across, and a distance measured from
--   one is an estimate in a way that a distance measured from real
--   coordinates is not.
--
--   The agreement check is not defensive programming, it is required. Of the
--   5,823 reference rows that publish their own coordinates, 560 sit more
--   than 50 km from the pincode they also publish — one Pathkind centre is
--   9,584 km out, one Lupin lab 272 km — and those rows would otherwise
--   appear in, or vanish from, a radius search for no reason a user could
--   see. Past GEO_DISAGREE_KM the coordinate contradicts the pincode, and
--   the pincode is the more trustworthy of the two.
--
--   atlas.km_between() — plain haversine, IMMUTABLE so it can sit in an
--   index or an ORDER BY without being re-planned.
--
-- Coverage after backfill: 8,182 of 8,267 chain centres and 2,639 of 2,640
-- medical NABL labs. The handful left over have no pincode we hold geo for.

CREATE OR REPLACE FUNCTION atlas.km_between(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
) RETURNS double precision AS $$
  SELECT CASE
    WHEN lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN NULL
    ELSE 6371 * acos(GREATEST(-1, LEAST(1,
      cos(radians(lat1)) * cos(radians(lat2)) *
      cos(radians(lon2) - radians(lon1)) +
      sin(radians(lat1)) * sin(radians(lat2)))))
  END;
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

COMMENT ON FUNCTION atlas.km_between(double precision, double precision,
                                     double precision, double precision) IS
  'Great-circle kilometres between two points. IMMUTABLE so it can be indexed.';

-- Where a pincode is, for resolving a search box entry to a point.
CREATE OR REPLACE FUNCTION atlas.pincode_point(p text)
RETURNS TABLE (lat double precision, lon double precision) AS $$
  SELECT latitude, longitude
  FROM atlas.pincode_directory
  WHERE pincode = NULLIF(btrim(p), '')
    AND latitude IS NOT NULL
  LIMIT 1;
$$ LANGUAGE sql STABLE;


/*
 * Does a row's own coordinate agree with its own pincode?
 *
 * True when there is a coordinate and either no pincode centroid to check it
 * against or the two are within 25 km. False means the source contradicted
 * itself and the pincode should win.
 */
CREATE OR REPLACE FUNCTION atlas.geo_agrees(
  own_lat double precision, own_lon double precision,
  pin_lat double precision, pin_lon double precision
) RETURNS boolean AS $$
  SELECT own_lat IS NOT NULL AND own_lon IS NOT NULL
     AND (pin_lat IS NULL
          OR atlas.km_between(pin_lat, pin_lon, own_lat, own_lon) <= 25);
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

ALTER TABLE atlas.chain_centre ADD COLUMN IF NOT EXISTS geo_lat    double precision;
ALTER TABLE atlas.chain_centre ADD COLUMN IF NOT EXISTS geo_lon    double precision;
ALTER TABLE atlas.chain_centre ADD COLUMN IF NOT EXISTS geo_source text;

ALTER TABLE atlas.nabl_lab ADD COLUMN IF NOT EXISTS geo_lat    double precision;
ALTER TABLE atlas.nabl_lab ADD COLUMN IF NOT EXISTS geo_lon    double precision;
ALTER TABLE atlas.nabl_lab ADD COLUMN IF NOT EXISTS geo_source text;

-- A bounding-box prefilter is what makes a radius search fast; the exact
-- haversine then runs over the few hundred rows that survive it.
CREATE INDEX IF NOT EXISTS idx_chain_centre_geo ON atlas.chain_centre (geo_lat, geo_lon)
  WHERE geo_lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nabl_lab_geo     ON atlas.nabl_lab (geo_lat, geo_lon)
  WHERE geo_lat IS NOT NULL;

/*
 * Fill geo_lat/geo_lon on both reference tables.
 *
 * Own coordinates win; a pincode centroid is the fallback. Run after any
 * load — both loaders call it — and after a pincode_directory refresh, since
 * a pincode that gains a centroid locates rows that could not be placed
 * before.
 */
CREATE OR REPLACE FUNCTION atlas.fill_reference_geo() RETURNS integer AS $$
DECLARE
  n integer;
  m integer;
BEGIN
  UPDATE atlas.chain_centre c SET
    geo_lat = CASE WHEN atlas.geo_agrees(c.latitude, c.longitude, d.latitude, d.longitude)
                   THEN c.latitude ELSE d.latitude END,
    geo_lon = CASE WHEN atlas.geo_agrees(c.latitude, c.longitude, d.latitude, d.longitude)
                   THEN c.longitude ELSE d.longitude END,
    geo_source = CASE
      WHEN atlas.geo_agrees(c.latitude, c.longitude, d.latitude, d.longitude) THEN 'exact'
      WHEN d.latitude IS NOT NULL THEN 'pincode' END
  FROM atlas.pincode_directory d
  WHERE d.pincode = c.pincode;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- A row whose pincode is not in the directory still places itself from its
  -- own coordinates; there is nothing to check them against.
  UPDATE atlas.chain_centre SET
    geo_lat = latitude, geo_lon = longitude, geo_source = 'exact'
  WHERE geo_lat IS NULL AND latitude IS NOT NULL;

  UPDATE atlas.nabl_lab l SET
    geo_lat = CASE WHEN atlas.geo_agrees(l.latitude, l.longitude, d.latitude, d.longitude)
                   THEN l.latitude ELSE d.latitude END,
    geo_lon = CASE WHEN atlas.geo_agrees(l.latitude, l.longitude, d.latitude, d.longitude)
                   THEN l.longitude ELSE d.longitude END,
    geo_source = CASE
      WHEN atlas.geo_agrees(l.latitude, l.longitude, d.latitude, d.longitude) THEN 'exact'
      WHEN d.latitude IS NOT NULL THEN 'pincode' END
  FROM atlas.pincode_directory d
  WHERE d.pincode = l.pincode;
  GET DIAGNOSTICS m = ROW_COUNT;

  UPDATE atlas.nabl_lab SET
    geo_lat = latitude, geo_lon = longitude, geo_source = 'exact'
  WHERE geo_lat IS NULL AND latitude IS NOT NULL;

  RETURN n + m;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION atlas.fill_reference_geo() IS
  'Fills geo_lat/geo_lon on chain_centre and nabl_lab from the row''s own '
  'coordinates, else its pincode centroid. Run after any load.';

SELECT atlas.fill_reference_geo();
