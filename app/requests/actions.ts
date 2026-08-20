'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { canManage } from '@/lib/access';
import { discoverForPincode } from '@/lib/discoverLabs';

type R = { ok: boolean; error?: string; id?: number };

/**
 * Promote a web-search lead into CRM.
 *
 * The lead itself is unverified third-party data, so this is deliberately a
 * human action rather than something the discovery job does on its own —
 * clicking it is the record that a person looked at it and thinks it is real.
 * The CRM note carries that caveat forward so it is not lost the moment the
 * row leaves this screen.
 */
export async function promoteDiscoveredLab(leadId: number): Promise<R> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!canManage(me, 'commitments')) {
    return { ok: false, error: 'Promoting a lead needs the network or admin role' };
  }
  if (!Number.isFinite(leadId)) return { ok: false, error: 'Bad lead id' };

  try {
    const row = await queryOne<{ id: number }>(
      `SELECT atlas.promote_discovered_lab($1, $2) AS id`, [leadId, me.id]);
    revalidatePath('/commitments');
    return { ok: true, id: row?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Dismiss a lead that turned out to be wrong, without deleting the evidence. */
export async function dismissDiscoveredLab(leadId: number): Promise<R> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!canManage(me, 'commitments')) {
    return { ok: false, error: 'Dismissing a lead needs the network or admin role' };
  }
  await queryOne(`UPDATE atlas.discovered_lab SET dismissed = true WHERE id = $1`, [leadId]);
  revalidatePath('/commitments');
  return { ok: true };
}

/**
 * Reconcile the ledger against the console on demand.
 *
 * The poller runs every few minutes anyway; this exists so somebody who has
 * just moved an order in the console can see it reflected without waiting,
 * which is the moment they are most likely to distrust the screen.
 */
export async function syncCommitments(): Promise<R & { opened?: number; closed?: number }> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!canManage(me, 'commitments')) {
    return { ok: false, error: 'Needs the network or admin role' };
  }
  const row = await queryOne<{ opened: number; closed: number; expired: number; crm_created: number }>(
    `SELECT * FROM atlas.sync_commitments_full()`);
  revalidatePath('/commitments');
  return { ok: true, opened: row?.opened, closed: row?.closed };
}

/**
 * Search the web for labs in a pincode we cannot reach.
 *
 * Triggered from the request the network team is looking at, rather than only
 * by the nightly batch — when someone is working a supply gap now, "run the
 * script and come back tomorrow" is not an answer.
 */
export async function findLabsForPincode(
  pincode: string, city?: string | null, state?: string | null,
): Promise<R & { found?: number }> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!canManage(me, 'commitments')) {
    return { ok: false, error: 'Searching for labs needs the network or admin role' };
  }
  if (!/^\d{6}$/.test(pincode)) return { ok: false, error: 'Bad pincode' };

  const r = await discoverForPincode(pincode, city, state);
  revalidatePath(`/requests`);
  return r.error ? { ok: false, error: r.error, found: 0 } : { ok: true, found: r.found };
}
