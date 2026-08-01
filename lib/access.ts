/**
 * Role-based access to restricted areas of Atlas.
 *
 * Deliberately dependency-free (no DB, no cookies) so both server components and
 * the client-side Nav can import it — the nav hides what a role can't reach, and
 * the page/route enforces the same rule server-side. Keep those two in sync by
 * driving both from AREA_ROLES rather than hardcoding roles at either call site.
 */

export type Role = 'admin' | 'operations' | 'network' | 'editor' | 'viewer';

/** Areas that are not open to every signed-in user. */
export type Area = 'accounts' | 'crm' | 'pricing';

/**
 * Allow-list per area. New roles are denied by default, which is the safe
 * direction — an unlisted role sees the "not available" page rather than data.
 */
export const AREA_ROLES: Record<Area, Role[]> = {
  // B2B account health — everyone except operations.
  accounts: ['admin', 'network', 'editor', 'viewer'],
  // Network-team tools — admin and network only.
  crm: ['admin', 'network'],
  pricing: ['admin', 'network'],
};

export function canAccess(user: { role: Role } | null | undefined, area: Area): boolean {
  return !!user && AREA_ROLES[area].includes(user.role);
}
