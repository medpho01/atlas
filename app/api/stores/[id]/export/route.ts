import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, audit } from '@/lib/auth';
import { canView } from '@/lib/access';
import { isStage, STAGE_LABEL, statusLabel } from '@/lib/stores';
import {
  getStoreOrders, getStoreDetail, countStoreOrders, MAX_ORDER_ROWS, type OrderRow,
} from '@/lib/storeOrders';
import { badDate, idParam } from '../../params';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/[id]/export — the store's orders as CSV.
 *
 * Built on the server and scoped to the filters rather than to the page, so
 * "export this store's cancellations for March" is one file and not four
 * copy-pastes. Capped, because a CSV is held in memory before it is sent and
 * an uncapped export of a large partner is how a dashboard takes the process
 * down with it.
 */
const MAX_ROWS = MAX_ORDER_ROWS;

/** U+FEFF. Excel needs it to read UTF-8 correctly; see the note in toCsv(). */
const BOM = String.fromCharCode(0xFEFF);

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!canView(me, 'storeOrders')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const storeId = idParam(params.id);
  if (!storeId) return NextResponse.json({ error: 'Bad store id' }, { status: 400 });

  const sp = req.nextUrl.searchParams;
  const bad = badDate(sp.get('from')) ?? badDate(sp.get('to'));
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });

  const stageRaw = sp.get('stage');
  if (stageRaw && !isStage(stageRaw)) {
    return NextResponse.json({ error: `Unknown stage "${stageRaw}"` }, { status: 400 });
  }

  const filters = {
    q: sp.get('q')?.trim() || undefined,
    stage: stageRaw && isStage(stageRaw) ? stageRaw : undefined,
    from: sp.get('from') || undefined,
    to: sp.get('to') || undefined,
    delayedOnly: sp.get('delayed') === '1',
    flaggedOnly: sp.get('flagged') === '1',
  };

  // The count as well as the rows, so the file can say when it is not the
  // whole answer. An export that quietly stops at the cap is the worst kind of
  // wrong number: it looks complete, and somebody reconciles against it.
  const [store, total, rows] = await Promise.all([
    getStoreDetail(storeId),
    countStoreOrders(storeId, filters),
    getStoreOrders(storeId, { ...filters, limit: MAX_ROWS }),
  ]);

  if (!store) return NextResponse.json({ error: 'No such store' }, { status: 404 });

  // Exports leave the building. Who took what, and when, is worth a row.
  audit(me.id, `/api/stores/${storeId}/export`, 'export');

  const truncated = total > rows.length;
  const csv = toCsv(rows, truncated ? total : null);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${slug(store.name)}-orders-${stamp}.csv`;

  return new NextResponse(csv, {
    headers: {
      // charset on the type as well as the BOM in the bytes: between them,
      // every spreadsheet anyone here uses opens accented lab names correctly.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
      // For anything reading this programmatically, which will not see the
      // notice row at the bottom of the file.
      'X-Atlas-Rows': String(rows.length),
      'X-Atlas-Total': String(total),
      ...(truncated ? { 'X-Atlas-Truncated': 'true' } : {}),
    },
  });
}

const COLUMNS: { header: string; get: (o: OrderRow) => string | number | null }[] = [
  { header: 'Order ID', get: (o) => o.order_id },
  { header: 'Store reference', get: (o) => o.reference_id },
  { header: 'Stage', get: (o) => STAGE_LABEL[o.stage] ?? o.stage },
  { header: 'LabStack status', get: (o) => statusLabel(o.order_status) },
  { header: 'Order type', get: (o) => o.order_type },
  { header: 'Patient', get: (o) => o.patient_name },
  { header: 'Patient city', get: (o) => o.patient_city },
  { header: 'Patient pincode', get: (o) => o.patient_pincode },
  { header: 'Booked at', get: (o) => o.created_at },
  { header: 'Appointment', get: (o) => o.appointment_at },
  { header: 'Last status change', get: (o) => o.status_at },
  { header: 'Phlebo', get: (o) => o.phlebo_name },
  { header: 'Phlebo assigned at', get: (o) => o.assigned_at },
  { header: 'Lab', get: (o) => o.lab_name },
  { header: 'Lab city', get: (o) => o.lab_city },
  { header: 'Turnaround (hours)', get: (o) => (o.turnaround_hours == null ? null : o.turnaround_hours.toFixed(1)) },
  { header: 'Delayed', get: (o) => (o.delayed ? 'yes' : 'no') },
  { header: 'Flagged for reschedule', get: (o) => (o.flagged_for_reschedule ? 'yes' : 'no') },
  { header: 'Reschedule reason', get: (o) => o.reschedule_reason },
  { header: 'Cancel reason', get: (o) => o.cancel_reason },
  { header: 'From request', get: (o) => o.request_id },
];

/**
 * One cell.
 *
 * Two separate jobs in here. The quoting is ordinary CSV. The apostrophe is
 * not: a value starting = + - or @ is executed as a formula when the file is
 * opened, so a lab named "-Acme" can run something on the machine of whoever
 * opens the export. Prefixing breaks that without changing what is displayed.
 * Tab and carriage return lead the same way in some spreadsheets, so they are
 * covered too.
 */
function cell(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = String(v);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function toCsv(rows: OrderRow[], truncatedTotal: number | null): string {
  const head = COLUMNS.map((c) => cell(c.header)).join(',');
  const body = rows.map((o) => COLUMNS.map((c) => cell(c.get(o))).join(','));
  // Said in the file itself, in the first column of the last row, because the
  // person who opens this in Excel will never see a response header.
  if (truncatedTotal != null) {
    body.push(cell(`TRUNCATED — this file holds the first ${rows.length.toLocaleString('en-IN')} `
      + `of ${truncatedTotal.toLocaleString('en-IN')} matching orders. `
      + `Narrow the date range or the stage and export again.`));
  }
  // The mark comes from BOM, built by char code. Typing the character or
  // writing a \uFEFF escape both leave an invisible byte in the source,
  // where a formatter, an editor or a JSON round-trip strips it without
  // anyone noticing — and Excel then mangles every accented name in every
  // export, with nothing in the diff to explain why. It happened once while
  // writing this file. CRLF for the same audience.
  return BOM + [head, ...body].join('\r\n') + '\r\n';
}

/** A filename that survives every operating system anyone here runs. */
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
    || 'store';
}
