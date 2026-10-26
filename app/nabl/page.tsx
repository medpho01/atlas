import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChipButton } from '@/components/ui/Toggle';
import { InfoTip } from '@/components/ui/InfoTip';
import { EntitySearch } from '@/components/ui/EntitySearch';
import { listNablLabs, getNablFacets, PAGE_SIZE } from '@/lib/nablLabs';

export const dynamic = 'force-dynamic';

const n = (v: number) => v.toLocaleString('en-IN');

export default async function NablPage({
  searchParams,
}: {
  searchParams: {
    q?: string; field?: string; state?: string; city?: string;
    onboarded?: string; page?: string;
  };
}) {
  const gate = await requireView('directory', '/nabl');
  if (gate.blocked) return <RoleBlocked area="NABL labs" detail="network, operations and admin" />;

  const page = Math.max(1, Number(searchParams.page) || 1);
  const [{ rows, total, pages }, facets] = await Promise.all([
    listNablLabs({ ...searchParams, page }),
    getNablFacets(),
  ]);

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q: searchParams.q, field: searchParams.field, state: searchParams.state,
      city: searchParams.city, onboarded: searchParams.onboarded,
      page: undefined, ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return `/nabl${qs ? `?${qs}` : ''}`;
  };

  const pageLink = (toPage: number) => {
    const base = link({});
    const sep = base.includes('?') ? '&' : '?';
    return toPage <= 1 ? base : `${base}${sep}page=${toPage}`;
  };

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="NABL accredited labs"
        subtitle="Every laboratory NABL has accredited, with its contact, discipline and certificate."
        actions={
          <InfoTip
            title="NABL labs"
            shows="The public NABL accreditation directory, loaded into Atlas."
            computed={
              <>
                <b>On our network</b> is a match on pincode plus a close name match against an
                active LabStack lab — a strong hint, not a fact, so check before acting on it.
                An accredited lab is not a provider until somebody onboards it.
              </>
            }
            drives="Nothing automatically. This is reference data for finding and vetting supply; onboarding still happens in Provider onboarding."
          />
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
        <div className="rounded-xl border border-ink-200 bg-surface px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-500">Accredited labs</div>
          <div className="text-[22px] font-extrabold mt-1 num text-ink-900">{n(facets.meta?.total ?? 0)}</div>
          <div className="text-[11px] text-ink-500 mt-0.5">in the directory</div>
        </div>
        <div className="rounded-xl border border-ink-200 bg-surface px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-500">Medical</div>
          <div className="text-[22px] font-extrabold mt-1 num text-ink-900">
            {n(facets.fields.find((f) => f.field === 'Medical')?.n ?? 0)}
          </div>
          <div className="text-[11px] text-ink-500 mt-0.5">the rest are testing and calibration</div>
        </div>
        <div className="rounded-xl border border-success-100 bg-success-50 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-500">Look like ours</div>
          <div className="text-[22px] font-extrabold mt-1 num text-success-700">{n(facets.meta?.matched ?? 0)}</div>
          <div className="text-[11px] text-ink-500 mt-0.5">same pincode, matching name</div>
        </div>
        <div className="rounded-xl border border-ink-200 bg-surface px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-500">Snapshot taken</div>
          <div className="text-[22px] font-extrabold mt-1 num text-ink-900">{facets.meta?.pulled_on ?? '—'}</div>
          <div className="text-[11px] text-ink-500 mt-0.5">re-run the pull to refresh</div>
        </div>
      </div>

      <div className="mt-5 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg
                      border border-ink-200 bg-surface px-4 py-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Field</span>
          <ChipButton href={link({ field: undefined })} active={!searchParams.field}>All</ChipButton>
          {facets.fields.slice(0, 5).map((f) => (
            <ChipButton key={f.field} href={link({ field: f.field })} active={searchParams.field === f.field}>
              {f.field} <span className="text-ink-400">{n(f.n)}</span>
            </ChipButton>
          ))}
        </div>

        <span className="w-px h-5 bg-ink-200" />
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">On our network</span>
          <ChipButton href={link({ onboarded: undefined })} active={!searchParams.onboarded}>All</ChipButton>
          <ChipButton href={link({ onboarded: 'yes' })} active={searchParams.onboarded === 'yes'}>Already on</ChipButton>
          <ChipButton href={link({ onboarded: 'no' })} active={searchParams.onboarded === 'no'}>Not yet</ChipButton>
        </div>

        <div className="ml-auto">
          <EntitySearch basePath="/nabl" initial={searchParams.q}
                        placeholder="Lab, city, pincode, certificate" width="w-[260px]" />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">State</span>
        <ChipButton href={link({ state: undefined })} active={!searchParams.state}>All</ChipButton>
        {facets.states.map((s) => (
          <ChipButton key={s.state} href={link({ state: s.state })} active={searchParams.state === s.state}>
            {s.state} <span className="text-ink-400">{n(s.n)}</span>
          </ChipButton>
        ))}
      </div>

      <div className="rounded-xl border border-ink-200 bg-surface overflow-x-auto">
        <table className="w-full min-w-[1280px] text-[13px]">
          <thead>
            <tr className="border-b border-ink-200">
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-4 py-2.5">Laboratory</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Field · discipline</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Where</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Contact</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Certificate</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-4 py-2.5">On our network</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.nabl_id} className="border-b border-ink-100 last:border-0 align-top hover:bg-ink-50/50">
                <td className="px-4 py-2.5">
                  <div className="font-semibold text-ink-900">{l.cab_name}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5 num">
                    {[l.cab_id, l.certificate_no].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-[12px] text-ink-600 max-w-[280px]">
                  <div className="font-medium text-ink-700">{l.field ?? '—'}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5 line-clamp-2">{l.discipline ?? '—'}</div>
                </td>
                <td className="px-3 py-2.5 text-[12px] text-ink-600 max-w-[240px]">
                  <div>{[l.city, l.state].filter(Boolean).join(', ') || '—'}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5 num">{l.pincode ?? ''}</div>
                </td>
                <td className="px-3 py-2.5 text-[12px] text-ink-600">
                  <div>{l.contact_name ?? '—'}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5 num">{l.phone ?? ''}</div>
                  <div className="text-[11px] text-ink-500 break-all">{l.email ?? ''}</div>
                </td>
                <td className="px-3 py-2.5 text-[12px]">
                  {l.certificate_link ? (
                    <a href={l.certificate_link} target="_blank" rel="noreferrer"
                       className="text-brand-400 font-medium hover:underline">Open certificate</a>
                  ) : (
                    <span className="text-ink-400">no link</span>
                  )}
                  <div className="text-[11px] text-ink-500 mt-0.5 num">{l.validity ?? ''}</div>
                </td>
                <td className="px-4 py-2.5 text-[12px]">
                  {l.onboarded_as ? (
                    <span className="text-success-700 font-medium">{l.onboarded_as}</span>
                  ) : (
                    <span className="text-ink-400">not matched</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-semibold text-ink-900">Nothing matches.</p>
            <p className="text-sm text-ink-500 mt-1">Clear a filter, or search a different name or pincode.</p>
          </div>
        )}
      </div>

      {pages > 1 && (
        <div className="flex items-center gap-3 mt-4">
          <span className="text-[12px] text-ink-500">
            {n((page - 1) * PAGE_SIZE + 1)}–{n(Math.min(page * PAGE_SIZE, total))} of {n(total)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {page > 1 && (
              <Link href={pageLink(page - 1)}
                    className="text-[12px] font-medium rounded-md border border-ink-200 px-3 py-1.5 text-ink-700">
                Previous
              </Link>
            )}
            <span className="text-[12px] text-ink-500">Page {n(page)} of {n(pages)}</span>
            {page < pages && (
              <Link href={pageLink(page + 1)}
                    className="text-[12px] font-medium rounded-md border border-ink-200 px-3 py-1.5 text-ink-700">
                Next
              </Link>
            )}
          </div>
        </div>
      )}

      <p className="text-[11px] text-ink-500 mt-4 max-w-[96ch] leading-relaxed">
        Loaded from the public NABL accreditation directory on {facets.meta?.pulled_on ?? 'the date shown above'}.
        Accreditation status and certificate links are NABL&rsquo;s; a certificate link opens their portal,
        where both the certificate and the scope PDF can be downloaded.
      </p>
    </div>
  );
}
