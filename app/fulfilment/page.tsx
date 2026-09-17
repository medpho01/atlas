import Link from 'next/link';
import { CalendarClock, AlertTriangle, Sparkles, MoveRight, Phone } from 'lucide-react';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChipButton } from '@/components/ui/Toggle';
import { StickyMetrics } from '@/components/ui/StickyMetrics';
import { KpiTile } from '@/components/KpiTile';
import {
  istDay, shiftDay, getOpenPromises, getDayAppointments, getRecentMoves,
  getDayCounts, getDeskSummary,
} from '@/lib/fulfilmentQueries';

export const dynamic = 'force-dynamic';

const inr = (v: string | null) =>
  v == null ? '—' : '₹' + Math.round(Number(v)).toLocaleString('en-IN');

const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB',
    { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * The view hands back an IST wall clock as text. Reading it through Date would
 * shift it again by whatever timezone the server happens to be in, so the
 * string is formatted as written.
 */
const time = (t: string | null) => {
  const m = t?.match(/ (\d{2}):(\d{2})/);
  if (!m) return '—';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
};

const num = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-IN');

/** Status, in the words the desk uses, and whether it still needs somebody. */
const STATUS_TONE: Record<string, { label: string; chip: string }> = {
  REPORT_DELIVERED: { label: 'delivered', chip: 'bg-success-50 text-success-600 border-success-100' },
  SAMPLE_PROCESSED: { label: 'processed', chip: 'bg-success-50 text-success-600 border-success-100' },
  SAMPLE_COLLECTED: { label: 'collected', chip: 'bg-brand-50 text-brand-700 border-brand-100' },
  SAMPLE_DELIVERED: { label: 'at lab', chip: 'bg-brand-50 text-brand-700 border-brand-100' },
  PHLEBO_ASSIGNED: { label: 'phlebo assigned', chip: 'bg-brand-50 text-brand-700 border-brand-100' },
  ORDER_SCHEDULED: { label: 'scheduled', chip: 'bg-ink-100 text-ink-600 border-ink-200' },
  CREATED: { label: 'created', chip: 'bg-ink-100 text-ink-600 border-ink-200' },
  PENDING: { label: 'pending', chip: 'bg-warn-50 text-warn-600 border-warn-100' },
  RESCHEDULED: { label: 'rescheduled', chip: 'bg-warn-50 text-warn-600 border-warn-100' },
  CANCELED: { label: 'cancelled', chip: 'bg-danger-50 text-danger-500 border-danger-100' },
  PATIENT_MISSED: { label: 'patient missed', chip: 'bg-danger-50 text-danger-500 border-danger-100' },
};

function Status({ s }: { s: string | null }) {
  if (!s) return <span className="text-ink-300">—</span>;
  const t = STATUS_TONE[s] ?? { label: s.toLowerCase().replace(/_/g, ' '), chip: 'bg-ink-100 text-ink-600 border-ink-200' };
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-[11px] ${t.chip}`}>{t.label}</span>;
}

/**
 * What a lab's history says about this order.
 *
 * "First order" is the headline, but not the whole question. A lab whose only
 * previous order was cancelled has no track record either, and saying so is
 * the difference between a badge and a reason to pick up the phone.
 */
function LabTrack({ row }: { row: { is_first_order: boolean | null; lab_orders_all_time: number | null;
                                    lab_delivered: number | null; lab_failed: number | null } }) {
  const n = row.lab_orders_all_time ?? 0;
  if (row.is_first_order) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-warn-100 bg-warn-50
                       px-1.5 py-0.5 text-[11px] font-medium text-warn-600">
        <Sparkles className="w-3 h-3" /> first order with this lab
      </span>
    );
  }
  if (n <= 3) {
    return (
      <span className="text-[11px] text-ink-500">
        {num(n)} order{n === 1 ? '' : 's'} ever
        {(row.lab_failed ?? 0) > 0 && <span className="text-danger-500"> · {row.lab_failed} failed</span>}
      </span>
    );
  }
  return (
    <span className="text-[11px] text-ink-400">
      {num(n)} orders · {num(row.lab_delivered)} delivered
    </span>
  );
}

export default async function FulfilmentPage({
  searchParams,
}: {
  searchParams: { day?: string; lane?: string };
}) {
  const gate = await requireView('commitments', '/fulfilment');
  if (gate.blocked) return <RoleBlocked area="The fulfilment desk" detail="network, accounts and admin" />;

  const today = istDay();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day ?? '') ? searchParams.day! : today;

  const [promises, appointments, moves, counts, summary] = await Promise.all([
    getOpenPromises(day),
    getDayAppointments(day),
    getRecentMoves(day),
    getDayCounts(shiftDay(day, -3), shiftDay(day, 7)),
    getDeskSummary(day),
  ]);

  const countFor = (d: string) => counts.find((c) => c.day === d);
  const strip = Array.from({ length: 11 }, (_, i) => shiftDay(day, i - 3));
  const href = (d: string) => `/fulfilment${d === today ? '' : `?day=${d}`}`;

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Fulfilment desk"
        subtitle="A promise has two deadlines: find the lab, then get the order done. Both are dates."
      />

      {/* The days either side, with what each is carrying — so the next thing
          to worry about is visible before it arrives. */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <span className="w-14 shrink-0 text-[11px] uppercase tracking-wide text-ink-400">Day</span>
        {strip.map((d) => {
          const c = countFor(d);
          return (
            <ChipButton key={d} href={href(d)} active={d === day}>
              {d === today ? 'Today' : dayLabel(d).replace(',', '')}
              {c && c.appointments > 0 && (
                <span className="opacity-60 tabular-nums">{c.appointments}</span>
              )}
              {c && c.first_orders > 0 && <Sparkles className="w-3 h-3" />}
            </ChipButton>
          );
        })}
      </div>

      <StickyMetrics title="Fulfilment desk" className="mb-6">
        <div className="kpi-row grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiTile label="Promised, no lab" value={(summary?.due_or_overdue ?? 0).toLocaleString('en-IN')}
                   sub="due or overdue" tone={summary?.due_or_overdue ? 'warn' : 'default'} />
          <KpiTile label="Overdue" value={(summary?.overdue ?? 0).toLocaleString('en-IN')}
                   sub="past the promised date" tone={summary?.overdue ? 'bad' : 'default'} />
          <KpiTile label="Appointments" value={(summary?.appointments ?? 0).toLocaleString('en-IN')}
                   sub={day === today ? 'today' : dayLabel(day)} />
          <KpiTile label="First orders" value={(summary?.first_orders ?? 0).toLocaleString('en-IN')}
                   sub="a lab's first ever" tone={summary?.first_orders ? 'warn' : 'default'} />
          <KpiTile label="Moved" value={(summary?.moved ?? 0).toLocaleString('en-IN')} sub="in the last 7 days" />
        </div>
      </StickyMetrics>

      {/* ---- Lane 1 -------------------------------------------------------- */}
      <Card className="mb-5">
        <CardHeader
          title="Promised, no lab yet"
          subtitle="A date somebody has already been given, and nobody to serve it. Nearest deadline first."
          icon={<AlertTriangle className="w-4 h-4" />}
        />
        <CardBody className="pt-0">
          {promises.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-500">
              Nothing promised without supply. Every booked order has a lab.
            </p>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
                    <th className="text-left font-medium px-5 py-2">Request</th>
                    <th className="text-left font-medium px-2 py-2">Where</th>
                    <th className="text-left font-medium px-2 py-2">Promised</th>
                    <th className="text-right font-medium px-2 py-2">Quote</th>
                    <th className="text-left font-medium px-2 py-2">Nearest lab</th>
                    <th className="text-left font-medium px-5 py-2">Onboarding</th>
                  </tr>
                </thead>
                <tbody>
                  {promises.map((p) => (
                    <tr key={p.commitment_id} className="border-b border-ink-100 last:border-0">
                      <td className="px-5 py-2">
                        <Link href={`/requests/${p.request_id}`} className="font-medium text-ink-900 hover:text-brand-600">
                          #{p.request_id}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-ink-700">
                        {p.city ?? '—'}
                        <span className="block text-[11px] text-ink-400 num">{p.pincode ?? ''}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span className={p.breached ? 'text-danger-500 font-medium' : 'text-ink-700'}>
                          {p.promised_date ?? 'no date'}
                        </span>
                        {p.days_left != null && (
                          <span className="block text-[11px] text-ink-400">
                            {p.breached
                              ? `${Math.abs(p.days_left)}d overdue`
                              : p.days_left === 0 ? 'due today' : `${p.days_left}d left`}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right num">{inr(p.quoted_price)}</td>
                      <td className="px-2 py-2 text-ink-700">
                        {p.target_lab_name ?? <span className="text-ink-400">none within range</span>}
                        {p.nearest_km && <span className="block text-[11px] text-ink-400">{Math.round(Number(p.nearest_km))} km</span>}
                      </td>
                      <td className="px-5 py-2">
                        {p.crm_thread_id ? (
                          <Link href={`/crm/${p.crm_thread_id}?provider=${p.crm_provider_id}`}
                                className="text-[12px] text-brand-700 dark:text-brand-400 hover:underline">
                            on a board · {(p.crm_stage ?? '').replace(/_/g, ' ')}
                          </Link>
                        ) : (
                          <span className="text-[12px] text-ink-400">not started</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ---- Lane 2 -------------------------------------------------------- */}
      <Card className="mb-5">
        <CardHeader
          title={`Happening ${day === today ? 'today' : `on ${dayLabel(day)}`}`}
          subtitle="First orders first — a lab that has never done one of these is where the day's attention belongs."
          icon={<CalendarClock className="w-4 h-4" />}
        />
        <CardBody className="pt-0">
          {appointments.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-500">No appointments on this day.</p>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
                    <th className="text-left font-medium px-5 py-2">Time</th>
                    <th className="text-left font-medium px-2 py-2">Order</th>
                    <th className="text-left font-medium px-2 py-2">Lab</th>
                    <th className="text-left font-medium px-2 py-2">Track record</th>
                    <th className="text-left font-medium px-2 py-2">From</th>
                    <th className="text-left font-medium px-5 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((a) => (
                    <tr key={a.order_id}
                        className={`border-b border-ink-100 last:border-0 ${a.is_first_order ? 'bg-warn-50/40' : ''}`}>
                      <td className="px-5 py-2 num whitespace-nowrap">{time(a.appointment_time)}</td>
                      <td className="px-2 py-2">
                        <span className="text-ink-900 num">#{a.order_id}</span>
                        {a.appointment_moves > 0 && (
                          <span className="block text-[11px] text-warn-600">
                            moved {a.appointment_moves}×
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-ink-800 max-w-xs">
                        {a.on_placeholder
                          ? <span className="text-danger-500 font-medium">no lab yet</span>
                          : (a.lab_name ?? '—')}
                        {a.lab_city && <span className="block text-[11px] text-ink-400">{a.lab_city}</span>}
                      </td>
                      <td className="px-2 py-2"><LabTrack row={a} /></td>
                      <td className="px-2 py-2 text-[12px] text-ink-600">
                        {a.request_id ? (
                          <Link href={`/requests/${a.request_id}`} className="hover:text-brand-600">
                            request #{a.request_id}
                            {a.request_pincode && <span className="block text-[11px] text-ink-400 num">{a.request_pincode}</span>}
                          </Link>
                        ) : (
                          <span className="text-ink-400">{a.store_name ?? 'direct'}</span>
                        )}
                      </td>
                      <td className="px-5 py-2">
                        <Status s={a.order_status} />
                        {a.requester_mobile && a.is_first_order && (
                          <a href={`tel:${a.requester_mobile.replace(/[^\d+]/g, '')}`}
                             className="block text-[11px] text-brand-700 dark:text-brand-400 mt-0.5 num">
                            <Phone className="inline w-3 h-3 mr-0.5" />{a.requester_mobile}
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ---- Lane 3 -------------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Moved since we last looked"
          subtitle="Appointments and labs that changed in the last week. A promise that has slipped twice is a different conversation."
          icon={<MoveRight className="w-4 h-4" />}
        />
        <CardBody className="pt-0">
          {moves.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-500">
              Nothing has moved this week.
              <span className="block text-[11px] text-ink-400 mt-1">
                Changes are noticed by comparing each night&rsquo;s snapshot with the last, so this fills
                in from the first night after the desk was installed.
              </span>
            </p>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
                    <th className="text-left font-medium px-5 py-2">Order</th>
                    <th className="text-left font-medium px-2 py-2">Was</th>
                    <th className="text-left font-medium px-2 py-2">Now</th>
                    <th className="text-left font-medium px-2 py-2">Lab</th>
                    <th className="text-left font-medium px-2 py-2">Times</th>
                    <th className="text-left font-medium px-5 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((m) => (
                    <tr key={m.order_id} className="border-b border-ink-100 last:border-0">
                      <td className="px-5 py-2">
                        <span className="num text-ink-900">#{m.order_id}</span>
                        {m.request_id && (
                          <Link href={`/requests/${m.request_id}`}
                                className="block text-[11px] text-brand-700 dark:text-brand-400">
                            request #{m.request_id}
                          </Link>
                        )}
                      </td>
                      <td className="px-2 py-2 text-ink-500 num">
                        {m.prev_appointment_time ? m.prev_appointment_time.slice(0, 10) : '—'}
                      </td>
                      <td className="px-2 py-2 text-ink-900 num">{m.appointment_time.slice(0, 10)}</td>
                      <td className="px-2 py-2 text-ink-700">
                        {m.lab_name ?? '—'}
                        {m.lab_moves > 0 && (
                          <span className="block text-[11px] text-warn-600">lab changed {m.lab_moves}×</span>
                        )}
                      </td>
                      <td className="px-2 py-2 num text-ink-600">
                        {m.appointment_moves > 0 ? m.appointment_moves : <span className="text-ink-300">—</span>}
                      </td>
                      <td className="px-5 py-2"><Status s={m.order_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
