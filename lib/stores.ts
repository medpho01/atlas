/**
 * The vocabulary of a store's order book — no database, no server.
 *
 * Split out from lib/storeOrders.ts for the same reason lib/requests.ts is
 * split from lib/requestQueries.ts: the table, the bulk bar and the filter
 * chips all run on the client and all need to agree with the server about
 * what a stage is called and what colour it is. A 'server-only' module cannot
 * be imported into any of them, and a second copy of the mapping would drift
 * within a week.
 */

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/**
 * The six stages, in the order an order passes through them.
 *
 * Display only. The stage on every row is computed by atlas.order_stage() in
 * the database and read from the view, so the screen, the API and the CSV
 * cannot disagree about what SAMPLE_DELIVERED counts as. STAGE_STATUSES is
 * the same mapping written backwards, for the tooltip that says which raw
 * statuses a stage covers; scripts/check-stage-map.sql asserts the two agree.
 */
export const STAGES = [
  'pending', 'scheduled', 'rescheduled', 'in_progress', 'completed', 'cancelled',
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  rescheduled: 'Rescheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** What each stage means, in the words the screen uses. */
export const STAGE_BLURB: Record<Stage, string> = {
  pending: 'Taken, with no appointment on it yet.',
  scheduled: 'Has a date. A phlebo may or may not be assigned.',
  rescheduled: 'Moved off its original date and waiting on a new one.',
  in_progress: 'Sample collected, somewhere between the patient and a result.',
  completed: 'Report delivered.',
  cancelled: 'Closed without a report — cancelled, or the patient was missed.',
};

export type Tone = 'ink' | 'brand' | 'warn' | 'good' | 'bad';

/**
 * Colour per stage.
 *
 * Red is spent on cancelled and nothing else. An order in progress is not a
 * problem, and a table that colours two thirds of its rows like one is a
 * table nobody can scan — which is the whole reason for colouring it.
 */
export const STAGE_TONE: Record<Stage, Tone> = {
  pending: 'ink',
  scheduled: 'brand',
  rescheduled: 'warn',
  in_progress: 'brand',
  completed: 'good',
  cancelled: 'bad',
};

/** The raw "OrderStatus" values behind each stage — mirrors atlas.order_stage(). */
export const STAGE_STATUSES: Record<Stage, string[]> = {
  pending: ['PENDING', 'CREATED'],
  scheduled: ['ORDER_SCHEDULED', 'PHLEBO_ASSIGNED', 'KIT_DISPATCHED'],
  rescheduled: ['RESCHEDULED'],
  in_progress: ['SAMPLE_COLLECTED', 'SAMPLE_DELIVERED', 'SAMPLE_PROCESSED', 'PATIENT_VISITED'],
  completed: ['REPORT_DELIVERED'],
  cancelled: ['CANCELED', 'PATIENT_MISSED'],
};

export function isStage(v: string | null | undefined): v is Stage {
  return !!v && (STAGES as readonly string[]).includes(v);
}

/** A raw status made readable, without losing which one it was. */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
}

/** Tailwind classes for a stage chip. Literal strings — Tailwind scans source. */
export const TONE_CHIP: Record<Tone, string> = {
  ink: 'bg-ink-100 text-ink-700 border-ink-200',
  brand: 'bg-brand-50 text-brand-700 border-brand-100',
  warn: 'bg-warn-50 text-warn-700 border-warn-100',
  good: 'bg-success-50 text-success-700 border-success-100',
  bad: 'bg-danger-50 text-danger-600 border-danger-100',
};

/** A solid block of the same colour, for the stacked bar on the store row. */
export const TONE_BAR: Record<Tone, string> = {
  ink: 'bg-ink-300',
  brand: 'bg-brand-500',
  warn: 'bg-warn-500',
  good: 'bg-success-500',
  bad: 'bg-danger-500',
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Hours as something a person reads at a glance.
 *
 * Turnaround runs from a few hours to a few days and a single unit is wrong at
 * one end or the other: "0.8 days" and "61 hours" are both worse than "19h"
 * and "4.2d".
 *
 * The switch is at 72 and not 48. Most turnarounds land between one and three
 * days, so a 48-hour boundary put the commonest values either side of it: the
 * fleet average rendered "48h" and a store one hour slower rendered "2.0d", and
 * comparing the two meant doing the conversion in your head. Three days moves
 * the seam out to where the numbers are sparse.
 */
export function humanHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return '—';
  const v = Math.abs(h);
  if (v < 1) return `${Math.round(v * 60)}m`;
  if (v < 72) return `${v < 10 ? v.toFixed(1) : Math.round(v)}h`;
  const d = v / 24;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)}d`;
}

/** A rate as a whole percent. Null stays a dash, because 0% is a real answer. */
export function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Math.round(v * 100)}%`;
}

/** 14 Mar 2026. The format every other Atlas screen uses. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') || iso.includes(' ') ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** 14 Mar, 09:30 — for an appointment, where the time is half the point. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : (iso ?? '').replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, `
    + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * How late something is, in words.
 *
 * Negative hours mean the appointment has not happened yet, which is not
 * lateness and must not render as "-19h late".
 */
export function lateness(hours: number | null | undefined): string | null {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return null;
  return `${humanHours(hours)} ago`;
}
