import 'server-only';
import { query, queryOne } from './db';
import type {
  Account, AccountFilters, Contact, Meeting, Service, Stage, Task,
} from './lifecycleKinds';

/**
 * The account lifecycle: one company, read the same way by sales, onboarding
 * and the accounts team.
 *
 * Everything here hangs off atlas.account — the row that exists before a store
 * does and outlives the deal that created it. Reads go through
 * analytics.v_account_lifecycle, which already folds in meetings, cadence, plan
 * progress and contracted lines. The shapes and labels live in
 * ./lifecycleKinds, which carries no database and so can be imported by a
 * client component.
 */

export * from './lifecycleKinds';

export async function listAccounts(f: AccountFilters = {}): Promise<Account[]> {
  const where: string[] = [];
  const params: any[] = [];
  const push = (v: any) => `$${params.push(v)}`;

  if (f.stage) where.push(`a.lifecycle = ${push(f.stage)}`);
  if (f.owner) where.push(`a.owner_id = ${push(f.owner)}`);
  if (f.unassigned) where.push(`a.owner_id IS NULL`);
  if (f.type) where.push(`a.account_type = ${push(f.type)}`);
  // The view hands dates out as text, so the comparison casts back.
  if (f.reviewDue) where.push(`a.next_review_on::date < atlas.ist_today()`);
  if (f.q) {
    const like = push(`%${f.q.trim()}%`);
    where.push(`(a.name ILIKE ${like} OR a.city ILIKE ${like})`);
  }

  return query<Account>(`
    SELECT * FROM analytics.v_account_lifecycle a
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY
      -- Late first, then whoever we have not seen in longest: the order
      -- somebody would work the list in, not alphabetical.
      (a.next_review_on::date < atlas.ist_today()) DESC NULLS LAST,
      a.late_tasks DESC,
      a.last_met_on ASC NULLS FIRST,
      a.name
    LIMIT 500
  `, params);
}

/** How many accounts sit on each stage, for the filter row. */
export async function getStageCounts() {
  return query<{ lifecycle: Stage; n: number }>(`
    SELECT lifecycle, COUNT(*)::int AS n
    FROM atlas.account GROUP BY 1
  `);
}

export async function getAccount(id: number): Promise<Account | null> {
  return queryOne<Account>(
    `SELECT * FROM analytics.v_account_lifecycle WHERE account_id = $1`, [id]);
}

// ------------------------------------------------------------------- contacts

export async function getContacts(accountId: number): Promise<Contact[]> {
  return query<Contact>(`
    SELECT id, name, role, phone, email, is_decision_maker, note
    FROM atlas.account_contact
    WHERE account_id = $1
    ORDER BY is_decision_maker DESC, id
  `, [accountId]);
}

// ------------------------------------------------------------------- meetings

export async function getMeetings(accountId: number): Promise<Meeting[]> {
  return query<Meeting>(`
    SELECT m.id, m.kind, m.happened_on::text, m.scheduled_on::text, m.title,
           m.attendees, m.notes, m.next_step, m.next_step_due::text,
           o.name AS next_step_owner, u.name AS author,
           (m.next_step_due < atlas.ist_today()) AS next_step_late
    FROM atlas.meeting m
    LEFT JOIN atlas.users u ON u.id = m.created_by
    LEFT JOIN atlas.users o ON o.id = m.next_step_owner_id
    WHERE m.account_id = $1
    -- Scheduled first, newest done after: the next thing matters more than the
    -- last thing on a screen somebody opens before a call.
    ORDER BY COALESCE(m.scheduled_on, m.happened_on) DESC, m.id DESC
  `, [accountId]);
}

// ------------------------------------------------------------------- services

/**
 * Contracted lines beside what was actually ordered. An account contracted for
 * a line it has never once used is the single most useful row here, and nothing
 * in Atlas could see it before atlas.account_service existed.
 */
export async function getServices(accountId: number, storeId: number | null): Promise<Service[]> {
  return query<Service>(`
    SELECT v.stream, v.status, v.contracted_on::text, v.note,
           l.last_month, l.ever
    FROM atlas.account_service v
    LEFT JOIN LATERAL (
      SELECT x.last_month,
             (SELECT COALESCE(SUM(y.events), 0)::int
                FROM analytics.mv_account_activity y
               WHERE y.store_id = $2 AND y.stream = v.stream) AS ever
      FROM analytics.v_account_line x
      WHERE x.store_id = $2 AND x.stream = v.stream
    ) l ON true
    WHERE v.account_id = $1
    ORDER BY v.stream
  `, [accountId, storeId]);
}

// ---------------------------------------------------------------------- tasks

const TASK_SELECT = `
  SELECT k.id, k.title, k.detail, k.due_on::text, k.planned_start::text,
         k.department, d.label AS department_label,
         k.assignee_id, u.name AS assignee, k.phase, k.repeat_every,
         k.done_at::text,
         (k.done_at IS NULL AND k.due_on < atlas.ist_today()) AS late,
         k.account_id, a.name AS account_name
  FROM atlas.account_task k
  JOIN atlas.account a ON a.id = k.account_id
  LEFT JOIN atlas.users u ON u.id = k.assignee_id
  LEFT JOIN atlas.department d ON d.key = k.department
`;

export async function getTasks(accountId: number, phase?: 'onboarding' | 'managed') {
  const params: any[] = [accountId];
  const extra = phase ? ` AND k.phase = $${params.push(phase)}` : '';
  return query<Task>(`
    ${TASK_SELECT}
    WHERE k.account_id = $1${extra}
    ORDER BY (k.done_at IS NOT NULL), k.planned_start NULLS LAST, k.due_on NULLS LAST, k.id
  `, params);
}

/** Every open item across accounts — the desk view, cut by person and date. */
export async function listTasks(f: {
  assignee?: number; department?: string; done?: boolean; stage?: Stage;
} = {}) {
  const where: string[] = [];
  const params: any[] = [];
  const push = (v: any) => `$${params.push(v)}`;

  where.push(f.done ? `k.done_at IS NOT NULL` : `k.done_at IS NULL`);
  if (f.assignee) where.push(`k.assignee_id = ${push(f.assignee)}`);
  if (f.department) where.push(`k.department = ${push(f.department)}`);
  if (f.stage) where.push(`a.lifecycle = ${push(f.stage)}`);

  return query<Task>(`
    ${TASK_SELECT}
    WHERE ${where.join(' AND ')}
    ORDER BY k.due_on NULLS LAST, k.id
    LIMIT 300
  `, params);
}

export async function getDepartmentCounts() {
  return query<{ key: string; label: string; n: number }>(`
    SELECT d.key, d.label, COUNT(k.id)::int AS n
    FROM atlas.department d
    LEFT JOIN atlas.account_task k ON k.department = d.key AND k.done_at IS NULL
    WHERE d.active
    GROUP BY 1, 2 ORDER BY d.sort_order
  `);
}

export async function getDepartments() {
  return query<{ key: string; label: string }>(
    `SELECT key, label FROM atlas.department WHERE active ORDER BY sort_order, label`);
}

/** Sales, accounts and admins — everyone who can own an account or a step. */
export async function getPeople() {
  return query<{ id: number; name: string; role: string }>(`
    SELECT id, name, role FROM atlas.users
    WHERE active AND role IN ('admin', 'sales', 'accounts', 'network_lead', 'network', 'operations')
    ORDER BY name
  `);
}
