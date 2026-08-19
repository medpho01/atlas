/**
 * The six-category rollup.
 *
 * Atlas already models supply two ways: provider kind (LAB, DOCTOR, …) and
 * service line (LAB_HOME_SAMPLE, …). Neither is how the network is described
 * to someone outside operations — they ask what we have for diagnostics, for
 * consults, for wellness. Category is that third axis, derived from the two
 * that already exist rather than stored, so nothing has to be re-tagged.
 *
 * Derived, not stored, is the important property: a provider's category is a
 * function of its kind and modality, so re-categorising later reinterprets
 * history (including atlas.network_snapshot) instead of invalidating it.
 */

import type { ProviderKind, Modality } from './coverage';

export const CATEGORIES = [
  'DIAGNOSTICS',
  'CONSULTS',
  'HOME_CARE',
  'WELLNESS_ONLINE',
  'WELLNESS_OFFLINE',
  'PHARMACY',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  DIAGNOSTICS: 'Diagnostics',
  CONSULTS: 'Consults',
  HOME_CARE: 'Home care',
  WELLNESS_ONLINE: 'Wellness — online',
  WELLNESS_OFFLINE: 'Wellness — offline',
  PHARMACY: 'Pharmacy',
};

export const CATEGORY_BLURB: Record<Category, string> = {
  DIAGNOSTICS: 'Labs and hospital labs — sample collection and testing.',
  CONSULTS: 'Doctors, in clinic or by video.',
  HOME_CARE: 'Nursing, injections and attendant care at home.',
  WELLNESS_ONLINE: 'Instructors and programmes delivered remotely.',
  WELLNESS_OFFLINE: 'Gyms, studios and physiotherapy centres.',
  PHARMACY: 'Medicine supply and delivery.',
};

/**
 * A (kind, modality) pair resolves to exactly one category.
 *
 * Two kinds are genuinely ambiguous without the modality, which is why this is
 * keyed on the pair rather than on kind alone: a DOCTOR is a consult in clinic
 * and still a consult on video, but an INSTRUCTOR is wellness-online while a
 * PHYSIO doing the same exercises in a centre is wellness-offline.
 */
const BY_KIND: Record<ProviderKind, Category> = {
  LAB: 'DIAGNOSTICS',
  HOSPITAL: 'DIAGNOSTICS',
  DOCTOR: 'CONSULTS',
  PHLEBO: 'DIAGNOSTICS',
  NURSE: 'HOME_CARE',
  PHARMACY: 'PHARMACY',
  GYM: 'WELLNESS_OFFLINE',
  STUDIO: 'WELLNESS_OFFLINE',
  PHYSIO: 'WELLNESS_OFFLINE',
  INSTRUCTOR: 'WELLNESS_ONLINE',
};

export function categoryOf(kind: ProviderKind, modality?: Modality | null): Category {
  // A physio consulting by video is wellness-online, not offline — modality
  // wins where the kind can be delivered either way.
  if (modality === 'VIRTUAL') {
    if (kind === 'PHYSIO' || kind === 'INSTRUCTOR') return 'WELLNESS_ONLINE';
    if (kind === 'DOCTOR') return 'CONSULTS';
  }
  return BY_KIND[kind];
}

/** Kinds that roll up into a category — for filters and SQL IN lists. */
export const CATEGORY_TO_KINDS: Record<Category, ProviderKind[]> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c] = (Object.keys(BY_KIND) as ProviderKind[]).filter((k) => BY_KIND[k] === c);
    return acc;
  },
  {} as Record<Category, ProviderKind[]>,
);

/**
 * How mature each category is, shown as a badge rather than implied by a count.
 * Config, not derived: "Early" is a commercial statement about where the
 * business has chosen to invest, which no query can infer from supply alone.
 */
export const CATEGORY_STAGE: Record<Category, 'Scaled' | 'Building' | 'Early'> = {
  DIAGNOSTICS: 'Scaled',
  CONSULTS: 'Building',
  HOME_CARE: 'Building',
  PHARMACY: 'Early',
  WELLNESS_OFFLINE: 'Early',
  WELLNESS_ONLINE: 'Early',
};
