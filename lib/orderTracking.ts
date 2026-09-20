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

export const TASK_KINDS = ['needs_lab', 'confirm_pickup', 'chase_report'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_LABEL: Record<TaskKind, string> = {
  needs_lab: 'Needs a lab',
  confirm_pickup: 'Pickup today',
  chase_report: 'Report outstanding',
};

/** Why each queue exists, in the words the page uses above the table. */
export const TASK_BLURB: Record<TaskKind, string> = {
  needs_lab:
    'Orders still sitting on the placeholder lab. The deadline is the day before the '
    + 'appointment — no lab by then and the appointment has nobody behind it.',
  confirm_pickup:
    'Appointments today at labs with barely any history. Call the centre and confirm the '
    + 'sample was actually collected — a new lab missing a pickup is how an order fails silently.',
  chase_report:
    '48 hours past the pickup with no report, at labs with barely any history. The sample is '
    + 'taken and somebody is waiting — this is the one the customer feels.',
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

/** How many tasks are in each queue, and how many of those are pressing. */
export async function getQueueCounts(): Promise<QueueCounts> {
  const rows = await query<{
    kind: TaskKind; total: number; urgent: number; unassigned: number;
  }>(`
    SELECT kind,
           count(*)::int AS total,
           count(*) FILTER (WHERE overdue OR days_left <= 0)::int AS urgent,
           count(*) FILTER (WHERE assignee_id IS NULL)::int AS unassigned
    FROM analytics.v_order_task
    GROUP BY 1
  `);
  const empty = { total: 0, urgent: 0, unassigned: 0 };
  return {
    needs_lab: rows.find((r) => r.kind === 'needs_lab') ?? { kind: 'needs_lab', ...empty } as never,
    confirm_pickup: rows.find((r) => r.kind === 'confirm_pickup') ?? { kind: 'confirm_pickup', ...empty } as never,
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
