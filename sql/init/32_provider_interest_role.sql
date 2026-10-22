-- ===========================================================================
-- 32_provider_interest_role.sql — who may press the like/dislike on a phlebo
-- or nurse row.
--
-- It was gated on `directory: manage`, which is network and admin. Operations
-- ring these people too, and the only way to let them was to give them manage
-- on the whole directory — which would also let them edit labs, upload lists
-- and change a provider's record. Two buttons are not worth that.
--
-- So the buttons get a feature of their own. It is a row in the matrix like
-- any other, which means it can be moved between teams from Roles & screens
-- without a deploy — the point of 30.
--
-- Idempotent. ON CONFLICT DO NOTHING, so an admin who has already moved it
-- keeps that change.
-- ===========================================================================

INSERT INTO atlas.role_feature (role, feature, capability) VALUES
  ('admin',        'providerInterest', 'manage'),
  ('network_lead', 'providerInterest', 'manage'),
  ('network',      'providerInterest', 'manage'),
  ('operations',   'providerInterest', 'manage'),
  ('editor',       'providerInterest', 'manage'),
  ('accounts',     'providerInterest', 'none'),
  ('sales',        'providerInterest', 'none'),
  ('viewer',       'providerInterest', 'none')
ON CONFLICT (role, feature) DO NOTHING;
