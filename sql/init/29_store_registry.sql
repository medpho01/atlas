-- ===========================================================================
-- 29_store_registry.sql — adding and removing stores from Atlas.
--
-- The constraint this file is built around
-- ----------------------------------------
-- A store record belongs to LabStack. Atlas reaches it through a read-only
-- replica, mirrored into src_local."Store" — and scripts/refresh-data.sh
-- TRUNCATEs that mirror every night at 3 AM and refills it from the source.
--
-- So a row inserted into src_local."Store" would appear to work, survive the
-- afternoon, and be gone by morning with nothing to say why. That is worse
-- than refusing: a partner would be onboarded, worked, and silently lost.
--
-- What this file does instead is give Atlas its own store table, unioned with
-- the mirror behind one view. A store added here is Atlas's, persists through
-- the refresh, and is marked as not-yet-in-the-console so nobody mistakes it
-- for a partner the console can take orders for.
--
-- Removing splits the same way, and the screen says which is happening:
--   · a store Atlas created, with nothing depending on it  → deleted outright
--   · anything else (LabStack's, or one with orders behind it) → archived,
--     which hides it from this screen and leaves the record and its history
--     exactly where they are.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- atlas.store — partners Atlas knows about that LabStack does not, yet.
--
-- Ids start at 900000. LabStack's are a serial in the low thousands, and the
-- two sets share a namespace the moment they are unioned — an overlap would
-- put one store's orders under another's name, which is the kind of mistake
-- that is only found by a partner reading their own list and not recognising
-- it. Nine hundred thousand is far enough ahead to be safe for the life of
-- the system and obvious enough on sight to be recognisable in a URL.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS atlas.store_id_seq START WITH 900000 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS atlas.store (
  id             int  PRIMARY KEY DEFAULT nextval('atlas.store_id_seq'),
  store_name     text NOT NULL CHECK (btrim(store_name) <> ''),
  legal_name     text,
  store_type     text,

  -- Location.
  address        text,
  locality       text,
  city           text,
  state          text,
  pincode        text CHECK (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$'),

  -- Contact.
  contact_name   text,
  contact_phone  text,
  contact_email  text CHECK (contact_email IS NULL OR contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  -- Service coverage: the pincodes this partner sends work from. Kept as an
  -- array rather than a join table because it is read whole, written whole,
  -- and never queried across stores.
  service_pincodes text[],

  active         boolean NOT NULL DEFAULT true,
  note           text,

  created_by     int REFERENCES atlas.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     int REFERENCES atlas.users(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE atlas.store IS
  'Stores Atlas owns — added here, not in the console. Unioned with the '
  'src_local mirror by analytics.v_store_directory. Survives the nightly '
  'refresh, which truncates the mirror.';

-- Two partners with the same name in the same city is almost always somebody
-- adding one that already exists. Not a hard constraint on name alone: two
-- genuinely different branches of a chain share a name across cities.
CREATE UNIQUE INDEX IF NOT EXISTS idx_atlas_store_name_city
  ON atlas.store (lower(btrim(store_name)), lower(COALESCE(btrim(city), '')));


-- ---------------------------------------------------------------------------
-- atlas.store_archive — stores hidden from this screen.
--
-- The honest form of "remove" for a record Atlas does not own. The store stays
-- in LabStack, its orders stay in the ledger, and every report that reads them
-- keeps reading them; what changes is that it stops appearing on a screen
-- somebody is working. Reversible, and it says who and why.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.store_archive (
  store_id     int  PRIMARY KEY,
  reason       text,
  archived_by  int  REFERENCES atlas.users(id) ON DELETE SET NULL,
  archived_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE atlas.store_archive IS
  'Stores hidden from Stores & Orders. Not a delete — the LabStack record and '
  'its order history are untouched.';


-- ---------------------------------------------------------------------------
-- analytics.v_store_directory — every store the screen knows about, from
-- both sides, in one shape.
--
-- `source` is the column everything else keys off: it decides whether a store
-- can be deleted, whether its fields are editable, and what the row says about
-- itself. Without it the screen would have to guess from the id range, which
-- works right up until it does not.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS analytics.v_store_directory;

CREATE VIEW analytics.v_store_directory AS
SELECT
  s.id,
  'labstack'::text                       AS source,
  COALESCE(NULLIF(btrim(s."storeName"), ''), 'Store ' || s.id) AS store_name,
  s."legalName"                          AS legal_name,
  s."storeType"                          AS store_type,
  s.address, s.locality, s.city, s.state, s.pincode,
  s.pocs[1] ->> 'name'                   AS contact_name,
  s.pocs[1] ->> 'phone'                  AS contact_phone,
  s.pocs[1] ->> 'email'                  AS contact_email,
  NULL::text[]                           AS service_pincodes,
  COALESCE(s.active, false)              AS active,
  COALESCE(s."apiEnabled", false)        AS api_enabled,
  NULL::text                             AS note,
  (s."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') AS created_at,
  NULL::int                              AS created_by,
  -- A LabStack store is never editable or deletable from here.
  false                                  AS atlas_owned
FROM src_local."Store" s
WHERE NOT EXISTS (SELECT 1 FROM atlas.store_archive a WHERE a.store_id = s.id)

UNION ALL

SELECT
  a.id,
  'atlas'::text                          AS source,
  a.store_name,
  a.legal_name,
  a.store_type,
  a.address, a.locality, a.city, a.state, a.pincode,
  a.contact_name, a.contact_phone, a.contact_email,
  a.service_pincodes,
  a.active,
  false                                  AS api_enabled,
  a.note,
  a.created_at,
  a.created_by,
  true                                   AS atlas_owned
FROM atlas.store a
WHERE NOT EXISTS (SELECT 1 FROM atlas.store_archive ar WHERE ar.store_id = a.id);

COMMENT ON VIEW analytics.v_store_directory IS
  'Every store Stores & Orders shows: the LabStack mirror plus Atlas''s own, '
  'minus anything archived. source/atlas_owned say which side a row came from '
  'and therefore what may be done to it.';


-- ---------------------------------------------------------------------------
-- atlas.store_dependencies — what would be orphaned by removing a store.
--
-- The screen asks this before it offers to delete anything, because "remove
-- store" with an order book behind it is not a removal, it is a hole in the
-- ledger. Returns counts rather than a boolean so the confirmation can say
-- what is actually there.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.store_dependencies(sid int)
RETURNS TABLE (orders bigint, requests bigint, flags bigint, has_profile boolean)
LANGUAGE sql STABLE AS $$
  SELECT
    (SELECT count(*) FROM src_local."Order" o WHERE o."storeId" = sid),
    (SELECT count(*) FROM analytics.mv_request_state r WHERE r.store_id = sid),
    (SELECT count(*) FROM atlas.order_reschedule_flag f
      WHERE f.store_id = sid AND f.cleared_at IS NULL),
    (SELECT EXISTS (SELECT 1 FROM atlas.store_profile p WHERE p.store_id = sid))
$$;

COMMENT ON FUNCTION atlas.store_dependencies(int) IS
  'What sits behind a store, for the confirmation before removing it.';
