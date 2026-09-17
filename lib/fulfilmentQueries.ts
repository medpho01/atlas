import 'server-only';
import { query, queryOne } from './db';

/**
 * The fulfilment desk: one day's promises, in the order the work happens.
 *
 * A request is quoted with a date and becomes an order. Between that moment
 * and the appointment somebody has to secure a lab; on the day itself somebody
 * has to see the order through. Atlas could show neither, because both are
 * about a date rather than about a record — so the queue that mattered was the
 * one nobody could see.
 *
 * Three reads, one per lane. They share a day and nothing else, deliberately:
 * a lane that has to wait for another lane's query to draw is a lane that
 * feels slow for no reason.
 */

/** IST, because the day is the team's day, not the server's. */
export function istDay(offsetDays = 0): string {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type PromiseRow = {
  commitment_id: number;
  request_id: number;
  order_id: number | null;
  promised_date: string | null;
  days_left: number | null;
  breached: boolean | null;
  quoted_price: string | null;
  pincode: string | null;
  city: string | null;
  state_name: string | null;
  nearest_km: string | null;
  target_lab_id: number | null;
  target_lab_name: string | null;
  crm_provider_id: number | null;
  crm_thread_id: number | null;
  crm_stage: string | null;
};

/**
 * Lane 1 — promised, no lab yet.
 *
 * The open commitments, nearest deadline first. Each one is a lab that has to
 * be found and onboarded before a date somebody has already been given, which
 * is why the CRM card is joined on: if onboarding has started, the desk should
 * say where it got to rather than sending somebody to look.
 */
export async function getOpenPromises(throughDay: string): Promise<PromiseRow[]> {
  return query<PromiseRow>(`
    -- ::text on the date: node-postgres hands back a Date for a date column,
    -- and a Date is not something a row can render.
    SELECT q.commitment_id, q.request_id, q.order_id, q.promised_date::text,
           q.days_left, q.breached, q.quoted_price::text,
           q.pincode, q.city, q.state_name, q.nearest_km::text,
           q.target_lab_id, q.target_lab_name,
           cp.id AS crm_provider_id,
           tp.thread_id AS crm_thread_id,
           tp.stage_key AS crm_stage
    FROM analytics.v_commitment_queue q
    LEFT JOIN atlas.crm_providers cp ON cp.source_lab_id = q.target_lab_id
    LEFT JOIN LATERAL (
      SELECT thread_id, stage_key FROM atlas.crm_thread_providers
      WHERE provider_id = cp.id ORDER BY updated_at DESC LIMIT 1
    ) tp ON true
    -- Everything already overdue, plus everything due up to the day being
    -- read. A deadline that has passed does not stop being work.
    WHERE q.promised_date IS NULL OR q.promised_date <= $1::date
    ORDER BY q.breached DESC NULLS LAST, q.promised_date NULLS FIRST, q.commitment_id
    LIMIT 200
  `, [throughDay]);
}

export type DayRow = {
  order_id: number;
  appointment_time: string;
  order_status: string | null;
  order_type: string | null;
  lab_id: number | null;
  lab_name: string | null;
  lab_city: string | null;
  store_name: string | null;
  request_id: number | null;
  request_pincode: string | null;
  requester_name: string | null;
  requester_mobile: string | null;
  quoted_price: string | null;
  is_first_order: boolean | null;
  lab_orders_all_time: number | null;
  lab_delivered: number | null;
  lab_failed: number | null;
  appointment_moves: number;
  prev_appointment_time: string | null;
  lab_moves: number;
  on_placeholder: boolean | null;
  request_city: string | null;
  /** Why this row is where it is in the list. Drawn as the reason chip. */
  attention: 'no_lab' | 'first_order' | 'new_lab' | 'moved' | 'routine';
};

/** What the day's table can be narrowed to. Every one of these is a URL chip. */
export type DayFilters = {
  from?: 'requests' | 'all';
  lab?: 'any' | 'none';
  first?: boolean;
  moved?: boolean;
  cancelled?: boolean;
};

/**
 * The day's orders, hardest first.
 *
 * One read with filters rather than three fixed lanes. The lanes were me
 * deciding which three questions mattered; the questions are the same rows
 * sliced differently, and a slice that is a URL is a slice somebody can send
 * to somebody else.
 *
 * The default sort is the whole point of the page: it is the order in which
 * the day should be worked. An order with no lab is not a record to read, it
 * is a phone call nobody has made yet — so it sits at the top whatever time it
 * is booked for, and the reason is written on the row.
 */
export async function getDayOrders(day: string, f: DayFilters = {}): Promise<DayRow[]> {
  const where: string[] = ['d.appointment_date = $1::date'];
  if (f.from !== 'all')  where.push('d.request_id IS NOT NULL');
  if (f.lab === 'none')  where.push('(d.on_placeholder OR d.lab_id IS NULL)');
  if (f.first)           where.push('d.is_first_order');
  if (f.moved)           where.push('(d.appointment_moves > 0 OR d.lab_moves > 0)');
  // Cancelled orders are not work. They are kept one chip away rather than
  // deleted, because "why did this fall over" is a question too.
  if (!f.cancelled)      where.push(`d.order_status NOT IN ('CANCELED', 'PATIENT_MISSED')`);

  return query<DayRow>(`
    SELECT d.order_id, d.appointment_time::text, d.order_status, d.order_type,
           d.lab_id, d.lab_name, d.lab_city, d.store_name,
           d.request_id, d.request_pincode, d.request_city,
           d.requester_name, d.requester_mobile, d.quoted_price::text,
           d.is_first_order, d.lab_orders_all_time, d.lab_delivered, d.lab_failed,
           d.appointment_moves, d.prev_appointment_time::text,
           d.lab_moves, d.on_placeholder,
           CASE
             WHEN d.on_placeholder OR d.lab_id IS NULL      THEN 'no_lab'
             WHEN d.is_first_order                          THEN 'first_order'
             WHEN COALESCE(d.lab_orders_all_time, 0) <= 3   THEN 'new_lab'
             WHEN d.appointment_moves > 0 OR d.lab_moves > 0 THEN 'moved'
             ELSE 'routine'
           END AS attention
    FROM analytics.v_fulfilment_day d
    WHERE ${where.join(' AND ')}
    ORDER BY CASE
               WHEN d.on_placeholder OR d.lab_id IS NULL      THEN 0
               WHEN d.is_first_order                          THEN 1
               WHEN COALESCE(d.lab_orders_all_time, 0) <= 3   THEN 2
               WHEN d.appointment_moves > 0 OR d.lab_moves > 0 THEN 3
               ELSE 4
             END,
             d.appointment_time, d.order_id
    LIMIT 400
  `, [day]);
}

export type DayCount = {
  day: string; appointments: number; first_orders: number;
  unallocated: number; from_requests: number;
};

/** The date strip: what each nearby day is carrying, before you open it. */
export async function getDayCounts(from: string, to: string): Promise<DayCount[]> {
  return query<DayCount>(`
    SELECT appointment_date::text AS day,
           count(*)::int AS appointments,
           count(*) FILTER (WHERE is_first_order)::int AS first_orders,
           count(*) FILTER (WHERE on_placeholder OR lab_id IS NULL)::int AS unallocated,
           count(*) FILTER (WHERE request_id IS NOT NULL)::int AS from_requests
    FROM analytics.v_fulfilment_day
    WHERE appointment_date BETWEEN $1::date AND $2::date
      AND order_status NOT IN ('CANCELED', 'PATIENT_MISSED')
    GROUP BY 1 ORDER BY 1
  `, [from, to]);
}

/** The tiles above the table. Counted on the day, not on the current filter. */
export async function getDeskSummary(day: string) {
  return queryOne<{
    appointments: number; from_requests: number; first_orders: number;
    no_lab: number; moved: number; promises: number; overdue: number;
  }>(`
    WITH d AS (
      SELECT * FROM analytics.v_fulfilment_day
      WHERE appointment_date = $1::date
        AND order_status NOT IN ('CANCELED', 'PATIENT_MISSED')
    )
    SELECT
      (SELECT count(*)::int FROM d)                                            AS appointments,
      (SELECT count(*)::int FROM d WHERE request_id IS NOT NULL)               AS from_requests,
      (SELECT count(*)::int FROM d WHERE is_first_order)                       AS first_orders,
      (SELECT count(*)::int FROM d WHERE on_placeholder OR lab_id IS NULL)     AS no_lab,
      (SELECT count(*)::int FROM d WHERE appointment_moves > 0 OR lab_moves > 0) AS moved,
      (SELECT count(*)::int FROM analytics.v_commitment_queue)                 AS promises,
      (SELECT count(*)::int FROM analytics.v_commitment_queue WHERE breached)  AS overdue
  `, [day]);
}

export type LabContext = {
  order: DayRow | null;
  /** Labs already in the network that reach this pincode. */
  covering: {
    lab_id: number; lab_name: string; city: string | null;
    missing: number | null; missing_items: string[]; cost: string | null;
    orders_all_time: number | null; delivered: number | null; failed: number | null;
  }[];
  /** How the assigned lab has performed lately — the last few orders, whatever their day. */
  recent: { order_id: number; appointment_time: string; order_status: string | null }[];
};

/**
 * Everything the drawer needs about one order's lab situation.
 *
 * Two reads because they answer two different questions — who is on it, and
 * who else could be. The covering-labs query is the same one the request page
 * uses, so "who can collect here" has one definition rather than two that
 * drift.
 */
export async function getLabContext(orderId: number): Promise<LabContext> {
  const order = await queryOne<DayRow>(`
    SELECT d.order_id, d.appointment_time::text, d.order_status, d.order_type,
           d.lab_id, d.lab_name, d.lab_city, d.store_name,
           d.request_id, d.request_pincode, d.request_city,
           d.requester_name, d.requester_mobile, d.quoted_price::text,
           d.is_first_order, d.lab_orders_all_time, d.lab_delivered, d.lab_failed,
           d.appointment_moves, d.prev_appointment_time::text,
           d.lab_moves, d.on_placeholder, 'routine' AS attention
    FROM analytics.v_fulfilment_day d WHERE d.order_id = $1
  `, [orderId]);
  if (!order) return { order: null, covering: [], recent: [] };

  const [covering, recent] = await Promise.all([
    order.request_id ? coveringLabsForRequest(order.request_id) : Promise.resolve([]),
    order.lab_id && !order.on_placeholder ? recentOrdersForLab(order.lab_id) : Promise.resolve([]),
  ]);
  return { order, covering, recent };
}

/**
 * Labs contracted to this request's store that reach its pincode, with what
 * each is missing — and, unlike the request page, with what each has actually
 * delivered. Choosing between two labs that can both serve is a question about
 * track record, and the desk is where that choice gets made.
 */
async function coveringLabsForRequest(requestId: number): Promise<LabContext['covering']> {
  return query<LabContext['covering'][number]>(`
    WITH want AS (
      SELECT DISTINCT kind, COALESCE(package_id, master_id) AS item_id
      FROM atlas.request_item
      WHERE request_id = $1 AND (package_id IS NOT NULL OR master_id IS NOT NULL)
    ),
    labs AS (
      SELECT DISTINCT lph.lab_id
      FROM analytics.mv_request_state s
      JOIN analytics.mv_lab_pincode_home lph ON lph.pincode = s.pincode
      WHERE s.request_id = $1
        AND (s.store_id IS NULL
             OR NOT atlas.store_lab_gate_active()
             OR EXISTS (SELECT 1 FROM src_local."LabsOnStore" los
                         WHERE los."storeId" = s.store_id AND los."labId" = lph.lab_id))
    )
    SELECT l.lab_id, lb."labName" AS lab_name, lb.city,
           CASE WHEN COUNT(w.item_id) = 0 THEN NULL
                ELSE COUNT(*) FILTER (WHERE w.item_id IS NOT NULL AND lo.lab_id IS NULL)::int
           END AS missing,
           ARRAY_REMOVE(ARRAY_AGG(
             CASE WHEN w.item_id IS NOT NULL AND lo.lab_id IS NULL
                  THEN COALESCE(p."packageName", m.name, '#' || w.item_id) END), NULL) AS missing_items,
           ROUND(SUM(lo.cost)::numeric, 2) AS cost,
           MAX(h.orders_all_time)::int AS orders_all_time,
           MAX(h.delivered)::int       AS delivered,
           MAX(h.failed)::int          AS failed
    FROM labs l
    LEFT JOIN want w ON true
    LEFT JOIN analytics.mv_lab_offering lo
           ON lo.lab_id = l.lab_id AND lo.kind = w.kind AND lo.item_id = w.item_id
    LEFT JOIN src_local."Package" p ON w.kind = 'PACKAGE' AND p.id = w.item_id
    LEFT JOIN src_local."Master"  m ON w.kind = 'TEST'    AND m.id = w.item_id
    JOIN src_local."Lab" lb ON lb.id = l.lab_id
    LEFT JOIN analytics.v_lab_order_history h ON h.lab_id = l.lab_id
    GROUP BY l.lab_id, lb."labName", lb.city
    ORDER BY (CASE WHEN COUNT(w.item_id) = 0 THEN 1
                   ELSE COUNT(*) FILTER (WHERE w.item_id IS NOT NULL AND lo.lab_id IS NULL) END),
             SUM(lo.cost) NULLS LAST
    LIMIT 12
  `, [requestId]);
}

/** The assigned lab's last few orders, so "can they do this" has evidence. */
async function recentOrdersForLab(labId: number) {
  return query<{ order_id: number; appointment_time: string; order_status: string | null }>(`
    SELECT o.id AS order_id,
           (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::text AS appointment_time,
           o."orderStatus"::text AS order_status
    FROM src_local."Order" o
    WHERE o."labId" = $1 AND o."appointmentTime" IS NOT NULL
    ORDER BY o."appointmentTime" DESC
    LIMIT 8
  `, [labId]);
}
