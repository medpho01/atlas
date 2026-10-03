/**
 * Places APIs as a source of leads, in front of the model.
 *
 * lib/labDiscovery.ts says why this exists, in the comment above
 * discoveryEnabled(): the ranking needs a name, an address, a phone number, a
 * rating and a review count; a model reading the open web costs about $1.50 a
 * pincode to produce them; and those are places-API fields at roughly a
 * fiftieth of the price and in under a second. Everything downstream of the
 * source — the scoring, the reasons and caveats, the card, the claim,
 * promote-to-CRM — is already source-agnostic. So this file is only the source.
 *
 * It imports nothing from the app and touches no database, for the same reason
 * labDiscovery.ts does not: scripts/discover-labs.ts is a plain node process
 * and must run exactly the code the request page runs, or the nightly sweep
 * and the button drift apart.
 *
 * Every source answers in LabFacts, the shape scoreLead already reads. A
 * source that cannot say something leaves it null rather than guessing — a
 * missing rating has to reach the scorer as missing, because that is what its
 * caveat about thin evidence is built on.
 */

import { DISCIPLINES, type LabFacts } from './labDiscovery';

export type SourceName = 'mappls' | 'ola' | 'google';

const SOURCE_NAMES: SourceName[] = ['mappls', 'ola', 'google'];
const isSourceName = (s: string): s is SourceName => (SOURCE_NAMES as string[]).includes(s);

/** What a source is given. lat/lng are the pincode centroid, when we have one. */
export type SourceTarget = {
  pincode: string;
  city?: string | null;
  state?: string | null;
  disciplines?: string[] | null;
  lat?: number | null;
  lng?: number | null;
};

/** A lead in the shape storeLead and scoreLead already expect. */
export type SourceLead = LabFacts & { name: string; address?: string; source_url: string };

export type SourceResult = {
  source: SourceName;
  labs: SourceLead[];
  /** Billable calls actually made. */
  calls: number;
  costUsd: number;
  /** Set when the source failed. An empty result is not a failure. */
  error?: string;
};

export interface PlaceSource {
  name: SourceName;
  /** Why this source cannot run now, or null if it can. Never throws. */
  unavailable(t: SourceTarget): string | null;
  costPerPincodeUsd(): number;
  search(t: SourceTarget): Promise<SourceResult>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Rough per-pincode prices, in USD.
 *
 * Estimates, so they are overridable rather than compiled in as facts. A stale
 * number here under-reports what discovery costs, and the run log is the only
 * place anybody will look.
 */
const DEFAULT_COST_USD: Record<SourceName, number> = { mappls: 0, ola: 0.002, google: 0.035 };

const envNum = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export type SourcesConfig = {
  chain: SourceName[];
  /** Names in DISCOVERY_SOURCES that are not sources. Surfaced, not swallowed. */
  ignored: string[];
  minLeads: number;
  radiusM: number;
  budgetUsd: number;
  costUsd: Record<SourceName, number>;
  keys: {
    mapplsClientId?: string;
    mapplsClientSecret?: string;
    olaApiKey?: string;
    googleApiKey?: string;
  };
};

export function sourcesConfig(env: NodeJS.ProcessEnv = process.env): SourcesConfig {
  const raw = (env.DISCOVERY_SOURCES ?? 'mappls,ola,google')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    // An unrecognised name is dropped rather than thrown on: a typo in a
    // compose file should not take the app down at import time. It still has to
    // be visible, which is what `ignored` is for.
    chain: raw.filter(isSourceName),
    ignored: raw.filter((s) => !isSourceName(s)),
    minLeads: Math.max(1, envNum(env.DISCOVERY_MIN_LEADS, 2)),
    radiusM: envNum(env.DISCOVERY_RADIUS_M, 6000),
    budgetUsd: envNum(env.DISCOVERY_BUDGET_USD, 15),
    costUsd: {
      mappls: envNum(env.DISCOVERY_COST_MAPPLS_USD, DEFAULT_COST_USD.mappls),
      ola: envNum(env.DISCOVERY_COST_OLA_USD, DEFAULT_COST_USD.ola),
      google: envNum(env.DISCOVERY_COST_GOOGLE_USD, DEFAULT_COST_USD.google),
    },
    keys: {
      mapplsClientId: env.MAPPLS_CLIENT_ID || undefined,
      mapplsClientSecret: env.MAPPLS_CLIENT_SECRET || undefined,
      olaApiKey: env.OLA_MAPS_API_KEY || undefined,
      googleApiKey: env.GOOGLE_PLACES_API_KEY || undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Plumbing the three sources share
// ---------------------------------------------------------------------------

/**
 * Eight seconds, no retry.
 *
 * The app path runs inside a server action with somebody watching, and a
 * places lookup that has not answered in eight seconds is not going to answer
 * usefully. Failing inside the window with something to read beats holding the
 * connection open until a proxy cuts it.
 */
export const HTTP_TIMEOUT_MS = 8_000;

async function getJson(url: string, init: RequestInit = {}, timeoutMs = HTTP_TIMEOUT_MS): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    const text = await res.text();
    if (!res.ok) {
      // The body is where these APIs put the actual reason — a disabled key, a
      // referrer restriction, an exhausted quota. A bare status code reads as a
      // network blip and sends the next person looking in the wrong place.
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300) || res.statusText}`);
    }
    return text ? JSON.parse(text) : {};
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(`No response within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function describeError(e: unknown): string {
  const err = e as { status?: number; message?: string };
  const detail = err?.message ?? String(e);
  return err?.status ? `HTTP ${err.status}: ${detail}` : detail;
}

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const strOrNull = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length ? s : null;
};

/** First non-empty string among several candidate field names. */
const pick = (o: any, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = strOrNull(o?.[k]);
    if (v) return v;
  }
  return null;
};

/** What to type into a places search for each kind of centre we might need. */
const QUERY_WORDS: Record<string, string[]> = {
  PATHOLOGY: ['diagnostic laboratory', 'pathology lab', 'blood test collection centre'],
  RADIOLOGY: ['diagnostic imaging centre', 'ultrasound scan centre', 'MRI CT scan centre'],
  CARDIO_DIAGNOSTIC: ['ECG echo test centre', 'cardiac diagnostic centre'],
};

/**
 * The search terms for one target, deduplicated and capped at three.
 *
 * Each term is a billable call on the metered sources, and past three the
 * results are the same places in a different order. A pincode that needs
 * pathology and radiology costs two calls, not six.
 */
export function queriesFor(t: SourceTarget, max = 3): string[] {
  const asked = t.disciplines?.length ? t.disciplines : ['PATHOLOGY'];
  const where = [t.city, t.pincode].filter(Boolean).join(' ');
  // Round-robin across the disciplines asked for, not all of one then all of
  // the next. Taken in order, a request needing pathology AND radiology spent
  // the whole three-call cap on pathology terms and never searched for an
  // imaging centre at all — which is the exact failure wanted() warns about:
  // a page of collection centres, none of which can do the MRI.
  const lists = asked.map((d) => QUERY_WORDS[d] ?? QUERY_WORDS.PATHOLOGY);
  const terms: string[] = [];
  const deepest = Math.max(...lists.map((l) => l.length));
  for (let i = 0; i < deepest; i++) for (const l of lists) if (l[i]) terms.push(l[i]);
  return Array.from(new Set(terms)).slice(0, max).map((w) => `${w} ${where}`.trim());
}

/** Kilometres between two points, one decimal. Good enough to rank on. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)) * 10) / 10;
}

/**
 * Which disciplines a listing's own words claim.
 *
 * Deliberately one-way: it can say a place looks like imaging, never that it
 * does NOT do pathology. disciplines_absent means the listing positively said
 * so, and a places category has said no such thing — leaving it null is the
 * honest answer, and scoreLead already handles "not mentioned" separately.
 */
export function disciplinesFrom(text: string | null, asked?: string[] | null): string[] | null {
  const hay = (text ?? '').toLowerCase();
  const found = new Set<string>();
  if (/(path|lab|laborator|blood|collection|diagnostic cent)/.test(hay)) found.add('PATHOLOGY');
  if (/(radiolog|imaging|x-?ray|ultrasound|sonograph|mri|ct scan|scan cent)/.test(hay)) found.add('RADIOLOGY');
  if (/(ecg|ekg|echo|cardio)/.test(hay)) found.add('CARDIO_DIAGNOSTIC');
  // Nothing recognisable in the name: fall back to what was asked for, since
  // that is the search term this listing came back for.
  if (!found.size && asked?.length) for (const d of asked) if (DISCIPLINES.includes(d)) found.add(d);
  return found.size ? Array.from(found) : null;
}

/**
 * The two place facts scoreLead reads, worked out from the geometry.
 *
 * in_pincode is the published address naming the pincode — the strongest
 * signal a listing gives, and the one scoreLead weights highest. Centroid
 * distance is the fallback. Both may be unknown, which is a real answer and
 * scores differently from "outside".
 */
export function placeFacts(
  t: SourceTarget, address: string | null, lat: number | null, lng: number | null,
): { in_pincode: boolean | null; distance_km: number | null } {
  const named = address ? address.includes(t.pincode) : null;
  const dist = (lat != null && lng != null && t.lat != null && t.lng != null)
    ? distanceKm(t.lat, t.lng, lat, lng)
    : null;
  if (named === true) return { in_pincode: true, distance_km: dist };
  // No coordinates, and an address that does not name the pincode, tells us
  // nothing either way. Saying "outside" here would be an assertion we cannot
  // support, and it costs a lead real points.
  if (dist == null) return { in_pincode: null, distance_km: null };
  // Within half a kilometre of the centroid is the pincode for our purposes,
  // whatever the address string happens to spell.
  return { in_pincode: dist <= 0.5, distance_km: dist };
}

// ---------------------------------------------------------------------------
// Mappls — the primary
//
// First in the chain for two reasons, one commercial and one legal. It is an
// Indian directory of Indian businesses, so its coverage of a 413xxx pincode
// beats a global provider's, and its free tier covers a sweep of three hundred
// pincodes outright. And unlike Google, its terms do not forbid retaining a
// name, address and phone past a caching window — which matters, because
// promoting a lead into CRM is exactly that retention.
//
// It publishes no ratings. That is fine: a missing rating reaches the scorer as
// missing, and scoreLead already says so in a caveat rather than pretending.
// ---------------------------------------------------------------------------

const MAPPLS_TOKEN_URL = 'https://outpost.mappls.com/api/security/oauth/token';
const MAPPLS_NEARBY_URL = 'https://atlas.mappls.com/api/places/nearby/json';

/**
 * The OAuth token, cached for the process.
 *
 * Mappls issues a bearer token valid for hours and rate-limits the token
 * endpoint harder than the search endpoint, so fetching one per search is the
 * quickest way to turn a working integration into a 429. Refreshed a minute
 * early so a long search cannot straddle the expiry.
 */
let mapplsToken: { value: string; expiresAt: number } | null = null;

/** Forget the cached token, so a probe tests the real handshake. */
export function resetMapplsToken(): void { mapplsToken = null; }

async function mapplsBearer(id: string, secret: string): Promise<string> {
  if (mapplsToken && Date.now() < mapplsToken.expiresAt) return mapplsToken.value;
  const json = await getJson(MAPPLS_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: id, client_secret: secret,
    }).toString(),
  });
  const value = strOrNull(json?.access_token);
  if (!value) throw new Error('Mappls returned no access_token');
  const ttl = numOrNull(json?.expires_in) ?? 3600;
  mapplsToken = { value, expiresAt: Date.now() + Math.max(60, ttl - 60) * 1000 };
  return value;
}

/**
 * Read one Mappls row.
 *
 * Written defensively on purpose: Mappls has shipped more than one response
 * shape for nearby search, and the field names differ between the suggest and
 * the nearby endpoints. Reading whichever plausible name is present costs
 * nothing and survives the next rename; assuming one shape produces an empty
 * result set that looks exactly like a barren pincode.
 */
export function mapplsToLead(r: any, t: SourceTarget): SourceLead | null {
  const name = pick(r, 'placeName', 'poi', 'name');
  if (!name) return null;
  const address = pick(r, 'placeAddress', 'address', 'formattedAddress');
  const lat = numOrNull(r?.latitude ?? r?.lat ?? r?.entryLatitude);
  const lng = numOrNull(r?.longitude ?? r?.lng ?? r?.entryLongitude);
  const eloc = pick(r, 'eLoc', 'placeId', 'id');
  const category = pick(r, 'type', 'categoryName', 'keywords', 'richInfo');
  return {
    name,
    address: address ?? undefined,
    phone: pick(r, 'tel', 'phone', 'mobileNo', 'contactNumber'),
    source_url: eloc ? `https://maps.mappls.com/${eloc}` : 'https://maps.mappls.com/',
    website: null,
    rating: null,
    rating_count: null,
    disciplines: disciplinesFrom([name, category].filter(Boolean).join(' '), t.disciplines),
    ...placeFacts(t, address, lat, lng),
  };
}

export const mapplsSource: PlaceSource = {
  name: 'mappls',

  unavailable(t) {
    const { keys } = sourcesConfig();
    if (!keys.mapplsClientId || !keys.mapplsClientSecret) {
      return 'MAPPLS_CLIENT_ID / MAPPLS_CLIENT_SECRET not set';
    }
    // Nearby search is anchored on a point. Without a centroid there is nothing
    // to anchor it to, and those pincodes should fall through to a source that
    // takes free text.
    if (t.lat == null || t.lng == null) return 'no centroid for this pincode';
    return null;
  },

  costPerPincodeUsd() { return sourcesConfig().costUsd.mappls; },

  async search(t) {
    const cfg = sourcesConfig();
    const out: SourceResult = { source: 'mappls', labs: [], calls: 0, costUsd: 0 };
    const queries = queriesFor(t);
    // Accrued per successful call rather than after the loop: a source that
    // dies partway has still billed for the calls it did answer, and the run
    // budget is decremented by this number.
    const perCall = cfg.costUsd.mappls / Math.max(1, queries.length);
    try {
      const auth = await mapplsBearer(cfg.keys.mapplsClientId!, cfg.keys.mapplsClientSecret!);
      for (const q of queries) {
        const url = `${MAPPLS_NEARBY_URL}?keywords=${encodeURIComponent(q)}`
          + `&refLocation=${t.lat},${t.lng}&radius=${Math.round(cfg.radiusM)}&page=1`;
        const json = await getJson(url, { headers: { Authorization: `Bearer ${auth}` } });
        out.calls += 1;
        out.costUsd = out.calls * perCall;
        const rows: any[] = json?.suggestedLocations ?? json?.results ?? json?.data ?? [];
        for (const r of Array.isArray(rows) ? rows : []) {
          const lead = mapplsToLead(r, t);
          if (lead) out.labs.push(lead);
        }
      }
      return out;
    } catch (e) {
      out.error = describeError(e);
      return out;
    }
  },
};

// ---------------------------------------------------------------------------
// Ola Maps — the secondary
//
// Text search rather than nearby, so it still answers for a pincode we have no
// centroid for. Indian coverage, near-free at this volume, and no retention
// clause of the kind Google has.
// ---------------------------------------------------------------------------

const OLA_TEXT_SEARCH_URL = 'https://api.olamaps.io/places/v1/textsearch';

export function olaToLead(r: any, t: SourceTarget): SourceLead | null {
  const name = pick(r, 'name', 'description', 'structured_formatting_main_text');
  if (!name) return null;
  const address = pick(r, 'formatted_address', 'vicinity', 'description', 'address');
  const loc = r?.geometry?.location ?? r?.location ?? {};
  const lat = numOrNull(loc?.lat ?? loc?.latitude);
  const lng = numOrNull(loc?.lng ?? loc?.longitude);
  const placeId = pick(r, 'place_id', 'placeId', 'id');
  const types: string[] = Array.isArray(r?.types) ? r.types : [];
  return {
    name,
    address: address ?? undefined,
    phone: pick(r, 'formatted_phone_number', 'international_phone_number', 'phone'),
    source_url: placeId ? `https://maps.olakrutrim.com/place/${placeId}` : 'https://maps.olakrutrim.com/',
    website: pick(r, 'website'),
    rating: numOrNull(r?.rating),
    rating_count: numOrNull(r?.user_ratings_total ?? r?.rating_count),
    disciplines: disciplinesFrom([name, types.join(' ')].filter(Boolean).join(' '), t.disciplines),
    ...placeFacts(t, address, lat, lng),
  };
}

export const olaSource: PlaceSource = {
  name: 'ola',

  unavailable() {
    return sourcesConfig().keys.olaApiKey ? null : 'OLA_MAPS_API_KEY not set';
  },

  costPerPincodeUsd() { return sourcesConfig().costUsd.ola; },

  async search(t) {
    const cfg = sourcesConfig();
    const out: SourceResult = { source: 'ola', labs: [], calls: 0, costUsd: 0 };
    const queries = queriesFor(t);
    const perCall = cfg.costUsd.ola / Math.max(1, queries.length);
    try {
      for (const q of queries) {
        const loc = t.lat != null && t.lng != null
          ? `&location=${t.lat},${t.lng}&radius=${Math.round(cfg.radiusM)}` : '';
        const url = `${OLA_TEXT_SEARCH_URL}?input=${encodeURIComponent(q)}${loc}`
          + `&api_key=${encodeURIComponent(cfg.keys.olaApiKey!)}`;
        const json = await getJson(url);
        out.calls += 1;
        out.costUsd = out.calls * perCall;
        const rows: any[] = json?.predictions ?? json?.results ?? [];
        for (const r of Array.isArray(rows) ? rows : []) {
          const lead = olaToLead(r, t);
          if (lead) out.labs.push(lead);
        }
      }
      return out;
    } catch (e) {
      out.error = describeError(e);
      return out;
    }
  },
};

// ---------------------------------------------------------------------------
// Google Places — the fallback
//
// Best coverage and the only ratings worth having, and last anyway, for a legal
// reason rather than a technical one. Google's terms permit keeping the place
// id indefinitely but treat name, address and phone as cached content with an
// expiry — and promote-to-CRM is exactly that retention. So it fills gaps the
// Indian directories leave rather than leading, and its rows are marked with
// their source so a retention job can find them.
// ---------------------------------------------------------------------------

const GOOGLE_SEARCH_TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';

/** Ask for exactly what the scorer reads. Every extra field is billed for. */
const GOOGLE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'places.location',
  'places.types',
  'places.websiteUri',
  'places.businessStatus',
].join(',');

export function googleToLead(p: any, t: SourceTarget): SourceLead | null {
  const name = strOrNull(p?.displayName?.text) ?? strOrNull(p?.displayName);
  if (!name) return null;
  // A place Google says is permanently closed is not a lead; it is a wasted
  // phone call with a plausible-looking listing behind it.
  if (p?.businessStatus === 'CLOSED_PERMANENTLY') return null;
  const address = strOrNull(p?.formattedAddress);
  const lat = numOrNull(p?.location?.latitude);
  const lng = numOrNull(p?.location?.longitude);
  const id = strOrNull(p?.id);
  const types: string[] = Array.isArray(p?.types) ? p.types : [];
  return {
    name,
    address: address ?? undefined,
    phone: strOrNull(p?.nationalPhoneNumber),
    source_url: id ? `https://www.google.com/maps/place/?q=place_id:${id}` : 'https://maps.google.com/',
    website: strOrNull(p?.websiteUri),
    rating: numOrNull(p?.rating),
    rating_count: numOrNull(p?.userRatingCount),
    disciplines: disciplinesFrom([name, types.join(' ')].filter(Boolean).join(' '), t.disciplines),
    note: p?.businessStatus === 'CLOSED_TEMPORARILY' ? 'Google lists this as temporarily closed' : null,
    ...placeFacts(t, address, lat, lng),
  };
}

export const googleSource: PlaceSource = {
  name: 'google',

  unavailable() {
    return sourcesConfig().keys.googleApiKey ? null : 'GOOGLE_PLACES_API_KEY not set';
  },

  costPerPincodeUsd() { return sourcesConfig().costUsd.google; },

  async search(t) {
    const cfg = sourcesConfig();
    const out: SourceResult = { source: 'google', labs: [], calls: 0, costUsd: 0 };
    const queries = queriesFor(t);
    const perCall = cfg.costUsd.google / Math.max(1, queries.length);
    try {
      for (const q of queries) {
        const body: Record<string, unknown> = {
          textQuery: q, regionCode: 'IN', languageCode: 'en',
          // Ten is plenty. The scorer discards most of a longer page, and a
          // second page is a second billable call for worse candidates.
          pageSize: 10,
        };
        if (t.lat != null && t.lng != null) {
          body.locationBias = {
            circle: { center: { latitude: t.lat, longitude: t.lng }, radius: cfg.radiusM },
          };
        }
        const json = await getJson(GOOGLE_SEARCH_TEXT_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Goog-Api-Key': cfg.keys.googleApiKey!,
            'X-Goog-FieldMask': GOOGLE_FIELD_MASK,
          },
          body: JSON.stringify(body),
        });
        out.calls += 1;
        out.costUsd = out.calls * perCall;
        const places: any[] = json?.places ?? [];
        for (const p of Array.isArray(places) ? places : []) {
          const lead = googleToLead(p, t);
          if (lead) out.labs.push(lead);
        }
      }
      return out;
    } catch (e) {
      out.error = describeError(e);
      return out;
    }
  },
};

export const SOURCES: Record<SourceName, PlaceSource> = {
  mappls: mapplsSource,
  ola: olaSource,
  google: googleSource,
};

/** Which credentials each source needs before it can be asked anything. */
function hasKeysFor(name: SourceName, cfg: SourcesConfig): boolean {
  if (name === 'mappls') return !!(cfg.keys.mapplsClientId && cfg.keys.mapplsClientSecret);
  if (name === 'ola') return !!cfg.keys.olaApiKey;
  return !!cfg.keys.googleApiKey;
}

/**
 * True when at least one source in the chain has what it needs to run.
 *
 * Reads the credentials out of the config it was given rather than asking each
 * source's unavailable(), which resolves its own config from process.env and
 * would quietly ignore the env passed in here.
 *
 * A centroid is per-pincode, so this asks only the credential question; a
 * source that is configured but unanchored is skipped at search time.
 */
export function anySourceConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const cfg = sourcesConfig(env);
  return cfg.chain.some((n) => hasKeysFor(n, cfg));
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

export type ChainAttempt = { source: SourceName; found: number; calls: number; costUsd: number; error?: string };

export type ChainResult = {
  labs: SourceLead[];
  /** Which source produced the leads we kept, for the run row. */
  source: SourceName | null;
  attempts: ChainAttempt[];
  skipped: { source: SourceName; why: string }[];
  calls: number;
  costUsd: number;
};

/**
 * Walk the chain until a pincode has enough leads.
 *
 * Stops at the first source that answers well enough, so a pincode a free
 * Indian directory can serve never reaches a metered one. Deduplicated on name
 * within the pincode, because storeLead's ON CONFLICT does the same and two
 * sources naming the same lab should not look like two labs here either.
 */
export async function searchSources(
  t: SourceTarget,
  opts: { sources?: Partial<Record<SourceName, PlaceSource>>; budgetUsd?: number } = {},
): Promise<ChainResult> {
  const cfg = sourcesConfig();
  const out: ChainResult = { labs: [], source: null, attempts: [], skipped: [], calls: 0, costUsd: 0 };
  let budgetLeft = opts.budgetUsd ?? cfg.budgetUsd;
  const seen = new Set<string>();

  for (const name of cfg.chain) {
    if (out.labs.length >= cfg.minLeads) break;

    const source = opts.sources?.[name] ?? SOURCES[name];
    const why = source.unavailable(t);
    if (why) { out.skipped.push({ source: name, why }); continue; }

    const price = source.costPerPincodeUsd();
    if (price > budgetLeft) {
      out.skipped.push({
        source: name,
        why: `would cost $${price.toFixed(3)}, only $${budgetLeft.toFixed(3)} left in this run`,
      });
      continue;
    }

    const res = await source.search(t);
    out.calls += res.calls;
    out.costUsd += res.costUsd;
    budgetLeft -= res.costUsd;
    out.attempts.push({
      source: name, found: res.labs.length, calls: res.calls, costUsd: res.costUsd, error: res.error,
    });

    for (const lead of res.labs) {
      const key = lead.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.labs.push(lead);
      if (!out.source) out.source = name;
    }
  }

  out.costUsd = Math.round(out.costUsd * 10000) / 10000;
  return out;
}
