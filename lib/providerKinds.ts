/**
 * The provider types, in one place.
 *
 * There were three of these lists — the thread form, the add dialog and the
 * detail drawer — and all three held different values, so a type added to one
 * was missing from the others depending on which screen you were on. The
 * column is free text, so nothing enforced agreement.
 */
export const PROVIDER_KINDS = [
  'LAB',
  'DIAGNOSTICS',
  'HOSPITAL',
  'CLINIC',
  'COLLECTION_CENTRE',
  'PHARMACY',
  'DOCTOR',
  'PHLEBO',
  'OTHER',
] as const;
