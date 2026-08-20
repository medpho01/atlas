import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Clock } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { InfoTip } from '@/components/ui/InfoTip';
import { getCommitments, getCommitmentStats, getPincodeDemand } from '@/lib/requestQueries';
import { STATE_SHORT, STATE_TONE, TONE_CHIP, type RequestState } from '@/lib/requests';

export const dynamic = 'force-dynamic';

const inr = (v: string | null) =>
  v == null ? '—' : '₹' + Math.round(Number(v)).toLocaleString('en-IN');

export default async function CommitmentsPage() {
  const gate = await requireView('commitments', '/commitments');
  if (gate.blocked) return <RoleBlocked area="Network bucket" detail="network and admin" />;

  const [rows, stats, demand] = await Promise.all([
    getCommitments(), getCommitmentStats(), getPincodeDemand(25),
  ]);

  const keptPct = stats && stats.allocated > 0
    ? Math.round((stats.kept / stats.allocated) * 100) : null;

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Network bucket"
        subtitle="Promises made before we had the supply. Most urgent first."
        actions={
          <InfoTip
            title="Network bucket"
            shows="Every open commitment — a booked order sitting on the placeholder lab, waiting for a real one."
            computed={
              <>
                A commitment opens when an order is booked against the placeholder lab and
                closes when that order moves onto a real lab. Neither event is reported by
                anyone: LabStack records no allocation timestamp, so Atlas detects the change
                and closes the row itself.
              </>
            }
            drives={
              <>
                Work the top of the list. Negotiate the ask with the target lab, onboard it in
                the console, then move the order off the placeholder — that move is what closes
                this row and writes the CRM record. Promise-kept rate is measured from this
                ledger, not from anyone&apos;s report.
              </>
            }
          />
        }
      />

      <Card className="my-4">
        <CardBody>
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div>
              <div className="text-2xl font-bold text-ink-900 num">{stats?.open ?? 0}</div>
              <div className="text-[11px] text-ink-500 mt-0.5">Open commitments</div>
            </div>
            <div>
              <div className={`text-2xl font-bold num ${stats?.breached ? 'text-danger-500' : 'text-ink-400'}`}>
                {stats?.breached ?? 0}
              </div>
              <div className="text-[11px] text-ink-500 mt-0.5">Past the promised date</div>
            </div>
            <div>
              <div className="text-2xl font-bold num text-warn-600">{stats?.due_3d ?? 0}</div>
              <div className="text-[11px] text-ink-500 mt-0.5">Due within 3 days</div>
            </div>
            <div>
              <div className="text-2xl font-bold num text-ink-700">
                {keptPct == null ? '—' : `${keptPct}%`}
              </div>
              <div className="text-[11px] text-ink-500 mt-0.5">
                Promise kept{stats?.allocated ? ` · ${stats.allocated} allocated` : ' · no history yet'}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title={`${rows.length} open`}
          subtitle="Breaching first, then by days remaining."
          icon={<Clock className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5">
            {rows.length === 0 ? (
              <p className="px-5 py-10 text-sm text-ink-500 text-center">
                No open commitments. A row appears here the moment an order is booked against
                the placeholder lab.
              </p>
            ) : (
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
                    <th className="text-left font-medium px-5 py-2">Request</th>
                    <th className="text-left font-medium px-2 py-2">Where</th>
                    <th className="text-left font-medium px-2 py-2">Promised</th>
                    <th className="text-right font-medium px-2 py-2">Days left</th>
                    <th className="text-right font-medium px-2 py-2">Quoted</th>
                    <th className="text-left font-medium px-2 py-2">Target</th>
                    <th className="text-left font-medium px-5 py-2">Ask</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const tone = STATE_TONE[c.state] ?? 'ink';
                    return (
                      <tr key={c.commitment_id}
                          className={`border-b border-ink-100 last:border-0 ${c.breached ? 'bg-danger-50/40' : ''}`}>
                        <td className="px-5 py-2.5">
                          <Link href={`/requests/${c.request_id}`} className="text-brand-600 hover:underline font-medium">
                            #{c.request_id}
                          </Link>
                          <span className={`block mt-0.5 w-fit rounded border px-1 text-[10px] ${TONE_CHIP[tone]}`}>
                            {STATE_SHORT[c.state] ?? c.state}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-ink-700">
                          {c.city}
                          <span className="block text-[10px] text-ink-400">{c.pincode}</span>
                        </td>
                        <td className="px-2 py-2.5 text-ink-700 whitespace-nowrap">
                          {c.promised_date
                            ? new Date(c.promised_date).toLocaleDateString('en-IN',
                                { weekday: 'short', day: 'numeric', month: 'short' })
                            : '—'}
                        </td>
                        <td className={`px-2 py-2.5 text-right font-semibold num
                          ${c.breached ? 'text-danger-500' : (c.days_left ?? 99) <= 2 ? 'text-warn-600' : 'text-ink-700'}`}>
                          {c.days_left == null ? '—' : c.breached ? `${Math.abs(c.days_left)} over` : c.days_left}
                        </td>
                        <td className="px-2 py-2.5 text-right num text-ink-700">{inr(c.quoted_price)}</td>
                        <td className="px-2 py-2.5 text-ink-700">
                          {c.target_lab_name ?? <span className="text-ink-400">none yet</span>}
                          {c.web_leads > 0 && (
                            <span className="block text-[10px] text-warn-600">
                              {c.web_leads} unverified web lead{c.web_leads === 1 ? '' : 's'}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-2.5 text-xs text-ink-700">{c.ask}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Pincodes by unmet demand"
          subtitle="Several commitments in one pincode is one negotiation, not several — this is the argument to take into it."
        />
        <CardBody className="pt-0">
          <div className="-mx-5">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
                  <th className="text-left font-medium px-5 py-2">Pincode</th>
                  <th className="text-left font-medium px-2 py-2">City</th>
                  <th className="text-right font-medium px-2 py-2">Unserved requests</th>
                  <th className="text-right font-medium px-2 py-2">Open promises</th>
                  <th className="text-right font-medium px-2 py-2">Nearest lab</th>
                  <th className="text-right font-medium px-5 py-2">Web leads</th>
                </tr>
              </thead>
              <tbody>
                {demand.map((d) => (
                  <tr key={d.pincode} className="border-b border-ink-100 last:border-0">
                    <td className="px-5 py-2">
                      <Link href={`/pincode/${d.pincode}`} className="text-brand-600 hover:underline num">
                        {d.pincode}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-ink-700">{d.city}</td>
                    <td className="px-2 py-2 text-right num font-semibold text-ink-900">{d.requests}</td>
                    <td className="px-2 py-2 text-right num text-ink-700">{d.open_commitments || '—'}</td>
                    <td className="px-2 py-2 text-right num text-ink-600">
                      {d.nearest_km ? `${d.nearest_km} km` : '—'}
                    </td>
                    <td className="px-5 py-2 text-right num text-ink-600">{d.web_leads || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
