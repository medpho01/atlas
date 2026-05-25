-- ============================================================================
-- atlas auth schema
-- Atlas's own writable namespace. The role used by the app gets:
--   GRANT SELECT ON ALL TABLES IN SCHEMA public TO atlas_app;   -- read-only
--   GRANT ALL    ON ALL TABLES IN SCHEMA atlas  TO atlas_app;   -- read/write
-- so a bug in Atlas can never corrupt the operational LabStack data.
-- Idempotent: safe to re-run.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS atlas;

-- ---- atlas.users -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.users (
  id              serial      PRIMARY KEY,
  email           text        UNIQUE NOT NULL,
  password_hash   text        NOT NULL,
  name            text        NOT NULL,
  role            text        NOT NULL DEFAULT 'viewer',  -- 'admin' | 'editor' | 'viewer'
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_atlas_users_email ON atlas.users (LOWER(email));

-- ---- atlas.sessions --------------------------------------------------------
-- Server-side session store. session_id is a random opaque token sent as a
-- httpOnly cookie; the client never sees the user_id.
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
-- Per-user saved settings. Free-form jsonb so we can add keys without DDL:
--   ('default_lens', '"LAB_HOME_SAMPLE"'::jsonb)
--   ('favorite_pincodes', '["560102","110001"]'::jsonb)
--   ('theme', '"dark"'::jsonb)
CREATE TABLE IF NOT EXISTS atlas.user_preferences (
  user_id     int   NOT NULL REFERENCES atlas.users(id) ON DELETE CASCADE,
  key         text  NOT NULL,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- ---- atlas.audit_log -------------------------------------------------------
-- Optional but cheap: append-only record of who hit which page. Useful for
-- "did the CEO actually open the dashboard this week?" answer.
CREATE TABLE IF NOT EXISTS atlas.audit_log (
  id          bigserial   PRIMARY KEY,
  user_id     int         REFERENCES atlas.users(id) ON DELETE SET NULL,
  path        text        NOT NULL,
  action      text        NOT NULL DEFAULT 'view',  -- 'view' | 'login' | 'logout'
  ip          inet,
  user_agent  text,
  ts          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atlas_audit_user_ts ON atlas.audit_log (user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_audit_ts      ON atlas.audit_log (ts DESC);

COMMENT ON SCHEMA atlas IS
  'Atlas-owned namespace. Reference data + auth + per-user state. The app role has read-write here and read-only on public.*';
