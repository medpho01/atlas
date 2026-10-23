import 'server-only';
import { query, queryOne } from './db';

export type Stage = { key: string; label: string; probability: number; outcome: 'open' | 'won' | 'lost' };

export type Pipeline = { id: number; name: string; stages: Stage[]; is_default: boolean };

export type Deal = {
  deal_id: number;
  pipeline_id: number;
  /** The atlas.account this deal is one chapter of — see lib/lifecycle. */
  account_id: number | null;
  account_lifecycle: string | null;
  meetings_done: number;
  last_met_on: string | null;
  next_meeting_on: string | null;
  opd_book_cr: string | null;
  premium_book_cr: string | null;
  company: string;
  website: string | null;
  city: string | null;
  state: string | null;
  account_type: string | null;
  account_type_label: string | null;
  stage_key: string;
  stage_label: string | null;
  stage_probability: number | null;
  stage_outcome: 'open' | 'won' | 'lost' | null;
  value_inr: string | null;
  weighted_inr: string | null;
  expected_close: string | null;
  source: string | null;
  owner_id: number | null;
  owner_name: string | null;
  contact_name: string | null;
  contact_role: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  store_id: number | null;
  store_name: string | null;
  lost_reason: string | null;
  closed_at: string | null;
  created_at: string;
  last_touch_at: string;
  days_quiet: number;
  days_in_stage: number;
  is_stuck: boolean;
  note_count: number;
  open_tasks: number;
  next_task: string | null;
  next_task_due: string | null;
  next_task_late: boolean | null;
  tags: string[];
};

export type DealFilters = {
  owner?: number;
  tag?: string;
  q?: string;
  /** 'open' hides won and lost, which is what a board is for. */
  show?: 'open' | 'all';
  /** An account-type key — insurer, broker, healthtech … */
  type?: string;
};

export async function getPipeline(id?: number): Promise<Pipeline | null> {
  if (id) {
    return queryOne<Pipeline>(
      `SELECT id, name, stages, is_default FROM atlas.sales_pipeline WHERE id = $1`, [id]);
  }
  return queryOne<Pipeline>(`
    SELECT id, name, stages, is_default
    FROM atlas.sales_pipeline
    ORDER BY is_default DESC, id
    LIMIT 1
  `);
}

/**
 * Every sales pipeline, for the board's switcher.
 *
 * The switcher only appears when there is more than one — with a single
 * pipeline it is a control with one option, and a second pipeline created in
 * Configure pipelines would otherwise be invisible unless somebody also made
 * it the default.
 */
export async function listSalesPipelines(): Promise<Pipeline[]> {
  return query<Pipeline>(
    `SELECT id, name, stages, is_default FROM atlas.sales_pipeline ORDER BY is_default DESC, id`);
}

/**
 * Every deal on the board, filtered.
 *
 * No pagination: a sales pipeline that does not fit on one screen is a
 * different problem from a page of five thousand phlebos, and a board with a
 * "load more" is a board that lies about its totals.
 */
export async function getDeals(pipelineId: number, f: DealFilters = {}): Promise<Deal[]> {
  const params: unknown[] = [pipelineId];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where = [`d.pipeline_id = $1`];

  if (f.show !== 'all') where.push(`d.stage_outcome = 'open'`);
  if (f.owner) where.push(`d.owner_id = ${push(f.owner)}`);
  if (f.tag) where.push(`${push(f.tag)} = ANY(d.tags)`);
  if (f.type === 'none') where.push(`d.account_type IS NULL`);
  else if (f.type) where.push(`d.account_type = ${push(f.type)}`);
  if (f.q && f.q.trim()) {
    const q = push(`%${f.q.trim().toLowerCase()}%`);
    where.push(`(lower(d.company) LIKE ${q} OR lower(d.city) LIKE ${q}
                 OR lower(d.contact_name) LIKE ${q})`);
  }

  return query<Deal>(`
    SELECT d.* FROM analytics.v_sales_deal d
    WHERE ${where.join(' AND ')}
    ORDER BY d.stage_probability DESC NULLS LAST, d.value_inr DESC NULLS LAST, d.deal_id
  `, params);
}

export async function getDeal(id: number): Promise<Deal | null> {
  return queryOne<Deal>(`SELECT * FROM analytics.v_sales_deal WHERE deal_id = $1`, [id]);
}

export type Note = {
  id: number; kind: string; body: string | null;
  author_id: number | null; author_name: string | null; created_at: string;
};

export async function getNotes(dealId: number): Promise<Note[]> {
  return query<Note>(`
    SELECT n.id, n.kind, n.body, n.author_id, u.name AS author_name,
           (n.created_at AT TIME ZONE 'Asia/Kolkata')::text AS created_at
    FROM atlas.sales_note n
    LEFT JOIN atlas.users u ON u.id = n.author_id
    WHERE n.deal_id = $1
    ORDER BY n.created_at DESC
    LIMIT 200
  `, [dealId]);
}

export type Task = {
  id: number; title: string; due_on: string | null;
  assignee_id: number | null; assignee_name: string | null;
  done_at: string | null; late: boolean;
};

export async function getTasks(dealId: number): Promise<Task[]> {
  return query<Task>(`
    SELECT t.id, t.title, t.due_on::text AS due_on,
           t.assignee_id, u.name AS assignee_name,
           (t.done_at AT TIME ZONE 'Asia/Kolkata')::text AS done_at,
           (t.done_at IS NULL AND t.due_on IS NOT NULL AND t.due_on < atlas.ist_today()) AS late
    FROM atlas.sales_task t
    LEFT JOIN atlas.users u ON u.id = t.assignee_id
    WHERE t.deal_id = $1
    ORDER BY t.done_at NULLS FIRST, t.due_on NULLS LAST, t.id
  `, [dealId]);
}

export async function getTags(): Promise<{ id: number; key: string; label: string; n: number }[]> {
  return query(`
    SELECT g.id, g.key, g.label, COUNT(dt.deal_id)::int AS n
    FROM atlas.sales_tag g
    LEFT JOIN atlas.sales_deal_tag dt ON dt.tag_id = g.id
    GROUP BY 1, 2, 3 ORDER BY 4 DESC, 3
  `);
}

/**
 * Who a deal or a task can be handed to: the people who actually work this
 * pipeline.
 *
 * Sales and admin only. Accounts can read the board — the handover from a
 * signed deal to a managed account is theirs — but a deal assigned to somebody
 * who never opens it to work it is a deal nobody owns, and a picker of twenty
 * names where five are plausible is a picker that gets the wrong one.
 */
export async function getAssignableUsers(): Promise<{ id: number; name: string; role: string }[]> {
  return query(`
    SELECT id, name, role FROM atlas.users
    WHERE active AND role IN ('sales', 'admin')
    ORDER BY CASE role WHEN 'sales' THEN 0 ELSE 1 END, name
  `);
}

/** The strip above the board. One pass, not one query per number. */
export async function getBoardSummary(pipelineId: number) {
  return queryOne<{
    open_deals: number; open_value: string; weighted: string;
    closing_month: number; closing_month_value: string;
    stuck: number; won_quarter: number; unassigned: number;
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE stage_outcome = 'open')::int                      AS open_deals,
      COALESCE(SUM(value_inr)    FILTER (WHERE stage_outcome = 'open'), 0)     AS open_value,
      COALESCE(SUM(weighted_inr) FILTER (WHERE stage_outcome = 'open'), 0)     AS weighted,
      COUNT(*) FILTER (WHERE stage_outcome = 'open'
                         AND expected_close::date
                             BETWEEN atlas.ist_today()
                             AND (date_trunc('month', atlas.ist_today()) + interval '1 month - 1 day')::date)::int
                                                                               AS closing_month,
      COALESCE(SUM(value_inr) FILTER (WHERE stage_outcome = 'open'
                         AND expected_close::date
                             BETWEEN atlas.ist_today()
                             AND (date_trunc('month', atlas.ist_today()) + interval '1 month - 1 day')::date), 0)
                                                                               AS closing_month_value,
      COUNT(*) FILTER (WHERE is_stuck)::int                                    AS stuck,
      COUNT(*) FILTER (WHERE stage_outcome = 'won'
                         AND closed_at::timestamp >= date_trunc('quarter', now()))::int AS won_quarter,
      COUNT(*) FILTER (WHERE stage_outcome = 'open' AND owner_id IS NULL)::int AS unassigned
    FROM analytics.v_sales_deal
    WHERE pipeline_id = $1
  `, [pipelineId]);
}

/** Stores not already claimed by a won deal, for the "mark won" picker. */
export async function getUnlinkedStores(q: string): Promise<{ id: number; name: string; city: string | null }[]> {
  const like = `%${(q ?? '').trim().toLowerCase()}%`;
  return query(`
    SELECT s.id, s."storeName" AS name, s.city
    FROM src_local."Store" s
    WHERE lower(s."storeName") LIKE $1
      AND NOT EXISTS (SELECT 1 FROM atlas.sales_deal d WHERE d.store_id = s.id)
    ORDER BY s."storeName"
    LIMIT 20
  `, [like]);
}


export type AccountType = { key: string; label: string };

/**
 * The kinds of company we sell to.
 *
 * Read from the table rather than a constant, so the list can be changed
 * without a deploy. Inactive types still resolve on a deal that already holds
 * them — retiring one greys it out of the picker, it does not rewrite history.
 */
export async function getAccountTypes(): Promise<AccountType[]> {
  return query<AccountType>(
    `SELECT key, label FROM atlas.sales_account_type WHERE active ORDER BY sort_order, label`);
}

/** How many open deals sit on each type, for the board's filter row. */
export async function getTypeCounts(pipelineId: number) {
  return query<{ key: string; label: string; n: number }>(`
    SELECT t.key, t.label, COUNT(d.deal_id)::int AS n
    FROM atlas.sales_account_type t
    LEFT JOIN analytics.v_sales_deal d
      ON d.account_type = t.key AND d.pipeline_id = $1 AND d.stage_outcome = 'open'
    WHERE t.active
    GROUP BY 1, 2 ORDER BY 3 DESC, t.label
  `, [pipelineId]);
}
