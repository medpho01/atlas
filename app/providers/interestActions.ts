'use server';

import { revalidatePath } from 'next/cache';
import { query } from '@/lib/db';
import { getSessionUser, audit } from '@/lib/auth';
import { canManage } from '@/lib/access';

export type InterestKind = 'phlebo' | 'nurse';
export type InterestStatus = 'interested' | 'not_interested';

const KINDS: InterestKind[] = ['phlebo', 'nurse'];
const STATUSES: InterestStatus[] = ['interested', 'not_interested'];

/** Digits only, last ten — the key the whole directory is built on. */
function normalise(phone: string): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  if (!d) return null;
  return d.length >= 10 ? d.slice(-10) : d;
}

/**
 * Record what somebody said when we rang them.
 *
 * `status: null` clears the answer, which is not the same as "not interested"
 * — it puts them back among the people nobody has spoken to. That is why the
 * table has two states and an absence rather than three states.
 *
 * Needs manage on the directory: admin, network lead and network, which is the
 * team that makes these calls. Everyone else can read the answer.
 */
export async function setProviderInterest(input: {
  kind: string;
  phone: string;
  status: string | null;
  note?: string;
}): Promise<{ ok: boolean; error?: string; status?: InterestStatus | null }> {
  const me = await getSessionUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!canManage(me, 'directory')) {
    return { ok: false, error: 'Needs the network, network lead or admin role' };
  }

  const kind = KINDS.find((k) => k === input.kind);
  if (!kind) return { ok: false, error: 'Unknown directory' };

  const phone = normalise(input.phone);
  if (!phone) return { ok: false, error: 'No phone number to record this against' };

  const clearing = input.status === null || input.status === '';
  const status = clearing ? null : STATUSES.find((s) => s === input.status);
  if (!clearing && !status) return { ok: false, error: 'Unknown answer' };

  const note = (input.note ?? '').trim().slice(0, 1000) || null;

  if (clearing) {
    await query('DELETE FROM atlas.provider_interest WHERE kind = $1 AND phone = $2',
      [kind, phone]);
  } else {
    await query(`
      INSERT INTO atlas.provider_interest (kind, phone, status, note, set_by, set_at)
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (kind, phone) DO UPDATE SET
        status = EXCLUDED.status,
        note   = EXCLUDED.note,
        set_by = EXCLUDED.set_by,
        set_at = now()
    `, [kind, phone, status, note, me.id]);
  }

  // The log keeps the clearing too, as a row with a null status — otherwise
  // "who marked them interested, and who undid it" has only half an answer.
  await query(`
    INSERT INTO atlas.provider_interest_log (kind, phone, status, note, set_by)
    VALUES ($1, $2, $3, $4, $5)
  `, [kind, phone, status ?? null, note, me.id]);

  const path = kind === 'nurse' ? '/nurses' : '/phlebos';
  audit(me.id, path, clearing ? 'interest-clear' : `interest-${status}`);
  revalidatePath(path);
  return { ok: true, status: status ?? null };
}
