import 'server-only';
import { query, queryOne } from './db';
import { STAGES, type Stage } from './stores';

export type { Stage } from './stores';

/**
 * Stores and the orders that belong to them.
 *
 * The other fulfilment screens are queues: they hold what needs a person now
 * and they are supposed to empty. This one is a ledger. It answers the
 * question a partner asks on a call — what is happening to our orders — which
 * needs every order, including the cancelled ones and the ones from March,
 * grouped by the store rather than by what we have to do about them.
 *
 * Nothing here writes to LabStack. "Store" and "Order" arrive through the
 * read-only replica; the three things Atlas owns beside them (the account
 * overlay, the change log and the reschedule flags) are the only tables this
 * module writes, and they live in the atlas schema. See sql/init/28.
 */

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type StoreFilters = {
  /** Store name, city, state or pincode. */
  q?: string;
  /** Only stores LabStack still has switched on. Default: all. */
  activeOnly?: boolean;
  /** Only the stores the requests queue is working. */
  trackedOnly?: boolean;
  /** Counts and analytics are computed inside this window; ISO dates. */
  from?: string;
  to?: string;
  /** Only stores that have something delayed or flagged right now. */
  needsAttention?: boolean;
  sort?: StoreSort;
  limit?: number;
  offset?: number;
};

export const STORE_SORTS = ['orders', 'name', 'delayed', 'cancelled', 'turnaround'] as const;
export type StoreSort = (typeof STORE_SORTS)[number];

export type OrderFilters = {
  /** Patient name, store reference, order id or phlebo. */
  q?: string;
  stage?: Stage;
  /** On the appointment date, which is the one a partner means by "on the 3rd". */
  from?: string;
  to?: string;
  delayedOnly?: boolean;
  flaggedOnly?: boolean;
  limit?: number;
  offset?: number;
};

/**
 * The date window, as SQL.
 *
 * Both bounds are inclusive and both are optional, and `to` is compared
 * against the date rather than the timestamp — a person filtering "to the 3rd"
 * means the whole of the 3rd, and comparing a timestamp would silently drop
 * everything after midnight that morning.
 */
function windowSql(
  column: string, params: unknown[], from?: string, to?: string,
): string {
  const parts: string[] = [];
  if (from) { params.push(from); parts.push(`${column}::date >= $${params.length}::date`); }
  if (to)   { params.push(to);   parts.push(`${column}::date <= $${params.length}::date`); }
  return parts.length ? ` AND ${parts.join(' AND ')}` : '';
}

// ---------------------------------------------------------------------------
// The store list
// ---------------------------------------------------------------------------

export type StoreRow = {
  store_id: number;
  name: string;
  legal_name: string | null;
  store_type: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  address: string | null;
  active: boolean;
  tracked: boolean;
  api_enabled: boolean;
  poc_name: string | null;
  poc_phone: string | null;
  poc_email: string | null;
  ops_owner_name: string | null;
  /** Counts within the window. */
  total: number;
  pending: number;
  scheduled: number;
  rescheduled: number;
  in_progress: number;
  completed: number;
  cancelled: number;
  delayed: number;
  flagged: number;
  /** Analytics. Null where there is nothing finished to measure. */
  avg_turnaround_hours: number | null;
  median_turnaround_hours: number | null;
  cancellation_rate: number | null;
  last_order_at: string | null;
  /** Whether the pending pile has passed this store's own limit. */
  pending_over_limit: boolean;
};

const STORE_ORDER_BY: Record<StoreSort, string> = {
  orders: 'o.total DESC NULLS LAST, s."storeName"',
  name: 's."storeName"',
  delayed: 'o.delayed DESC NULLS LAST, o.total DESC NULLS LAST',
  cancelled: 'o.cancellation_rate DESC NULLS LAST, o.total DESC NULLS LAST',
  turnaround: 'o.avg_turnaround_hours DESC NULLS LAST, o.total DESC NULLS LAST',
};

/** The WHERE on stores, shared by the page query and its count. */
function storeWhere(f: StoreFilters, params: unknown[]): string {
  const where: string[] = ['TRUE'];
  if (f.q) {
    params.push(`%${f.q}%`);
    const p = `$${params.length}`;
    where.push(`(s."storeName" ILIKE ${p} OR s.city ILIKE ${p}
                 OR s.state ILIKE ${p} OR s.pincode ILIKE ${p}
                 OR s."legalName" ILIKE ${p})`);
  }
  if (f.activeOnly) where.push('s.active');
  if (f.trackedOnly) where.push('atlas.store_is_tracked(s.id)');
  return where.join(' AND ');
}

/**
 * The counts for one store, as a correlated subquery.
 *
 * A LATERAL per store rather than one GROUP BY over every order, because the
 * store list has to include stores with no orders at all — a partner
 * onboarded last week, or one that has gone quiet, both of which are exactly
 * what somebody opens this page to notice. An inner join would hide them and
 * a grouped left join would need the same lateral anyway to keep the date
 * window from eliminating the store row along with its orders.
 */
function storeStatsSql(params: unknown[], f: StoreFilters): string {
  const win = windowSql('v.created_at', params, f.from, f.to);
  return `
    LEFT JOIN LATERAL (
      SELECT count(*)::int                                          AS total,
             count(*) FILTER (WHERE v.stage = 'pending')::int        AS pending,
             count(*) FILTER (WHERE v.stage = 'scheduled')::int      AS scheduled,
             count(*) FILTER (WHERE v.stage = 'rescheduled')::int    AS rescheduled,
             count(*) FILTER (WHERE v.stage = 'in_progress')::int    AS in_progress,
             count(*) FILTER (WHERE v.stage = 'completed')::int      AS completed,
             count(*) FILTER (WHERE v.stage = 'cancelled')::int      AS cancelled,
             count(*) FILTER (WHERE v.delayed)::int                  AS delayed,
             count(*) FILTER (WHERE v.flagged_for_reschedule)::int   AS flagged,
             avg(v.turnaround_hours)                                 AS avg_turnaround_hours,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY v.turnaround_hours)
                                                                     AS median_turnaround_hours,
             -- Rate over the whole window, not over finished orders: a store
             -- whose orders are mostly still open would otherwise read 50%
             -- cancelled off two rows.
             CASE WHEN count(*) > 0
                  THEN count(*) FILTER (WHERE v.stage = 'cancelled')::numeric / count(*)
             END                                                     AS cancellation_rate,
             max(v.created_at)::text                                 AS last_order_at
      FROM analytics.v_store_order v
      WHERE v.store_id = s.id${win}
    ) o ON TRUE`;
}

export async function getStoreRows(f: StoreFilters = {}): Promise<StoreRow[]> {
  const params: unknown[] = [];
  const stats = storeStatsSql(params, f);
  const where = storeWhere(f, params);
  const attention = f.needsAttention
    ? ' AND (COALESCE(o.delayed, 0) > 0 OR COALESCE(o.flagged, 0) > 0)' : '';

  const limit = Math.min(Math.max(f.limit ?? 25, 1), 200);
  params.push(limit);
  const limitP = `$${params.length}`;
  params.push(Math.max(f.offset ?? 0, 0));
  const offsetP = `$${params.length}`;

  return query<StoreRow>(`
    SELECT s.id                       AS store_id,
           COALESCE(NULLIF(btrim(s."storeName"), ''), 'Store ' || s.id) AS name,
           s."legalName"              AS legal_name,
           s."storeType"              AS store_type,
           s.city, s.state, s.pincode, s.address,
           COALESCE(s.active, false)      AS active,
           atlas.store_is_tracked(s.id)   AS tracked,
           COALESCE(s."apiEnabled", false) AS api_enabled,
           -- The console keeps contacts as an array of objects and the first
           -- is the one it shows, so that is the one we show.
           s.pocs[1] ->> 'name'       AS poc_name,
           s.pocs[1] ->> 'phone'      AS poc_phone,
           s.pocs[1] ->> 'email'      AS poc_email,
           ou.name                    AS ops_owner_name,
           COALESCE(o.total, 0)       AS total,
           COALESCE(o.pending, 0)     AS pending,
           COALESCE(o.scheduled, 0)   AS scheduled,
           COALESCE(o.rescheduled, 0) AS rescheduled,
           COALESCE(o.in_progress, 0) AS in_progress,
           COALESCE(o.completed, 0)   AS completed,
           COALESCE(o.cancelled, 0)   AS cancelled,
           COALESCE(o.delayed, 0)     AS delayed,
           COALESCE(o.flagged, 0)     AS flagged,
           o.avg_turnaround_hours::float8    AS avg_turnaround_hours,
           o.median_turnaround_hours::float8 AS median_turnaround_hours,
           o.cancellation_rate::float8       AS cancellation_rate,
           o.last_order_at,
           COALESCE(o.pending, 0) >= atlas.store_pending_limit(s.id) AS pending_over_limit
    FROM src_local."Store" s
    LEFT JOIN atlas.store_profile sp ON sp.store_id = s.id
    LEFT JOIN atlas.users ou ON ou.id = sp.ops_owner_id
    ${stats}
    WHERE ${where}${attention}
    ORDER BY ${STORE_ORDER_BY[f.sort ?? 'orders']}
    LIMIT ${limitP} OFFSET ${offsetP}
  `, params);
}

/** How many stores match, for the pager. */
export async function countStores(f: StoreFilters = {}): Promise<number> {
  const params: unknown[] = [];
  // needsAttention reads the lateral, so the count has to pay for it too.
  // Without the filter it does not, and this stays a scan of forty rows.
  if (!f.needsAttention) {
    const where = storeWhere(f, params);
    const row = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM src_local."Store" s WHERE ${where}`, params);
    return row?.n ?? 0;
  }
  const stats = storeStatsSql(params, f);
  const where = storeWhere(f, params);
  const row = await queryOne<{ n: number }>(`
    SELECT count(*)::int AS n
    FROM src_local."Store" s
    ${stats}
    WHERE ${where} AND (COALESCE(o.delayed, 0) > 0 OR COALESCE(o.flagged, 0) > 0)
  `, params);
  return row?.n ?? 0;
}

/** The fleet in one line: what the strip above the table reads. */
export async function getStoreOverview(f: StoreFilters = {}) {
  const params: unknown[] = [];
  const win = windowSql('v.created_at', params, f.from, f.to);
  return queryOne<{
    stores: number; active_stores: number; quiet_stores: number;
    orders: number; delayed: number; flagged: number;
    pending: number; cancelled: number;
    avg_turnaround_hours: number | null;
  }>(`
    SELECT (SELECT count(*)::int FROM src_local."Store")                    AS stores,
           (SELECT count(*)::int FROM src_local."Store" WHERE active)       AS active_stores,
           -- Active, tracked, and nothing at all in the window. The one thing
           -- an orders table can never show you is the partner who stopped
           -- sending any.
           (SELECT count(*)::int FROM src_local."Store" s
             WHERE s.active AND atlas.store_is_tracked(s.id)
               AND NOT EXISTS (SELECT 1 FROM analytics.v_store_order v
                                WHERE v.store_id = s.id${win}))            AS quiet_stores,
           count(*)::int                                                    AS orders,
           count(*) FILTER (WHERE v.delayed)::int                           AS delayed,
           count(*) FILTER (WHERE v.flagged_for_reschedule)::int            AS flagged,
           count(*) FILTER (WHERE v.stage = 'pending')::int                 AS pending,
           count(*) FILTER (WHERE v.stage = 'cancelled')::int               AS cancelled,
           avg(v.turnaround_hours)::float8                                  AS avg_turnaround_hours
    FROM analytics.v_store_order v
    WHERE TRUE${win}
  `, params);
}

// ---------------------------------------------------------------------------
// One store's orders
// ---------------------------------------------------------------------------

export type OrderRow = {
  order_id: number;
  store_id: number;
  order_status: string | null;
  stage: Stage;
  order_type: string | null;
  reference_id: string | null;
  created_at: string | null;
  appointment_at: string | null;
  status_at: string | null;
  assigned_at: string | null;
  phlebo_name: string | null;
  phlebo_number: string | null;
  lab_id: number | null;
  lab_name: string | null;
  lab_city: string | null;
  patient_name: string | null;
  patient_city: string | null;
  patient_pincode: string | null;
  request_id: number | null;
  cancel_reason: string | null;
  turnaround_hours: number | null;
  delayed: boolean;
  hours_since_appointment: number | null;
  flagged_for_reschedule: boolean;
  reschedule_reason: string | null;
  flagged_by_name: string | null;
  reschedule_stale: boolean;
};

function orderWhere(storeId: number, f: OrderFilters, params: unknown[]): string {
  params.push(storeId);
  const where: string[] = [`v.store_id = $${params.length}`];

  if (f.stage) { params.push(f.stage); where.push(`v.stage = $${params.length}`); }
  if (f.delayedOnly) where.push('v.delayed');
  if (f.flaggedOnly) where.push('v.flagged_for_reschedule');
  if (f.q) {
    const raw = f.q.trim();
    params.push(`%${raw}%`);
    const p = `$${params.length}`;
    // A bare number is almost always somebody pasting an order id, so match it
    // exactly as well as inside the reference — otherwise searching "119"
    // returns every reference containing 119 and buries the order itself.
    const asId = /^\d+$/.test(raw) ? Number(raw) : null;
    let idClause = '';
    if (asId !== null && Number.isSafeInteger(asId)) {
      params.push(asId);
      idClause = ` OR v.order_id = $${params.length}`;
    }
    where.push(`(v.patient_name ILIKE ${p} OR v.reference_id ILIKE ${p}
                 OR v.phlebo_name ILIKE ${p} OR v.lab_name ILIKE ${p}${idClause})`);
  }
  return where.join(' AND ') + windowSql('v.appointment_at', params, f.from, f.to);
}

/**
 * One store's orders, most recent appointment first.
 *
 * Delayed rows are not floated to the top. This is a ledger somebody reads in
 * date order while a partner reads their own list down the phone, and a table
 * that silently reorders itself around our idea of urgency is one they cannot
 * follow. The delayed filter is a click away for when that is the question.
 */
export async function getStoreOrders(storeId: number, f: OrderFilters = {}): Promise<OrderRow[]> {
  const params: unknown[] = [];
  const where = orderWhere(storeId, f, params);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 500);
  params.push(limit);
  const limitP = `$${params.length}`;
  params.push(Math.max(f.offset ?? 0, 0));
  const offsetP = `$${params.length}`;

  return query<OrderRow>(`
    SELECT v.order_id, v.store_id, v.order_status, v.stage, v.order_type, v.reference_id,
           v.created_at::text, v.appointment_at::text, v.status_at::text, v.assigned_at::text,
           v.phlebo_name, v.phlebo_number,
           v.lab_id, v.lab_name, v.lab_city,
           v.patient_name, v.patient_city, v.patient_pincode,
           v.request_id, v.cancel_reason,
           v.turnaround_hours::float8, v.delayed,
           v.hours_since_appointment::float8,
           v.flagged_for_reschedule, v.reschedule_reason, v.flagged_by_name, v.reschedule_stale
    FROM analytics.v_store_order v
    WHERE ${where}
    ORDER BY v.appointment_at DESC NULLS LAST, v.order_id DESC
    LIMIT ${limitP} OFFSET ${offsetP}
  `, params);
}

export async function countStoreOrders(storeId: number, f: OrderFilters = {}): Promise<number> {
  const params: unknown[] = [];
  const where = orderWhere(storeId, f, params);
  const row = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM analytics.v_store_order v WHERE ${where}`, params);
  return row?.n ?? 0;
}

/**
 * How many orders sit in each stage for this store, under every filter except
 * the stage itself — so the tabs keep saying what they would give you rather
 * than all reading zero once one of them is chosen.
 */
export async function getStageFacets(
  storeId: number, f: OrderFilters = {},
): Promise<Record<Stage, number> & { all: number }> {
  const params: unknown[] = [];
  const where = orderWhere(storeId, { ...f, stage: undefined }, params);
  const rows = await query<{ stage: Stage; n: number }>(`
    SELECT v.stage, count(*)::int AS n
    FROM analytics.v_store_order v
    WHERE ${where}
    GROUP BY 1
  `, params);
  const out = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number> & { all: number };
  out.all = 0;
  for (const r of rows) {
    if ((STAGES as readonly string[]).includes(r.stage)) out[r.stage] = r.n;
    out.all += r.n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// One store
// ---------------------------------------------------------------------------

export type StoreDetail = StoreRow & {
  ops_owner_id: number | null;
  ops_contact_name: string | null;
  ops_contact_phone: string | null;
  ops_contact_email: string | null;
  coverage_note: string | null;
  delay_alert_hours: number;
  pending_alert_count: number;
  profile_updated_at: string | null;
  profile_updated_by: string | null;
  mou_end_date: string | null;
  created_at: string | null;
};

export async function getStoreDetail(
  storeId: number, f: { from?: string; to?: string } = {},
): Promise<StoreDetail | null> {
  const params: unknown[] = [];
  const stats = storeStatsSql(params, f);
  params.push(storeId);
  return queryOne<StoreDetail>(`
    SELECT s.id                       AS store_id,
           COALESCE(NULLIF(btrim(s."storeName"), ''), 'Store ' || s.id) AS name,
           s."legalName"              AS legal_name,
           s."storeType"              AS store_type,
           s.city, s.state, s.pincode, s.address,
           COALESCE(s.active, false)      AS active,
           atlas.store_is_tracked(s.id)   AS tracked,
           COALESCE(s."apiEnabled", false) AS api_enabled,
           s.pocs[1] ->> 'name'       AS poc_name,
           s.pocs[1] ->> 'phone'      AS poc_phone,
           s.pocs[1] ->> 'email'      AS poc_email,
           (s."mouEndDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::text AS mou_end_date,
           (s."createdAt"  AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::text AS created_at,
           sp.ops_owner_id,
           ou.name                    AS ops_owner_name,
           sp.ops_contact_name, sp.ops_contact_phone, sp.ops_contact_email,
           sp.coverage_note,
           atlas.store_delay_hours(s.id)   AS delay_alert_hours,
           atlas.store_pending_limit(s.id) AS pending_alert_count,
           sp.updated_at::text        AS profile_updated_at,
           pu.name                    AS profile_updated_by,
           COALESCE(o.total, 0)       AS total,
           COALESCE(o.pending, 0)     AS pending,
           COALESCE(o.scheduled, 0)   AS scheduled,
           COALESCE(o.rescheduled, 0) AS rescheduled,
           COALESCE(o.in_progress, 0) AS in_progress,
           COALESCE(o.completed, 0)   AS completed,
           COALESCE(o.cancelled, 0)   AS cancelled,
           COALESCE(o.delayed, 0)     AS delayed,
           COALESCE(o.flagged, 0)     AS flagged,
           o.avg_turnaround_hours::float8    AS avg_turnaround_hours,
           o.median_turnaround_hours::float8 AS median_turnaround_hours,
           o.cancellation_rate::float8       AS cancellation_rate,
           o.last_order_at,
           COALESCE(o.pending, 0) >= atlas.store_pending_limit(s.id) AS pending_over_limit
    FROM src_local."Store" s
    LEFT JOIN atlas.store_profile sp ON sp.store_id = s.id
    LEFT JOIN atlas.users ou ON ou.id = sp.ops_owner_id
    LEFT JOIN atlas.users pu ON pu.id = sp.updated_by
    ${stats}
    WHERE s.id = $${params.length}
  `, params);
}

/** Whether a store id is real, so "no orders" and "no store" can be told apart. */
export async function storeExists(storeId: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM src_local."Store" WHERE id = $1`, [storeId]);
  return row != null;
}

/** What the store's orders look like month by month, for the detail page. */
export async function getStoreTrend(storeId: number, months = 6) {
  return query<{
    month: string; total: number; completed: number; cancelled: number;
    avg_turnaround_hours: number | null;
  }>(`
    SELECT to_char(date_trunc('month', v.created_at), 'YYYY-MM')      AS month,
           count(*)::int                                              AS total,
           count(*) FILTER (WHERE v.stage = 'completed')::int          AS completed,
           count(*) FILTER (WHERE v.stage = 'cancelled')::int          AS cancelled,
           avg(v.turnaround_hours)::float8                             AS avg_turnaround_hours
    FROM analytics.v_store_order v
    WHERE v.store_id = $1
      AND v.created_at >= date_trunc('month', now()) - ($2::int - 1) * interval '1 month'
    GROUP BY 1
    ORDER BY 1
  `, [storeId, months]);
}

/** Who changed what about this store. Newest first. */
export async function getStoreChangeLog(storeId: number, limit = 50) {
  return query<{
    id: number; action: string; summary: string; detail: unknown;
    actor_name: string | null; ts: string;
  }>(`
    SELECT c.id, c.action, c.summary, c.detail, u.name AS actor_name, c.ts::text
    FROM atlas.store_change_log c
    LEFT JOIN atlas.users u ON u.id = c.actor_id
    WHERE c.store_id = $1
    ORDER BY c.ts DESC, c.id DESC
    LIMIT $2
  `, [storeId, Math.min(Math.max(limit, 1), 200)]);
}

/** The people an account can be handed to. */
export async function getOpsOwners() {
  return query<{ id: number; name: string; role: string }>(`
    SELECT id, name, role FROM atlas.users
    WHERE active AND role IN ('admin', 'network_lead', 'network', 'accounts', 'operations')
    ORDER BY name
  `);
}
