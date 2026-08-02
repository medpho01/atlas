import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft, Briefcase, TrendingUp, TrendingDown, Beaker, Pill, Stethoscope,
  MessageSquare, MapPin, Sparkles, AlertTriangle,
} from 'lucide-react';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import {
  getAccount, getAccountStreams, getAccountMonthly, getAccountServiceMix,
  getAccountRequestFunnel, getAccountPartners, getAccountGeography, getAccountUpsell,
  STREAM_LABEL, SERVICE_LABEL, type Stream,
} from '@/lib/accountQueries';

export const dynamic = 'force-dynamic';

const STREAM_ICON: Record<Stream, React.ReactNode> = {
  LAB_ORDER: <Beaker className="w-3.5 h-3.5" />,
  PHARMA_ORDER: <Pill className="w-3.5 h-3.5" />,
  APPOINTMENT: <Stethoscope className="w-3.5 h-3.5" />,
  REQUEST: <MessageSquare className="w-3.5 h-3.5" />,
};

/** Request outcomes, grouped so the funnel reads as a story rather than a list. */
const REQUEST_OUTCOME: Record<string, { label: string; tone: 'good' | 'bad' | 'warn' | 'mute' }> = {
  ORDERED:         { label: 'Converted to order', tone: 'good' },
  CONSENTED:       { label: 'Consented',          tone: 'good' },
  QUOTED:          { label: 'Quoted',             tone: 'warn' },
  OPEN:            { label: 'Open',               tone: 'warn' },
  DISCHARGED:      { label: 'Discharged',         tone: 'mute' },
  UNREACHABLE:     { label: 'Unreachable',        tone: 'bad' },
  WRONG_NUMBER:    { label: 'Wrong number',       tone: 'bad' },
  CANCELLED:       { label: 'Cancelled',          tone: 'bad' },
  DENIED:          { label: 'Denied',             tone: 'bad' },
  NON_SERVICEABLE: { label: 'Not serviceable',    tone: 'bad' },
};

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const storeId = parseInt(id, 10);
  if (!Number.isInteger(storeId)) notFound();

  const gate = await requireView('accountHealth', `/accounts/${storeId}`);
  if (gate.blocked) return <RoleBlocked area="Accounts" detail="the accounts, network and admin teams" />;

  const account = await getAccount(storeId);
  if (!account) notFound();

  const [streams, monthly, mix, funnel, partners, geo, upsell] = await Promise.all([
    getAccountStreams(storeId),
    getAccountMonthly(storeId),
    getAccountServiceMix(storeId),
    getAccountRequestFunnel(storeId),
    getAccountPartners(storeId),
    getAccountGeography(storeId),
    getAccountUpsell(storeId),
  ]);

  const total = streams.reduce((s, x) => s + x.events, 0);
  const l30 = streams.reduce((s, x) => s + x.events_l30d, 0);
  const prior = streams.reduce((s, x) => s + x.events_l30d_prior, 0);
  const growth = prior > 0 ? Math.round((100 * (l30 - prior)) / prior) : null;

  const requests = funnel.reduce((s, r) => s + r.events, 0);
  const converted = funnel.filter((r) => r.status === 'ORDERED' || r.status === 'CONSENTED')
                          .reduce((s, r) => s + r.events, 0);
  const lost = funnel.filter((r) => REQUEST_OUTCOME[r.status]?.tone === 'bad')
                     .reduce((s, r) => s + r.events, 0);
  const convRate = requests > 0 ? Math.round((100 * converted) / requests) : null;

  // Monthly totals across streams, for the sparkline-ish bar row.
  const byMonth = new Map<string, number>();
  for (const m of monthly) byMonth.set(m.month, (byMonth.get(m.month) ?? 0) + m.events);
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
  const peak = Math.max(1, ...months.map(([, v]) => v));

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1500px] mx-auto">
      <Link href="/accounts" className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900 transition mb-3">
        <ArrowLeft className="w-4 h-4" /> All accounts
      </Link>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
        <Briefcase className="w-5 h-5 text-brand-600 self-center" />
        <h1 className="text-2xl font-bold text-ink-900">{account.store_name}</h1>
        {!account.active && (
          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-ink-100 text-ink-600 border border-ink-200">Inactive</span>
        )}
        {account.city && <span className="text-sm text-ink-500">{account.city}{account.state ? `, ${account.state}` : ''}</span>}
      </div>
      <p className="text-sm text-ink-600 mb-6">
        Every stream this account puts through the platform — lab orders, pharmacy, appointments and enquiries.
      </p>

      {/* Headline */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        <Tile label="All activity" value={total.toLocaleString('en-IN')} sub="every stream, all time" />
        <Tile label="Last month" value={l30.toLocaleString('en-IN')}
              sub={growth === null ? 'no prior month' : `${growth >= 0 ? '+' : ''}${growth}% vs prior`}
              tone={growth === null ? undefined : growth >= 0 ? 'good' : 'bad'}
              icon={growth === null ? undefined : growth >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />} />
        <Tile label="Streams used" value={`${streams.filter((s) => s.events > 0).length} of 4`}
              sub={streams.filter((s) => s.events > 0).map((s) => STREAM_LABEL[s.stream]).join(', ') || '—'} />
        <Tile label="Enquiries" value={requests.toLocaleString('en-IN')}
              sub={convRate === null ? 'none recorded' : `${convRate}% became orders`}
              tone={convRate !== null && convRate < 30 ? 'warn' : undefined} />
        <Tile label="Lost enquiries" value={lost.toLocaleString('en-IN')}
              sub="unreachable, cancelled or denied" tone={lost > 0 ? 'bad' : undefined} />
      </div>

      {/* Streams */}
      <Card title="Activity by stream" hint="fulfilled / cancelled shown against each">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4">
          {(['LAB_ORDER', 'PHARMA_ORDER', 'APPOINTMENT', 'REQUEST'] as Stream[]).map((key) => {
            const s = streams.find((x) => x.stream === key);
            const n = s?.events ?? 0;
            return (
              <div key={key} className={`rounded-xl border p-3 ${n > 0 ? 'border-ink-200 bg-surface' : 'border-dashed border-ink-200 bg-ink-50/50'}`}>
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-ink-500 mb-1">
                  {STREAM_ICON[key]} {STREAM_LABEL[key]}
                </div>
                <div className={`text-2xl font-bold tabular-nums ${n > 0 ? 'text-ink-900' : 'text-ink-400'}`}>
                  {n.toLocaleString('en-IN')}
                </div>
                {n > 0 ? (
                  <div className="text-[11px] text-ink-500 mt-0.5 tabular-nums">
                    <span className="text-success-600 font-semibold">{s!.fulfilled.toLocaleString('en-IN')}</span> fulfilled ·{' '}
                    <span className="text-danger-500 font-semibold">{s!.canceled.toLocaleString('en-IN')}</span> cancelled
                  </div>
                ) : (
                  <div className="text-[11px] text-ink-400 mt-0.5">
                    {key === 'APPOINTMENT' ? 'not attributable — see note' : 'never used'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {!streams.some((s) => s.stream === 'APPOINTMENT' && s.events > 0) && (
          <div className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-warn-100 bg-warn-50 px-3 py-2 text-[11.5px] text-warn-600">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Appointments carry no store reference in the source. The only route is
              <code className="mx-1 font-mono">Appointment.order_id → Order.storeId</code>, which is unpopulated —
              so this reads zero for every account. It is not evidence that no appointments happened.
            </span>
          </div>
        )}
      </Card>

      {/* Trend */}
      {months.length > 1 && (
        <Card title="Monthly activity" hint={`${months.length} months, all streams`}>
          <div className="p-4">
            <div className="flex items-end gap-1 h-28">
              {months.map(([m, v]) => (
                <div key={m} className="flex-1 flex flex-col justify-end items-center group" title={`${m}: ${v.toLocaleString('en-IN')}`}>
                  <div className="w-full rounded-t bg-brand-500/70 group-hover:bg-brand-500 transition-colors"
                       style={{ height: `${Math.max(2, (v / peak) * 100)}%` }} />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-ink-500 mt-1.5 tabular-nums">
              <span>{months[0][0].slice(0, 7)}</span>
              <span>peak {peak.toLocaleString('en-IN')}</span>
              <span>{months[months.length - 1][0].slice(0, 7)}</span>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Request funnel */}
        {funnel.length > 0 && (
          <Card title="Enquiry outcomes" hint={`${requests.toLocaleString('en-IN')} requests`}>
            <table className="w-full text-sm">
              <tbody>
                {funnel.map((r) => {
                  const meta = REQUEST_OUTCOME[r.status] ?? { label: r.status, tone: 'mute' as const };
                  const pct = requests > 0 ? Math.round((100 * r.events) / requests) : 0;
                  return (
                    <tr key={r.status} className="border-b border-ink-100 last:border-0">
                      <td className="px-4 py-2 text-[13px] text-ink-800">{meta.label}</td>
                      <td className="px-2 py-2 w-1/2">
                        <div className="h-1.5 rounded bg-ink-100 overflow-hidden">
                          <div className={`h-full ${
                            meta.tone === 'good' ? 'bg-success-500' : meta.tone === 'bad' ? 'bg-danger-500'
                            : meta.tone === 'warn' ? 'bg-warn-500' : 'bg-ink-300'}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-[13px] font-semibold text-ink-900">
                        {r.events.toLocaleString('en-IN')}
                        <span className="text-ink-500 font-normal text-[11px] ml-1">{pct}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        {/* Service mix */}
        <Card title="What they order" hint="by service line">
          {mix.length === 0 ? <Empty>No activity recorded.</Empty> : (
            <table className="w-full text-sm">
              <tbody>
                {mix.filter((m) => m.stream !== 'REQUEST').map((m) => (
                  <tr key={`${m.stream}:${m.service_line}`} className="border-b border-ink-100 last:border-0">
                    <td className="px-4 py-2 text-[13px] text-ink-800">
                      {SERVICE_LABEL[m.service_line] ?? m.service_line}
                      <div className="text-[10px] text-ink-500">{STREAM_LABEL[m.stream]}</div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-[13px] font-semibold text-ink-900">
                      {m.events.toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-[11px] text-ink-500">
                      {m.events > 0 ? `${Math.round((100 * m.fulfilled) / m.events)}% done` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Partners */}
        <Card title="Who fulfils their work" hint="labs by order volume">
          {partners.length === 0 ? <Empty>No fulfilment recorded.</Empty> : (
            <table className="w-full text-sm">
              <tbody>
                {partners.map((p) => (
                  <tr key={p.name} className="border-b border-ink-100 last:border-0">
                    <td className="px-4 py-2 text-[13px] text-ink-800">{p.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-[13px] font-semibold text-ink-900">
                      {p.events.toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Geography */}
        <Card title="Where their demand is" hint="top pincodes"
              action={geo.length > 0 ? <Link href="/pincodes?tab=serviceability" className="text-[11px] text-brand-700 dark:text-brand-400 hover:underline">Check serviceability →</Link> : undefined}>
          {geo.length === 0 ? <Empty>No geography recorded.</Empty> : (
            <table className="w-full text-sm">
              <tbody>
                {geo.map((g) => (
                  <tr key={g.pincode} className="border-b border-ink-100 last:border-0">
                    <td className="px-4 py-2 text-[13px] tabular-nums text-ink-900 font-semibold">
                      <Link href={`/pincode/${g.pincode}`} className="hover:text-brand-700 dark:hover:text-brand-400">
                        {g.pincode}
                      </Link>
                      {g.city && <span className="text-ink-500 font-normal ml-2 text-[12px]">{g.city}</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-[13px] text-ink-800">
                      {g.events.toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Upsell */}
      {upsell.length > 0 && (
        <Card title="Not yet selling" hint="service lines this account has never ordered, ranked by adoption elsewhere">
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {upsell.map((u) => (
              <div key={u.service_line} className="rounded-xl border border-brand-100 dark:border-brand-500/30 bg-brand-50/60 dark:bg-brand-500/10 p-3">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
                  <Sparkles className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
                  {SERVICE_LABEL[u.service_line] ?? u.service_line}
                </div>
                <div className="text-[11px] text-ink-600 mt-1 tabular-nums">
                  {u.accounts_using} other account{u.accounts_using === 1 ? '' : 's'} ·{' '}
                  {u.total_events.toLocaleString('en-IN')} orders
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone, icon }: {
  label: string; value: string; sub?: string;
  tone?: 'good' | 'bad' | 'warn'; icon?: React.ReactNode;
}) {
  const colour = tone === 'good' ? 'text-success-600' : tone === 'bad' ? 'text-danger-500'
               : tone === 'warn' ? 'text-warn-600' : 'text-ink-900';
  return (
    <div className="rounded-xl border border-ink-200 bg-surface p-3.5">
      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums leading-tight ${colour}`}>{value}</div>
      {sub && (
        <div className={`text-[11px] mt-0.5 flex items-center gap-1 ${tone ? colour : 'text-ink-500'}`}>
          {icon}{sub}
        </div>
      )}
    </div>
  );
}

function Card({ title, hint, action, children }: {
  title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-surface overflow-hidden mb-4">
      <div className="px-4 py-2.5 border-b border-ink-200 flex items-center gap-2">
        <b className="text-[13px] text-ink-900">{title}</b>
        {hint && <span className="text-[11px] text-ink-500">{hint}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-8 text-center text-[12px] text-ink-500">{children}</div>;
}
