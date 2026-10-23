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
  /**
   * Paths under this item's href that belong to a DIFFERENT item, for the day
   * two items share a prefix again. Nothing uses it now that the accounts
   * screens are one item with tabs.
   */
  notActiveOn?: string[];
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
      { href: '/readiness', label: 'Readiness', feature: 'coverage' },
      { href: '/momentum', label: 'Momentum', feature: 'coverage' },
      { href: '/network', label: 'Provider network', feature: 'coverage' },
    ],
  },
  {
    label: 'Fulfilment',
    noun: 'demand',
    items: [
      { href: '/requests', label: 'Requests', feature: 'requests', alsoActiveOn: ['/request'] },
      { href: '/order-tracking', label: 'Order tracking', feature: 'orderTracking' },
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
      { href: '/sales', label: 'Sales CRM', feature: 'salesCrm', alsoActiveOn: ['/sales'] },
      // One item for the whole book: the list, the health report, the task
      // list and the cross-sell list are four questions about the same rows,
      // and they are tabs inside it rather than four things to choose between.
      { href: '/accounts', label: 'Accounts', feature: 'accountHealth' },
      { href: '/catalogue', label: 'Catalogue', feature: 'catalogue' },
      { href: '/pricing', label: 'Packages & Pricing', feature: 'pricing' },
      { href: '/crm', label: 'Provider onboarding', feature: 'providerPipeline' },
    ],
  },
  {
    label: 'Admin',
    items: [
      // Which partners the requests queue is for. Sits under Admin rather than
      // Fulfilment because it is configuration, not a queue to work.
      { href: '/settings/stores', label: 'Stores', feature: 'coverage' },
      { href: '/users', label: 'Users & roles', feature: 'admin' },
      { href: '/settings/roles', label: 'Roles & screens', feature: 'admin' },
      { href: '/settings/pipeline', label: 'Configure pipelines', feature: 'admin' },
    ],
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
  const excluded = item.notActiveOn?.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`));
  if (excluded) return false;
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
