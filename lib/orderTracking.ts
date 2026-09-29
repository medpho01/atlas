import 'server-only';
import { query, queryOne } from './db';

/**
 * The three queues an order passes through after it leaves the request queue.
 *
 * The work is derived — analytics.v_order_task reads the order data and says
 * what is due, so a row appears because the data says it should and leaves
 * when the data says it is done. Nothing here creates or closes a task.
 *
 * What this module stores is the human layer: who a task is assigned to and
 * what the lab said when somebody called.
 */

export const TASK_KINDS = ['needs_lab', 'pickup_today', 'chase_report'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_LABEL: Record<TaskKind, string> = {
  needs_lab: 'Needs a lab',
  pickup_today: 'Pickup today',
  chase_report: 'Report outstanding',
};

/** Why each queue exists, in the words the page uses above the table. */
export const TASK_BLURB: Record<TaskKind, string> = {
  needs_lab:
    'Appointments from tomorrow onward that are still on the LabStack placeholder lab — no '
    + 'real lab has been named. The deadline is the day before the appointment: no lab by '
    + 'then and the appointment has nobody behind it.',
  pickup_today:
    'Every appointment happening today, whichever lab it is at. Not a filtered selection — '
    + 'the question today is simply whether each one is happening, and it is asked of all '
    + 'of them.',
  chase_report:
    'The appointment has been and gone and no report has come back, whatever state it '
    + 'stopped in. The clock is 48 hours from the appointment or the last update, whichever '
    + 'is later. This is the one the customer feels.',
};

export type TaskRow = {
  kind: TaskKind;
  order_id: number;
  due_date: string;
  overdue: boolean;
  days_left: number | null;
  appointment_at: string;
  appointment_date: string;
  collected_at: string | null;
  /** What the 48-hour clock counts from: the appointment or the last status change. */
  clock_from: string | null;
  order_status: string | null;
  order_type: string | null;
  lab_id: number | null;
  lab_name: string | null;
  lab_city: string | null;
  lab_pincode: string | null;
  lab_phone: string | null;
  lab_email: string | null;
  on_placeholder: boolean;
  lab_orders_all_time: number;
  lab_delivered: number;
  lab_failed: number;
  store_id: number | null;
  store_name: string | null;
  /** Six-stage grouping, so a pickup row can say whether it is already collected. */
  stage: string | null;
  reference_id: string | null;
  phlebo_name: string | null;
  phlebo_number: string | null;
  request_id: number | null;
  request_pincode: string | null;
  request_city: string | null;
  requester_name: string | null;
  requester_mobile: string | null;
  quoted_price: string | null;
  assignee_id: number | null;
  assignee_name: string | null;
  assigned_by: number | null;
  assigned_by_name: string | null;
  assigned_at: string | null;
  note_count: number;
  /** Only filled for the allocation queue — see atlas.labs_in_range. */
  labs_in_range: number | null;
};

export type TaskFilters = {
  /**
   * Which appointments to look at, counted in days from today.
   *
   * On the APPOINTMENT, not on the deadline. The deadline is already a day
   * before the appointment, so a cumulative "deadline within N days" put
   * yesterday's overdue rows and the day-after-tomorrow's appointments into a
   * chip labelled Tomorrow — which is not what the word means, and made the
   * page look like it was ignoring the filter.
   */
  apptInDays?: number;
  /** Appointments from today out to N days, inclusive. */
  apptWithinDays?: number;
  /** Allocation: only the ones whose deadline is today or tomorrow. */
  urgent?: boolean;
  /** One or more stores. A person owns a handful of accounts, not one. */
  stores?: number[];
  /** Report: only the ones already past 48 hours. */
  late?: boolean;
  assignee?: number | 'none';
};

export type QueueCounts = Record<TaskKind, { total: number; urgent: number; unassigned: number }>;

/**
 * How many tasks are in each queue, and how many of those are pressing.
 *
 * Takes the store selection, because the tab badges sit directly above a table
 * that honours it. Without that they read the whole book while the rows read
 * one partner — and on a screen whose organising idea is "orders originating
 * from store X", the badge is the number somebody would quote.
 */
export async function getQueueCounts(stores: number[] = []): Promise<QueueCounts> {
  const params: unknown[] = [];
  let where = '';
  if (stores.length) {
    params.push(stores);
    where = `WHERE store_id = ANY($${params.length})`;
  }
  const rows = await query<{
    kind: TaskKind; total: number; urgent: number; unassigned: number;
  }>(`
    SELECT kind,
           count(*)::int AS total,
           count(*) FILTER (WHERE overdue OR days_left <= 0)::int AS urgent,
           count(*) FILTER (WHERE assignee_id IS NULL)::int AS unassigned
    FROM analytics.v_order_task
    ${where}
    GROUP BY 1
  `, params);
  const empty = { total: 0, urgent: 0, unassigned: 0 };
  return {
    needs_lab: rows.find((r) => r.kind === 'needs_lab') ?? { kind: 'needs_lab', ...empty } as never,
    pickup_today: rows.find((r) => r.kind === 'pickup_today') ?? { kind: 'pickup_today', ...empty } as never,
    chase_report: rows.find((r) => r.kind === 'chase_report') ?? { kind: 'chase_report', ...empty } as never,
  } as QueueCounts;
}

/**
 * One queue's rows, most pressing first.
 *
 * The lab-coverage count is joined only for the allocation queue: it is the
 * one question that queue asks and the other two already have a lab, so
 * computing it for all three would pay for coverage nobody reads.
 */
export async function getTasks(kind: TaskKind, f: TaskFilters = {}): Promise<TaskRow[]> {
  const params: unknown[] = [kind];
  const where: string[] = ['t.kind = $1'];

  if (f.urgent) where.push('(t.overdue OR t.days_left <= 1)');
  if (f.apptInDays != null) {
    params.push(f.apptInDays);
    where.push(`t.appointment_date::date = atlas.ist_today() + $${params.length}::int`);
  }
  if (f.apptWithinDays != null) {
    params.push(f.apptWithinDays);
    where.push(
      `t.appointment_date::date BETWEEN atlas.ist_today() AND atlas.ist_today() + $${params.length}::int`);
  }
  if (f.late) where.push('t.overdue');
  if (f.stores?.length) {
    params.push(f.stores);
    where.push(`t.store_id = ANY($${params.length})`);
  }
  if (f.assignee === 'none') where.push('t.assignee_id IS NULL');
  else if (typeof f.assignee === 'number') {
    params.push(f.assignee);
    where.push(`t.assignee_id = $${params.length}`);
  }

  // Overdue first, then by deadline, then by the appointment itself so a
  // morning collection is worked before an afternoon one.
  return query<TaskRow>(`
    SELECT t.*,
           -- Only for the allocation queue, and only where there is a pincode
           -- to ask about: a NULL pincode is "we do not know", not "nowhere".
           CASE WHEN t.kind = 'needs_lab' AND t.request_pincode IS NOT NULL
                THEN (SELECT labs FROM atlas.labs_in_range(t.request_pincode)) END AS labs_in_range
    FROM analytics.v_order_task t
    WHERE ${where.join(' AND ')}
    ORDER BY t.overdue DESC, t.due_date, t.appointment_at, t.order_id
    LIMIT 300
  `, params);
}

/** The stores with work in one queue, busiest first, for the filter row. */
export async function getQueueStores(kind: TaskKind) {
  return query<{ store_id: number; name: string; n: number }>(`
    SELECT t.store_id, COALESCE(t.store_name, 'Unnamed store') AS name, count(*)::int AS n
    FROM analytics.v_order_task t
    WHERE t.kind = $1 AND t.store_id IS NOT NULL
    GROUP BY 1, 2
    ORDER BY n DESC, name
  `, [kind]);
}

export type TaskNote = {
  id: number; body: string; author_id: number | null;
  author_name: string | null; created_at: string;
};

/** What was said about one task, newest first. */
export async function getTaskNotes(orderId: number, kind: TaskKind): Promise<TaskNote[]> {
  return query<TaskNote>(`
    SELECT n.id, n.body, n.author_id, u.name AS author_name, n.created_at::text
    FROM atlas.order_task_note n
    LEFT JOIN atlas.users u ON u.id = n.author_id
    WHERE n.order_id = $1 AND n.kind = $2
    ORDER BY n.created_at DESC
    LIMIT 50
  `, [orderId, kind]);
}

/** One task, or null when the order has moved on and it no longer exists. */
export async function getTask(orderId: number, kind: TaskKind): Promise<TaskRow | null> {
  return queryOne<TaskRow>(`
    SELECT t.*,
           -- Only for the allocation queue, and only where there is a pincode
           -- to ask about: a NULL pincode is "we do not know", not "nowhere".
           CASE WHEN t.kind = 'needs_lab' AND t.request_pincode IS NOT NULL
                THEN (SELECT labs FROM atlas.labs_in_range(t.request_pincode)) END AS labs_in_range
    FROM analytics.v_order_task t
    WHERE t.order_id = $1 AND t.kind = $2
  `, [orderId, kind]);
}

/** The people work can be handed to. */
export async function getAssignableUsers() {
  return query<{ id: number; name: string; role: string }>(`
    SELECT id, name, role FROM atlas.users
    WHERE active AND role IN ('admin', 'network_lead', 'network')
    ORDER BY name
  `);
}

/** How the order got to where it is, for the drawer's timeline. */
export async function getOrderTimeline(orderId: number) {
  return queryOne<{
    created_at: string | null;
    appointment_at: string | null;
    status_at: string | null;
    order_status: string | null;
    prev_lab_id: number | null;
    lab_moves: number;
    appointment_moves: number;
    moved_at: string | null;
  }>(`
    SELECT (o."createdAt"       AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::text AS created_at,
           (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::text AS appointment_at,
           (o."statusUpdatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::text AS status_at,
           o."orderStatus"::text AS order_status,
           w.prev_lab_id,
           COALESCE(w.lab_moves, 0)         AS lab_moves,
           COALESCE(w.appointment_moves, 0) AS appointment_moves,
           (w.moved_at AT TIME ZONE 'Asia/Kolkata')::text AS moved_at
    FROM src_local."Order" o
    LEFT JOIN atlas.order_watch w ON w.order_id = o.id
    WHERE o.id = $1
  `, [orderId]);
}

// ---------------------------------------------------------------------------
// The stores being tracked
// ---------------------------------------------------------------------------

export const TRACKED_GROUP = 'TRACKED';

export type StoreQueue = {
  store_id: number;
  store_name: string;
  city: string | null;
  active: boolean;
  added_at: string;
  added_by: string | null;
  needs_lab: number;
  needs_lab_tomorrow: number;
  needs_lab_overdue: number;
  pickup_today: number;
  pickup_no_lab: number;
  pickup_collected: number;
  chase_report: number;
  chase_report_late: number;
  unassigned: number;
};

/**
 * One row per tracked store, with its queues beside it.
 *
 * The shape the spec is written in: "all orders originating from store X with
 * appointment today" is a question about one partner, and the first thing
 * somebody needs is which partner has the pile — not a flat list of two
 * hundred orders that happens to be sorted by date.
 */
export async function getStoreQueues(): Promise<StoreQueue[]> {
  return query<StoreQueue>(`
    SELECT store_id, store_name, city, active,
           added_at::text, added_by,
           needs_lab, needs_lab_tomorrow, needs_lab_overdue,
           pickup_today, pickup_no_lab, pickup_collected,
           chase_report, chase_report_late, unassigned
    FROM analytics.v_store_queue
    ORDER BY (pickup_no_lab + needs_lab_overdue) DESC,
             (needs_lab + pickup_today) DESC,
             store_name
  `);
}

/** How many stores are being tracked, for the empty state. */
export async function getTrackedStoreCount(): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT atlas.store_group_size($1) AS n`, [TRACKED_GROUP]);
  return row?.n ?? 0;
}

/** Every store, with whether it is tracked — for the picker that adds one. */
export async function getStoreTrackingOptions() {
  return query<{
    store_id: number; name: string; city: string | null;
    tracked: boolean; orders: number;
  }>(`
    SELECT d.id AS store_id, d.store_name AS name, d.city,
           atlas.store_in_group($1, d.id) AS tracked,
           (SELECT count(*)::int FROM src_local."Order" o WHERE o."storeId" = d.id) AS orders
    FROM analytics.v_store_directory d
    WHERE d.active
    ORDER BY atlas.store_in_group($1, d.id) DESC, d.store_name
  `, [TRACKED_GROUP]);
}
