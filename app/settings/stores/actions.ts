'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { canManage } from '@/lib/access';

type R = { ok: boolean; error?: string };

/**
 * Switch a store on or off for the requests queue.
 *
 * Off hides its requests and its filter chip; it does not delete anything, and
 * the queue always shows how many requests are hidden. Absent from the table
 * means tracked, so this only ever writes a deliberate decision.
 */
export async function setStoreTracked(storeId: number, tracked: boolean): Promise<R> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!canManage(me, 'commitments')) {
    return { ok: false, error: 'Changing tracked stores needs the network or admin role' };
  }
  if (!Number.isFinite(storeId)) return { ok: false, error: 'Bad store' };

  await queryOne(`
    INSERT INTO atlas.store_tracking (store_id, tracked, updated_by)
    VALUES ($1, $2, $3)
    ON CONFLICT (store_id) DO UPDATE
      SET tracked = EXCLUDED.tracked, updated_by = EXCLUDED.updated_by, updated_at = now()
  `, [storeId, tracked, me.id]);

  revalidatePath('/settings/stores');
  revalidatePath('/requests');
  return { ok: true };
}
