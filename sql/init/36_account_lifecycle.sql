-- The account lifecycle: one row per company, from first meeting to QBR.
--
-- Atlas had a sales board keyed by a typed company name and an account health
-- report keyed by a console store_id, and nothing in between — which is exactly
-- where onboarding lives. atlas.account is that missing row: created when sales
-- opens the opportunity, linked to a store when the console mints one, carried
-- through every stage. Deals, meetings, contacts, services and tasks all point
-- at it, so a handover moves a pointer rather than re-keying a history.
--
-- Atlas still cannot create a store: src is read-only and the console owns it.
-- store_id stays nullable and is filled at go-live.

-- ---------------------------------------------------------------- departments

-- Who does the work. Roles say what somebody may see in Atlas; departments say
-- which team owns a step, which is a different question and outlives the person.
CREATE TABLE IF NOT EXISTS atlas.department (
  key        text PRIMARY KEY,
  label      text    NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  active     boolean NOT NULL DEFAULT true
);

INSERT INTO atlas.department (key, label, sort_order) VALUES
  ('sales',        'Sales',        10),
  ('accounts',     'Accounts',     20),
  ('integrations', 'Integrations', 30),
  ('network',      'Network',      40),
  ('operations',   'Operations',   50),
  ('finance',      'Finance',      60),
  ('product',      'Product',      70)
ON CONFLICT (key) DO NOTHING;

-- -------------------------------------------------------------------- account

CREATE TABLE IF NOT EXISTS atlas.account (
  id            serial PRIMARY KEY,
  name          text        NOT NULL,
  website       text,
  city          text,
  state         text,
  -- A key from atlas.sales_account_type: insurer, broker, healthtech…
  account_type  text,

  -- Where the account is in its life. 'lost' is a prospect that went nowhere;
  -- 'churned' is a customer that stopped. Keeping both means the funnel's
  -- conversion rate and the book's retention never contaminate each other.
  lifecycle     text        NOT NULL DEFAULT 'sales'
                  CHECK (lifecycle IN ('sales', 'onboarding', 'managed', 'churned', 'lost')),
  owner_id      integer     REFERENCES atlas.users (id) ON DELETE SET NULL,

  -- Set only once the console has a store. Until then the account is real and
  -- the store is not, which is the whole reason this table exists.
  store_id      integer UNIQUE,

  -- Typed by sales, in ₹ crore. Nothing in our data can infer either: the
  -- premium book sizes the relationship, the OPD book is the denominator for
  -- our share once they are live.
  premium_book_cr numeric(10,2),
  opd_book_cr     numeric(10,2),
  -- What one service is worth to them, typed alongside the book. Without it a
  -- ₹Cr book cannot be turned into a number of services, and share stays blank
  -- rather than being derived from a constant somebody invented once.
  avg_ticket_inr  numeric(10,2),

  -- How often somebody should be in front of them. The cadence belongs to the
  -- account, not to a task, so it cannot quietly stop when a task is deleted.
  review_cadence text       NOT NULL DEFAULT 'none'
                  CHECK (review_cadence IN ('none', 'weekly', 'fortnightly', 'monthly', 'quarterly')),

  source        text,
  mou_signed_on date,
  go_live_on    date,
  live_since    date,
  closed_reason text,
  created_by    integer     REFERENCES atlas.users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_lifecycle ON atlas.account (lifecycle, name);
CREATE INDEX IF NOT EXISTS idx_account_owner     ON atlas.account (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_account_type      ON atlas.account (account_type);

COMMENT ON TABLE atlas.account IS
  'One row per company across sales, onboarding and account management. '
  'store_id is filled at go-live; Atlas never creates the store itself.';

-- ------------------------------------------------------------------- contacts

-- A deal used to carry exactly one contact in four columns. Who decides and who
-- you talk to are rarely the same person, and account management needs both a
-- year later.
CREATE TABLE IF NOT EXISTS atlas.account_contact (
  id                bigserial PRIMARY KEY,
  account_id        integer     NOT NULL REFERENCES atlas.account (id) ON DELETE CASCADE,
  name              text        NOT NULL,
  role              text,
  phone             text,
  email             text,
  is_decision_maker boolean     NOT NULL DEFAULT false,
  note              text,
  created_by        integer     REFERENCES atlas.users (id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_contact ON atlas.account_contact (account_id, is_decision_maker DESC, id);

-- ------------------------------------------------------------------- meetings

-- A meeting was a note with kind='meeting' and no date of its own. First met,
-- last met, next due, how many, and what was agreed each time all fall out of
-- giving it a table — shared by all three stages, so the count never resets.
CREATE TABLE IF NOT EXISTS atlas.meeting (
  id             bigserial PRIMARY KEY,
  account_id     integer     NOT NULL REFERENCES atlas.account (id) ON DELETE CASCADE,
  -- 'mbr' and 'qbr' are the reviews the cadence schedules; the rest are ordinary
  -- contact. Separating them is what lets "last business review" mean something.
  kind           text        NOT NULL DEFAULT 'meeting'
                   CHECK (kind IN ('meeting', 'call', 'mbr', 'qbr')),
  -- Exactly one of these is set: a meeting that happened, or one that is booked.
  happened_on    date,
  scheduled_on   date,
  title          text,
  attendees      text,
  notes          text,
  -- What was agreed. Kept beside the meeting rather than only as a task,
  -- because the two answer different questions a year apart.
  next_step      text,
  next_step_due  date,
  next_step_owner_id integer  REFERENCES atlas.users (id) ON DELETE SET NULL,
  created_by     integer      REFERENCES atlas.users (id),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT meeting_has_a_date CHECK (happened_on IS NOT NULL OR scheduled_on IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_meeting_account ON atlas.meeting (account_id, happened_on DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_meeting_upcoming ON atlas.meeting (scheduled_on) WHERE scheduled_on IS NOT NULL;

-- ------------------------------------------------------------------- services

-- What an account is entitled to order, which is not what it has ordered.
-- analytics.v_account_line knows the second; only a human knows the first, and
-- the gap between them is the most useful number on the account screen.
CREATE TABLE IF NOT EXISTS atlas.account_service (
  account_id    integer     NOT NULL REFERENCES atlas.account (id) ON DELETE CASCADE,
  -- Matches v_account_line.stream: LAB_ORDER, APPOINTMENT, PHARMA_ORDER.
  stream        text        NOT NULL,
  status        text        NOT NULL DEFAULT 'contracted'
                  CHECK (status IN ('discussed', 'contracted', 'live', 'paused')),
  contracted_on date,
  note          text,
  updated_by    integer     REFERENCES atlas.users (id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, stream)
);

-- ---------------------------------------------------------------------- tasks

-- account_task grows up: it was keyed by store_id, so it could not exist before
-- go-live — no onboarding plan could use it. It now hangs off the account, and
-- carries the three fields a plan needs: a department, a planned start, and
-- what it is waiting on.
ALTER TABLE atlas.account_task ADD COLUMN IF NOT EXISTS account_id    integer REFERENCES atlas.account (id) ON DELETE CASCADE;
ALTER TABLE atlas.account_task ADD COLUMN IF NOT EXISTS department    text;
ALTER TABLE atlas.account_task ADD COLUMN IF NOT EXISTS planned_start date;
ALTER TABLE atlas.account_task ADD COLUMN IF NOT EXISTS waits_on_id   bigint REFERENCES atlas.account_task (id) ON DELETE SET NULL;
-- 'onboarding' tasks are the go-live plan; 'managed' tasks are the running
-- relationship. Same table, because a step does not change shape when the
-- account does.
ALTER TABLE atlas.account_task ADD COLUMN IF NOT EXISTS phase         text NOT NULL DEFAULT 'managed';
ALTER TABLE atlas.account_task ADD COLUMN IF NOT EXISTS meeting_id    bigint REFERENCES atlas.meeting (id) ON DELETE SET NULL;
-- store_id predates the account and is now redundant; it stays nullable so the
-- rows written before this migration keep working.
ALTER TABLE atlas.account_task ALTER COLUMN store_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_task_account ON atlas.account_task (account_id, done_at, due_on);
CREATE INDEX IF NOT EXISTS idx_account_task_dept    ON atlas.account_task (department, due_on) WHERE done_at IS NULL;

-- ------------------------------------------------------------- the sales link

ALTER TABLE atlas.sales_deal ADD COLUMN IF NOT EXISTS account_id integer REFERENCES atlas.account (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_deal_account ON atlas.sales_deal (account_id);

-- ------------------------------------------------------------------- backfill

-- Every existing deal becomes an account. Won deals that named a store arrive
-- already managed; lost ones arrive lost; the rest are still selling.
INSERT INTO atlas.account (name, website, city, state, account_type, lifecycle,
                           owner_id, store_id, source, created_by, created_at)
SELECT d.company, d.website, d.city, d.state, d.account_type,
       CASE WHEN s.outcome = 'won' AND d.store_id IS NOT NULL THEN 'managed'
            WHEN s.outcome = 'won'                            THEN 'onboarding'
            WHEN s.outcome = 'lost'                           THEN 'lost'
            ELSE 'sales' END,
       d.owner_id, d.store_id, d.source, d.created_by, d.created_at
FROM atlas.sales_deal d
JOIN atlas.sales_pipeline p ON p.id = d.pipeline_id
CROSS JOIN LATERAL (
  SELECT st->>'outcome' AS outcome
  FROM jsonb_array_elements(p.stages) st
  WHERE st->>'key' = d.stage_key
  LIMIT 1
) s
WHERE d.account_id IS NULL
  AND (d.store_id IS NULL OR NOT EXISTS (SELECT 1 FROM atlas.account a WHERE a.store_id = d.store_id));

UPDATE atlas.sales_deal d
   SET account_id = a.id
  FROM atlas.account a
 WHERE d.account_id IS NULL
   AND (a.store_id = d.store_id OR (a.store_id IS NULL AND a.name = d.company));

-- Every live store becomes an account too, so the list is the whole book and
-- not just what sales happens to have typed. Their contacts and ops settings
-- already live in store_profile; this only gives them a lifecycle row.
INSERT INTO atlas.account (name, city, state, lifecycle, owner_id, store_id, review_cadence)
SELECT s."storeName", s.city, s.state, 'managed', p.account_manager_id, s.id, 'none'
FROM src_local."Store" s
LEFT JOIN atlas.store_profile p ON p.store_id = s.id
WHERE NOT EXISTS (SELECT 1 FROM atlas.account a WHERE a.store_id = s.id);

-- Existing tasks follow their store onto its account.
UPDATE atlas.account_task t
   SET account_id = a.id
  FROM atlas.account a
 WHERE t.account_id IS NULL AND a.store_id = t.store_id;

-- A line an account has actually ordered is a line it is live on — the only
-- part of "contracted" we can honestly infer. Anything sold but never used has
-- to be typed in, which is precisely the gap worth seeing.
INSERT INTO atlas.account_service (account_id, stream, status)
SELECT a.id, l.stream, 'live'
FROM atlas.account a
JOIN analytics.v_account_line l ON l.store_id = a.store_id
WHERE a.store_id IS NOT NULL AND l.line_status <> 'never'
ON CONFLICT (account_id, stream) DO NOTHING;

-- ---------------------------------------------------------------------- views

-- Dropped rather than replaced: a column added in the middle is not a
-- replacement Postgres will accept, and nothing depends on this view yet.
DROP VIEW IF EXISTS analytics.v_account_lifecycle;
CREATE VIEW analytics.v_account_lifecycle AS
SELECT
  a.id                                        AS account_id,
  a.name,
  a.city, a.state, a.website,
  a.lifecycle,
  a.account_type,
  t.label                                     AS account_type_label,
  a.owner_id,
  u.name                                      AS owner,
  a.store_id,
  a.premium_book_cr,
  a.opd_book_cr,
  a.avg_ticket_inr,
  a.review_cadence,
  -- Dates leave as text: everything that reads them renders them, and pg
  -- would otherwise hand React a Date object it refuses to print.
  a.mou_signed_on::text AS mou_signed_on,
  a.go_live_on::text    AS go_live_on,
  a.live_since::text    AS live_since,
  a.created_at,

  -- Meetings, which answer most of what the three teams ask of a row.
  (SELECT COUNT(*)::int FROM atlas.meeting m
     WHERE m.account_id = a.id AND m.happened_on IS NOT NULL)       AS meetings_done,
  (SELECT MIN(m.happened_on) FROM atlas.meeting m
     WHERE m.account_id = a.id)::text                                     AS first_met_on,
  (SELECT MAX(m.happened_on) FROM atlas.meeting m
     WHERE m.account_id = a.id)::text                                     AS last_met_on,
  (SELECT MIN(m.scheduled_on) FROM atlas.meeting m
     WHERE m.account_id = a.id AND m.scheduled_on >= atlas.ist_today())::text AS next_meeting_on,
  (SELECT MAX(m.happened_on) FROM atlas.meeting m
     WHERE m.account_id = a.id AND m.kind IN ('mbr', 'qbr'))::text AS last_review_on,

  -- When the next review is due: the cadence applied to the last one. An
  -- account with no cadence is never late, because nobody promised anything.
  CASE a.review_cadence
    WHEN 'weekly'      THEN (SELECT MAX(m.happened_on) + 7   FROM atlas.meeting m WHERE m.account_id = a.id AND m.kind IN ('mbr','qbr'))
    WHEN 'fortnightly' THEN (SELECT MAX(m.happened_on) + 14  FROM atlas.meeting m WHERE m.account_id = a.id AND m.kind IN ('mbr','qbr'))
    WHEN 'monthly'     THEN (SELECT MAX(m.happened_on) + 30  FROM atlas.meeting m WHERE m.account_id = a.id AND m.kind IN ('mbr','qbr'))
    WHEN 'quarterly'   THEN (SELECT MAX(m.happened_on) + 91  FROM atlas.meeting m WHERE m.account_id = a.id AND m.kind IN ('mbr','qbr'))
    ELSE NULL
  END::text                                                         AS next_review_on,

  -- Tasks, split by phase so an onboarding bar and a running action item never
  -- get counted together.
  (SELECT COUNT(*)::int FROM atlas.account_task k
     WHERE k.account_id = a.id AND k.done_at IS NULL)               AS open_tasks,
  (SELECT COUNT(*)::int FROM atlas.account_task k
     WHERE k.account_id = a.id AND k.done_at IS NULL
       AND k.due_on < atlas.ist_today())                            AS late_tasks,
  (SELECT COUNT(*)::int FROM atlas.account_task k
     WHERE k.account_id = a.id AND k.phase = 'onboarding')          AS plan_steps,
  (SELECT COUNT(*)::int FROM atlas.account_task k
     WHERE k.account_id = a.id AND k.phase = 'onboarding'
       AND k.done_at IS NOT NULL)                                   AS plan_done,

  -- Contracted vs ordered, as two counts. The difference is the cross-sell and
  -- the never-activated line, both of which Atlas could not see before.
  (SELECT COUNT(*)::int FROM atlas.account_service v
     WHERE v.account_id = a.id AND v.status IN ('contracted', 'live'))  AS services_contracted,
  (SELECT COUNT(*)::int FROM atlas.account_service v
     WHERE v.account_id = a.id AND v.status = 'live')                   AS services_live,

  -- Volume, only for accounts that became a store.
  COALESCE(va.this_month, 0)                  AS this_month,
  COALESCE(va.last_month, 0)                  AS last_month,
  va.worst_line_status,

  -- Our share of the book they were sized at, in services rather than rupees:
  -- storePayment's sign convention is unconfirmed, the OPD book is typed by a
  -- human, and one honest ratio beats two unverifiable ones.
  CASE WHEN a.opd_book_cr > 0 AND a.avg_ticket_inr > 0
       THEN ROUND(COALESCE(va.last_twelve, 0)
                  / (a.opd_book_cr * 10000000 / a.avg_ticket_inr) * 100, 1)
  END                                         AS share_pct,
  CASE WHEN a.opd_book_cr > 0 AND a.avg_ticket_inr > 0
       THEN ROUND(a.opd_book_cr * 10000000 / a.avg_ticket_inr)::bigint
  END                                         AS services_expected,
  COALESCE(va.last_twelve, 0)::bigint         AS services_twelve_months
FROM atlas.account a
LEFT JOIN atlas.users u ON u.id = a.owner_id
LEFT JOIN atlas.sales_account_type t ON t.key = a.account_type
LEFT JOIN LATERAL (
  SELECT v.this_month, v.last_month, v.worst_line_status,
         (SELECT COALESCE(SUM(x.events), 0)::numeric
            FROM analytics.mv_account_activity x
           WHERE x.store_id = a.store_id
             AND x.month >= date_trunc('month', atlas.ist_today()) - interval '12 months') AS last_twelve
  FROM analytics.v_account v WHERE v.store_id = a.store_id
) va ON true;

COMMENT ON VIEW analytics.v_account_lifecycle IS
  'The accounts spine: one row per company across sales, onboarding and '
  'account management, with its meetings, cadence, plan progress, contracted '
  'lines and — where a book size was typed — our share of it in services.';
