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
  on_placeholder: boolean | null;
};

/**
 * Lane 2 — happening on the day.
 *
 * First orders first, then the rest. The ordering is the point: a lab that has
 * never done one of these is where the day's attention belongs, and of the 98
 * labs that have ever taken an order, 41 have taken exactly one.
 */
export async function getDayAppointments(day: string, opts: { onlyRequests?: boolean } = {}): Promise<DayRow[]> {
  const where = opts.onlyRequests ? 'AND d.request_id IS NOT NULL' : '';
  return query<DayRow>(`
    SELECT d.order_id, d.appointment_time::text, d.order_status, d.order_type,
           d.lab_id, d.lab_name, d.lab_city, d.store_name,
           d.request_id, d.request_pincode, d.requester_name, d.requester_mobile,
           d.quoted_price::text,
           d.is_first_order, d.lab_orders_all_time, d.lab_delivered, d.lab_failed,
           d.appointment_moves, d.prev_appointment_time::text, d.on_placeholder
    FROM analytics.v_fulfilment_day d
    WHERE d.appointment_date = $1::date ${where}
    ORDER BY d.is_first_order DESC NULLS LAST, d.on_placeholder DESC NULLS LAST,
             d.appointment_time, d.order_id
    LIMIT 300
  `, [day]);
}

export type MovedRow = DayRow & { moved_at: string | null; lab_moves: number; prev_lab_id: number | null };

/**
 * Lane 3 — moved since we last looked.
 *
 * Only possible because atlas.order_watch remembers: the snapshot is rebuilt
 * nightly, so yesterday's date is otherwise simply gone. A promise that has
 * slipped three times is a different conversation from one booked yesterday,
 * and only the count says which.
 */
export async function getRecentMoves(day: string, withinDays = 7): Promise<MovedRow[]> {
  return query<MovedRow>(`
    SELECT d.order_id, d.appointment_time::text, d.order_status, d.order_type,
           d.lab_id, d.lab_name, d.lab_city, d.store_name,
           d.request_id, d.request_pincode, d.requester_name, d.requester_mobile,
           d.quoted_price::text,
           d.is_first_order, d.lab_orders_all_time, d.lab_delivered, d.lab_failed,
           d.appointment_moves, d.prev_appointment_time::text, d.on_placeholder,
           d.moved_at::text, d.lab_moves, d.prev_lab_id
    FROM analytics.v_fulfilment_day d
    WHERE d.moved_at IS NOT NULL
      AND d.moved_at > $1::date - make_interval(days => $2)
      AND (d.appointment_moves > 0 OR d.lab_moves > 0)
    ORDER BY d.moved_at DESC
    LIMIT 100
  `, [day, withinDays]);
}

export type DayCount = { day: string; appointments: number; first_orders: number; unallocated: number };

/** The date strip: what each nearby day is carrying, before you open it. */
export async function getDayCounts(from: string, to: string): Promise<DayCount[]> {
  return query<DayCount>(`
    SELECT appointment_date::text AS day,
           count(*)::int AS appointments,
           count(*) FILTER (WHERE is_first_order)::int AS first_orders,
           count(*) FILTER (WHERE on_placeholder)::int AS unallocated
    FROM analytics.v_fulfilment_day
    WHERE appointment_date BETWEEN $1::date AND $2::date
    GROUP BY 1 ORDER BY 1
  `, [from, to]);
}

/** The one-line summary above the lanes. */
export async function getDeskSummary(day: string) {
  return queryOne<{
    due_or_overdue: number; overdue: number;
    appointments: number; first_orders: number; unallocated: number; moved: number;
  }>(`
    SELECT
      (SELECT count(*)::int FROM analytics.v_commitment_queue
        WHERE promised_date IS NULL OR promised_date <= $1::date)                      AS due_or_overdue,
      (SELECT count(*)::int FROM analytics.v_commitment_queue WHERE breached)          AS overdue,
      (SELECT count(*)::int FROM analytics.v_fulfilment_day
        WHERE appointment_date = $1::date)                                             AS appointments,
      (SELECT count(*)::int FROM analytics.v_fulfilment_day
        WHERE appointment_date = $1::date AND is_first_order)                          AS first_orders,
      (SELECT count(*)::int FROM analytics.v_fulfilment_day
        WHERE appointment_date = $1::date AND on_placeholder)                          AS unallocated,
      (SELECT count(*)::int FROM analytics.v_fulfilment_day
        WHERE moved_at > $1::date - interval '7 days')                                 AS moved
  `, [day]);
}
