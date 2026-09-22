/**
 * Requests vocabulary — states, tones and labels.
 *
 * Pure, no database. The tables that render this are client components and
 * lib/requestQueries.ts is server-only, same split as lib/readiness.ts.
 */

export const REQUEST_STATES = [
  'SERVICEABLE',
  'PACKAGE_GAP',
  'SUPPLY_GAP_KNOWN',
  'SUPPLY_GAP_UNKNOWN',
  'NO_ITEMS',
  'NO_PINCODE',
] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export const STATE_LABEL: Record<RequestState, string> = {
  SERVICEABLE: 'Serviceable',
  PACKAGE_GAP: 'Package gap',
  SUPPLY_GAP_KNOWN: 'Supply gap — lab identified',
  SUPPLY_GAP_UNKNOWN: 'Supply gap — no lab in range',
  NO_ITEMS: 'Unidentified items',
  NO_PINCODE: 'No pincode',
};

export const STATE_SHORT: Record<RequestState, string> = {
  SERVICEABLE: 'Serviceable',
  PACKAGE_GAP: 'Package gap',
  SUPPLY_GAP_KNOWN: 'Supply gap',
  SUPPLY_GAP_UNKNOWN: 'No lab in range',
  NO_ITEMS: 'Unidentified items',
  NO_PINCODE: 'No pincode',
};

/**
 * Who acts. The point of the state model is that it names an owner — a state
 * that leaves "someone should look at this" is not a state, it's a shrug.
 */
export const STATE_OWNER: Record<RequestState, 'console' | 'network' | 'data'> = {
  SERVICEABLE: 'console',
  PACKAGE_GAP: 'network',
  SUPPLY_GAP_KNOWN: 'network',
  SUPPLY_GAP_UNKNOWN: 'network',
  NO_ITEMS: 'data',
  NO_PINCODE: 'data',
};

/**
 * Who acts, in the words the row can print.
 *
 * STATE_OWNER has named the owner since the state model was written, and the
 * queue has never shown it — so a person reading thirty rows re-derives it
 * thirty times from the state chip, and the two states that are somebody
 * else's job entirely (a missing pincode, an unparsed ask) look like work for
 * whoever opened the page. Naming it is the difference between a list of
 * problems and a list of assignments.
 */
export const OWNER_LABEL: Record<'console' | 'network' | 'data', string> = {
  console: 'Ops',
  network: 'Network',
  data: 'Data',
};

/**
 * What each owner is being asked to do, in one line, for the hover.
 *
 * Short enough to read without stopping, because it is shown on a chip that
 * somebody is passing over on their way down the list.
 */
export const OWNER_ACTION: Record<'console' | 'network' | 'data', string> = {
  console: 'Ops can quote and convert this today — the network is already in place.',
  network: 'Needs the network team: a lab has to be activated or onboarded before this can be served.',
  data: 'Needs a data fix before anyone can price it — the request is missing what it asked for or where it is.',
};

export const OWNER_TONE: Record<'console' | 'network' | 'data', 'brand' | 'warn' | 'ink'> = {
  console: 'brand',
  network: 'warn',
  data: 'ink',
};

/**
 * How long a request may sit in a stage before it is late.
 *
 * The queue has always been able to show how long something has waited, and
 * has never said how long was acceptable — so "12 days" is a number the reader
 * has to hold an opinion about. These are that opinion, written once:
 *
 *   · Needs a quote — the store is waiting on a price and cannot do anything
 *     until it has one. A day is generous; two is late.
 *   · Awaiting acceptance — the ball is with the store, so the clock is
 *     slower, but a quote nobody has answered in a week is a quote that has
 *     been forgotten rather than considered.
 *   · Ready to order — the store has said yes and the promised date is moving
 *     while this sits. Same day, and late tomorrow.
 *
 * Deliberately per stage rather than one number for the page: the three
 * queues are three different promises, and a single threshold would be wrong
 * for two of them.
 */
export const STAGE_SLA: Record<string, { due: number; late: number }> = {
  OPEN: { due: 1, late: 2 },
  CONSENTED: { due: 1, late: 2 },
  QUOTED: { due: 3, late: 7 },
  QUOTATION_ACCEPTED: { due: 0, late: 1 },
};

export type SlaLevel = 'ok' | 'due' | 'late' | 'none';

/**
 * Where a request sits against the promise for its stage.
 *
 * 'none' rather than 'ok' when there is no threshold or no clock: a stage
 * nobody is waiting on must not render as though it passed a check, or the
 * colour stops meaning anything.
 */
export function slaLevel(status: string | null | undefined, waitingDays: number | null): SlaLevel {
  const sla = status ? STAGE_SLA[status] : undefined;
  if (!sla || waitingDays == null) return 'none';
  if (waitingDays >= sla.late) return 'late';
  if (waitingDays >= sla.due) return 'due';
  return 'ok';
}

/** What the rail and the age cell are saying, spelled out for the title attribute. */
export function slaReason(status: string | null | undefined, waitingDays: number | null): string {
  const sla = status ? STAGE_SLA[status] : undefined;
  if (!sla || waitingDays == null) return 'No clock on this stage.';
  const stage = STAGE_LABEL[status!] ?? status;
  const d = (n: number) => (n === 0 ? 'the same day' : n === 1 ? '1 day' : `${n} days`);
  const level = slaLevel(status, waitingDays);
  if (level === 'late') return `Late — ${stage} should move within ${d(sla.late)}, and this has waited ${waitingDays}.`;
  if (level === 'due')  return `Due — ${stage} should move within ${d(sla.due)}, and this has waited ${waitingDays}.`;
  return `On time — ${stage} is worked within ${d(sla.due)}.`;
}

export const STATE_TONE: Record<RequestState, 'success' | 'warn' | 'danger' | 'ink'> = {
  SERVICEABLE: 'success',
  PACKAGE_GAP: 'warn',
  SUPPLY_GAP_KNOWN: 'warn',
  SUPPLY_GAP_UNKNOWN: 'danger',
  NO_ITEMS: 'ink',
  NO_PINCODE: 'ink',
};

/** Written out so Tailwind's scanner finds them — interpolated names never build. */
export const TONE_CHIP: Record<'success' | 'warn' | 'danger' | 'ink', string> = {
  success: 'bg-success-50 text-success-600 border-success-100',
  warn: 'bg-warn-50 text-warn-600 border-warn-100',
  danger: 'bg-danger-50 text-danger-500 border-danger-100',
  ink: 'bg-ink-100 text-ink-600 border-ink-200',
};

export const BASIS_LABEL: Record<string, string> = {
  covering_lab: 'A covering lab’s own rate',
  network_median: 'Median across the network',
  partial: 'Incomplete — some items have no rate anywhere',
  none: 'No rate available',
};

/** How much to trust the number, stated rather than implied. */
export const BASIS_STRENGTH: Record<string, 'strong' | 'moderate' | 'none'> = {
  covering_lab: 'strong',
  network_median: 'moderate',
  partial: 'none',
  none: 'none',
};

export type RequestRow = {
  request_id: number;
  pincode: string | null;
  city: string | null;
  state_name: string | null;
  status: string;
  order_type: string | null;
  store_id: number | null;
  created_at: string;
  src_flag: boolean;
  is_converted: boolean;
  order_id: number | null;
  items_total: number;
  items_resolvable: number;
  items_unresolved: number;
  covering_labs: number;
  full_labs: number;
  best_lab_id: number | null;
  best_lab_cost: string | null;
  reference_cost: string | null;
  reference_n: number | null;
  nearest_km: string | null;
  state: RequestState;
  state_label: string | null;
  quote_price: string | null;
  promised_date: string | null;
  price_basis: string;
  markup_pct: string | null;
  reason: string;
  commitment_id: number | null;
  /** What was actually promised on the commitment, where there is one. */
  committed_date: string | null;
  // Carried on the row so the table needs no per-row lookup.
  packages: string[] | null;
  tests: string[] | null;
  item_names: string[] | null;
  unnamed: number | null;
  labs_ready: string[] | null;
  labs_covering: string[] | null;
  missing_items: string | null;
  store_name: string | null;
  disciplines: string[] | null;
  store_price: string | null;
  store_mrp: string | null;
  cost_min: string | null;
  cost_avg: string | null;
  cost_max: string | null;
  cost_labs: number | null;
  // The order a request became, where it became one. Joined on the row rather
  // than looked up per render: "did this convert, who is serving it, and when"
  // is one question, and three columns of it in three places is three answers.
  /** Creation and the appointment the store asked for, as IST dates. */
  created_date: string | null;
  requested_date: string | null;
  /** Days since anybody touched the request, and when that was. */
  waiting_days: number | null;
  last_touched_at: string | null;
  /** Who asked, and the number to ring. */
  requester_name: string | null;
  requester_mobile: string | null;
  order_appointment: string | null;
  order_lab_id: number | null;
  order_lab_name: string | null;
  order_status: string | null;
};

export type CommitmentRow = {
  commitment_id: number;
  request_id: number;
  order_id: number | null;
  state: RequestState;
  state_label: string | null;
  promised_date: string | null;
  quoted_price: string | null;
  price_basis: string | null;
  target_lab_id: number | null;
  target_lab_name: string | null;
  target_lab_city: string | null;
  days_left: number | null;
  breached: boolean;
  pincode: string | null;
  city: string | null;
  nearest_km: string | null;
  ask: string;
  web_leads: number;
  attributed_to_name: string | null;
};

/**
 * The block ops pastes into the console. Deliberately plain text: it is
 * retyped-by-clipboard into another system, and anything clever about the
 * formatting survives exactly as far as the first paste.
 */
export function quoteBlock(r: {
  request_id: number;
  quote_price: string | null;
  promised_date: string | null;
  committed_date?: string | null;
  created_date?: string | null;
  requested_date?: string | null;
  state: RequestState;
}): string {
  const price = r.quote_price ? `INR ${Math.round(Number(r.quote_price))}` : '-';
  // Three dates, because whoever reads this in the console is deciding whether
  // the answer is acceptable, and that is a comparison: how long they have
  // been waiting, the date they asked for, and the date we can do.
  return [
    `Request #${r.request_id}`,
    `Created: ${r.created_date ?? '-'}`,
    `Requested date: ${r.requested_date ?? '-'}`,
    `Earliest available date: ${r.committed_date ?? r.promised_date ?? '-'}`,
    `Quoted price: ${price}`,
  ].join('\n');
}

/**
 * What kind of centre a test needs. Inferred from the test name in
 * atlas.test_discipline, because LabStack has no field for it — its
 * LabDepartment list is nine pathology disciplines with no imaging among them,
 * while 1,907 catalogue entries are X-rays, ultrasounds, CT and MRI.
 */
export const DISCIPLINE_LABEL: Record<string, string> = {
  PATHOLOGY: 'pathology',
  RADIOLOGY: 'radiology / imaging',
  CARDIO_DIAGNOSTIC: 'cardiac & functional testing',
};

/**
 * What to go looking for, in words a search prompt can use.
 *
 * Defined in lib/labDiscovery.ts and re-exported here, where callers already
 * expect it. There were three copies of this map — one here, one in
 * lib/discoverLabs.ts and one in scripts/discover-labs.ts — and they had
 * started to differ.
 */
export { DISCIPLINE_SEARCH } from './labDiscovery';

/**
 * The console's own stage for a request — where it sits in LabStack's workflow,
 * as opposed to `state`, which is Atlas's verdict on whether we can serve it.
 *
 * The two answer different questions and a row needs both: a request can be
 * QUOTED in the console and still a supply gap in Atlas, which is exactly the
 * situation the network bucket exists for.
 *
 * Ordered as the workflow runs, so the filter row reads as a funnel rather than
 * an alphabetical list. Losses sit at the end.
 */
export const STAGE_ORDER = [
  'OPEN', 'CONSENTED', 'QUOTED', 'QUOTATION_ACCEPTED', 'ORDERED', 'DISCHARGED',
  'UNREACHABLE', 'WRONG_NUMBER', 'DENIED', 'CANCELLED', 'NON_SERVICEABLE',
] as const;

/**
 * The stages a request moves through while somebody is still working it.
 *
 * This is the page's whole job — open, quote it, get the price accepted, see
 * it become an order — so these four are listed in that order and apart from
 * the rest. A flat row that mixed them with Unreachable and Cancelled made a
 * pipeline look like a set of unrelated labels.
 */
export const PIPELINE_STAGES = ['OPEN', 'CONSENTED', 'QUOTED', 'QUOTATION_ACCEPTED', 'ORDERED'] as const;

/** Stages where nobody is working the request any more. */
export const CLOSED_STAGES = [
  'DISCHARGED', 'UNREACHABLE', 'WRONG_NUMBER', 'DENIED', 'CANCELLED', 'NON_SERVICEABLE',
] as const;

export const STAGE_LABEL: Record<string, string> = {
  OPEN: 'Open',
  CONSENTED: 'Consented',
  QUOTED: 'Quoted',
  QUOTATION_ACCEPTED: 'Quote accepted',
  ORDERED: 'Ordered',
  DISCHARGED: 'Discharged',
  UNREACHABLE: 'Unreachable',
  WRONG_NUMBER: 'Wrong number',
  DENIED: 'Denied',
  CANCELLED: 'Cancelled',
  NON_SERVICEABLE: 'Not serviceable',
};

export const STAGE_TONE: Record<string, 'success' | 'warn' | 'danger' | 'ink'> = {
  OPEN: 'warn',
  CONSENTED: 'warn',
  QUOTED: 'warn',
  QUOTATION_ACCEPTED: 'success',
  ORDERED: 'success',
  DISCHARGED: 'success',
  // Everything below is a request that ended without an order.
  UNREACHABLE: 'danger',
  WRONG_NUMBER: 'ink',
  DENIED: 'danger',
  CANCELLED: 'danger',
  NON_SERVICEABLE: 'danger',
};

/**
 * Stages that mean nobody is waiting on us. Mirrors the SETTLED list in
 * requestQueries — selecting one of these has to switch settled requests back
 * on, or the filter returns nothing and looks broken.
 */
export const SETTLED_STAGES = new Set([
  'ORDERED', 'DISCHARGED', 'CANCELLED', 'DENIED', 'WRONG_NUMBER',
]);

// Nullable on purpose: the console's status column has no NOT NULL, and a
// single request without one used to take the whole queue down with
// "cannot read properties of null" — a page of two hundred rows lost to one
// blank field.
export const stageLabel = (s: string | null | undefined) =>
  s ? (STAGE_LABEL[s] ?? s.toLowerCase().replace(/_/g, ' ')) : '—';
