import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChipButton } from '@/components/ui/Toggle';
import { InfoTip } from '@/components/ui/InfoTip';
import { EntitySearch } from '@/components/ui/EntitySearch';
import { NearPincode } from '@/components/ui/NearPincode';
import {
  listCentres, getChainSummary, getCentreCities, PAGE_SIZE,
  RADIUS_CHOICES, DEFAULT_RADIUS, asPincode,
} from '@/lib/chainCentres';

export const dynamic = 'force-dynamic';

const n = (v: number) => v.toLocaleString('en-IN');

export default async function FranchiseesPage({
  searchParams,
}: {
  searchParams: {
    q?: string; chain?: string; city?: string; state?: string;
    matched?: string; phone?: string; near?: string; radius?: string;
    page?: string;
  };
}) {
  const gate = await requireView('directory', '/franchisees');
  if (gate.blocked) return <RoleBlocked area="Franchisee networks" detail="network, operations and admin" />;

  const page = Math.max(1, Number(searchParams.page) || 1);
  const near = asPincode(searchParams.near);
  const radius = Number(searchParams.radius) || DEFAULT_RADIUS;
  const [{ rows, total, pages }, chains, cities] = await Promise.all([
    listCentres({ ...searchParams, near: near ?? undefined, radius, page }),
    getChainSummary(),
    getCentreCities(searchParams.chain),
  ]);

  const totals = chains.reduce(
    (a, c) => ({
      centres: a.centres + c.centres,
      matched: a.matched + c.matched,
      cities: Math.max(a.cities, c.cities),
    }),
    { centres: 0, matched: 0, cities: 0 },
  );

  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q: searchParams.q, chain: searchParams.chain, city: searchParams.city,
      state: searchParams.state, matched: searchParams.matched,
      phone: searchParams.phone, near: searchParams.near,
      radius: searchParams.radius, page: undefined, ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return `/franchisees${qs ? `?${qs}` : ''}`;
  };

  const pageLink = (toPage: number) => {
    const base = link({});
    const sep = base.includes('?') ? '&' : '?';
    return toPage <= 1 ? base : `${base}${sep}page=${toPage}`;
  };

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto">
      <PageHeader
        title="Franchisee networks"
        subtitle="The collection centres the national diagnostic chains publish, with address, contact and hours."
        actions={
          <InfoTip
            title="Franchisee networks"
            shows="One row per centre per chain, loaded from each chain's own site."
            computed={
              <>
                <b>On our network</b> is a match on pincode plus a close name match against an
                active LabStack lab — a hint to check, not a fact. <b>Shared phone</b> marks a
                number used by more than one centre of the same chain, usually one franchisee
                running several branches.
              </>
            }
            drives="Nothing automatically. This is competitive and sourcing reference: who covers which pincode, and who to call."
          />
        }
      />

      {/* Totals plus one card per chain — five across, so a fourth chain
          doesn't silently drop off the end of the strip. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-5">
        <div className="rounded-xl border border-ink-200 bg-surface px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-500">Centres</div>
          <div className="text-[22px] font-extrabold mt-1 num text-ink-900">{n(totals.centres)}</div>
          <div className="text-[11px] text-ink-500 mt-0.5">across {chains.length} chain{chains.length === 1 ? '' : 's'}</div>
        </div>
        {chains.slice(0, 4).map((c) => (
          <div key={c.chain} className="rounded-xl border border-ink-200 bg-surface px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-ink-500">{c.chain}</div>
            <div className="text-[22px] font-extrabold mt-1 num text-ink-900">{n(c.centres)}</div>
            <div className="text-[11px] text-ink-500 mt-0.5">
              {n(c.cities)} cities · pulled {c.pulled_on}
            </div>
          </div>
        ))}
      </div>

      {chains.length > 0 && (
        <div className="mt-4 rounded-xl border border-ink-200 bg-surface overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-ink-200">
                <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-4 py-2.5">Chain</th>
                <th className="text-right text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Centres</th>
                <th className="text-right text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Cities</th>
                <th className="text-right text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">On our network</th>
                <th className="text-right text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Shared phones</th>
                <th className="text-right text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">With email</th>
                <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-4 py-2.5">Snapshot</th>
              </tr>
            </thead>
            <tbody>
              {chains.map((c) => (
                <tr key={c.chain} className="border-b border-ink-100 last:border-0 hover:bg-ink-50/50">
                  <td className="px-4 py-2.5">
                    <Link href={link({ chain: c.chain })} className="font-semibold text-ink-900 hover:text-brand-400">
                      {c.chain}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-right num font-semibold">{n(c.centres)}</td>
                  <td className="px-3 py-2.5 text-right num">{n(c.cities)}</td>
                  <td className="px-3 py-2.5 text-right num">{n(c.matched)}</td>
                  <td className="px-3 py-2.5 text-right num text-ink-600">{n(c.shared_phones)}</td>
                  <td className="px-3 py-2.5 text-right num text-ink-600">{n(c.emails)}</td>
                  <td className="px-4 py-2.5 text-[12px] text-ink-500 num">{c.pulled_on}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg
                      border border-ink-200 bg-surface px-4 py-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Chain</span>
          <ChipButton href={link({ chain: undefined, city: undefined })} active={!searchParams.chain}>All</ChipButton>
          {chains.map((c) => (
            <ChipButton key={c.chain} href={link({ chain: c.chain, city: undefined })}
                        active={searchParams.chain === c.chain}>
              {c.chain} <span className="text-ink-400">{n(c.centres)}</span>
            </ChipButton>
          ))}
        </div>

        <span className="w-px h-5 bg-ink-200" />
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">On our network</span>
          <ChipButton href={link({ matched: undefined })} active={!searchParams.matched}>All</ChipButton>
          <ChipButton href={link({ matched: 'yes' })} active={searchParams.matched === 'yes'}>Already on</ChipButton>
          <ChipButton href={link({ matched: 'no' })} active={searchParams.matched === 'no'}>Not yet</ChipButton>
        </div>

        <span className="w-px h-5 bg-ink-200" />
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">Phone</span>
          <ChipButton href={link({ phone: undefined })} active={!searchParams.phone}>All</ChipButton>
          <ChipButton href={link({ phone: 'shared' })} active={searchParams.phone === 'shared'}>Shared</ChipButton>
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          <EntitySearch basePath="/franchisees" initial={searchParams.q}
                        placeholder="Centre, address, city, pincode, phone" width="w-[280px]" />
          <NearPincode basePath="/franchisees" initial={near ?? undefined}
                       radius={radius} choices={RADIUS_CHOICES}
                       defaultRadius={DEFAULT_RADIUS} />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-ink-400 mr-0.5">City</span>
        <ChipButton href={link({ city: undefined })} active={!searchParams.city}>All</ChipButton>
        {cities.map((c) => (
          <ChipButton key={c.city_key} href={link({ city: c.city_key })} active={searchParams.city === c.city_key}>
            {c.city} <span className="text-ink-400">{n(c.n)}</span>
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
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Chain</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Address</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Contact</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-3 py-2.5">Hours</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-ink-500 font-semibold px-4 py-2.5">On our network</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={`${c.chain}-${c.external_id}`} className="border-b border-ink-100 last:border-0 align-top hover:bg-ink-50/50">
                {near && (
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <div className="num font-semibold text-ink-900">
                      {c.km === null ? '—' : `${c.km} km`}
                    </div>
                    {c.geo_source === 'pincode' && (
                      <div className="text-[10px] text-ink-400 mt-0.5">approx.</div>
                    )}
                  </td>
                )}
                <td className="px-4 py-2.5">
                  <div className="font-semibold text-ink-900">{c.name}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5">
                    {[c.city, c.pincode].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-[12px] text-ink-600">{c.chain}</td>
                <td className="px-3 py-2.5 text-[12px] text-ink-600 max-w-[340px]">
                  <div className="line-clamp-2">{c.address ?? '—'}</div>
                  {c.map_link && (
                    <a href={c.map_link} target="_blank" rel="noreferrer"
                       className="text-[11px] text-brand-400 hover:underline">Open map</a>
                  )}
                </td>
                <td className="px-3 py-2.5 text-[12px]">
                  <div className="num text-ink-700">{c.phone ?? '—'}</div>
                  {c.phone_shared > 1 && (
                    <div className="text-[10px] text-warn-600 mt-0.5">
                      shared by {c.phone_shared} centres
                    </div>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`}
                       className="block text-[11px] text-brand-400 hover:underline mt-0.5 break-all">
                      {c.email}
                    </a>
                  )}
                </td>
                <td className="px-3 py-2.5 text-[12px] text-ink-600 max-w-[180px]">
                  <div className="line-clamp-2">{c.open_hours ?? '—'}</div>
                </td>
                <td className="px-4 py-2.5 text-[12px]">
                  {c.matched_lab_name ? (
                    <span className="text-success-700 font-medium">{c.matched_lab_name}</span>
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
            <p className="text-sm text-ink-500 mt-1">Clear a filter, or search a different name, city or pincode.</p>
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
        Each chain is a snapshot of what that chain publishes, refreshed independently — the
        snapshot date is in the table above. A centre listed here is one the chain says it has;
        it is not a LabStack provider until somebody onboards it.
      </p>
    </div>
  );
}
