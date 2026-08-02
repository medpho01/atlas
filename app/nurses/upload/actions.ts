'use server';

import { getSessionUser } from '@/lib/auth';
import { canManage } from '@/lib/access';
import { bulkUpsertNurses, UploadedNurse, UploadResult } from '@/lib/nursesQueries';
import { revalidatePath } from 'next/cache';

export type CommitInput = {
  filename: string;
  rows: UploadedNurse[];
  /** Applied to any row that didn't carry its own aggregator column. */
  defaultAggregator?: string;
};

export async function commitUpload(input: CommitInput): Promise<
  | { ok: true; result: UploadResult }
  | { ok: false; error: string }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'unauthenticated' };
  if (!canManage(user, 'directory')) return { ok: false, error: 'forbidden' };

  if (!input.rows?.length) return { ok: false, error: 'no_rows' };
  if (input.rows.length > 100_000) return { ok: false, error: 'too_many_rows_max_100000' };

  const fallback = input.defaultAggregator?.trim();
  const rows = fallback
    ? input.rows.map((r) => ({ ...r, aggregator: r.aggregator?.trim() || fallback }))
    : input.rows;

  try {
    const result = await bulkUpsertNurses(rows, {
      filename: input.filename || 'unnamed.csv',
      userId: user.id,
    });
    revalidatePath('/nurses');
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
