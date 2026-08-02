import 'server-only';
import { redirect } from 'next/navigation';
import { getSessionUser, type User } from './auth';
import { canView, canManage, type Feature } from './access';

/**
 * Page guard. Returns the user when they may view the feature, otherwise
 * either sends them to login or signals a role block.
 *
 * Every protected page calls this rather than hand-rolling the checks, so a
 * new page can't ship with the login redirect but no role check — which is how
 * /pincodes, /gaps and eight others ended up reachable by any signed-in user.
 */
export async function requireView(
  feature: Feature,
  next: string,
): Promise<{ user: User; blocked: false } | { user: User | null; blocked: true }> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!canView(user, feature)) return { user, blocked: true };
  return { user, blocked: false };
}

/** True when the user may write within the feature — drives buttons and actions. */
export async function hasManage(feature: Feature): Promise<boolean> {
  return canManage(await getSessionUser(), feature);
}
