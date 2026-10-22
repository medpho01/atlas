-- ===========================================================================
-- 31_sales_crm.sql — the pipeline for signing new stores.
--
-- Atlas already has a CRM at /crm and this is deliberately not it. That one is
-- supply-side: a thread is a campaign to onboard N providers and the card is a
-- provider inside it. This one is demand-side: one card is one company we are
-- trying to sign as a LabStack store, with a value, a close date and an owner.
-- Same shapes — jsonb stages, an activity trail, an assignee — different
-- nouns, different team, different lifecycle. Sharing the tables would mean a
-- change for sales could break the network team's board.
--
-- The anchor is that a won deal becomes a Store. LabStack's customers ARE
-- stores, so sales_deal.store_id is the outcome, and from that moment
-- Stores & Orders already answers what the account went on to send. Nothing
-- else in Atlas can say "we signed them in March, and here is what they have
-- actually sent since".
--
-- Atlas cannot create a store — that is the console's, and src is read-only.
-- So winning a deal asks which store it became, and a deal with nowhere to
-- point stays where it is.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The pipeline. One today; the column stays because the account-management
-- CRM will add its own, and a second pipeline should be a row rather than a
-- migration.
--
-- Stages are jsonb in the same shape 06_crm.sql uses, so the editor and the
-- rendering are the same idea in both places:
--   [{"key":"prospect","label":"Prospect","probability":10,"outcome":"open"}]
-- outcome is open | won | lost. Exactly one won and one lost, enforced by the
-- application because a CHECK cannot read inside an array cleanly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.sales_pipeline (
  id          serial PRIMARY KEY,
  name        text        NOT NULL,
  stages      jsonb       NOT NULL,
  is_default  boolean     NOT NULL DEFAULT false,
  created_by  integer     REFERENCES atlas.users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO atlas.sales_pipeline (name, stages, is_default)
SELECT 'New stores', $json$[
  {"key":"prospect",  "label":"Prospect",  "probability":10,  "outcome":"open"},
  {"key":"qualified", "label":"Qualified", "probability":35,  "outcome":"open"},
  {"key":"pilot",     "label":"Pilot",     "probability":60,  "outcome":"open"},
  {"key":"contract",  "label":"Contract",  "probability":85,  "outcome":"open"},
  {"key":"won",       "label":"Won",       "probability":100, "outcome":"won"},
  {"key":"lost",      "label":"Lost",      "probability":0,   "outcome":"lost"}
]$json$::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM atlas.sales_pipeline);

-- ---------------------------------------------------------------------------
-- The deal. A prospective store.
--
-- The company is plain text while it is a prospect, on purpose: a second
-- address book would have to be kept in step with the console, and a prospect
-- is not a store yet. store_id arrives when it is won, and from then on the
-- company's real behaviour is read from Stores & Orders rather than retyped.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.sales_deal (
  id            serial PRIMARY KEY,
  pipeline_id   integer     NOT NULL REFERENCES atlas.sales_pipeline (id),
  company       text        NOT NULL,
  website       text,
  city          text,
  state         text,
  stage_key     text        NOT NULL,
  value_inr     numeric(12,0),
  expected_close date,
  source        text,
  owner_id      integer     REFERENCES atlas.users (id),
  contact_name  text,
  contact_role  text,
  contact_phone text,
  contact_email text,
  -- Set only when the deal is won, and only to a store that already exists in
  -- the console. Atlas never creates one.
  store_id      integer,
  lost_reason   text,
  closed_at     timestamptz,
  -- The clock the board's "stuck" badge reads. Bumped by a note, a task or a
  -- stage move; NOT by editing a field, because tidying a value is not contact.
  last_touch_at timestamptz NOT NULL DEFAULT now(),
  stage_since   timestamptz NOT NULL DEFAULT now(),
  created_by    integer     REFERENCES atlas.users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_deal_stage ON atlas.sales_deal (pipeline_id, stage_key);
CREATE INDEX IF NOT EXISTS idx_sales_deal_owner ON atlas.sales_deal (owner_id);
CREATE INDEX IF NOT EXISTS idx_sales_deal_touch ON atlas.sales_deal (last_touch_at);
CREATE INDEX IF NOT EXISTS idx_sales_deal_store ON atlas.sales_deal (store_id);
CREATE INDEX IF NOT EXISTS idx_sales_deal_company ON atlas.sales_deal (lower(company));

-- ---------------------------------------------------------------------------
-- Notes, tasks, tags, and the stage trail.
--
-- The trail is written rather than derived, unlike the order queues: a stage
-- move leaves no trace in the row it came from, so "when did this reach
-- Pilot" has only one place to live.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.sales_note (
  id         bigserial PRIMARY KEY,
  deal_id    integer     NOT NULL REFERENCES atlas.sales_deal (id) ON DELETE CASCADE,
  kind       text        NOT NULL DEFAULT 'note'
               CHECK (kind IN ('note', 'call', 'email', 'meeting', 'stage', 'system')),
  body       text,
  author_id  integer     REFERENCES atlas.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_note_deal ON atlas.sales_note (deal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS atlas.sales_task (
  id          bigserial PRIMARY KEY,
  deal_id     integer     NOT NULL REFERENCES atlas.sales_deal (id) ON DELETE CASCADE,
  title       text        NOT NULL,
  due_on      date,
  assignee_id integer     REFERENCES atlas.users (id),
  done_at     timestamptz,
  done_by     integer     REFERENCES atlas.users (id),
  created_by  integer     REFERENCES atlas.users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_task_deal ON atlas.sales_task (deal_id, done_at, due_on);
CREATE INDEX IF NOT EXISTS idx_sales_task_open ON atlas.sales_task (assignee_id, due_on) WHERE done_at IS NULL;

CREATE TABLE IF NOT EXISTS atlas.sales_tag (
  id    serial PRIMARY KEY,
  label text NOT NULL,
  key   text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS atlas.sales_deal_tag (
  deal_id integer NOT NULL REFERENCES atlas.sales_deal (id) ON DELETE CASCADE,
  tag_id  integer NOT NULL REFERENCES atlas.sales_tag (id) ON DELETE CASCADE,
  PRIMARY KEY (deal_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_sales_deal_tag_tag ON atlas.sales_deal_tag (tag_id);

CREATE TABLE IF NOT EXISTS atlas.sales_stage_event (
  id         bigserial PRIMARY KEY,
  deal_id    integer     NOT NULL REFERENCES atlas.sales_deal (id) ON DELETE CASCADE,
  from_key   text,
  to_key     text        NOT NULL,
  moved_by   integer     REFERENCES atlas.users (id),
  moved_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_stage_event_deal ON atlas.sales_stage_event (deal_id, moved_at DESC);

-- ---------------------------------------------------------------------------
-- analytics.v_sales_deal — the board's row.
--
-- Stuck is computed here rather than stored: fourteen days without a note, a
-- task or a move. Deriving it means it can never be stale and there is nothing
-- to configure — it is not a stage, it is a fact about a stage.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_sales_deal AS
SELECT
  d.id                                   AS deal_id,
  d.pipeline_id,
  d.company, d.website, d.city, d.state,
  d.stage_key,
  st.label                               AS stage_label,
  (st.probability)::int                  AS stage_probability,
  st.outcome                             AS stage_outcome,
  d.value_inr,
  ROUND(COALESCE(d.value_inr, 0) * COALESCE(st.probability, 0) / 100.0) AS weighted_inr,
  d.expected_close::text                 AS expected_close,
  d.source,
  d.owner_id,
  u.name                                 AS owner_name,
  d.contact_name, d.contact_role, d.contact_phone, d.contact_email,
  d.store_id,
  s."storeName"                          AS store_name,
  d.lost_reason,
  (d.closed_at   AT TIME ZONE 'Asia/Kolkata')::text AS closed_at,
  (d.created_at  AT TIME ZONE 'Asia/Kolkata')::text AS created_at,
  (d.last_touch_at AT TIME ZONE 'Asia/Kolkata')::text AS last_touch_at,
  EXTRACT(day FROM now() - d.last_touch_at)::int     AS days_quiet,
  EXTRACT(day FROM now() - d.stage_since)::int       AS days_in_stage,
  (now() - d.last_touch_at > interval '14 days'
     AND st.outcome = 'open')            AS is_stuck,
  (SELECT count(*)::int FROM atlas.sales_note n WHERE n.deal_id = d.id)   AS note_count,
  (SELECT count(*)::int FROM atlas.sales_task t
     WHERE t.deal_id = d.id AND t.done_at IS NULL)                        AS open_tasks,
  -- The next thing somebody has actually committed to, which is the only
  -- column on a board that says whether a deal is being worked.
  (SELECT t.title FROM atlas.sales_task t
     WHERE t.deal_id = d.id AND t.done_at IS NULL
     ORDER BY t.due_on NULLS LAST, t.id LIMIT 1)                          AS next_task,
  (SELECT t.due_on::text FROM atlas.sales_task t
     WHERE t.deal_id = d.id AND t.done_at IS NULL
     ORDER BY t.due_on NULLS LAST, t.id LIMIT 1)                          AS next_task_due,
  (SELECT t.due_on < atlas.ist_today() FROM atlas.sales_task t
     WHERE t.deal_id = d.id AND t.done_at IS NULL
     ORDER BY t.due_on NULLS LAST, t.id LIMIT 1)                          AS next_task_late,
  COALESCE((SELECT array_agg(tg.label ORDER BY tg.label)
              FROM atlas.sales_deal_tag dt
              JOIN atlas.sales_tag tg ON tg.id = dt.tag_id
             WHERE dt.deal_id = d.id), ARRAY[]::text[])                   AS tags
FROM atlas.sales_deal d
JOIN atlas.sales_pipeline p ON p.id = d.pipeline_id
LEFT JOIN LATERAL (
  SELECT x.key, x.label, x.probability, x.outcome
  FROM jsonb_to_recordset(p.stages)
       AS x(key text, label text, probability numeric, outcome text)
  WHERE x.key = d.stage_key
) st ON true
LEFT JOIN atlas.users u ON u.id = d.owner_id
LEFT JOIN src_local."Store" s ON s.id = d.store_id;

COMMENT ON VIEW analytics.v_sales_deal IS
  'One row per deal with its stage, its next committed task and whether it has '
  'gone quiet. Stuck is derived — fourteen days without a note, a task or a '
  'move — so it is never stale and there is nothing to configure.';
