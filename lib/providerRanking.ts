/**
 * Rule-based ranking of diagnostic labs and hospitals for a pincode or city.
 *
 * TypeScript port of `ranking.py` (see that file's docstring for the full
 * design rationale). Deliberately deterministic — no model, no training, no
 * network call — so the explanation attached to a score can be trusted: each
 * reason is emitted by the same term that moved the score, and the two cannot
 * drift apart.
 *
 * Two behaviours carried over unchanged from the prototype:
 *
 * - Unknown is not zero. A signal with no data is dropped and the remaining
 *   weights renormalised, then the result is scaled by how much of the weight
 *   budget was actually observed (floor 0.6). A provider with nothing on file
 *   for a signal is treated as unknown on it, not as scoring zero — and it
 *   also cannot top the list on two flattering signals alone.
 * - `services` filters, it does not merely weight. A provider whose known
 *   service list matches nothing requested is excluded; a provider with no
 *   service list on file is kept and flagged, because unknown is not "no".
 *
 * Scores are relative within one ranked list. Comparing a score across two
 * different areas or two different service filters is meaningless.
 */

// --------------------------------------------------------------------------
// Configuration — identical to ranking.py
// --------------------------------------------------------------------------

export type SignalKey = 'accreditation' | 'proximity' | 'service_match' | 'reviews';

const WEIGHTS: Record<SignalKey, number> = {
  accreditation: 0.4,
  proximity: 0.3,
  service_match: 0.2,
  reviews: 0.1,
};

/** Distance at which proximity contributes nothing. */
const MAX_DISTANCE_KM = 15.0;

/** Review scores are published out of 5. */
const MAX_REVIEW_SCORE = 5.0;

/** Confidence floor applied to thin evidence — see module docstring. */
const COVERAGE_FLOOR = 0.6;

// --------------------------------------------------------------------------
// Data model
// --------------------------------------------------------------------------

/**
 * One lab or hospital, and everything the ranker needs to know about it.
 * Optional fields are `null`/`undefined` when genuinely unknown — never `0`
 * or `[]` standing in for "we don't know".
 */
export interface RankableProvider {
  name: string;
  address?: string | null;
  phone?: string | null;
  /** Known service list, e.g. ['mri', 'ct']. Absent/empty means unknown, not "offers nothing". */
  services?: string[] | null;
  accredited?: boolean | null;
  distanceKm?: number | null;
  reviewScore?: number | null;
}

interface Signal {
  key: SignalKey;
  weight: number;
  value: number;
}

export interface Scored<P extends RankableProvider = RankableProvider> {
  provider: P;
  score: number;
  /** Share of the applicable weight budget actually observed, 0..1. */
  coverage: number;
  missing: SignalKey[];
  rank: number;
  explanation: string;
}

function offers(p: RankableProvider, service: string): boolean {
  const needle = service.trim().toLowerCase();
  return (p.services ?? []).some((s) => s.trim().toLowerCase() === needle);
}

// --------------------------------------------------------------------------
// Signals — each returns 0..1, or null when the input is unknown
// --------------------------------------------------------------------------

function accreditationSignal(p: RankableProvider): number | null {
  if (p.accredited == null) return null;
  return p.accredited ? 1 : 0;
}

function proximitySignal(p: RankableProvider): number | null {
  if (p.distanceKm == null) return null;
  return Math.max(0, 1 - p.distanceKm / MAX_DISTANCE_KM);
}

function serviceMatchSignal(p: RankableProvider, requested: string[]): number | null {
  // Nothing requested means the signal does not apply -- not that the
  // provider scored zero on it.
  if (requested.length === 0) return null;
  if (!p.services || p.services.length === 0) return null;
  const hits = requested.filter((s) => offers(p, s)).length;
  return hits / requested.length;
}

function reviewsSignal(p: RankableProvider): number | null {
  if (p.reviewScore == null) return null;
  return Math.min(1, Math.max(0, p.reviewScore / MAX_REVIEW_SCORE));
}

// --------------------------------------------------------------------------
// Scoring
// --------------------------------------------------------------------------

/**
 * Score one provider, in two steps.
 *
 * First, drop unknown signals and renormalise over what is left. Second,
 * scale by how much of the applicable weight was actually observed — the
 * floor of 0.6 demotes thin evidence without erasing it. See the module
 * docstring; the reasoning is unchanged from ranking.py.
 */
export function scoreProvider<P extends RankableProvider>(
  provider: P,
  requestedServices: string[],
): { score: number; signals: Signal[]; missing: SignalKey[]; coverage: number } {
  const raw: Partial<Record<SignalKey, number | null>> = {
    accreditation: accreditationSignal(provider),
    proximity: proximitySignal(provider),
    reviews: reviewsSignal(provider),
  };

  // service_match applies only when the caller asked for something.
  if (requestedServices.length > 0) {
    raw.service_match = serviceMatchSignal(provider, requestedServices);
  }

  const rawKeys = Object.keys(raw) as SignalKey[];
  const signals: Signal[] = rawKeys
    .filter((k) => raw[k] != null)
    .map((k) => ({ key: k, weight: WEIGHTS[k], value: raw[k] as number }));
  const missing = rawKeys.filter((k) => raw[k] == null);

  if (signals.length === 0) {
    // Nothing at all is known. Rank it last rather than pretending to a 0.
    return { score: 0, signals: [], missing, coverage: 0 };
  }

  const applicableWeight = rawKeys.reduce((sum, k) => sum + WEIGHTS[k], 0);
  const observedWeight = signals.reduce((sum, s) => sum + s.weight, 0);

  const base = signals.reduce((sum, s) => sum + s.weight * s.value, 0) / observedWeight;
  const coverage = observedWeight / applicableWeight;
  const confidence = COVERAGE_FLOOR + (1 - COVERAGE_FLOOR) * coverage;

  return { score: base * confidence, signals, missing, coverage };
}

/**
 * Score, sort, filter, and explain a pool of providers. Filtering to an area
 * is the caller's job (usually a WHERE clause); this only applies the
 * `services` filter, which — like in ranking.py — is a hard exclusion, not a
 * mere preference: somebody asking for an MRI does not want a blood-only
 * collection centre ranked second on the strength of being nearby.
 */
export function rankProviders<P extends RankableProvider>(
  providers: P[],
  requestedServicesInput: string[] = [],
): Scored<P>[] {
  const requested = requestedServicesInput.map((s) => s.trim()).filter(Boolean);

  let pool = providers;
  if (requested.length > 0) {
    // Providers whose service list we simply do not have are kept — unknown
    // is not the same as no.
    pool = pool.filter((p) => !p.services || p.services.length === 0 || requested.some((s) => offers(p, s)));
  }

  const scored = pool.map((p) => {
    const { score, signals, missing, coverage } = scoreProvider(p, requested);
    return { provider: p, score, signals, missing, coverage, rank: 0, explanation: '' } as Scored<P> & {
      signals: Signal[];
    };
  });

  // Ties are broken by distance, then name, so two runs of the same data
  // never disagree.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const da = a.provider.distanceKm ?? 999;
    const db = b.provider.distanceKm ?? 999;
    if (da !== db) return da - db;
    return a.provider.name.localeCompare(b.provider.name);
  });

  const distances = scored.map((s) => s.provider.distanceKm).filter((d): d is number => d != null);
  const closestKm = distances.length > 0 ? Math.min(...distances) : null;

  scored.forEach((s, i) => {
    s.rank = i + 1;
    s.explanation = explain(s, requested, closestKm);
  });

  return scored;
}

// --------------------------------------------------------------------------
// Explanations
// --------------------------------------------------------------------------

function signalOf(signals: Signal[], key: SignalKey): Signal | undefined {
  return signals.find((s) => s.key === key);
}

/**
 * Build a plain-text reason from the signals that actually moved the score.
 * Strengths are listed in order of how much they contributed, so the first
 * clause is always the real reason the provider sits where it does.
 */
function explain<P extends RankableProvider>(
  scored: Scored<P> & { signals: Signal[] },
  requested: string[],
  closestKm: number | null,
): string {
  const p = scored.provider;
  const strengths: [number, string][] = [];
  const against: string[] = [];

  const acc = signalOf(scored.signals, 'accreditation');
  if (acc) {
    if (acc.value >= 1) strengths.push([acc.value * acc.weight, 'accredited']);
    else against.push('not accredited');
  }

  const prox = signalOf(scored.signals, 'proximity');
  if (prox && p.distanceKm != null) {
    if (closestKm != null && p.distanceKm === closestKm) {
      strengths.push([prox.value * prox.weight, `closest in this area (${p.distanceKm} km)`]);
    } else if (prox.value >= 0.6) {
      strengths.push([prox.value * prox.weight, `nearby (${p.distanceKm} km)`]);
    } else if (prox.value <= 0.35) {
      against.push(`${p.distanceKm} km out`);
    }
  }

  const svc = signalOf(scored.signals, 'service_match');
  if (svc && requested.length > 0) {
    const matched = requested.filter((s) => offers(p, s));
    const missed = requested.filter((s) => !offers(p, s));
    if (missed.length === 0) {
      strengths.push([svc.value * svc.weight, `offers everything asked for (${matched.join(', ')})`]);
    } else if (matched.length > 0) {
      strengths.push([svc.value * svc.weight, `offers ${matched.length} of ${requested.length} requested`]);
      against.push(`no ${missed.join(', ')}`);
    } else {
      against.push(`offers none of ${requested.join(', ')}`);
    }
  }

  const rev = signalOf(scored.signals, 'reviews');
  if (rev && p.reviewScore != null) {
    if (rev.value >= 0.86) strengths.push([rev.value * rev.weight, `well reviewed (${p.reviewScore}/5)`]);
    else if (rev.value <= 0.7) against.push(`modest reviews (${p.reviewScore}/5)`);
  }

  for (const key of scored.missing) {
    if (key === 'reviews') against.push('no review data');
    else if (key === 'accreditation') against.push('accreditation unverified');
    else if (key === 'service_match' && requested.length > 0) against.push('service list unknown');
  }

  strengths.sort((a, b) => b[0] - a[0]);
  const phrases = strengths.map(([, text]) => text);

  const head = phrases.length > 0
    ? `Ranked #${scored.rank} — ${joinList(phrases)}.`
    : `Ranked #${scored.rank} — nothing scored in its favour.`;

  const tail = against.length > 0 ? ` Against it: ${joinList(against)}.` : '';
  return head + tail;
}

/** "a" / "a and b" / "a, b and c" */
function joinList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
