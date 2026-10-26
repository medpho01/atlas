-- The NABL accredited-laboratory directory, as Atlas's own reference copy.
--
-- NABL publishes 11,000+ accredited labs with contact details, discipline and
-- a certificate link, but only through a search box — no export, no API we are
-- entitled to call on a schedule. So this is a loaded snapshot, refreshed by
-- re-running the pull, not a live view: `pulled_on` says how stale it is and
-- every screen that reads it shows that date.
--
-- It is reference data, not supply. A NABL lab is not a LabStack provider
-- until somebody onboards it; the two are matched by hand, which is why
-- nothing here is foreign-keyed to src.
CREATE TABLE IF NOT EXISTS atlas.nabl_lab (
  -- NABL's own row id, so a refresh updates rather than duplicates.
  nabl_id            text PRIMARY KEY,
  cab_name           text NOT NULL,
  cab_id             text,
  certificate_no     text,
  field              text,
  application_status text,
  validity           text,
  certificate_link   text,

  contact_name       text,
  phone              text,
  email              text,
  address            text,
  city               text,
  state              text,
  pincode            text,
  country            text,
  latitude           double precision,
  longitude          double precision,

  discipline         text,
  groupname          text,
  subgroup           text,
  permanent_facility text,
  site_facility      text,
  mobile_facility    text,
  type_of_cab        text,
  integrated_lab     text,
  nabl_updated_on    text,

  -- Normalised once on load: every screen filters on these rather than
  -- re-deriving them, and city_key folds Bangalore into Bengaluru the same way
  -- the rest of Atlas does.
  city_key           text,
  pulled_on          date NOT NULL DEFAULT atlas.ist_today(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nabl_lab_city     ON atlas.nabl_lab (city_key);
CREATE INDEX IF NOT EXISTS idx_nabl_lab_state    ON atlas.nabl_lab (state);
CREATE INDEX IF NOT EXISTS idx_nabl_lab_field    ON atlas.nabl_lab (field);
CREATE INDEX IF NOT EXISTS idx_nabl_lab_pincode  ON atlas.nabl_lab (pincode);
CREATE INDEX IF NOT EXISTS idx_nabl_lab_name_trgm ON atlas.nabl_lab USING gin (lower(cab_name) gin_trgm_ops);

COMMENT ON TABLE atlas.nabl_lab IS
  'Snapshot of the NABL accredited-laboratory directory. Reference data: a row '
  'here is an accredited lab, not a LabStack provider.';

-- The staging table the CSV lands in: every column text, so a malformed
-- latitude or a stray quote fails on the cast rather than halting the copy.
CREATE UNLOGGED TABLE IF NOT EXISTS atlas.nabl_lab_stage (
  cab_name text, cab_id text, certificate_no text, field text,
  application_status text, validity text, certificate_link text,
  contact_name text, phone text, email text, address text, city text,
  state text, pincode text, country text, latitude text, longitude text,
  discipline text, groupname text, subgroup text,
  permanent_facility text, site_facility text, mobile_facility text,
  type_of_cab text, integrated_lab text, last_updated_date text, id text
);

-- Fold the staging rows in. Re-running the pull refreshes in place: a lab that
-- renews keeps its row and its history of being there.
CREATE OR REPLACE FUNCTION atlas.load_nabl_labs() RETURNS integer AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO atlas.nabl_lab (
    nabl_id, cab_name, cab_id, certificate_no, field, application_status,
    validity, certificate_link, contact_name, phone, email, address, city,
    state, pincode, country, latitude, longitude, discipline, groupname,
    subgroup, permanent_facility, site_facility, mobile_facility, type_of_cab,
    integrated_lab, nabl_updated_on, city_key, pulled_on, updated_at)
  SELECT
    s.id, s.cab_name, s.cab_id, s.certificate_no, s.field, s.application_status,
    s.validity,
    -- NABL holds a bare filename for a few dozen labs; that is not a link.
    NULLIF(CASE WHEN s.certificate_link LIKE 'https://nablwp.qci.org.in/%'
                THEN s.certificate_link END, ''),
    s.contact_name, s.phone, s.email, s.address, s.city, s.state,
    NULLIF(btrim(s.pincode), ''), s.country,
    NULLIF(btrim(s.latitude), '')::double precision,
    NULLIF(btrim(s.longitude), '')::double precision,
    s.discipline, s.groupname, s.subgroup, s.permanent_facility,
    s.site_facility, s.mobile_facility, s.type_of_cab, s.integrated_lab,
    s.last_updated_date,
    atlas.city_key(s.city), atlas.ist_today(), now()
  FROM atlas.nabl_lab_stage s
  WHERE s.id IS NOT NULL AND btrim(s.id) <> ''
  ON CONFLICT (nabl_id) DO UPDATE SET
    cab_name = EXCLUDED.cab_name, cab_id = EXCLUDED.cab_id,
    certificate_no = EXCLUDED.certificate_no, field = EXCLUDED.field,
    application_status = EXCLUDED.application_status, validity = EXCLUDED.validity,
    certificate_link = EXCLUDED.certificate_link, contact_name = EXCLUDED.contact_name,
    phone = EXCLUDED.phone, email = EXCLUDED.email, address = EXCLUDED.address,
    city = EXCLUDED.city, state = EXCLUDED.state, pincode = EXCLUDED.pincode,
    country = EXCLUDED.country, latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude, discipline = EXCLUDED.discipline,
    groupname = EXCLUDED.groupname, subgroup = EXCLUDED.subgroup,
    permanent_facility = EXCLUDED.permanent_facility,
    site_facility = EXCLUDED.site_facility, mobile_facility = EXCLUDED.mobile_facility,
    type_of_cab = EXCLUDED.type_of_cab, integrated_lab = EXCLUDED.integrated_lab,
    nabl_updated_on = EXCLUDED.nabl_updated_on, city_key = EXCLUDED.city_key,
    pulled_on = EXCLUDED.pulled_on, updated_at = now();

  GET DIAGNOSTICS n = ROW_COUNT;
  TRUNCATE atlas.nabl_lab_stage;

  -- 41 adds the console match; call it when it exists so a refresh never
  -- leaves the screen claiming a stale match.
  IF to_regprocedure('atlas.match_nabl_labs()') IS NOT NULL THEN
    PERFORM atlas.match_nabl_labs();
  END IF;

  RETURN n;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION atlas.load_nabl_labs() IS
  'Folds atlas.nabl_lab_stage into atlas.nabl_lab and empties the staging table. '
  'Run after \copy-ing the CSV from sql/reports/nabl-labs.csv.';
