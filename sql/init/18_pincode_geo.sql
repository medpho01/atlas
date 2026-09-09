-- ============================================================================
-- Pincode coordinates, from every real source we have.
--
-- LabStack's PincodeToLatLong lists 19,418 pincodes but records coordinates
-- for only 4,384 of them; the other 15,034 rows are NULL. Nothing is being
-- rejected or mis-parsed — the data is simply absent.
--
-- mv_pincode_geo used to paper over that by giving an unlocated pincode the
-- AVERAGE position of everything sharing its first three digits. That is fine
-- for drawing a dot on a map and useless for measuring anything: it puts ~15
-- pincodes on one identical point, so a centre near that point "covered" all
-- of them at zero distance. Centre-visit reach had to exclude those guesses,
-- which is why it reads low — we can only measure the 23% of India we can
-- actually place.
--
-- This table is where a pincode's real position lives, whatever its origin,
-- with the origin recorded. Three sources, in precedence order:
--
--   manual    a human or an imported dataset said so. Wins over everything —
--             it is the only source anyone can correct.
--   labstack  PincodeToLatLong, where it has coordinates.
--   observed  the median position of real addresses in that pincode, taken
--             from customer profiles and provider records. Median, not mean:
--             one address typed into the wrong pincode should not drag the
--             centroid, and a mean is exactly what made the prefix guesses so
--             misleading.
--
-- Observed points are sanity-checked against the pincode's 3-digit region and
-- discarded if they land more than 150km away, which catches a pincode typed
-- into an address on the other side of the country.
-- ============================================================================

-- Human-supplied or imported coordinates. Separate table so a refresh can
-- never overwrite them, and so an import is auditable after the fact.
CREATE TABLE IF NOT EXISTS atlas.pincode_geo_manual (
  pincode    text PRIMARY KEY CHECK (pincode ~ '^[0-9]{6}$'),
  latitude   double precision NOT NULL CHECK (latitude  BETWEEN 6 AND 38),
  longitude  double precision NOT NULL CHECK (longitude BETWEEN 67 AND 98),
  source     text NOT NULL DEFAULT 'import',   -- where the row came from
  note       text,
  added_by   int REFERENCES atlas.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The resolved answer, rebuilt nightly.
CREATE TABLE IF NOT EXISTS atlas.pincode_geo (
  pincode     text PRIMARY KEY,
  latitude    double precision NOT NULL,
  longitude   double precision NOT NULL,
  provenance  text NOT NULL CHECK (provenance IN ('manual','labstack','observed')),
  sample_size int,                              -- addresses behind an observed point
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pincode_geo_provenance ON atlas.pincode_geo (provenance);

CREATE OR REPLACE FUNCTION atlas.rebuild_pincode_geo()
RETURNS TABLE (manual int, labstack int, observed int, total int)
LANGUAGE plpgsql AS $$
BEGIN
  CREATE TEMP TABLE _resolved ON COMMIT DROP AS
  WITH bbox AS (SELECT 6.0 lat_lo, 38.0 lat_hi, 67.0 lng_lo, 98.0 lng_hi),

  -- 1. Anything a person or an import stated.
  manual AS (
    SELECT pincode, latitude, longitude, 'manual'::text AS provenance, NULL::int AS sample_size
    FROM atlas.pincode_geo_manual
  ),

  -- 2. LabStack's own table, where it actually has a position.
  labstack AS (
    SELECT p.pincode, p.latitude, p.longitude, 'labstack'::text, NULL::int
    FROM src_local."PincodeToLatLong" p, bbox b
    WHERE p.pincode ~ '^[0-9]{6}$'
      AND p.latitude  BETWEEN b.lat_lo AND b.lat_hi
      AND p.longitude BETWEEN b.lng_lo AND b.lng_hi
      AND NOT EXISTS (SELECT 1 FROM manual m WHERE m.pincode = p.pincode)
  ),

  -- 3. Real addresses we have seen in that pincode.
  addresses AS (
    SELECT pincode, latitude, longitude FROM src_local."Profile"
    UNION ALL
    SELECT pincode, latitude, longitude FROM src_local."Lab"
  ),
  clean AS (
    SELECT a.pincode, a.latitude, a.longitude
    FROM addresses a, bbox b
    WHERE a.pincode ~ '^[0-9]{6}$'
      AND a.latitude  BETWEEN b.lat_lo AND b.lat_hi
      AND a.longitude BETWEEN b.lng_lo AND b.lng_hi
  ),
  observed_raw AS (
    SELECT pincode,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY latitude)  AS lat,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY longitude) AS lng,
           COUNT(*)::int AS n
    FROM clean GROUP BY pincode
  ),
  -- Where the 3-digit region sits, from pincodes we are already sure about.
  region AS (
    SELECT substring(pincode, 1, 3) AS prefix, AVG(latitude) lat, AVG(longitude) lng
    FROM (SELECT * FROM manual UNION ALL SELECT * FROM labstack) k
    GROUP BY 1
  ),
  observed AS (
    SELECT o.pincode, o.lat, o.lng, 'observed'::text, o.n
    FROM observed_raw o
    LEFT JOIN region r ON r.prefix = substring(o.pincode, 1, 3)
    WHERE NOT EXISTS (SELECT 1 FROM manual   m WHERE m.pincode = o.pincode)
      AND NOT EXISTS (SELECT 1 FROM labstack l WHERE l.pincode = o.pincode)
      -- Accept only if it lands in the right part of the country. 1.5 degrees
      -- is roughly 150km, which is generous for a pincode and tight enough to
      -- catch an address filed under the wrong one.
      AND (r.lat IS NULL
           OR (abs(o.lat - r.lat) < 1.5 AND abs(o.lng - r.lng) < 1.5))
  )
  SELECT * FROM manual
  UNION ALL SELECT * FROM labstack
  UNION ALL SELECT * FROM observed;

  DELETE FROM atlas.pincode_geo;
  INSERT INTO atlas.pincode_geo (pincode, latitude, longitude, provenance, sample_size)
  SELECT pincode, latitude, longitude, provenance, sample_size FROM _resolved;

  RETURN QUERY
  SELECT COUNT(*) FILTER (WHERE provenance = 'manual')::int,
         COUNT(*) FILTER (WHERE provenance = 'labstack')::int,
         COUNT(*) FILTER (WHERE provenance = 'observed')::int,
         COUNT(*)::int
  FROM atlas.pincode_geo;
END $$;
