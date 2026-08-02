import 'server-only';
import { query, queryOne } from './db';

/**
 * Account intelligence.
 *
 * Reads analytics.mv_account_activity, which carries every demand stream a
 * store puts through the platform — lab orders, pharmacy orders, appointments
 * and requests — rather than lab orders alone.
 *
 * Money columns exist on the MV but are deliberately not surfaced yet:
 * Order.storePayment is negative on 28,197 of 46,202 rows, so the sign
 * convention needs confirming before anything is labelled revenue.
 */

export const STREAMS = ['LAB_ORDER', 'PHARMA_ORDER', 'APPOINTMENT', 'REQUEST'] as const;
export type Stream = (typeof STREAMS)[number];

export const STREAM_LABEL: Record<Stream, string> = {
  LAB_ORDER: 'Lab orders',
  PHARMA_ORDER: 'Pharmacy orders',
  APPOINTMENT: 'Appointments',
  REQUEST: 'Requests',
};

export const SERVICE_LABEL: Record<string, string> = {
  LAB_HOME_SAMPLE: 'Lab · Home sample',
  LAB_CENTER_VISIT: 'Lab · Center visit',
  CAMP_ORDER: 'Camp',
  PHARMACY_DELIVERY: 'Pharmacy · Delivery',
  DOCTOR_CONSULT_CENTER: 'Doctor · Center',
  DOCTOR_CONSULT_HOME: 'Doctor · Home',
  DOCTOR_CONSULT_ONLINE: 'Doctor · Online',
  NURSING_HOME_VISIT: 'Nursing · Home visit',
  OTHER_APPOINTMENT: 'Other appointment',
  OTHER: 'Other',
};

export type AccountListRow = {
  store_id: number;
  store_name: string;
  city: string | null;
  active: boolean;
  streams_used: number;
  events_all_time: number;
  events_l30d: number;
  events_l30d_prior: number;
  requests_all_time: number;
  last_activity: string | null;
};

/** Accounts with all-stream totals, searchable by name or city. */
export async function searchAccounts(opts: { q?: string; limit?: number } = {}): Promise<AccountListRow[]> {
  const params: unknown[] = [];
  const conds: string[] = [];
  if (opts.q?.trim()) {
    params.push(`%${opts.q.trim().toLowerCase()}%`);
    conds.push(`(lower(s."storeName") LIKE $${params.length} OR lower(s.city) LIKE $${params.length})`);
  }
  params.push(opts.limit ?? 200);

  return query<AccountListRow>(`
    WITH anchor AS (SELECT MAX(month) AS ref FROM analytics.mv_account_activity),
    agg AS (
      SELECT
        a.store_id,
        COUNT(DISTINCT a.stream)::int                                             AS streams_used,
        SUM(a.events)::int                                                        AS events_all_time,
        SUM(a.events) FILTER (WHERE a.month >= (SELECT ref FROM anchor))::int      AS events_l30d,
        SUM(a.events) FILTER (WHERE a.month >= (SELECT ref FROM anchor) - INTERVAL '1 month'
                                AND a.month <  (SELECT ref FROM anchor))::int      AS events_l30d_prior,
        SUM(a.events) FILTER (WHERE a.stream = 'REQUEST')::int                     AS requests_all_time,
        MAX(a.month)::text                                                         AS last_activity
      FROM analytics.mv_account_activity a
      GROUP BY a.store_id
    )
    SELECT
      s.id AS store_id, s."storeName" AS store_name, s.city, s.active,
      COALESCE(agg.streams_used, 0)      AS streams_used,
      COALESCE(agg.events_all_time, 0)   AS events_all_time,
      COALESCE(agg.events_l30d, 0)       AS events_l30d,
      COALESCE(agg.events_l30d_prior, 0) AS events_l30d_prior,
      COALESCE(agg.requests_all_time, 0) AS requests_all_time,
      agg.last_activity
    FROM src_local."Store" s
    LEFT JOIN agg ON agg.store_id = s.id
    ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
    ORDER BY COALESCE(agg.events_all_time, 0) DESC, s."storeName"
    LIMIT $${params.length}
  `, params);
}

export type AccountHeader = {
  store_id: number;
  store_name: string;
  legal_name: string | null;
  city: string | null;
  state: string | null;
  active: boolean;
  mou_end_date: string | null;
  created_at: string | null;
};

export async function getAccount(storeId: number): Promise<AccountHeader | null> {
  return queryOne<AccountHeader>(`
    SELECT id AS store_id, "storeName" AS store_name, "legalName" AS legal_name,
           city, state, active, "mouEndDate"::text AS mou_end_date, "createdAt"::text AS created_at
    FROM src_local."Store" WHERE id = $1
  `, [storeId]);
}

export type StreamTotals = {
  stream: Stream;
  events: number;
  fulfilled: number;
  canceled: number;
  events_l30d: number;
  events_l30d_prior: number;
  distinct_users: number;
};

/** Per-stream totals with a month-over-month comparison. */
export async function getAccountStreams(storeId: number): Promise<StreamTotals[]> {
  return query<StreamTotals>(`
    WITH anchor AS (SELECT MAX(month) AS ref FROM analytics.mv_account_activity)
    SELECT
      a.stream,
      SUM(a.events)::int                                                     AS events,
      SUM(a.fulfilled)::int                                                  AS fulfilled,
      SUM(a.canceled)::int                                                   AS canceled,
      COALESCE(SUM(a.events) FILTER (WHERE a.month >= (SELECT ref FROM anchor)), 0)::int AS events_l30d,
      COALESCE(SUM(a.events) FILTER (WHERE a.month >= (SELECT ref FROM anchor) - INTERVAL '1 month'
                              AND a.month <  (SELECT ref FROM anchor)), 0)::int          AS events_l30d_prior,
      MAX(a.distinct_users)::int                                             AS distinct_users
    FROM analytics.mv_account_activity a
    WHERE a.store_id = $1
    GROUP BY a.stream
    ORDER BY SUM(a.events) DESC
  `, [storeId]);
}

export type MonthPoint = { month: string; stream: Stream; events: number; fulfilled: number };

/** Monthly trend per stream — the growth picture. */
export async function getAccountMonthly(storeId: number, months = 18): Promise<MonthPoint[]> {
  return query<MonthPoint>(`
    SELECT month::text, stream, SUM(events)::int AS events, SUM(fulfilled)::int AS fulfilled
    FROM analytics.mv_account_activity
    WHERE store_id = $1 AND month >= (SELECT MAX(month) FROM analytics.mv_account_activity) - ($2 || ' months')::interval
    GROUP BY month, stream
    ORDER BY month
  `, [storeId, months]);
}

export type ServiceMixRow = {
  service_line: string; stream: Stream; events: number; fulfilled: number; canceled: number;
};

/** What they actually buy — the basis for spotting what they don't. */
export async function getAccountServiceMix(storeId: number): Promise<ServiceMixRow[]> {
  return query<ServiceMixRow>(`
    SELECT service_line, stream,
           SUM(events)::int AS events, SUM(fulfilled)::int AS fulfilled, SUM(canceled)::int AS canceled
    FROM analytics.mv_account_activity
    WHERE store_id = $1
    GROUP BY service_line, stream
    ORDER BY SUM(events) DESC
  `, [storeId]);
}

export type RequestFunnelRow = { status: string; events: number };

/** Enquiries by outcome. Where demand died before becoming an order. */
export async function getAccountRequestFunnel(storeId: number): Promise<RequestFunnelRow[]> {
  return query<RequestFunnelRow>(`
    SELECT r.status::text AS status, COUNT(*)::int AS events
    FROM src_local."Request" r
    WHERE r."storeId" = $1
    GROUP BY r.status
    ORDER BY COUNT(*) DESC
  `, [storeId]);
}

export type PartnerRow = { name: string; kind: string; events: number };

/** Labs and pharmacies fulfilling this account's work. */
export async function getAccountPartners(storeId: number, limit = 8): Promise<PartnerRow[]> {
  return query<PartnerRow>(`
    SELECT l."labName" AS name, 'LAB' AS kind, COUNT(*)::int AS events
    FROM src_local."Order" o JOIN src_local."Lab" l ON l.id = o."labId"
    WHERE o."storeId" = $1
    GROUP BY l."labName"
    ORDER BY COUNT(*) DESC
    LIMIT $2
  `, [storeId, limit]);
}

export type GeoRow = { pincode: string; city: string | null; events: number };

/** Where their demand comes from — feeds straight into a coverage check. */
export async function getAccountGeography(storeId: number, limit = 10): Promise<GeoRow[]> {
  return query<GeoRow>(`
    SELECT d.pincode, pc.city, COUNT(*)::int AS events
    FROM analytics.mv_unified_demand d
    LEFT JOIN analytics.mv_pincode_city pc ON pc.pincode = d.pincode
    WHERE d.store_id = $1
    GROUP BY d.pincode, pc.city
    ORDER BY COUNT(*) DESC
    LIMIT $2
  `, [storeId, limit]);
}

/**
 * Service lines this account has never ordered, ranked by how much the rest
 * of the book uses them — the upsell list, evidenced rather than guessed.
 */
export type UpsellRow = { service_line: string; accounts_using: number; total_events: number };

export async function getAccountUpsell(storeId: number): Promise<UpsellRow[]> {
  return query<UpsellRow>(`
    WITH theirs AS (
      SELECT DISTINCT service_line FROM analytics.mv_account_activity
      WHERE store_id = $1 AND stream <> 'REQUEST'
    )
    SELECT service_line,
           COUNT(DISTINCT store_id)::int AS accounts_using,
           SUM(events)::int              AS total_events
    FROM analytics.mv_account_activity
    WHERE stream <> 'REQUEST'
      AND service_line <> 'OTHER'
      AND service_line NOT IN (SELECT service_line FROM theirs)
    GROUP BY service_line
    ORDER BY COUNT(DISTINCT store_id) DESC, SUM(events) DESC
  `, [storeId]);
}

/** Stream coverage, so the UI can say "no data" rather than implying "none". */
export async function getStreamCoverage(): Promise<{ stream: string; stores: number; events: number }[]> {
  return query(`
    SELECT stream, COUNT(DISTINCT store_id)::int AS stores, SUM(events)::int AS events
    FROM analytics.mv_account_activity GROUP BY stream
  `);
}
