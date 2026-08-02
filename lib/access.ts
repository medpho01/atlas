/**
 * Role-based access for Atlas.
 *
 * Two axes, not one. Page-level access alone can't express "Accounts can see
 * providers but not add them", which is the rule that shaped this model — so
 * every feature carries a capability, not a boolean.
 *
 * Dependency-free on purpose (no DB, no cookies) so the Sidebar can import it
 * on the client while pages and API routes enforce the same rows on the server.
 * Nav and enforcement drifting apart is the failure mode this prevents.
 */

export type Role = 'admin' | 'network' | 'accounts' | 'operations' | 'editor' | 'viewer';

/** Roles a new user can be given. editor/viewer are legacy — see LEGACY_ROLES. */
export const ACTIVE_ROLES: Role[] = ['admin', 'network', 'accounts', 'operations'];

/**
 * Pre-dating the four-profile model. Kept so nobody on prod loses access at
 * deploy; they map to the closest active profile. Retire once /users shows
 * none left.
 */
export const LEGACY_ROLES: Role[] = ['editor', 'viewer'];

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  network: 'Network',
  accounts: 'Accounts',
  operations: 'Operations',
  editor: 'Editor (legacy)',
  viewer: 'Viewer (legacy)',
};

export const ROLE_BLURB: Record<Role, string> = {
  admin: 'Everything, plus provisioning people and roles.',
  network: 'Grows supply — owns the provider directory, rates and onboarding.',
  accounts: 'Grows demand — owns account health and can read the network side.',
  operations: 'Fulfils today’s orders — reads coverage and the directory.',
  editor: 'Legacy role. Behaves like Network. Reassign and retire.',
  viewer: 'Legacy role. Read-only across the network side. Reassign and retire.',
};

/** One row per sidebar group (or per item where a group splits by owner). */
export type Feature =
  | 'overview'
  | 'coverage'          // pincodes, gaps, imbalance, momentum, heatmap, serviceability
  | 'directory'         // labs & chains, phlebos, nurses, quality
  | 'accountHealth'     // Growth › Account health
  | 'catalogue'         // Growth › Packages & Pricing
  | 'providerPipeline'  // Growth › Provider onboarding
  | 'admin';            // users & roles

export type Capability = 'none' | 'view' | 'manage';

const RANK: Record<Capability, number> = { none: 0, view: 1, manage: 2 };

/**
 * Features that can't be used without read access to another. Without this a
 * role could manage the onboarding pipeline while unable to open the provider
 * they're moving through it.
 */
const REQUIRES: Partial<Record<Feature, Feature>> = {
  providerPipeline: 'directory',
  catalogue: 'directory',
  accountHealth: 'coverage',
};

const MATRIX: Record<Feature, Record<Role, Capability>> = {
  overview:         { admin: 'manage', network: 'view',   accounts: 'view',   operations: 'view',   editor: 'view',   viewer: 'view' },
  coverage:         { admin: 'manage', network: 'view',   accounts: 'view',   operations: 'view',   editor: 'view',   viewer: 'view' },
  directory:        { admin: 'manage', network: 'manage', accounts: 'view',   operations: 'view',   editor: 'manage', viewer: 'view' },
  accountHealth:    { admin: 'manage', network: 'view',   accounts: 'manage', operations: 'none',   editor: 'view',   viewer: 'view' },
  catalogue:        { admin: 'manage', network: 'manage', accounts: 'view',   operations: 'none',   editor: 'manage', viewer: 'view' },
  providerPipeline: { admin: 'manage', network: 'manage', accounts: 'view',   operations: 'none',   editor: 'manage', viewer: 'view' },
  admin:            { admin: 'manage', network: 'none',   accounts: 'none',   operations: 'none',   editor: 'none',   viewer: 'none' },
};

type UserLike = { role: Role } | null | undefined;

/**
 * Capability a role holds for a feature, after dependency promotion.
 * Unknown roles get 'none' — a new role can't silently inherit access.
 */
export function capability(user: UserLike, feature: Feature): Capability {
  if (!user) return 'none';
  const row = MATRIX[feature];
  if (!row) return 'none';
  let cap = row[user.role] ?? 'none';

  // If a role can reach something that depends on this feature, it must at
  // least be able to read this one.
  for (const [dependent, required] of Object.entries(REQUIRES) as [Feature, Feature][]) {
    if (required !== feature) continue;
    const depCap = MATRIX[dependent]?.[user.role] ?? 'none';
    if (RANK[depCap] > RANK.none && RANK[cap] < RANK.view) cap = 'view';
  }
  return cap;
}

/** Can open the feature at all. */
export function canView(user: UserLike, feature: Feature): boolean {
  return RANK[capability(user, feature)] >= RANK.view;
}

/** Can add, edit, upload, or move things within the feature. */
export function canManage(user: UserLike, feature: Feature): boolean {
  return capability(user, feature) === 'manage';
}

/** Back-compat alias — reads better at page guards. */
export const canAccess = canView;

/** The whole matrix, for the admin screen. */
export function permissionMatrix(): { feature: Feature; caps: Record<Role, Capability> }[] {
  return (Object.keys(MATRIX) as Feature[]).map((feature) => ({
    feature,
    caps: Object.fromEntries(
      (Object.keys(MATRIX[feature]) as Role[]).map((r) => [r, capability({ role: r }, feature)]),
    ) as Record<Role, Capability>,
  }));
}

export const FEATURE_LABEL: Record<Feature, string> = {
  overview: 'Overview',
  coverage: 'Coverage',
  directory: 'Directory',
  accountHealth: 'Account health',
  catalogue: 'Packages & Pricing',
  providerPipeline: 'Provider onboarding',
  admin: 'Users & roles',
};
