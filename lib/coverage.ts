// ============================================================================
// Coverage model — provider kinds × modalities
// ============================================================================

export const PROVIDER_KINDS = [
  'LAB',
  'HOSPITAL',
  'DOCTOR',
  'PHLEBO',
  'NURSE',
  'PHARMACY',
] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const MODALITIES = ['CENTER_VISIT', 'HOME_SAMPLE', 'HOME_VISIT', 'DELIVERY'] as const;
export type Modality = (typeof MODALITIES)[number];

// Which (kind, modality) combinations are valid (i.e., shown in matrix UI)
export const CAPABILITY_MATRIX: Record<ProviderKind, Modality[]> = {
  LAB: ['CENTER_VISIT', 'HOME_SAMPLE'],
  HOSPITAL: ['CENTER_VISIT', 'HOME_SAMPLE'],
  DOCTOR: ['CENTER_VISIT', 'HOME_VISIT'],
  PHLEBO: ['HOME_SAMPLE'],
  NURSE: ['HOME_VISIT'],
  PHARMACY: ['CENTER_VISIT', 'DELIVERY'],
};

export const KIND_LABEL: Record<ProviderKind, string> = {
  LAB: 'Lab',
  HOSPITAL: 'Hospital',
  DOCTOR: 'Doctor',
  PHLEBO: 'Phlebo',
  NURSE: 'Nurse',
  PHARMACY: 'Pharmacy',
};

export const KIND_SHORT: Record<ProviderKind, string> = {
  LAB: 'Lab',
  HOSPITAL: 'Hospital',
  DOCTOR: 'Doctor',
  PHLEBO: 'Phlebo',
  NURSE: 'Nurse',
  PHARMACY: 'Pharmacy',
};

export const MODALITY_LABEL: Record<Modality, string> = {
  CENTER_VISIT: 'Center Visit',
  HOME_SAMPLE: 'Home Sample',
  HOME_VISIT: 'Home Visit',
  DELIVERY: 'Delivery',
};

export const MODALITY_SHORT: Record<Modality, string> = {
  CENTER_VISIT: 'Center',
  HOME_SAMPLE: 'Home Sample',
  HOME_VISIT: 'Home Visit',
  DELIVERY: 'Delivery',
};

/**
 * Lens options support either:
 *   - kind: a single ProviderKind ("LAB") for granular slices
 *   - kinds: ProviderKind[] for combined slices ("All Labs" = Diag + Coll + Hospital)
 * Both are represented in the same flat array; consumers use the helper-returned
 * `kinds` array which is always non-empty when modality is constrained.
 */
export type LensOption = {
  key: string;
  kinds: ProviderKind[] | 'ANY';
  modality: Modality | 'ANY';
  label: string;
};

const ALL_LAB_KINDS: ProviderKind[] = ['LAB', 'HOSPITAL'];

export const LENS_OPTIONS: LensOption[] = [
  { key: 'ANY', kinds: 'ANY', modality: 'ANY', label: 'Any provider · any modality' },
  // Combined "All Labs" lenses (Diag + Coll + Hospital de-duped)
  { key: 'LAB_ALL|CENTER_VISIT', kinds: ALL_LAB_KINDS, modality: 'CENTER_VISIT', label: 'All Labs — Center Visit' },
  { key: 'LAB_ALL|HOME_SAMPLE', kinds: ALL_LAB_KINDS, modality: 'HOME_SAMPLE', label: 'All Labs — Home Sample' },
  // Granular per-kind options
  ...PROVIDER_KINDS.flatMap((kind) =>
    CAPABILITY_MATRIX[kind].map((modality) => ({
      key: `${kind}|${modality}`,
      kinds: [kind],
      modality,
      label: `${KIND_SHORT[kind]} — ${MODALITY_LABEL[modality]}`,
    } as LensOption))
  ),
];

export function parseLens(key?: string): { kinds: ProviderKind[] | 'ANY'; modality: Modality | 'ANY' } {
  if (!key || key === 'ANY') return { kinds: 'ANY', modality: 'ANY' };
  const opt = LENS_OPTIONS.find((o) => o.key === key);
  return opt ? { kinds: opt.kinds, modality: opt.modality } : { kinds: 'ANY', modality: 'ANY' };
}

/**
 * Map a (kinds, modality) lens to the set of unified-demand service_line values
 * that correspond to it. Used to filter the Orders leaderboard by lens so
 * "All Labs — Center Visit" only shows LAB_CENTER_VISIT orders.
 *
 * Returns `null` when the lens is fully ANY (caller should not filter).
 */
export function lensToServiceLines(
  kinds: ProviderKind[] | 'ANY',
  modality: Modality | 'ANY'
): string[] | null {
  if (kinds === 'ANY' && modality === 'ANY') return null;
  const kindSet = new Set<ProviderKind>(kinds === 'ANY' ? PROVIDER_KINDS : kinds);
  const isLab = (k: ProviderKind) => k === 'LAB' || k === 'HOSPITAL';
  const hasLab = Array.from(kindSet).some(isLab);
  const out = new Set<string>();

  const wantsCenterVisit = modality === 'ANY' || modality === 'CENTER_VISIT';
  const wantsHomeSample = modality === 'ANY' || modality === 'HOME_SAMPLE';
  const wantsHomeVisit = modality === 'ANY' || modality === 'HOME_VISIT';
  const wantsDelivery = modality === 'ANY' || modality === 'DELIVERY';

  if (hasLab) {
    if (wantsCenterVisit) out.add('LAB_CENTER_VISIT');
    if (wantsHomeSample) {
      out.add('LAB_HOME_SAMPLE');
      out.add('CAMP_ORDER'); // camp orders run through labs
    }
  }
  if (kindSet.has('PHLEBO') && wantsHomeSample) out.add('LAB_HOME_SAMPLE');
  if (kindSet.has('DOCTOR')) {
    if (wantsCenterVisit) out.add('DOCTOR_CONSULT_CENTER');
    if (wantsHomeVisit) out.add('DOCTOR_CONSULT_HOME');
    if (modality === 'ANY') out.add('DOCTOR_CONSULT_ONLINE');
  }
  if (kindSet.has('NURSE') && wantsHomeVisit) out.add('NURSING_HOME_VISIT');
  if (kindSet.has('PHARMACY') && wantsDelivery) out.add('PHARMACY_DELIVERY');

  return Array.from(out);
}
