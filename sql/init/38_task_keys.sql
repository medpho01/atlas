-- A task is written once and read from both screens.
--
-- account_task predates atlas.account: it was keyed by store_id, and 36 added
-- account_id without changing the writers. So a task created on Account health
-- carries only store_id and never appears on the account profile, and a task
-- created on the profile carries only account_id and never appears in the
-- store-keyed task list. Same table, two keys, two half-blind screens.
--
-- Filling the missing key in the database rather than in each writer is what
-- makes that impossible to get wrong again: every path, now and later, writes
-- both.

CREATE OR REPLACE FUNCTION atlas.account_task_fill_keys() RETURNS trigger AS $$
BEGIN
  IF NEW.account_id IS NULL AND NEW.store_id IS NOT NULL THEN
    SELECT a.id INTO NEW.account_id FROM atlas.account a WHERE a.store_id = NEW.store_id;
  END IF;

  IF NEW.store_id IS NULL AND NEW.account_id IS NOT NULL THEN
    SELECT a.store_id INTO NEW.store_id FROM atlas.account a WHERE a.id = NEW.account_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_account_task_fill_keys ON atlas.account_task;
CREATE TRIGGER trg_account_task_fill_keys
  BEFORE INSERT OR UPDATE OF store_id, account_id ON atlas.account_task
  FOR EACH ROW EXECUTE FUNCTION atlas.account_task_fill_keys();

COMMENT ON FUNCTION atlas.account_task_fill_keys() IS
  'Keeps account_task.store_id and account_id in step, so a task written from '
  'either screen is visible on both. An account with no store keeps store_id null.';

-- Everything written between 36 and this file.
UPDATE atlas.account_task t
   SET account_id = a.id
  FROM atlas.account a
 WHERE t.account_id IS NULL AND a.store_id = t.store_id;

UPDATE atlas.account_task t
   SET store_id = a.store_id
  FROM atlas.account a
 WHERE t.store_id IS NULL AND a.id = t.account_id AND a.store_id IS NOT NULL;
