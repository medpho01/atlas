-- ===========================================================================
-- 30_role_access.sql — which screens a role can open, as data.
--
-- lib/access.ts holds a compiled matrix of feature × role → capability. It is
-- good code and it stays: it is the default, the fallback for any feature a
-- deploy adds before anybody configures it, and the thing that makes the rules
-- reviewable in a pull request.
--
-- What it cannot do is let an admin add a role, or move one screen between
-- teams, without a deploy. So the matrix also lives here, and the application
-- reads this on top of the compiled one: a row here wins, a missing row falls
-- back to the code.
--
-- Two invariants the application enforces and this file seeds:
--   * admin keeps manage on 'admin'. Otherwise one careless edit locks every
--     administrator out of the only screen that could undo it.
--   * a capability is exactly one of none / view / manage.
--
-- Idempotent. Safe to run twice. Re-running does NOT overwrite an edit: the
-- seed only fills rows that are not there.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS atlas.role_feature (
  role        text        NOT NULL,
  feature     text        NOT NULL,
  capability  text        NOT NULL CHECK (capability IN ('none', 'view', 'manage')),
  updated_by  integer     REFERENCES atlas.users (id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, feature)
);

COMMENT ON TABLE atlas.role_feature IS
  'Feature × role → capability, overriding the compiled matrix in lib/access.ts. '
  'A missing row means "whatever the code says", so a feature added by a deploy '
  'works before anybody opens the settings screen.';

-- Every change, because "who gave sales access to pricing" is asked later and
-- the row only remembers the current answer.
CREATE TABLE IF NOT EXISTS atlas.role_feature_log (
  id          bigserial PRIMARY KEY,
  role        text        NOT NULL,
  feature     text        NOT NULL,
  capability  text        NOT NULL,
  was         text,
  updated_by  integer     REFERENCES atlas.users (id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_role_feature_log_key
  ON atlas.role_feature_log (role, feature, updated_at DESC);

-- ---------------------------------------------------------------------------
-- The seed: the compiled matrix as it stands, plus the sales column.
--
-- ON CONFLICT DO NOTHING, so this is the starting point and never a reset. An
-- admin who moves a screen keeps that change through every later deploy.
--
-- Sales reads what an account conversation needs — coverage, catalogue,
-- pricing, requests, orders — and manages only its own pipeline. It does not
-- get the directory, provider onboarding or order tracking: those are the
-- network team's working queues.
-- ---------------------------------------------------------------------------
INSERT INTO atlas.role_feature (role, feature, capability) VALUES
  ('admin','overview','manage'),        ('admin','coverage','manage'),
  ('admin','directory','manage'),       ('admin','accountHealth','manage'),
  ('admin','catalogue','manage'),       ('admin','pricing','manage'),
  ('admin','providerPipeline','manage'),('admin','requests','manage'),
  ('admin','commitments','manage'),     ('admin','orderTracking','manage'),
  ('admin','storeOrders','manage'),     ('admin','salesCrm','manage'),
  ('admin','admin','manage'),

  ('network_lead','overview','view'),        ('network_lead','coverage','view'),
  ('network_lead','directory','manage'),     ('network_lead','accountHealth','view'),
  ('network_lead','catalogue','manage'),     ('network_lead','pricing','manage'),
  ('network_lead','providerPipeline','manage'),('network_lead','requests','manage'),
  ('network_lead','commitments','manage'),   ('network_lead','orderTracking','manage'),
  ('network_lead','storeOrders','view'),     ('network_lead','salesCrm','none'),
  ('network_lead','admin','none'),

  ('network','overview','view'),        ('network','coverage','view'),
  ('network','directory','manage'),     ('network','accountHealth','view'),
  ('network','catalogue','manage'),     ('network','pricing','manage'),
  ('network','providerPipeline','manage'),('network','requests','manage'),
  ('network','commitments','manage'),   ('network','orderTracking','view'),
  ('network','storeOrders','view'),     ('network','salesCrm','none'),
  ('network','admin','none'),

  ('operations','overview','view'),     ('operations','coverage','view'),
  ('operations','directory','view'),    ('operations','accountHealth','none'),
  ('operations','catalogue','none'),    ('operations','pricing','none'),
  ('operations','providerPipeline','none'),('operations','requests','manage'),
  ('operations','commitments','view'),  ('operations','orderTracking','view'),
  ('operations','storeOrders','view'),  ('operations','salesCrm','none'),
  ('operations','admin','none'),

  ('accounts','overview','view'),       ('accounts','coverage','view'),
  ('accounts','directory','view'),      ('accounts','accountHealth','manage'),
  ('accounts','catalogue','view'),      ('accounts','pricing','view'),
  ('accounts','providerPipeline','view'),('accounts','requests','view'),
  ('accounts','commitments','view'),    ('accounts','orderTracking','none'),
  ('accounts','storeOrders','manage'),  ('accounts','salesCrm','view'),
  ('accounts','admin','none'),

  ('sales','overview','view'),          ('sales','coverage','view'),
  ('sales','directory','none'),         ('sales','accountHealth','view'),
  ('sales','catalogue','view'),         ('sales','pricing','view'),
  ('sales','providerPipeline','none'),  ('sales','requests','view'),
  ('sales','commitments','view'),       ('sales','orderTracking','none'),
  ('sales','storeOrders','view'),       ('sales','salesCrm','manage'),
  ('sales','admin','none'),

  ('editor','overview','view'),         ('editor','coverage','view'),
  ('editor','directory','manage'),      ('editor','accountHealth','view'),
  ('editor','catalogue','manage'),      ('editor','pricing','manage'),
  ('editor','providerPipeline','manage'),('editor','requests','view'),
  ('editor','commitments','view'),      ('editor','orderTracking','view'),
  ('editor','storeOrders','view'),      ('editor','salesCrm','none'),
  ('editor','admin','none'),

  ('viewer','overview','view'),         ('viewer','coverage','view'),
  ('viewer','directory','view'),        ('viewer','accountHealth','view'),
  ('viewer','catalogue','view'),        ('viewer','pricing','view'),
  ('viewer','providerPipeline','view'), ('viewer','requests','none'),
  ('viewer','commitments','none'),      ('viewer','orderTracking','none'),
  ('viewer','storeOrders','view'),      ('viewer','salesCrm','none'),
  ('viewer','admin','none')
ON CONFLICT (role, feature) DO NOTHING;

-- The invariant, in the database as well as the application: whatever else is
-- edited, an admin can always reach the screen that edits it.
UPDATE atlas.role_feature SET capability = 'manage'
 WHERE role = 'admin' AND feature = 'admin' AND capability <> 'manage';
