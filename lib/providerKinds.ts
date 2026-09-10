/**
 * The provider types, in one place.
 *
 * There were three of these lists — the thread form, the add dialog and the
 * detail drawer — and all three held different values, so a type added to one
 * was missing from the others depending on which screen you were on. The
 * column is free text, so nothing enforced agreement.
 *
 * Stored as keys and shown as labels. The keys are what a decade of rows,
 * imports and SQL functions already contain, so they are left alone even where
 * the label has moved on — `LAB` reads as "Pathology lab" rather than being
 * rewritten across every table that references it.
 */
export const PROVIDER_KINDS = [
  'LAB',
  'RADIOLOGY',
  'COLLECTION_CENTRE',
  'CLINIC',
  'HOSPITAL',
  'PHARMACY',
  'DOCTOR',
  'PHLEBO',
  'NURSE',
  'DENTAL',
  'VISION',
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/**
 * What each key is called on screen.
 *
 * Legacy keys are listed too. They are not offered in the pickers, but cards
 * created before this list settled still carry them, and a card that shows a
 * blank type — or a raw DIAGNOSTICS — is worse than one that says what it is.
 */
export const PROVIDER_KIND_LABEL: Record<string, string> = {
  LAB: 'Pathology lab',
  RADIOLOGY: 'Radiology centre',
  COLLECTION_CENTRE: 'Collection centre',
  CLINIC: 'Clinic',
  HOSPITAL: 'Hospital',
  PHARMACY: 'Pharmacy',
  DOCTOR: 'Doctor',
  PHLEBO: 'Phlebo',
  NURSE: 'Nurse',
  DENTAL: 'Dental network',
  VISION: 'Vision',
  DIAGNOSTICS: 'Radiology centre',
  OTHER: 'Other',
};

/** A key's label, falling back to the stored text so nothing renders empty. */
export function providerKindLabel(kind: string | null | undefined): string {
  if (!kind) return '—';
  return PROVIDER_KIND_LABEL[kind] ?? kind;
}

/**
 * The options a picker should show for a provider that currently holds `kind`.
 *
 * A retired value stays selectable while it is the card's own value: dropping
 * it would silently reassign the type of every legacy card the moment someone
 * opened it to edit a phone number.
 */
export function providerKindOptions(
  current?: string | null,
): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] =
    PROVIDER_KINDS.map((k) => ({ value: k, label: PROVIDER_KIND_LABEL[k] }));
  if (current && !PROVIDER_KINDS.includes(current as ProviderKind)) {
    // Marked, because a retired value can share a label with a live one —
    // DIAGNOSTICS reads as "Radiology centre" — and two identical-looking
    // options with different keys is the worst of both.
    opts.push({ value: current, label: `${providerKindLabel(current)} (old value)` });
  }
  return opts;
}

/**
 * Best-effort key for text typed by a person — a spreadsheet column, mostly.
 *
 * Imports carry "Pathology Lab", "radiology", "Collection Center" and every
 * other spelling of the same thing; storing them verbatim is how the list
 * fragmented in the first place. Anything unrecognised is returned trimmed and
 * upper-cased rather than dropped, so a type nobody anticipated still lands
 * somewhere visible.
 */
export function normalizeProviderKind(text: string | null | undefined): string {
  const t = (text ?? '').trim();
  if (!t) return '';
  const key = t.toUpperCase().replace(/[\s\-_.]+/g, '_');
  if (PROVIDER_KINDS.includes(key as ProviderKind)) return key;

  const synonyms: Record<string, string> = {
    PATHOLOGY_LAB: 'LAB', PATH_LAB: 'LAB', PATHOLOGY: 'LAB', LABORATORY: 'LAB',
    DIAGNOSTIC_LAB: 'LAB', DIAGNOSTICS: 'RADIOLOGY', DIAGNOSTIC_CENTRE: 'RADIOLOGY',
    DIAGNOSTIC_CENTER: 'RADIOLOGY', RADIOLOGY_CENTRE: 'RADIOLOGY',
    RADIOLOGY_CENTER: 'RADIOLOGY', IMAGING: 'RADIOLOGY', IMAGING_CENTRE: 'RADIOLOGY',
    IMAGING_CENTER: 'RADIOLOGY', SCAN_CENTRE: 'RADIOLOGY', SCAN_CENTER: 'RADIOLOGY',
    COLLECTION_CENTER: 'COLLECTION_CENTRE', CC: 'COLLECTION_CENTRE',
    COLLECTION_POINT: 'COLLECTION_CENTRE', PUC: 'COLLECTION_CENTRE',
    POLYCLINIC: 'CLINIC', NURSING_HOME: 'HOSPITAL', CHEMIST: 'PHARMACY',
    MEDICAL_STORE: 'PHARMACY', PHYSICIAN: 'DOCTOR', CONSULTANT: 'DOCTOR',
    PHLEBOTOMIST: 'PHLEBO', PHLEBOTOMY: 'PHLEBO', NURSING: 'NURSE',
    DENTAL_NETWORK: 'DENTAL', DENTIST: 'DENTAL', DENTAL_CLINIC: 'DENTAL',
    VISION_NETWORK: 'VISION', OPTICAL: 'VISION', OPTOMETRY: 'VISION',
    EYE: 'VISION', EYE_CARE: 'VISION', OPHTHALMOLOGY: 'VISION',
  };
  return synonyms[key] ?? key;
}
