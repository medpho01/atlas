import { Phone, Globe, Clock, MapPin, Home, Star, BadgeCheck } from 'lucide-react';
import { LeadActions } from './LeadActions';
import { TONE_CHIP } from '@/lib/requests';
import type { Ranked } from '@/lib/labDiscovery';
import type { LeadRow } from '@/lib/discoverLabs';

/**
 * One web lead, with the reason it is where it is in the list.
 *
 * The rank and the score are there to answer one question — who do I phone
 * first — which a flat list ordered by `confidence` could not. They are
 * emphatically NOT a verdict on whether the lab is real: every row here is an
 * unverified third-party search result, the `unverified` chip stays, and
 * LeadActions is unchanged. Rank 1 means "start here", never "this one is
 * safe".
 *
 * The breakdown is a `title` attribute rather than a popover on purpose. It
 * has to work in a server component, it has to be copy-pasteable into a
 * thread, and a rank nobody can audit is a rank nobody trusts.
 */
export function DiscoveredLead({ lead }: { lead: Ranked<LeadRow> }) {
  const { score } = lead;
  const breakdown = [
    ...score.components.map((c) => `${c.label}: ${c.points}/${c.max} — ${c.detail}`),
    // Without this line the components would not add up to the number on the
    // chip, and an unexplained total is the thing this card exists to avoid.
    ...(score.discount
      ? [`then ×${score.discount.factor}: ${score.discount.why}`]
      : []),
  ].join('\n');

  return (
    <li className="py-2.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[11px] text-ink-400 num tabular-nums w-4 shrink-0">
          {lead.rank}
        </span>
        <span className="font-medium text-ink-900">{lead.name}</span>

        {/* Band and number together: the band so it means something at a
            glance, the number so two leads can be compared. */}
        <span
          title={`${score.total} of 100\n\n${breakdown}`}
          className={`text-[10px] rounded border px-1 cursor-help ${TONE_CHIP[score.band.tone]}`}
        >
          {score.band.label} · {score.total}
        </span>

        <span className="text-[10px] uppercase tracking-wide text-warn-600
                         border border-warn-100 bg-warn-50 rounded px-1">
          unverified
        </span>

        {lead.chain && <span className="text-[10px] text-ink-400">{lead.chain}</span>}

        <span className="ml-auto">
          <LeadActions leadId={lead.id} promoted={!!lead.crm_provider_id} />
        </span>
      </div>

      {/* The facts the rank was computed from, so the rank can be checked
          against them without opening the breakdown. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-[11px] text-ink-600">
        {lead.disciplines?.map((d) => (
          <span key={d} className="rounded border border-ink-200 bg-ink-100 px-1">
            {DISCIPLINE_BADGE[d] ?? d.toLowerCase().replace(/_/g, ' ')}
          </span>
        ))}
        {/* Only what the listing positively said is absent. A discipline the
            page simply never mentioned is not shown here — that distinction is
            the whole reason the search reports the two separately. */}
        {lead.disciplines_absent?.map((d) => (
          <span key={`no-${d}`} className="rounded border border-ink-200 px-1 text-ink-400 line-through">
            {DISCIPLINE_BADGE[d] ?? d.toLowerCase().replace(/_/g, ' ')}
          </span>
        ))}
        {lead.accreditation?.map((a) => (
          <span key={a} className="inline-flex items-center gap-0.5 rounded border
                                   border-success-100 bg-success-50 text-success-600 px-1">
            <BadgeCheck className="w-3 h-3" /> {a}
          </span>
        ))}
        {lead.rating != null && (lead.rating_count ?? 0) > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <Star className="w-3 h-3" />
            <span className="num">{lead.rating}</span>
            <span className="text-ink-400 num">({lead.rating_count})</span>
          </span>
        )}
        {lead.home_collection === true && (
          <span className="inline-flex items-center gap-0.5"><Home className="w-3 h-3" /> home collection</span>
        )}
        {lead.in_pincode === true && (
          <span className="inline-flex items-center gap-0.5"><MapPin className="w-3 h-3" /> in pincode</span>
        )}
        {lead.in_pincode === false && (
          <span className="inline-flex items-center gap-0.5 text-ink-500">
            <MapPin className="w-3 h-3" />
            {lead.distance_km != null ? `${lead.distance_km} km out` : 'outside pincode'}
          </span>
        )}
        {lead.hours && (
          <span className="inline-flex items-center gap-0.5 text-ink-500">
            <Clock className="w-3 h-3" /> {lead.hours}
          </span>
        )}
      </div>

      {lead.address && <div className="text-xs text-ink-600 mt-0.5">{lead.address}</div>}

      <div className="flex flex-wrap items-center gap-3 mt-0.5">
        {/* A lead is a phone call. Make it one tap on the phone somebody is
            holding while they read this. */}
        {lead.phone && (
          <a href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}
             className="inline-flex items-center gap-1 text-xs text-brand-700 dark:text-brand-400
                        hover:underline num">
            <Phone className="w-3 h-3" /> {lead.phone}
          </a>
        )}
        {lead.website && (
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-400 truncate max-w-[18rem]">
            <Globe className="w-3 h-3 shrink-0" /> {lead.website}
          </span>
        )}
      </div>

      {lead.note && <div className="text-[11px] text-ink-500 mt-0.5">{lead.note}</div>}

      {score.reasons.length > 0 && (
        <div className="text-[11px] text-ink-500 mt-1">
          <span className="text-ink-400">Ranked here for </span>
          {score.reasons.join(', ')}.
        </div>
      )}

      {/* The agenda for the phone call. Amber, because every line of it is
          something the rank assumed and nobody confirmed. */}
      {score.caveats.length > 0 && (
        <div className="text-[11px] text-warn-600 mt-0.5">
          <span className="font-medium">Unconfirmed:</span> {score.caveats.join('; ')}.
        </div>
      )}

      {lead.source_url && (
        <div className="text-[10px] text-ink-400 truncate mt-0.5">{lead.source_url}</div>
      )}
    </li>
  );
}

const DISCIPLINE_BADGE: Record<string, string> = {
  PATHOLOGY: 'pathology',
  RADIOLOGY: 'imaging',
  CARDIO_DIAGNOSTIC: 'cardiac testing',
};
