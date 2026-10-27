import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChipButton } from '@/components/ui/Toggle';
import { InfoTip } from '@/components/ui/InfoTip';
import { EntitySearch } from '@/components/ui/EntitySearch';
import { NearPincode } from '@/components/ui/NearPincode';
import { listNablLabs, getNablFacets, PAGE_SIZE,
  RADIUS_CHOICES, DEFAULT_RADIUS, asPincode,
} from '@/lib/nablLabs';

export const dynamic = 'force-dynamic';

const n = (v: number) => v.toLocaleString('en-IN');

export default async function NablPage({
  searchParams,
}: {
  searchParams: {
    q?: string; discipline?: string; state?: string; city?: string;
    onboarded?: string; near?: string; radius?: string; page?: string;
  };
}) {
  const gate = await requireView('directory', '/nabl');
  if (gate.blocked) return <RoleBlocked area="NABL labs" detail="network, operations and admin" />;

  const page = Math.max(1, Number(searchParams.page) || 1);
  const near = asPincode(searchParams.near);
  const radius = Number(searchParams.radius) || DEFAULT_RADIUS;
  const [{ rows, total, pages }, facets] = await Promise.all([
    listNablLabs({ ...searchParams, near: near ?? undefined, radius, page }),
    getNablFacets(),
  ]);

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q: searchParams.q, discipline: searchParams.discipline, state: searchParams.state,
      city: searchParams.city, onboarded: searchParams.onboarded,
      near: searchParams.near, radius: searchParams.radius,
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
        title="NABL diagnostic centres"
        subtitle="Every pathology and imaging centre NABL has accredited, with its contact, discipline and certificate."
        actions={
          <InfoTip
            title="NABL diagnostic centres"
            shows="The medical field of the NABL accreditation register: pathology and imaging only."
            computed={
              <>
                NABL also accredits 8,502 industrial labs — fertiliser chemistry, electrical
                calibration, corrugated box testing. None of that is supply, so this screen never
                shows it. <b>On our network</b> is a match on pincode plus a close name match
                against an active LabStack lab: a strong hint, not a fact.
              </>
            }
            drives="Nothing automatically. This is reference data for finding and vetting supply; onboarding still happens in Provider onboarding."
          />
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
        <div className="rounded-xl border border-ink-200 bg-surface px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-500">Diagnostic centres</div>
          <div className="text-[22px] font-extrabold mt-1 num text-ink-900">{n(facets.meta?.total ?? 0)}</div>
          <div className="text-[11px] text-ink-500 mt-0.5">pathology and imaging, accredited</div>
        </div>
        <div className="rounded-xl border border-ink-200 bg-surface px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-500">Imaging centres</div>
          <div className="text-[22px] font-extrabold mt-1 num text-ink-900">{n(facets.meta?.imaging ?? 0)}</div>
          <div className="text-[11px] text-ink-500 mt-0.5">CT, MRI, ultrasound, radiography</div>
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

      <div className="mt-5 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg
                      border border-ink-200 bg-surface px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">On our network</span>
          <ChipButton href={link({ onboarded: undefined })} active={!searchParams.onboarded}>All</ChipButton>
          <ChipButton href={link({ onboarded: 'yes' })} active={searchParams.onboarded === 'yes'}>Already on</ChipButton>
          <ChipButton href={link({ onboarded: 'no' })} active={searchParams.onboarded === 'no'}>Not yet</ChipButton>
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          <EntitySearch basePath="/nabl" initial={searchParams.q}
                        placeholder="Centre, city, pincode, certificate" width="w-[260px]" />
          <NearPincode basePath="/nabl" initial={near ?? undefined}
                       radius={radius} choices={RADIUS_CHOICES}
                       defaultRadius={DEFAULT_RADIUS} />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Discipline</span>
        <ChipButton href={link({ discipline: undefined })} active={!searchParams.discipline}>All</ChipButton>
        {facets.disciplines.map((d) => (
          <ChipButton key={d.discipline} href={link({ discipline: d.discipline })}
                      active={searchParams.discipline === d.discipline}>
            {d.discipline} <span className="text-ink-400">{n(d.n)}</span>
          </ChipButton>
        ))}
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
        <table className="w-full min-w-[1240px] text-[13px]">
          <thead>
            <tr className="border-b border-ink-200">
              {near && (
                <th className="text-right text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Distance</th>
              )}
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-4 py-2.5">Centre</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Discipline</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Where</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Contact</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Certificate</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-4 py-2.5">On our network</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.nabl_id} className="border-b border-ink-100 last:border-0 align-top hover:bg-ink-50/50">
                {near && (
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <div className="num font-semibold text-ink-900">
                      {l.km === null ? '—' : `${l.km} km`}
                    </div>
                    {l.geo_source === 'pincode' && (
                      <div className="text-[10px] text-ink-400 mt-0.5">approx.</div>
                    )}
                  </td>
                )}
                <td className="px-4 py-2.5">
                  <div className="font-semibold text-ink-900">{l.cab_name}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5 num">
                    {[l.cab_id, l.certificate_no].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-[12px] text-ink-600 max-w-[300px]">
                  <div className="line-clamp-3">{l.discipline ?? '—'}</div>
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
        The medical field of the NABL accreditation register, loaded on{' '}
        {facets.meta?.pulled_on ?? 'the date shown above'}. Industrial testing and calibration labs
        are excluded. A certificate link opens NABL&rsquo;s portal, where both the certificate and
        the scope PDF can be downloaded.
      </p>
    </div>
  );
}
