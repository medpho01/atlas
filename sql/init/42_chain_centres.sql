-- The franchisee networks of the national diagnostic chains.
--
-- Thyrocare, Metropolis, Pathkind and the rest each publish their collection
-- centres on their own site, in their own shape, behind their own bot
-- protection. This is one table for all of them: a centre is a centre,
-- whatever the brand, and every screen reads the same columns.
--
-- Reference data, like atlas.nabl_lab. A row here is a centre a chain says it
-- has, loaded from a snapshot; it is not supply until somebody onboards it.
-- `pulled_on` says how stale each chain's snapshot is, per chain, because they
-- are refreshed independently.

CREATE TABLE IF NOT EXISTS atlas.chain_centre (
  chain        text NOT NULL,
  -- The chain's own id where it has one, else a hash of name, pincode and
  -- address. The address is in the hash because two centres of one chain can
  -- genuinely share a name and a pincode — two branches of the same locality —
  -- and without it they collide into one row.
  external_id  text NOT NULL,

  name         text NOT NULL,
  address      text,
  city         text,
  state        text,
  pincode      text,
  phone        text,
  whatsapp     text,
  open_hours   text,
  map_link     text,
  latitude     double precision,
  longitude    double precision,

  -- Normalised once on load; every filter reads these.
  city_key     text,
  phone_digits text,

  -- Set by atlas.match_chain_centres(): the console lab this looks like.
  matched_lab_id   integer,
  matched_lab_name text,
  matched_score    numeric(4,3),

  source_url   text,
  pulled_on    date NOT NULL DEFAULT atlas.ist_today(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, external_id)
);

CREATE INDEX IF NOT EXISTS idx_chain_centre_chain   ON atlas.chain_centre (chain, city_key);
CREATE INDEX IF NOT EXISTS idx_chain_centre_city    ON atlas.chain_centre (city_key);
CREATE INDEX IF NOT EXISTS idx_chain_centre_pincode ON atlas.chain_centre (pincode);
CREATE INDEX IF NOT EXISTS idx_chain_centre_phone   ON atlas.chain_centre (phone_digits);
CREATE INDEX IF NOT EXISTS idx_chain_centre_matched ON atlas.chain_centre ((matched_lab_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_chain_centre_name_trgm
  ON atlas.chain_centre USING gin (lower(name) gin_trgm_ops);

COMMENT ON TABLE atlas.chain_centre IS
  'Collection centres published by the national diagnostic chains, one row per '
  'centre per chain. Reference data: a centre here is not a LabStack provider.';

-- Everything text, so a malformed coordinate fails on the cast and not the copy.
CREATE UNLOGGED TABLE IF NOT EXISTS atlas.chain_centre_stage (
  chain text, external_id text, name text, address text, city text, state text,
  pincode text, phone text, whatsapp text, open_hours text, map_link text,
  latitude text, longitude text, source_url text
);

/*
 * Fold the staging rows in for ONE chain at a time.
 *
 * Per chain, because a refresh of Thyrocare must not look like Metropolis
 * going missing: centres the chain no longer lists are deleted, but only
 * within the chain being loaded.
 */
CREATE OR REPLACE FUNCTION atlas.load_chain_centres(p_chain text) RETURNS integer AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO atlas.chain_centre (
    chain, external_id, name, address, city, state, pincode, phone, whatsapp,
    open_hours, map_link, latitude, longitude, city_key, phone_digits,
    source_url, email, pulled_on, updated_at)
  SELECT DISTINCT ON (s.chain, id.external_id)
    s.chain,
    id.external_id,
    s.name, s.address, s.city, s.state, NULLIF(btrim(s.pincode), ''),
    s.phone, s.whatsapp, s.open_hours, s.map_link,
    NULLIF(btrim(s.latitude), '')::double precision,
    NULLIF(btrim(s.longitude), '')::double precision,
    atlas.city_key(s.city),
    NULLIF(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), ''),
    s.source_url, NULLIF(btrim(lower(s.email)), ''), atlas.ist_today(), now()
  FROM atlas.chain_centre_stage s
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      NULLIF(btrim(s.external_id), ''),
      md5(lower(coalesce(s.name, '')) || '|' || coalesce(s.pincode, '')
          || '|' || lower(coalesce(s.address, '')))) AS external_id
  ) id
  WHERE s.chain = p_chain AND coalesce(btrim(s.name), '') <> ''
  ON CONFLICT (chain, external_id) DO UPDATE SET
    name = EXCLUDED.name, address = EXCLUDED.address, city = EXCLUDED.city,
    state = EXCLUDED.state, pincode = EXCLUDED.pincode, phone = EXCLUDED.phone,
    whatsapp = EXCLUDED.whatsapp, open_hours = EXCLUDED.open_hours,
    map_link = EXCLUDED.map_link, latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude, city_key = EXCLUDED.city_key,
    phone_digits = EXCLUDED.phone_digits, source_url = EXCLUDED.source_url,
    email = EXCLUDED.email,
    pulled_on = EXCLUDED.pulled_on, updated_at = now();

  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM atlas.chain_centre c
   WHERE c.chain = p_chain AND c.updated_at < now() - interval '1 minute';

  DELETE FROM atlas.chain_centre_stage WHERE chain = p_chain;

  PERFORM atlas.match_chain_centres(p_chain);
  -- Defined in 43 and 46; resolved at call time, so the file order is fine.
  PERFORM atlas.fill_chain_centre_states();
  PERFORM atlas.fill_reference_geo();
  RETURN n;
END;
$$ LANGUAGE plpgsql;

/*
 * Pair each centre with the console lab that looks like it — same pincode,
 * name similarity over 0.45, exactly as the NABL register does, so the two
 * screens mean the same thing by "already on our network".
 */
CREATE OR REPLACE FUNCTION atlas.match_chain_centres(p_chain text DEFAULT NULL)
RETURNS integer AS $$
DECLARE
  n integer;
BEGIN
  UPDATE atlas.chain_centre c SET
    matched_lab_id = NULL, matched_lab_name = NULL, matched_score = NULL
  WHERE p_chain IS NULL OR c.chain = p_chain;

  UPDATE atlas.chain_centre c SET
    matched_lab_id   = best.id,
    matched_lab_name = best."labName",
    matched_score    = best.score
  FROM (
    SELECT DISTINCT ON (cc.chain, cc.external_id)
           cc.chain, cc.external_id, l.id, l."labName",
           similarity(lower(l."labName"), lower(cc.name)) AS score
    FROM atlas.chain_centre cc
    JOIN src_local."Lab" l
      ON l.active AND l.pincode = cc.pincode
     AND similarity(lower(l."labName"), lower(cc.name)) > 0.45
    WHERE p_chain IS NULL OR cc.chain = p_chain
    ORDER BY cc.chain, cc.external_id, score DESC
  ) best
  WHERE best.chain = c.chain AND best.external_id = c.external_id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION atlas.load_chain_centres(text) IS
  'Folds atlas.chain_centre_stage into atlas.chain_centre for one chain, drops '
  'centres that chain no longer lists, and re-runs the console match.';
