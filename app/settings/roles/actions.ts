'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@/lib/db';
import { getSessionUser, audit } from '@/lib/auth';
import { canManage, FEATURE_LABEL, type Capability, type Feature, type Role } from '@/lib/access';
import { invalidateRoleAccess, MATRIX_ROLES } from '@/lib/roleAccess';

const CAPS: Capability[] = ['none', 'view', 'manage'];

/**
 * Move one screen in or out of one role's reach.
 *
 * Refuses the single edit that cannot be undone from inside the application:
 * taking Admin away from admin would lock every administrator out of this very
 * screen, and the only way back would be psql. lib/access.ts enforces the same
 * rule on read, so a row inserted by hand does not get around it either.
 */
export async function setRoleCapability(input: {
  role: string; feature: string; capability: string;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!canManage(me, 'admin')) return { ok: false, error: 'Needs the admin role' };

  const role = MATRIX_ROLES.find((r) => r === input.role) as Role | undefined;
  if (!role) return { ok: false, error: 'Unknown role' };
  const feature = (Object.keys(FEATURE_LABEL) as Feature[]).find((f) => f === input.feature);
  if (!feature) return { ok: false, error: 'Unknown screen' };
  const capability = CAPS.find((c) => c === input.capability);
  if (!capability) return { ok: false, error: 'Unknown capability' };

  if (role === 'admin' && feature === 'admin' && capability !== 'manage') {
    return { ok: false, error: 'Admin keeps Admin — otherwise nobody can undo this' };
  }

  await query(`
    INSERT INTO atlas.role_feature_log (role, feature, capability, was, updated_by)
    SELECT $1, $2, $3, (SELECT capability FROM atlas.role_feature WHERE role = $1 AND feature = $2), $4
  `, [role, feature, capability, me.id]);

  await query(`
    INSERT INTO atlas.role_feature (role, feature, capability, updated_by, updated_at)
    VALUES ($1, $2, $3, $4, now())
    ON CONFLICT (role, feature) DO UPDATE SET
      capability = EXCLUDED.capability, updated_by = EXCLUDED.updated_by, updated_at = now()
  `, [role, feature, capability, me.id]);

  invalidateRoleAccess();
  audit(me.id, '/settings/roles', `${role}:${feature}=${capability}`);
  revalidatePath('/', 'layout');
  return { ok: true };
}
