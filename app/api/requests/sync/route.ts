import { NextResponse } from 'next/server';
import { requireView } from '@/lib/guard';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The commitment poller.
 *
 * Steps 3 and 6 of the flow happen in the LabStack console; this is how Atlas
 * finds out. It opens a commitment for every order newly parked on the
 * placeholder lab, and closes every one whose order has since moved onto a
 * real lab.
 *
 * Only open commitments are examined — tens of rows, not the 46k-order table —
 * because the source is a hot standby that has killed long reads before.
 * Frequent and narrow, never broad.
 *
 * Called by the page on load and by cron. Idempotent: running it twice changes
 * nothing the second time.
 */
export async function POST() {
  const gate = await requireView('commitments', '/api/requests/sync');
  if (gate.blocked) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const t0 = Date.now();
  const result = await queryOne<{ opened: number; closed: number; expired: number }>(
    `SELECT * FROM atlas.sync_commitments()`);

  return NextResponse.json({ ...result, ms: Date.now() - t0 });
}

/** Read-only view of where the ledger stands. */
export async function GET() {
  const gate = await requireView('commitments', '/api/requests/sync');
  if (gate.blocked) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const rows = await query<{ outcome: string | null; n: number }>(`
    SELECT COALESCE(outcome, 'open') AS outcome, COUNT(*)::int AS n
    FROM atlas.commitment GROUP BY 1 ORDER BY 2 DESC`);
  return NextResponse.json({ rows });
}
