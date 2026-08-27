'use server';

import { getSessionUser } from '@/lib/auth';
import { getPanelGap } from '@/lib/serviceabilityQueries';

/**
 * What a chosen panel of labs covers, and what it leaves behind.
 *
 * A server action rather than a page param because the lab set is a working
 * selection, not a place someone navigates to — and it keeps a 200-lab
 * selection out of the URL.
 */
export async function runPanelGap(labIds: number[]) {
  const me = await getSessionUser();
  if (!me) return { ok: false as const, error: 'unauthenticated' };
  if (!Array.isArray(labIds) || !labIds.length) {
    return { ok: false as const, error: 'Pick at least one lab' };
  }
  try {
    const { summary, rows } = await getPanelGap(labIds);
    return { ok: true as const, summary, rows };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}
