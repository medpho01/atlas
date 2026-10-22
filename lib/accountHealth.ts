import 'server-only';
import { query, queryOne } from './db';

/**
 * Account health, by business line and by calendar month.
 *
 * Reads analytics.v_account and v_account_line. Two things it never does:
 * put a currency label on anything, because storePayment's sign convention is
 * unconfirmed; and blend the lines into one score, because the only thing
 * worth knowing is which line moved.
 */

export type LineStatus = 'never' | 'stopped' | 'declining' | 'growing' | 'active';

export const LINE_LABEL: Record<string, string> = {
  LAB_ORDER: 'Diagnostics',
  APPOINTMENT: 'Consultations',
  PHARMA_ORDER: 'Pharmacy',
};

/** The order the lines read in, everywhere. */
export const LINES = ['LAB_ORDER', 'APPOINTMENT', 'PHARMA_ORDER'] as const;

export const STATUS_LABEL: Record<LineStatus, string> = {
  never: 'Never ordered',
  stopped: 'Stopped',
  declining: 'Declining',
  growing: 'Growing',
  active: 'Active',
};

export type AccountLine = {
  stream: string; label: string; status: LineStatus;
  this_month: number; last_month: number; year_ago_month: number;
  first_month: string | null;
};

export type AccountRow = {
  store_id: number; store_name: string; city: string | null; state: string | null;
  account_manager_id: number | null; account_manager: string | null;
  this_month: number; last_month: number; year_ago_month: number;
  lines_active: number; lines_stopped: number; lines_declining: number;
  worst_line_status: LineStatus;
  lines: AccountLine[];
  next_task: string | null; next_task_due: string | null; next_task_late: boolean | null;
  open_tasks: number;
};

export type AccountFilters = {
  manager?: number;
  /** 'unassigned' for accounts nobody owns. */
  unassigned?: boolean;
  status?: LineStatus;
  /** Only accounts active on this line. */
  line?: string;
  /** Only accounts that have NEVER ordered on this line — the cross-sell list. */
  missingLine?: string;
  q?: string;
};

export async function listAccounts(f: AccountFilters = {}): Promise<AccountRow[]> {
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where: string[] = [];

  if (f.unassigned) where.push(`a.account_manager_id IS NULL`);
  else if (f.manager) where.push(`a.account_manager_id = ${push(f.manager)}`);
  if (f.status) where.push(`a.worst_line_status = ${push(f.status)}`);
  if (f.q && f.q.trim()) {
    const q = push(`%${f.q.trim().toLowerCase()}%`);
    where.push(`(lower(a.store_name) LIKE ${q} OR lower(a.city) LIKE ${q}
                 OR lower(a.account_manager) LIKE ${q})`);
  }
  // Both line filters read the jsonb the view already assembles, so neither
  // needs a second pass over the activity table.
  if (f.line) {
    where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(a.lines) x
                 WHERE x->>'stream' = ${push(f.line)} AND x->>'status' <> 'never')`);
  }
  if (f.missingLine) {
    where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(a.lines) x
                 WHERE x->>'stream' = ${push(f.missingLine)} AND x->>'status' = 'never')`);
    // Only worth listing an account that actually buys something else.
    where.push(`a.lines_active > 0`);
  }

  return query<AccountRow>(`
    SELECT a.* FROM analytics.v_account a
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY
      CASE a.worst_line_status
        WHEN 'stopped' THEN 1 WHEN 'declining' THEN 2
        WHEN 'growing' THEN 3 WHEN 'active' THEN 4 ELSE 5 END,
      a.this_month DESC, a.last_month DESC, a.store_name
    LIMIT 400
  `, params);
}

export async function getAccount(storeId: number): Promise<AccountRow | null> {
  return queryOne<AccountRow>(
    `SELECT * FROM analytics.v_account WHERE store_id = $1`, [storeId]);
}

/** The strip above the list. One pass, and no money in it. */
export async function getAccountSummary() {
  return queryOne<{
    accounts: number; this_month: number; last_month: number; year_ago: number;
    stopped: number; one_line_only: number; unassigned: number;
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE lines_active > 0)::int                       AS accounts,
      COALESCE(SUM(this_month), 0)::int                                   AS this_month,
      COALESCE(SUM(last_month), 0)::int                                   AS last_month,
      COALESCE(SUM(year_ago_month), 0)::int                               AS year_ago,
      COUNT(*) FILTER (WHERE lines_stopped > 0)::int                      AS stopped,
      COUNT(*) FILTER (WHERE lines_active = 1)::int                       AS one_line_only,
      COUNT(*) FILTER (WHERE lines_active > 0
                         AND account_manager_id IS NULL)::int             AS unassigned
    FROM analytics.v_account
  `);
}

/** Twelve months of this account, by line, for the chart. */
export async function getAccountMonths(storeId: number) {
  return query<{ month: string; stream: string; events: number }>(`
    SELECT to_char(a.month, 'YYYY-MM') AS month, a.stream, SUM(a.events)::int AS events
    FROM analytics.mv_account_activity a
    WHERE a.store_id = $1
      AND a.stream <> 'REQUEST'
      AND a.month >= (date_trunc('month', atlas.ist_today()) - interval '11 months')::date
    GROUP BY 1, 2 ORDER BY 1
  `, [storeId]);
}

export type AccountTask = {
  id: number; title: string; detail: string | null; due_on: string | null;
  assignee_id: number | null; assignee_name: string | null;
  repeat_every: 'none' | 'monthly' | 'quarterly';
  done_at: string | null; late: boolean;
  store_id: number; store_name: string | null;
};

export async function getAccountTasks(storeId: number): Promise<AccountTask[]> {
  return query<AccountTask>(`
    SELECT t.id, t.title, t.detail, t.due_on::text AS due_on,
           t.assignee_id, u.name AS assignee_name, t.repeat_every,
           (t.done_at AT TIME ZONE 'Asia/Kolkata')::text AS done_at,
           (t.done_at IS NULL AND t.due_on IS NOT NULL AND t.due_on < atlas.ist_today()) AS late,
           t.store_id, s."storeName" AS store_name
    FROM atlas.account_task t
    LEFT JOIN atlas.users u ON u.id = t.assignee_id
    LEFT JOIN src_local."Store" s ON s.id = t.store_id
    WHERE t.store_id = $1
    ORDER BY t.done_at NULLS FIRST, t.due_on NULLS LAST, t.id
  `, [storeId]);
}

/** Every open task across accounts — the cross-account queue. */
export async function listTasks(opts: { assignee?: number; done?: boolean } = {}) {
  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where = [opts.done ? `t.done_at IS NOT NULL` : `t.done_at IS NULL`];
  if (opts.assignee) where.push(`t.assignee_id = ${push(opts.assignee)}`);
  return query<AccountTask>(`
    SELECT t.id, t.title, t.detail, t.due_on::text AS due_on,
           t.assignee_id, u.name AS assignee_name, t.repeat_every,
           (t.done_at AT TIME ZONE 'Asia/Kolkata')::text AS done_at,
           (t.done_at IS NULL AND t.due_on IS NOT NULL AND t.due_on < atlas.ist_today()) AS late,
           t.store_id, s."storeName" AS store_name
    FROM atlas.account_task t
    LEFT JOIN atlas.users u ON u.id = t.assignee_id
    LEFT JOIN src_local."Store" s ON s.id = t.store_id
    WHERE ${where.join(' AND ')}
    ORDER BY t.due_on NULLS LAST, t.id
    LIMIT 300
  `, params);
}

export async function getAccountNotes(storeId: number) {
  return query<{ id: number; kind: string; body: string | null; author_name: string | null; created_at: string }>(`
    SELECT n.id, n.kind, n.body, u.name AS author_name,
           (n.created_at AT TIME ZONE 'Asia/Kolkata')::text AS created_at
    FROM atlas.account_note n
    LEFT JOIN atlas.users u ON u.id = n.author_id
    WHERE n.store_id = $1 ORDER BY n.created_at DESC LIMIT 100
  `, [storeId]);
}

export async function getContacts(storeId: number) {
  return query<{ id: number; name: string; role: string | null; phone: string | null; email: string | null; is_primary: boolean }>(`
    SELECT id, name, role, phone, email, is_primary FROM atlas.store_contact
    WHERE store_id = $1 ORDER BY is_primary DESC, name
  `, [storeId]);
}

/** Who an account or a task can be handed to. */
export async function getAccountPeople() {
  return query<{ id: number; name: string; role: string }>(`
    SELECT id, name, role FROM atlas.users
    WHERE active AND role IN ('accounts', 'admin', 'sales')
    ORDER BY CASE role WHEN 'accounts' THEN 0 WHEN 'sales' THEN 1 ELSE 2 END, name
  `);
}
