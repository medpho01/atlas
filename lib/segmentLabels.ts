/**
 * Segment names, in a module with no server-only import.
 *
 * lib/readiness.ts is pulled into the client bundle by ReadinessTable, so it
 * cannot import lib/readinessSegments.ts (which opens a database connection).
 * The labels live here so both sides read the same list rather than keeping
 * two copies that drift.
 */
export const SEGMENTS = [
  'ALL',
  'LAB_HOME_SAMPLE',
  'LAB_CENTER_RADIOLOGY',
  'LAB_CENTER_HOSPITAL',
  'DOCTOR_CENTER',
  'HOME_CARE',
  'PHARMACY',
  'WELLNESS_OFFLINE',
  'WELLNESS_ONLINE',
] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABEL: Record<Segment, string> = {
  ALL:                  'All segments',
  LAB_HOME_SAMPLE:      'Home sample',
  LAB_CENTER_RADIOLOGY: 'Centre visit · Radiology',
  LAB_CENTER_HOSPITAL:  'Centre visit · Hospitals',
  DOCTOR_CENTER:        'Centre visit · Consults',
  HOME_CARE:            'Home care',
  PHARMACY:             'Pharmacy',
  WELLNESS_OFFLINE:     'Wellness — offline',
  WELLNESS_ONLINE:      'Wellness — online',
};

/** What this segment's supply is called in a sentence. */
export const SEGMENT_SUPPLY_NOUN: Record<Segment, string> = {
  ALL:                  'provider',
  LAB_HOME_SAMPLE:      'home-sample',
  LAB_CENTER_RADIOLOGY: 'diagnostic-centre',
  LAB_CENTER_HOSPITAL:  'hospital',
  DOCTOR_CENTER:        'in-clinic consult',
  HOME_CARE:            'home-care',
  PHARMACY:             'pharmacy',
  WELLNESS_OFFLINE:     'wellness',
  WELLNESS_ONLINE:      'online wellness',
};

/** The four the network is actually built on; the rest are a second row. */
export const PRIMARY_SEGMENTS: Segment[] = [
  'ALL', 'LAB_HOME_SAMPLE', 'LAB_CENTER_RADIOLOGY', 'LAB_CENTER_HOSPITAL', 'DOCTOR_CENTER',
];
