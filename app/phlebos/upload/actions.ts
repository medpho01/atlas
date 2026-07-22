'use server';

import { getSessionUser } from '@/lib/auth';
import { bulkUpsertPhlebos, UploadedPhlebo, UploadResult } from '@/lib/phlebosQueries';
import { revalidatePath } from 'next/cache';

export type CommitInput = {
  filename: string;
  rows: UploadedPhlebo[];
};

export async function commitUpload(input: CommitInput): Promise<
  | { ok: true; result: UploadResult }
  | { ok: false; error: string }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'unauthenticated' };
  if (user.role !== 'admin') return { ok: false, error: 'admin_only' };

  if (!input.rows?.length) return { ok: false, error: 'no_rows' };
  if (input.rows.length > 100_000) return { ok: false, error: 'too_many_rows_max_100000' };

  try {
    const result = await bulkUpsertPhlebos(input.rows, {
      filename: input.filename || 'unnamed.csv',
      userId: user.id,
    });
    revalidatePath('/phlebos');
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
