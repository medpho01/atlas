-- ===========================================================================
-- 33_account_health.sql — the Accounts team's own layer over a store.
--
-- Three things, and a view that joins them to what the store actually does.
--
-- 1. Who runs the account. It lives on atlas.store_profile, the table the
--    Stores & Orders work introduced, rather than a second table: one row per
--    store, one place to look. A separate column from ops_owner_id though,
--    because they are genuinely different jobs — the person who chases a late
--    pickup is not necessarily the person who owns the commercial
--    relationship, and collapsing them would make "my accounts" mean two
--    things depending on which screen you asked.
--
--    CREATE TABLE IF NOT EXISTS, so this works whether or not that work has
--    landed, and merging it later is a no-op for these columns.
--
-- 2. Contacts. Who to call at the account, which nothing in Atlas held.
--
-- 3. Tasks, one-off and recurring. Monthly and quarterly, not a recurrence
--    engine: those are the cases the team has, and the next copy is written
--    when the current one is ticked rather than by a scheduler — so a missed
--    month shows up as one overdue task instead of a silent backlog.
--
-- Deliberately absent: money, and a blended health score. storePayment is
-- negative on 28,197 of 46,182 rows and positive on 533, so the sign
-- convention is unconfirmed and nothing here carries a currency label. And one
-- number across three business lines hides the only thing worth knowing, which
-- is which line moved — so status is computed per line.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS atlas.store_profile (
  store_id            integer     PRIMARY KEY,
  ops_owner_id        integer     REFERENCES atlas.users (id) ON DELETE SET NULL,
  ops_contact_name    text,
  ops_contact_phone   text,
  ops_contact_email   text,
  coverage_note       text,
  delay_alert_hours   integer     NOT NULL DEFAULT 48
                        CHECK (delay_alert_hours >= 1 AND delay_alert_hours <= 720),
  pending_alert_count integer     NOT NULL DEFAULT 5
                        CHECK (pending_alert_count >= 1 AND pending_alert_count <= 10000),
  updated_by          integer     REFERENCES atlas.users (id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE atlas.store_profile
  ADD COLUMN IF NOT EXISTS account_manager_id integer REFERENCES atlas.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_store_profile_manager
  ON atlas.store_profile (account_manager_id);

COMMENT ON COLUMN atlas.store_profile.account_manager_id IS
  'Who owns the commercial relationship. Separate from ops_owner_id, which is '
  'who chases a late pickup — the same person often, but not by construction.';


-- ---------------------------------------------------------------------------
-- Contacts at the account.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.store_contact (
  id         serial PRIMARY KEY,
  store_id   integer     NOT NULL,
  name       text        NOT NULL,
  role       text,
  phone      text,
  email      text,
  is_primary boolean     NOT NULL DEFAULT false,
  note       text,
  added_by   integer     REFERENCES atlas.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_store_contact_store ON atlas.store_contact (store_id, is_primary DESC, name);


-- ---------------------------------------------------------------------------
-- Tasks and notes on an account.
--
-- repeat_every is the whole recurrence model: none, monthly, quarterly. A
-- completed recurring task writes its successor, so the chain is only ever as
-- long as the work actually done.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.account_task (
  id            bigserial PRIMARY KEY,
  store_id      integer     NOT NULL,
  title         text        NOT NULL,
  detail        text,
  due_on        date,
  assignee_id   integer     REFERENCES atlas.users (id),
  repeat_every  text        NOT NULL DEFAULT 'none'
                  CHECK (repeat_every IN ('none', 'monthly', 'quarterly')),
  -- The task this one was generated from, so a chain can be followed back.
  parent_id     bigint      REFERENCES atlas.account_task (id) ON DELETE SET NULL,
  done_at       timestamptz,
  done_by       integer     REFERENCES atlas.users (id),
  created_by    integer     REFERENCES atlas.users (id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_task_store ON atlas.account_task (store_id, done_at, due_on);
CREATE INDEX IF NOT EXISTS idx_account_task_open
  ON atlas.account_task (assignee_id, due_on) WHERE done_at IS NULL;

CREATE TABLE IF NOT EXISTS atlas.account_note (
  id         bigserial PRIMARY KEY,
  store_id   integer     NOT NULL,
  kind       text        NOT NULL DEFAULT 'note'
               CHECK (kind IN ('note', 'call', 'email', 'meeting', 'system')),
  body       text,
  author_id  integer     REFERENCES atlas.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_note_store ON atlas.account_note (store_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- analytics.v_account_line — one row per account per business line.
--
-- Months, not rolling windows: this month, last month, the same month a year
-- ago. The third is the one that says whether a dip is seasonal.
--
-- Requests are excluded from every count. An enquiry is not a transaction, and
-- counting it would make an account look busy for asking rather than buying.
--
-- Status is per line and never blended:
--   never      nothing, ever, on this line
--   stopped    ordered before, nothing this month or last
--   declining  this month below half of last month
--   growing    this month above 1.5x last month
--   active     everything else
--
-- "This month" is compared like for like — last month is cut at the same day
-- of the month — because on the 3rd of November every account in the company
-- would otherwise look like it had collapsed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_account_line AS
WITH bounds AS (
  SELECT date_trunc('month', atlas.ist_today())::date            AS this_m,
         (date_trunc('month', atlas.ist_today()) - interval '1 month')::date  AS last_m,
         (date_trunc('month', atlas.ist_today()) - interval '12 months')::date AS year_m,
         EXTRACT(day FROM atlas.ist_today())::int                AS day_of_month
),
lines AS (
  SELECT * FROM (VALUES
    ('LAB_ORDER',    'Diagnostics'),
    ('APPOINTMENT',  'Consultations'),
    ('PHARMA_ORDER', 'Pharmacy')
  ) AS t(stream, label)
),
stores AS (SELECT id AS store_id, "storeName" AS store_name, city, state FROM src_local."Store")
SELECT
  s.store_id, s.store_name, s.city, s.state,
  l.stream, l.label                                      AS line_label,
  COALESCE(cur.events, 0)                                AS this_month,
  COALESCE(prev.events, 0)                               AS last_month,
  COALESCE(prev_sofar.events, 0)                         AS last_month_to_date,
  COALESCE(yr.events, 0)                                 AS year_ago_month,
  first_seen.first_month::text                           AS first_month,
  last_seen.last_month::text                             AS last_active_month,
  CASE
    WHEN first_seen.first_month IS NULL                           THEN 'never'
    WHEN COALESCE(cur.events,0) = 0 AND COALESCE(prev.events,0) = 0 THEN 'stopped'
    WHEN COALESCE(prev_sofar.events,0) > 0
     AND COALESCE(cur.events,0) < COALESCE(prev_sofar.events,0) * 0.5 THEN 'declining'
    WHEN COALESCE(prev_sofar.events,0) > 0
     AND COALESCE(cur.events,0) > COALESCE(prev_sofar.events,0) * 1.5 THEN 'growing'
    ELSE 'active'
  END                                                    AS line_status
FROM stores s
CROSS JOIN lines l
CROSS JOIN bounds b
LEFT JOIN LATERAL (
  SELECT SUM(a.events)::int AS events FROM analytics.mv_account_activity a
  WHERE a.store_id = s.store_id AND a.stream = l.stream AND a.month = b.this_m
) cur ON true
LEFT JOIN LATERAL (
  SELECT SUM(a.events)::int AS events FROM analytics.mv_account_activity a
  WHERE a.store_id = s.store_id AND a.stream = l.stream AND a.month = b.last_m
) prev ON true
-- Last month cut at today's day-of-month, so the comparison is like for like.
-- The MV is monthly, so this is the whole month scaled by the fraction elapsed:
-- approximate, and honest about being so, which beats comparing three days
-- against thirty-one.
LEFT JOIN LATERAL (
  SELECT ROUND(SUM(a.events) * LEAST(1.0,
           b.day_of_month::numeric
           / EXTRACT(day FROM (b.this_m + interval '1 month - 1 day'))::numeric))::int AS events
  FROM analytics.mv_account_activity a
  WHERE a.store_id = s.store_id AND a.stream = l.stream AND a.month = b.last_m
) prev_sofar ON true
LEFT JOIN LATERAL (
  SELECT SUM(a.events)::int AS events FROM analytics.mv_account_activity a
  WHERE a.store_id = s.store_id AND a.stream = l.stream AND a.month = b.year_m
) yr ON true
LEFT JOIN LATERAL (
  SELECT MIN(a.month) AS first_month FROM analytics.mv_account_activity a
  WHERE a.store_id = s.store_id AND a.stream = l.stream
) first_seen ON true
LEFT JOIN LATERAL (
  SELECT MAX(a.month) AS last_month FROM analytics.mv_account_activity a
  WHERE a.store_id = s.store_id AND a.stream = l.stream AND a.events > 0
) last_seen ON true;

COMMENT ON VIEW analytics.v_account_line IS
  'One row per store per business line, by calendar month. Status is per line '
  'and never blended — an account flat on diagnostics with pharmacy at zero is '
  'declining on pharmacy, which a single score would hide.';


-- ---------------------------------------------------------------------------
-- analytics.v_account — the list row: the lines rolled up, plus the human layer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_account AS
SELECT
  s.id                                   AS store_id,
  s."storeName"                          AS store_name,
  s.city, s.state,
  p.account_manager_id,
  u.name                                 AS account_manager,
  SUM(l.this_month)::int                 AS this_month,
  SUM(l.last_month)::int                 AS last_month,
  SUM(l.year_ago_month)::int             AS year_ago_month,
  COUNT(*) FILTER (WHERE l.line_status <> 'never')::int   AS lines_active,
  COUNT(*) FILTER (WHERE l.line_status = 'stopped')::int  AS lines_stopped,
  COUNT(*) FILTER (WHERE l.line_status = 'declining')::int AS lines_declining,
  -- Not a score: the single worst thing happening on any of its lines, so the
  -- list can be sorted by what needs attention without pretending to blend.
  CASE
    WHEN COUNT(*) FILTER (WHERE l.line_status <> 'never') = 0        THEN 'never'
    WHEN COUNT(*) FILTER (WHERE l.line_status = 'stopped')  > 0      THEN 'stopped'
    WHEN COUNT(*) FILTER (WHERE l.line_status = 'declining') > 0     THEN 'declining'
    WHEN COUNT(*) FILTER (WHERE l.line_status = 'growing')  > 0      THEN 'growing'
    ELSE 'active'
  END                                    AS worst_line_status,
  jsonb_agg(jsonb_build_object(
    'stream', l.stream, 'label', l.line_label, 'status', l.line_status,
    'this_month', l.this_month, 'last_month', l.last_month,
    'year_ago_month', l.year_ago_month, 'first_month', l.first_month
  ) ORDER BY l.stream)                   AS lines,
  (SELECT t.title FROM atlas.account_task t
    WHERE t.store_id = s.id AND t.done_at IS NULL
    ORDER BY t.due_on NULLS LAST, t.id LIMIT 1)          AS next_task,
  (SELECT t.due_on::text FROM atlas.account_task t
    WHERE t.store_id = s.id AND t.done_at IS NULL
    ORDER BY t.due_on NULLS LAST, t.id LIMIT 1)          AS next_task_due,
  (SELECT t.due_on < atlas.ist_today() FROM atlas.account_task t
    WHERE t.store_id = s.id AND t.done_at IS NULL
    ORDER BY t.due_on NULLS LAST, t.id LIMIT 1)          AS next_task_late,
  (SELECT COUNT(*)::int FROM atlas.account_task t
    WHERE t.store_id = s.id AND t.done_at IS NULL)       AS open_tasks
FROM src_local."Store" s
JOIN analytics.v_account_line l ON l.store_id = s.id
LEFT JOIN atlas.store_profile p ON p.store_id = s.id
LEFT JOIN atlas.users u ON u.id = p.account_manager_id
GROUP BY s.id, s."storeName", s.city, s.state, p.account_manager_id, u.name;

COMMENT ON VIEW analytics.v_account IS
  'The accounts list: this month, last month and the same month last year '
  'across every line, who manages it, and what is committed to next. '
  'worst_line_status is the worst thing happening on any one line, not a score.';
