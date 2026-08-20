import type { Feature, Role } from './access';
import { canView } from './access';

/**
 * The single navigation definition. The sidebar renders from it and the top
 * bar derives its breadcrumb from it, so a route can never appear in one and
 * not the other.
 *
 * Grouped by object — places, providers, commercial motion, admin — rather
 * than by team. Team names need a "but also usable by…" exception the moment
 * two teams share a page; object names don't.
 */

export type NavItem = {
  href: string;
  label: string;
  feature: Feature;
  /** Extra paths that should light this item up, e.g. /pincode/560103 → Pincodes. */
  alsoActiveOn?: string[];
};

export type NavGroup = {
  /** Null for the ungrouped item at the top. */
  label: string | null;
  /** Shown beside the group label — what kind of thing lives here. */
  noun?: string;
  items: NavItem[];
};

export const NAV: NavGroup[] = [
  {
    label: null,
    items: [{ href: '/', label: 'Overview', feature: 'overview' }],
  },
  {
    label: 'Coverage',
    noun: 'places',
    items: [
      { href: '/pincodes', label: 'Pincodes', feature: 'coverage', alsoActiveOn: ['/pincode', '/coverage'] },
      { href: '/gaps', label: 'Gaps', feature: 'coverage' },
      { href: '/readiness', label: 'Readiness', feature: 'coverage' },
      { href: '/imbalance', label: 'Imbalance', feature: 'coverage' },
      { href: '/momentum', label: 'Momentum', feature: 'coverage' },
      { href: '/heatmap', label: 'Order Heatmap', feature: 'coverage' },
    ],
  },
  {
    label: 'Fulfilment',
    noun: 'demand',
    items: [
      { href: '/requests', label: 'Requests', feature: 'requests', alsoActiveOn: ['/request'] },
      { href: '/commitments', label: 'Network bucket', feature: 'commitments' },
    ],
  },
  {
    label: 'Directory',
    noun: 'providers',
    items: [
      { href: '/directory', label: 'Labs & Chains', feature: 'directory', alsoActiveOn: ['/chain'] },
      { href: '/phlebos', label: 'Phlebos', feature: 'directory' },
      { href: '/nurses', label: 'Nurses', feature: 'directory' },
      { href: '/quality', label: 'Quality', feature: 'directory' },
    ],
  },
  {
    label: 'Growth',
    noun: 'accounts & deals',
    items: [
      { href: '/accounts', label: 'Account health', feature: 'accountHealth' },
      { href: '/catalogue', label: 'Catalogue', feature: 'catalogue' },
      { href: '/pricing', label: 'Packages & Pricing', feature: 'pricing' },
      { href: '/crm', label: 'Provider onboarding', feature: 'providerPipeline' },
    ],
  },
  {
    label: 'Admin',
    items: [{ href: '/users', label: 'Users & roles', feature: 'admin' }],
  },
];

/** Groups with every unreachable item stripped; empty groups drop out entirely. */
export function navFor(role: Role | undefined): NavGroup[] {
  const user = role ? { role } : null;
  return NAV
    .map((g) => ({ ...g, items: g.items.filter((i) => canView(user, i.feature)) }))
    .filter((g) => g.items.length > 0);
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === '/') return pathname === '/';
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
  return !!item.alsoActiveOn?.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Group + item for the current path, for the top-bar breadcrumb. */
export function locate(pathname: string): { group: string | null; item: string } | null {
  for (const g of NAV) {
    for (const i of g.items) {
      if (isActive(pathname, i)) return { group: g.label, item: i.label };
    }
  }
  return null;
}
