import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { canLeadCrm } from '@/lib/crm';
import { monthBounds, getScoreboard } from '@/lib/crmScore';

export const dynamic = 'force-dynamic';

/**
 * The month's scores as a file, for whoever processes the incentive.
 *
 * Payroll happens outside Atlas, so the number has to leave the screen. A lead
 * or admin only: this is the sheet the money is paid from.
 */
export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me || !canLeadCrm(me)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const month = monthBounds(new URL(req.url).searchParams.get('month'));
  const rows = await getScoreboard(month.from, month.to);

  const csv = [
    ['Month', 'Person', 'Earned', 'Lost to waiting', 'Net', 'Target', '% of target', 'Incentive (INR)'].join(','),
    ...rows.map((r) => [
      month.key,
      `"${r.name.replace(/"/g, '""')}"`,
      r.earned, r.penalty, r.net, r.target, r.pct,
      Number(r.payout).toFixed(2),
    ].join(',')),
  ].join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="atlas-crm-score-${month.key}.csv"`,
    },
  });
}
