import Link from 'next/link';
import { AlertTriangle, Phone, Sparkles } from 'lucide-react';
import type { OrderRow } from '@/lib/orderTracking';

const clock = (t: string | null) => {
  const m = t?.match(/ (\d{2}):(\d{2})/);
  if (!m) return '—';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
};

const num = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN');
const inr = (v: string | null) => (v == null ? '—' : '₹' + Math.round(Number(v)).toLocaleString('en-IN'));

const STATUS_LABEL: Record<string, string> = {
  CREATED: 'Created', PENDING: 'Pending', ORDER_SCHEDULED: 'Scheduled',
  RESCHEDULED: 'Rescheduled', PHLEBO_ASSIGNED: 'Phlebo assigned',
  SAMPLE_COLLECTED: 'Sample collected', SAMPLE_DELIVERED: 'Sample delivered',
  SAMPLE_PROCESSED: 'Sample processed', REPORT_DELIVERED: 'Report delivered',
  KIT_DISPATCHED: 'Kit dispatched', CANCELED: 'Cancelled', PATIENT_MISSED: 'Patient missed',
};

function Status({ s }: { s: string | null }) {
  if (!s) return <span className="text-ink-300">—</span>;
  const tone =
    s === 'REPORT_DELIVERED' ? 'bg-success-50 text-success-600 border-success-100'
    : s === 'CANCELED' || s === 'PATIENT_MISSED' ? 'bg-danger-50 text-danger-500 border-danger-100'
    : s.startsWith('SAMPLE') ? 'bg-brand-50 text-brand-700 border-brand-100'
    : 'bg-ink-100 text-ink-600 border-ink-200';
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap ${tone}`}>
      {STATUS_LABEL[s] ?? s.toLowerCase().replace(/_/g, ' ')}
    </span>
  );
}

/**
 * Every request-born order on one day, whatever state it is in.
 *
 * The lab is the column this exists for. An order still parked on the
 * placeholder on the day itself is the one that fails, so those sort to the
 * top and say so in red rather than showing the placeholder's name as though
 * it were a real allocation.
 */
export function DayTable({ rows, day }: { rows: OrderRow[]; day: string }) {
  if (rows.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <p className="text-sm text-ink-600 font-medium">No request became an order for this day.</p>
        <p className="text-[12px] text-ink-400 mt-1">
          Direct store orders are not listed here — this page follows requests.
        </p>
      </div>
    );
  }

  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full text-sm min-w-[1220px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
            <th className="text-left font-medium pl-5 pr-2 py-2 w-[96px]">Time</th>
            <th className="text-left font-medium px-2 py-2 w-[124px]">Order</th>
            <th className="text-left font-medium px-2 py-2 w-[124px]">Request</th>
            <th className="text-left font-medium px-2 py-2 w-[150px]">Where</th>
            <th className="text-left font-medium px-2 py-2">Lab</th>
            <th className="text-left font-medium px-2 py-2 w-[140px]">Contact</th>
            <th className="text-left font-medium px-2 py-2 w-[132px]">Lab record</th>
            <th className="text-left font-medium px-2 py-2 w-[142px]">Order status</th>
            <th className="text-right font-medium px-2 pr-5 py-2 w-[92px]">Quote</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.order_id}
                className={`border-b border-ink-100 last:border-0 ${r.on_placeholder ? 'bg-danger-50/30' : ''}`}>
              <td className="pl-5 pr-2 py-2.5 whitespace-nowrap num text-ink-900">{clock(r.appointment_at)}</td>
              <td className="px-2 py-2.5 num text-ink-900">#{r.order_id}</td>
              <td className="px-2 py-2.5">
                <Link href={`/requests/${r.request_id}`}
                      className="text-[12px] text-brand-700 dark:text-brand-400 hover:underline num">
                  #{r.request_id}
                </Link>
                {r.store_name && (
                  <span className="block text-[11px] text-ink-400 truncate max-w-[118px]">{r.store_name}</span>
                )}
              </td>
              <td className="px-2 py-2.5">
                <span className="text-ink-800">{r.request_city ?? '—'}</span>
                <span className="block text-[11px] text-ink-400 num">{r.request_pincode ?? ''}</span>
              </td>
              <td className="px-2 py-2.5">
                {r.on_placeholder ? (
                  <span className="inline-flex items-center gap-1 text-danger-500 font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5" /> LabStack Networks — no real lab
                  </span>
                ) : (
                  <>
                    <Link href={`/lab/${r.lab_id}`} className="text-ink-900 hover:text-brand-600">
                      {r.lab_name ?? '—'}
                    </Link>
                    <span className="block text-[11px] text-ink-400">{r.lab_city ?? ''}</span>
                  </>
                )}
              </td>
              <td className="px-2 py-2.5">
                {r.on_placeholder ? <span className="text-ink-300">—</span>
                  : r.lab_phone ? (
                    <a href={`tel:${r.lab_phone.replace(/[^\d+]/g, '')}`}
                       className="inline-flex items-center gap-1 text-[12px] text-brand-700 dark:text-brand-400 num hover:underline">
                      <Phone className="w-3 h-3" />{r.lab_phone}
                    </a>
                  ) : <span className="text-[11px] text-ink-400">no number</span>}
              </td>
              <td className="px-2 py-2.5">
                {r.on_placeholder ? <span className="text-ink-300">—</span> : (
                  <>
                    <span className={`text-xs font-semibold ${
                      r.lab_orders_all_time <= 1 ? 'text-danger-500'
                      : r.lab_orders_all_time < 5 ? 'text-warn-600' : 'text-ink-600'}`}>
                      {r.lab_orders_all_time <= 1 && <Sparkles className="inline w-3 h-3 mr-0.5" />}
                      {num(r.lab_orders_all_time)} ever
                    </span>
                    <span className="block text-[11px] text-ink-400">
                      {r.lab_failed > 0
                        ? <span className="text-danger-500">{num(r.lab_failed)} failed</span>
                        : `${num(r.lab_delivered)} delivered`}
                    </span>
                  </>
                )}
              </td>
              <td className="px-2 py-2.5"><Status s={r.order_status} /></td>
              <td className="px-2 pr-5 py-2.5 text-right num text-ink-700">{inr(r.quoted_price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
