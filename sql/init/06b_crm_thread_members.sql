-- ---------------------------------------------------------------------------
-- Who works which thread.
--
-- Providers were assigned per card, so a thread had no roster: you could see
-- that Suraj owned 19 providers but not which campaigns were his, and the
-- add-provider form offered every thread whether or not it was his work.
--
-- Membership is separate from card assignment on purpose. Being on a thread is
-- "this campaign is mine to work"; owning a card is "this provider is mine to
-- move". A lead can be on a thread with no cards yet, and that is the state the
-- old model could not express.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.crm_thread_members (
  thread_id  int NOT NULL REFERENCES atlas.crm_threads(id) ON DELETE CASCADE,
  user_id    int NOT NULL REFERENCES atlas.users(id)       ON DELETE CASCADE,
  added_by   int REFERENCES atlas.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_thread_members_user
  ON atlas.crm_thread_members (user_id);

-- Anyone already holding a card on a thread is working it, so seed membership
-- from the cards rather than starting empty and making everyone re-enter what
-- the data already knows.
INSERT INTO atlas.crm_thread_members (thread_id, user_id)
SELECT DISTINCT tp.thread_id, tp.assignee_id
FROM atlas.crm_thread_providers tp
WHERE tp.assignee_id IS NOT NULL
ON CONFLICT DO NOTHING;
