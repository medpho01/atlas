-- ============================================================================
-- atlas-db init #1: schema + tables.
-- This script runs ONCE when atlas-db's data volume is empty (first boot).
-- Subsequent restarts skip it; the volume persists the schema.
--
-- atlas-db is Atlas's owned database. The Postgres user (`atlas`) has full
-- control here. The operational LabStack DB is reached separately via
-- SOURCE_DATABASE_URL and is read-only from Atlas's perspective.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS atlas;

-- ---- atlas.users -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.users (
  id              serial      PRIMARY KEY,
  email           text        UNIQUE NOT NULL,
  password_hash   text        NOT NULL,
  name            text        NOT NULL,
  role            text        NOT NULL DEFAULT 'viewer',
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_atlas_users_email ON atlas.users (LOWER(email));

-- ---- atlas.sessions --------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.sessions (
  session_id      text        PRIMARY KEY,
  user_id         int         NOT NULL REFERENCES atlas.users(id) ON DELETE CASCADE,
  expires_at      timestamptz NOT NULL,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  ip              inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_sessions_user    ON atlas.sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_atlas_sessions_expires ON atlas.sessions (expires_at);

-- ---- atlas.user_preferences ------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.user_preferences (
  user_id     int   NOT NULL REFERENCES atlas.users(id) ON DELETE CASCADE,
  key         text  NOT NULL,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- ---- atlas.audit_log -------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.audit_log (
  id          bigserial   PRIMARY KEY,
  user_id     int         REFERENCES atlas.users(id) ON DELETE SET NULL,
  path        text        NOT NULL,
  action      text        NOT NULL DEFAULT 'view',
  ip          inet,
  user_agent  text,
  ts          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_audit_user_ts ON atlas.audit_log (user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_audit_ts      ON atlas.audit_log (ts DESC);

-- ---- atlas.pincode_directory ------------------------------------------------
-- Authoritative pincode → district/state/lat-long reference (India Post via
-- the dropdevrahul/pincodes-india mirror). Populated by 02_pincode_directory.sql
-- on first boot, then read-only at runtime.
CREATE TABLE IF NOT EXISTS atlas.pincode_directory (
  pincode      text PRIMARY KEY,
  city         text,
  district     text,
  state        text,
  office_name  text,
  office_type  text,
  circle       text,
  latitude     double precision,
  longitude    double precision
);
CREATE INDEX IF NOT EXISTS idx_atlas_pin_dir_state ON atlas.pincode_directory(state);
CREATE INDEX IF NOT EXISTS idx_atlas_pin_dir_city  ON atlas.pincode_directory(city);

COMMENT ON SCHEMA atlas IS
  'Atlas application state: auth + audit + reference data. Read-write by the app.';
