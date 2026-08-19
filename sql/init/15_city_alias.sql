-- ============================================================================
-- City canonicalisation.
--
-- The source spells cities several ways and every city-keyed thing in Atlas
-- silently fragments as a result. Bengaluru is the worst case: 'Bangalore'
-- (150 providers), 'Bengaluru' (39) and 'bengalure' (1) are three separate
-- markets to every query, so the readiness page scored the country's densest
-- diagnostics city as 40 / Build on a quarter of its actual supply. Delhi and
-- Gurugram split the same way.
--
-- Stripping case and punctuation — which every key here already does — does
-- not help, because these are different words for the same place.
--
-- A curated table rather than fuzzy matching: 'Bangalore' → 'Bengaluru' is a
-- fact someone knows, and a similarity threshold that merges those two will
-- also merge places that are genuinely different. Unlisted cities pass through
-- unchanged, so this only ever fixes what it is told about.
-- ============================================================================

CREATE TABLE IF NOT EXISTS atlas.city_alias (
  variant_key   text PRIMARY KEY,
  canonical_key text NOT NULL,
  canonical_name text NOT NULL,
  note          text,
  added_by      int REFERENCES atlas.users(id),
  added_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO atlas.city_alias (variant_key, canonical_key, canonical_name, note) VALUES
 ('bangalore','bengaluru','Bengaluru','renamed 2014'),
 ('bengalure','bengaluru','Bengaluru','misspelling'),
 ('benglore','bengaluru','Bengaluru','misspelling'),
 ('gurgaon','gurugram','Gurugram','renamed 2016'),
 ('newdelhi','delhi','Delhi','same market'),
 ('kolkatta','kolkata','Kolkata','misspelling'),
 ('mysore','mysuru','Mysuru','renamed 2014'),
 ('mangalore','mangaluru','Mangaluru','renamed 2014'),
 ('hubli','hubballi','Hubballi','renamed 2014'),
 ('belgaum','belagavi','Belagavi','renamed 2014'),
 ('tumkur','tumakuru','Tumakuru','renamed 2014'),
 ('gulbarga','kalaburagi','Kalaburagi','renamed 2014'),
 ('vishakapatnam','visakhapatnam','Visakhapatnam','misspelling'),
 ('vizag','visakhapatnam','Visakhapatnam','colloquial'),
 ('trichy','tiruchirappalli','Tiruchirappalli','colloquial'),
 ('calicut','kozhikode','Kozhikode','renamed'),
 ('cochin','kochi','Kochi','renamed'),
 ('ernakulam','kochi','Kochi','same market'),
 ('trissur','thrissur','Thrissur','misspelling'),
 ('pondicherry','puducherry','Puducherry','renamed 2006'),
 ('bhubneshwar','bhubaneswar','Bhubaneswar','misspelling'),
 ('allahabad','prayagraj','Prayagraj','renamed 2018'),
 ('tirvandrum','thiruvananthapuram','Thiruvananthapuram','misspelling'),
 ('tuticorin','thoothukudi','Thoothukudi','renamed'),
 ('tiruppur','tirupur','Tirupur','spelling'),
 ('secunderabad','hyderabad','Hyderabad','twin city, one market'),
 -- Self-mapping rows exist only to pin the display spelling. Without them the
 -- name shown is whichever variant sorts first, so a city recorded as both
 -- 'Delhi' and 'DELHI' renders as DELHI.
 ('delhi','delhi','Delhi','display casing'),
 ('mumbai','mumbai','Mumbai','display casing'),
 ('pune','pune','Pune','display casing'),
 ('kolkata','kolkata','Kolkata','display casing'),
 ('jaipur','jaipur','Jaipur','display casing'),
 ('chennai','chennai','Chennai','display casing'),
 ('surat','surat','Surat','display casing'),
 ('ludhiana','ludhiana','Ludhiana','display casing'),
 ('gwalior','gwalior','Gwalior','display casing'),
 ('dehradun','dehradun','Dehradun','display casing'),
 ('aurangabad','aurangabad','Aurangabad','display casing'),
 ('warangal','warangal','Warangal','display casing')
ON CONFLICT (variant_key) DO UPDATE SET
  canonical_key = EXCLUDED.canonical_key, canonical_name = EXCLUDED.canonical_name;

-- The one place city keys are made. Everything city-keyed should call this so
-- a new alias fixes every surface at once instead of one query at a time.
CREATE OR REPLACE FUNCTION atlas.city_key(raw text) RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(
    (SELECT a.canonical_key FROM atlas.city_alias a
      WHERE a.variant_key = regexp_replace(lower(TRIM(raw)), '[^a-z0-9]', '', 'g')),
    regexp_replace(lower(TRIM(raw)), '[^a-z0-9]', '', 'g')
  )
$$;

CREATE OR REPLACE FUNCTION atlas.city_display(raw text) RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(
    (SELECT a.canonical_name FROM atlas.city_alias a
      WHERE a.variant_key = regexp_replace(lower(TRIM(raw)), '[^a-z0-9]', '', 'g')),
    TRIM(raw)
  )
$$;
