-- The franchisee's own email address.
--
-- Redcliffe publishes one per centre (laboperations.<city>@redcliffelabs.com)
-- and it is the most directly useful field on the screen for a salesperson:
-- a named inbox at the centre rather than the chain's switchboard. The other
-- chains don't publish it yet, so the column is blank for them — kept in the
-- shared table rather than a Redcliffe-only one, because every chain could
-- start publishing it and the screen should not care which did.

ALTER TABLE atlas.chain_centre       ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE atlas.chain_centre_stage ADD COLUMN IF NOT EXISTS email text;

CREATE INDEX IF NOT EXISTS idx_chain_centre_email
  ON atlas.chain_centre ((email IS NOT NULL));
