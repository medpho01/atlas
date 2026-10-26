-- v_account_lifecycle stops re-reading the activity matview once per account.
--
-- The view joined analytics.v_account through a LATERAL and, inside that
-- LATERAL, ran a correlated twelve-month SUM over mv_account_activity. The
-- nested correlation is what did the damage: Postgres cannot flatten it, so
-- v_account — itself an aggregate over v_account_line over the matview — was
-- re-evaluated for every account. 81 accounts cost 373ms of the view's 678ms,
-- and it grows with the book.
--
-- Both become ordinary joins against one pass each: the same numbers, read
-- once.

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
  a.mou_signed_on::text AS mou_signed_on,
  a.go_live_on::text    AS go_live_on,
  a.live_since::text    AS live_since,
  a.created_at,

  m.meetings_done,
  m.first_met_on::text                        AS first_met_on,
  m.last_met_on::text                         AS last_met_on,
  m.next_meeting_on::text                     AS next_meeting_on,
  m.last_review_on::text                      AS last_review_on,

  CASE a.review_cadence
    WHEN 'weekly'      THEN m.last_review_on + 7
    WHEN 'fortnightly' THEN m.last_review_on + 14
    WHEN 'monthly'     THEN m.last_review_on + 30
    WHEN 'quarterly'   THEN m.last_review_on + 91
  END::text                                   AS next_review_on,

  COALESCE(k.open_tasks, 0)                   AS open_tasks,
  COALESCE(k.late_tasks, 0)                   AS late_tasks,
  COALESCE(k.plan_steps, 0)                   AS plan_steps,
  COALESCE(k.plan_done, 0)                    AS plan_done,

  COALESCE(sv.services_contracted, 0)         AS services_contracted,
  COALESCE(sv.services_live, 0)               AS services_live,

  COALESCE(va.this_month, 0)                  AS this_month,
  COALESCE(va.last_month, 0)                  AS last_month,
  va.worst_line_status,

  CASE WHEN a.opd_book_cr > 0 AND a.avg_ticket_inr > 0
       THEN ROUND(COALESCE(lt.last_twelve, 0)
                  / (a.opd_book_cr * 10000000 / a.avg_ticket_inr) * 100, 1)
  END                                         AS share_pct,
  CASE WHEN a.opd_book_cr > 0 AND a.avg_ticket_inr > 0
       THEN ROUND(a.opd_book_cr * 10000000 / a.avg_ticket_inr)::bigint
  END                                         AS services_expected,
  COALESCE(lt.last_twelve, 0)::bigint         AS services_twelve_months

FROM atlas.account a
LEFT JOIN atlas.users u ON u.id = a.owner_id
LEFT JOIN atlas.sales_account_type t ON t.key = a.account_type

-- One pass over meetings for every account, instead of five correlated
-- subqueries per row.
LEFT JOIN (
  SELECT account_id,
         COUNT(*) FILTER (WHERE happened_on IS NOT NULL)::int AS meetings_done,
         MIN(happened_on)                                     AS first_met_on,
         MAX(happened_on)                                     AS last_met_on,
         MIN(scheduled_on) FILTER (WHERE scheduled_on >= atlas.ist_today()) AS next_meeting_on,
         MAX(happened_on) FILTER (WHERE kind IN ('mbr', 'qbr'))             AS last_review_on
  FROM atlas.meeting GROUP BY account_id
) m ON m.account_id = a.id

LEFT JOIN (
  SELECT account_id,
         COUNT(*) FILTER (WHERE done_at IS NULL)::int                       AS open_tasks,
         COUNT(*) FILTER (WHERE done_at IS NULL
                            AND due_on < atlas.ist_today())::int            AS late_tasks,
         COUNT(*) FILTER (WHERE phase = 'onboarding')::int                  AS plan_steps,
         COUNT(*) FILTER (WHERE phase = 'onboarding'
                            AND done_at IS NOT NULL)::int                   AS plan_done
  FROM atlas.account_task GROUP BY account_id
) k ON k.account_id = a.id

LEFT JOIN (
  SELECT account_id,
         COUNT(*) FILTER (WHERE status IN ('contracted', 'live'))::int AS services_contracted,
         COUNT(*) FILTER (WHERE status = 'live')::int                  AS services_live
  FROM atlas.account_service GROUP BY account_id
) sv ON sv.account_id = a.id

-- A plain join now: v_account is read once for the whole book.
LEFT JOIN analytics.v_account va ON va.store_id = a.store_id

-- And the twelve-month total is its own single aggregate rather than a
-- correlated subquery nested inside a LATERAL.
LEFT JOIN (
  SELECT store_id, SUM(events)::numeric AS last_twelve
  FROM analytics.mv_account_activity
  WHERE month >= date_trunc('month', atlas.ist_today()) - interval '12 months'
  GROUP BY store_id
) lt ON lt.store_id = a.store_id;

COMMENT ON VIEW analytics.v_account_lifecycle IS
  'The accounts spine: one row per company across sales, onboarding and '
  'account management. Every aggregate is a single pass joined in, never a '
  'correlated subquery — the book is read once per page load, not once per row.';

CREATE INDEX IF NOT EXISTS idx_meeting_account_kind
  ON atlas.meeting (account_id, kind, happened_on);
CREATE INDEX IF NOT EXISTS idx_account_service_account
  ON atlas.account_service (account_id, status);
