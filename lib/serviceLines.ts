// Service-line taxonomy used by the momentum dashboard, demand-supply watchlist,
// and the forecast layer. Order here drives display order in the UI.

export const SERVICE_LINES = [
  'LAB_HOME_SAMPLE',
  'LAB_CENTER_VISIT',
  'DOCTOR_CONSULT_CENTER',
  'DOCTOR_CONSULT_HOME',
  'DOCTOR_CONSULT_ONLINE',
  'NURSING_HOME_VISIT',
  'PHARMACY_DELIVERY',
  'CAMP_ORDER',
  'OTHER_APPOINTMENT',
] as const;
export type ServiceLine = (typeof SERVICE_LINES)[number];

export const SERVICE_LINE_LABEL: Record<ServiceLine, string> = {
  LAB_HOME_SAMPLE: 'Lab — Home Sample',
  LAB_CENTER_VISIT: 'Lab — Walk-in',
  DOCTOR_CONSULT_CENTER: 'Doctor — In-clinic',
  DOCTOR_CONSULT_HOME: 'Doctor — Home Visit',
  DOCTOR_CONSULT_ONLINE: 'Doctor — Teleconsult',
  NURSING_HOME_VISIT: 'Nursing / Injection',
  PHARMACY_DELIVERY: 'Pharmacy — Delivery',
  CAMP_ORDER: 'Camp Order',
  OTHER_APPOINTMENT: 'Other Appointments',
};

export const SERVICE_LINE_SHORT: Record<ServiceLine, string> = {
  LAB_HOME_SAMPLE: 'Lab Home',
  LAB_CENTER_VISIT: 'Lab Walk-in',
  DOCTOR_CONSULT_CENTER: 'Doctor Clinic',
  DOCTOR_CONSULT_HOME: 'Doctor Home',
  DOCTOR_CONSULT_ONLINE: 'Teleconsult',
  NURSING_HOME_VISIT: 'Nursing/Inj',
  PHARMACY_DELIVERY: 'Pharma',
  CAMP_ORDER: 'Camp',
  OTHER_APPOINTMENT: 'Other',
};

// Map service line → which provider kinds are needed to fulfil it.
// Drives the demand-supply imbalance calculation.
export const SERVICE_LINE_TO_KINDS: Record<ServiceLine, string[]> = {
  LAB_HOME_SAMPLE: ['LAB', 'HOSPITAL', 'PHLEBO'],
  LAB_CENTER_VISIT: ['LAB', 'HOSPITAL'],
  DOCTOR_CONSULT_CENTER: ['DOCTOR', 'HOSPITAL'],
  DOCTOR_CONSULT_HOME: ['DOCTOR'],
  DOCTOR_CONSULT_ONLINE: ['DOCTOR'], // location-agnostic — included for completeness
  NURSING_HOME_VISIT: ['NURSE', 'DOCTOR'],
  PHARMACY_DELIVERY: ['PHARMACY'],
  CAMP_ORDER: ['LAB', 'PHLEBO'],
  OTHER_APPOINTMENT: [],
};

export const SERVICE_LINE_TONE: Record<ServiceLine, 'lab' | 'doctor' | 'nurse' | 'pharmacy' | 'camp' | 'other'> = {
  LAB_HOME_SAMPLE: 'lab',
  LAB_CENTER_VISIT: 'lab',
  DOCTOR_CONSULT_CENTER: 'doctor',
  DOCTOR_CONSULT_HOME: 'doctor',
  DOCTOR_CONSULT_ONLINE: 'doctor',
  NURSING_HOME_VISIT: 'nurse',
  PHARMACY_DELIVERY: 'pharmacy',
  CAMP_ORDER: 'camp',
  OTHER_APPOINTMENT: 'other',
};

export const TONE_COLORS = {
  lab: { dot: 'bg-brand-500', text: 'text-brand-500', bg: 'bg-brand-50', border: 'border-brand-100' },
  doctor: { dot: 'bg-success-500', text: 'text-success-700', bg: 'bg-success-50', border: 'border-success-100' },
  nurse: { dot: 'bg-warn-500', text: 'text-warn-600', bg: 'bg-warn-50', border: 'border-warn-100' },
  pharmacy: { dot: 'bg-danger-500', text: 'text-danger-500', bg: 'bg-danger-50', border: 'border-danger-100' },
  camp: { dot: 'bg-brand-400', text: 'text-brand-400', bg: 'bg-brand-50/40', border: 'border-brand-100' },
  other: { dot: 'bg-ink-400', text: 'text-ink-500', bg: 'bg-ink-100', border: 'border-ink-200' },
} as const;
