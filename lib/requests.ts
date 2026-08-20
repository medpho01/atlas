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
  SUPPLY_GAP_KNOWN: 'Supply gap — candidate',
  SUPPLY_GAP_UNKNOWN: 'Supply gap — none',
  NO_ITEMS: 'Nothing identifiable',
  NO_PINCODE: 'No pincode',
};

export const STATE_SHORT: Record<RequestState, string> = {
  SERVICEABLE: 'Serviceable',
  PACKAGE_GAP: 'Package gap',
  SUPPLY_GAP_KNOWN: 'Supply gap',
  SUPPLY_GAP_UNKNOWN: 'No supply',
  NO_ITEMS: 'Unknown ask',
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
  nearest_km: string | null;
  state: RequestState;
  state_label: string | null;
  quote_price: string | null;
  promised_date: string | null;
  price_basis: string;
  markup_pct: string | null;
  reason: string;
  commitment_id: number | null;
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
  state: RequestState;
}): string {
  const price = r.quote_price ? `INR ${Math.round(Number(r.quote_price))}` : '—';
  const date = r.promised_date ?? '—';
  return `Request #${r.request_id}\nQuoted price: ${price}\nEarliest date: ${date}`;
}
