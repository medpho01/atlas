/**
 * The account lifecycle's shapes and labels — no database, so a client
 * component can import them.
 *
 * lib/lifecycle.ts is server-only (it holds the queries) and a 'use client'
 * file that imports it fails the build. Same split as lib/pipelineKinds.
 */

export const STAGES = ['sales', 'onboarding', 'managed', 'churned', 'lost'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  sales: 'Sales',
  onboarding: 'Onboarding',
  managed: 'Managed',
  churned: 'Churned',
  lost: 'Lost',
};

export const CADENCES = ['none', 'weekly', 'fortnightly', 'monthly', 'quarterly'] as const;
export type Cadence = (typeof CADENCES)[number];

export const CADENCE_LABEL: Record<Cadence, string> = {
  none: 'No cadence',
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly review',
  quarterly: 'Quarterly review',
};

/** How long each cadence waits, in days. The view applies the same numbers. */
export const CADENCE_DAYS: Record<Cadence, number | null> = {
  none: null, weekly: 7, fortnightly: 14, monthly: 30, quarterly: 91,
};

export type Account = {
  account_id: number;
  name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  lifecycle: Stage;
  account_type: string | null;
  account_type_label: string | null;
  owner_id: number | null;
  owner: string | null;
  store_id: number | null;
  premium_book_cr: string | null;
  opd_book_cr: string | null;
  avg_ticket_inr: string | null;
  review_cadence: Cadence;
  mou_signed_on: string | null;
  go_live_on: string | null;
  live_since: string | null;
  created_at: string;

  meetings_done: number;
  first_met_on: string | null;
  last_met_on: string | null;
  next_meeting_on: string | null;
  last_review_on: string | null;
  next_review_on: string | null;

  open_tasks: number;
  late_tasks: number;
  plan_steps: number;
  plan_done: number;

  services_contracted: number;
  services_live: number;

  this_month: number;
  last_month: number;
  worst_line_status: string | null;

  share_pct: string | null;
  services_expected: string | null;
  services_twelve_months: string;
};

export type AccountFilters = {
  stage?: Stage;
  owner?: number;
  unassigned?: boolean;
  type?: string;
  q?: string;
  /** Only accounts whose next review has passed. */
  reviewDue?: boolean;
};


export type Contact = {
  id: number; name: string; role: string | null;
  phone: string | null; email: string | null;
  is_decision_maker: boolean; note: string | null;
};


export type Meeting = {
  id: number; kind: 'meeting' | 'call' | 'mbr' | 'qbr';
  happened_on: string | null; scheduled_on: string | null;
  title: string | null; attendees: string | null; notes: string | null;
  next_step: string | null; next_step_due: string | null;
  next_step_owner: string | null;
  author: string | null;
  /** True when the next step has a date that has passed and no task closed it. */
  next_step_late: boolean | null;
};

export const MEETING_KIND_LABEL: Record<string, string> = {
  meeting: 'Meeting', call: 'Call', mbr: 'Monthly review', qbr: 'Quarterly review',
};


export type Service = {
  stream: string; status: 'discussed' | 'contracted' | 'live' | 'paused';
  contracted_on: string | null; note: string | null;
  /** Orders in the last complete month, where the account is a store. */
  last_month: number | null;
  ever: number | null;
};

export const SERVICE_STATUS_LABEL: Record<string, string> = {
  discussed: 'Discussed', contracted: 'Contracted', live: 'Live', paused: 'Paused',
};


export type Task = {
  id: number; title: string; detail: string | null;
  due_on: string | null; planned_start: string | null;
  department: string | null; department_label: string | null;
  assignee_id: number | null; assignee: string | null;
  phase: 'onboarding' | 'managed';
  repeat_every: 'none' | 'monthly' | 'quarterly';
  done_at: string | null; late: boolean | null;
  account_id: number; account_name: string;
};

/** The business lines, in the order they read in everywhere. */
export const LINES = ['LAB_ORDER', 'APPOINTMENT', 'PHARMA_ORDER'] as const;

export const LINE_LABEL: Record<string, string> = {
  LAB_ORDER: 'Diagnostics',
  APPOINTMENT: 'Consultations',
  PHARMA_ORDER: 'Pharmacy',
};
