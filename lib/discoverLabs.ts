import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { query, queryOne } from './db';
import {
  SEARCH_SYSTEM, SEARCH_SCHEMA, searchPrompt, DISCOVERY_STALE_DAYS,
  scoreLead, rankLeads, num, isSearchRunning, shouldAutoSearch,
  type LabFacts, type RunRow, type Ranked, autoSearchEnabled, splitLine,
  readLabs, MAX_CONTINUATIONS, type SearchAnswer,
} from './labDiscovery';

/**
 * Find labs on the open web for a pincode the network cannot reach.
 *
 * Same job as scripts/discover-labs.ts, callable from the app so the network
 * team can trigger it on the request in front of them rather than waiting for
 * a batch. The batch script stays for sweeping many pincodes at once.
 *
 * The prompt, the schema and the scoring live in lib/labDiscovery.ts, which
 * imports nothing — this file and the batch script each had their own diverged
 * copy of all three.
 *
 * Results are LEADS. They land in atlas.discovered_lab marked unverified, are
 * never merged into the lab directory, and nothing here contacts anybody. The
 * rank says "call this one first", never "this one is real".
 *
 * Search results are data, not instructions: the model is asked for facts in a
 * fixed schema, and nothing it returns can cause Atlas to take an action.
 */

const MODEL = 'claude-opus-5';

// Re-exported from the pure module so the page imports both the run-row
// predicates and the reads from one place, while the logic itself stays
// testable without Next. shouldAutoSearch mirrors atlas.claim_discovery's
// WHERE clause and is fixture-tested in scripts/test-lab-scoring.ts.
export { isSearchRunning, shouldAutoSearch, autoSearchEnabled, readLabs };
export type { SearchAnswer };

/**
 * Turn an SDK error into something worth writing to discovery_run.error.
 *
 * The API's own message says what was wrong; without it a failure is recorded
 * as a bare "400" and looks identical to a network blip. That ambiguity cost a
 * round of wrong diagnosis — the real cause was an exhausted credit balance,
 * which the API had been saying plainly all along.
 */
function describe(e: unknown): string {
  const err = e as { status?: number; message?: string; error?: { error?: { message?: string } } };
  const detail = err?.error?.error?.message ?? err?.message ?? String(e);
  const base = err?.status ? `HTTP ${err.status}: ${detail}` : detail;
  // Which key hit this. The container loads .env.production while the shell
  // scripts also read .env, so the app and a working curl can easily be using
  // two different keys — as they were when a topped-up key tested fine from
  // the command line while the app kept reporting an exhausted balance.
  // Last four characters only: enough to match against the Console, not
  // enough to be a credential.
  const key = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
  const withKey = key ? `${base} (key …${key.slice(-4)})` : base;
  // A timeout is the one failure a person can do something about, so say what.
  // Reading three listings closely takes a minute or two; the bare SDK message
  // reads like a broken integration.
  return /timed? ?out/i.test(withKey)
    ? `${withKey} — a search reads several listings and can take a couple of minutes. Try again.`
    : withKey;
}

/** Where a search came from. Recorded so "what is the page load costing us"
 *  is answerable from the data rather than from memory. */
export type DiscoveryTrigger = 'batch' | 'request_page' | 'manual';

export type DiscoveryResult = {
  found: number;
  error?: string;
  /** atlas.claim_discovery said no. Not an error — either somebody else is
   *  already searching this pincode, or it was answered recently enough. */
  declined?: boolean;
};

/**
 * Take the claim, or find out somebody else has it.
 *
 * `staleDays` 0 is the deliberate-human case: a person may always re-search,
 * except over the top of a search already running. See the function's own
 * comment in sql/init/20_lab_discovery_ranking.sql.
 *
 * Returns true on a database that has not had the migration applied (42883,
 * function does not exist). Declining there would silently disable discovery
 * on every existing host until somebody noticed; searching unconditionally is
 * exactly what this code did before the claim existed, so it is the honest
 * fallback rather than a new failure mode.
 */
async function claim(
  pincode: string, staleDays: number, trigger: DiscoveryTrigger,
): Promise<boolean> {
  try {
    const row = await queryOne<{ claimed: boolean }>(
      `SELECT atlas.claim_discovery($1, $2, $3) AS claimed`, [pincode, staleDays, trigger]);
    return !!row?.claimed;
  } catch (e) {
    if ((e as { code?: string }).code === '42883') return true;
    throw e;
  }
}

/**
 * One search, with the structured-output schema — and without it if the API
 * will not take the schema.
 *
 * Production answered `HTTP 400: Schema is too complex`, which took the whole
 * feature down: every search failed, and the only way back was a deploy. The
 * schema has been slimmed (see SEARCH_SCHEMA), but a limit nobody can read
 * from here is a limit that can be hit again by adding one field, so the
 * failure is now recoverable in flight.
 *
 * The fallback keeps the same prompt — which describes every field and asks
 * for JSON — and loses only the guarantee that the answer parses. A malformed
 * answer was always possible and is already handled: it throws, and the run
 * records the error.
 */
/**
 * Set once the API has told us it will not take the schema.
 *
 * Without it every search pays for a rejected request before the retry that
 * works. The limit is a property of the API and the schema, not of the
 * pincode, so one answer holds for the life of the process — and a deploy
 * clears it, which is the right granularity for something a schema edit
 * changes.
 */
let schemaRejected = false;


/**
 * A canned answer, for exercising the whole path without spending money.
 *
 * Set DISCOVERY_FAKE=1 (and optionally DISCOVERY_FAKE_MS) and a search returns
 * this instead of calling the API. It is not a mock of the SDK — it is a real
 * answer in the shape the model actually replied in for 413736, prose and a
 * fenced block and all, so the claim, the background run, the store, the poll
 * and the card can all be tested locally and in that order.
 *
 * Never reachable in production: the flag is not set there, and the deploy
 * does not set it.
 */
async function fakeSearch(pincode: string): Promise<SearchAnswer> {
  const ms = Number(process.env.DISCOVERY_FAKE_MS ?? 8000);
  await new Promise((r) => setTimeout(r, ms));
  const labs = [
    { name: `Sunrise Diagnostics ${pincode}`, address: '12 MG Road', phone: '+91 98200 00000',
      source_url: 'https://example.test/sunrise', confidence: 0.82,
      disciplines: ['PATHOLOGY', 'RADIOLOGY'], accreditation: 'NABL, ISO 9001',
      services: 'CBC, MRI 1.5T', rating: 4.4, rating_count: 380,
      home_collection: true, in_pincode: true, hours: '8am-8pm',
      note: 'Main branch, runs its own imaging.' },
    { name: `Minimal Lab ${pincode}`, source_url: 'https://example.test/minimal', confidence: 0.4 },
  ];
  return {
    stop_reason: 'end_turn',
    continuations: 0,
    content: [
      { type: 'thinking' },
      { type: 'server_tool_use' },
      { type: 'web_search_tool_result' },
      { type: 'text', text: `Here is what I found.\n\n\`\`\`json\n${JSON.stringify({ labs })}\n\`\`\`` },
    ],
  };
}

export async function search(
  anthropic: Anthropic,
  pincode: string, city?: string | null, state?: string | null,
  disciplines?: string[] | null,
): Promise<SearchAnswer> {
  const request = {
    model: MODEL,
    // 4000 was enough for four labs of name, address and phone. The schema
    // now asks for disciplines, accreditation, ratings, hours and a note per
    // lab, and a truncated response is a parse failure, not a short list.
    max_tokens: 8000,
    system: [{ type: 'text', text: SEARCH_SYSTEM, cache_control: { type: 'ephemeral' } }],
    // Ten, not three.
    //
    // Three was chosen to keep memory down, and it is what the model hit: a
    // probe against 413736 came back "the web search tool returned 'server
    // tool use limit exceeded' on every attempt, so I could not verify a
    // single real provider" — and then, correctly, refused to invent any. The
    // searches this feature exists to make are several queries deep, and
    // dynamic filtering spends some of the budget on code execution of its
    // own, so the limit was being reached before the work was done.
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 10 }],
    messages: [{ role: 'user', content: searchPrompt(pincode, city, state, disciplines) }],
  };
  // 'medium', not 'low'. At low effort the model answers out of the search
  // snippets and leaves every new field empty — which makes every lead score
  // alike and the whole ranking pointless. Reading a listing closely enough
  // to say whether it claims NABL is the work here, not a lookup.
  const withSchema = {
    ...request,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SEARCH_SCHEMA } },
  };

  const withoutSchema = { ...request, output_config: { effort: 'medium' } };

  if (process.env.DISCOVERY_FAKE === '1') return await fakeSearch(pincode);

  const once = async (body: object): Promise<SearchAnswer> =>
    await anthropic.messages.stream(body as never).finalMessage();

  /**
   * Run it, and resume it when the server pauses.
   *
   * web_search runs a sampling loop on Anthropic's side, and when that loop
   * hits its iteration limit the turn comes back with stop_reason
   * "pause_turn" and NO final answer in it — the searches happened, the JSON
   * has not been written yet. Sending the assistant turn straight back
   * resumes it where it stopped; an extra "continue" message is wrong and the
   * API says so.
   *
   * Not handling this was a crash, not a degradation: with no text block the
   * parse read `.labs` off undefined and the run recorded "Cannot read
   * properties of undefined (reading 'map')", which says nothing about what
   * actually happened.
   */
  const withResume = async (body: { messages: unknown[] }): Promise<SearchAnswer> => {
    let answer = await once(body);
    const messages = [...body.messages];
    let continuations = 0;
    while (answer.stop_reason === 'pause_turn' && continuations < MAX_CONTINUATIONS) {
      continuations += 1;
      messages.push({ role: 'assistant', content: answer.content });
      console.warn(`[discovery] ${pincode}: server paused the tool loop, resuming (${continuations})`);
      answer = await once({ ...body, messages });
    }
    return { ...answer, continuations };
  };

  if (schemaRejected) return await withResume(withoutSchema);
  try {
    return await withResume(withSchema);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    const isSchema = err?.status === 400 && /schema/i.test(err?.message ?? '');
    if (!isSchema) throw e;
    schemaRejected = true;
    console.warn(`[discovery] ${pincode}: the API rejected the output schema (${err.message}). ` +
                 'Falling back to the prompt alone for the rest of this process — ' +
                 'ask /api/discovery/schema-check whether it still fits.');
    return await withResume(withoutSchema);
  }
}

/**
 * Take the claim, then let the search run without anybody waiting on it.
 *
 * The claim is awaited because its answer is what the caller needs: whether
 * this click bought a search or found one already running. The search itself
 * is not — it runs for minutes, and holding an HTTP request open for that long
 * is what put a white page in front of somebody working a request.
 *
 * Nothing is dropped by not awaiting it. Every outcome, including every
 * failure, is written to atlas.discovery_run by discoverForPincode's own
 * try/catch, which is where the card reads from. The one thing that must never
 * happen here is an unhandled rejection taking the process down with it, so
 * the promise carries its own catch.
 */
const NO_CREDENTIAL =
  'No Anthropic credential in this container. The app loads .env.production, ' +
  'not .env — the key has to be in the file compose actually reads. ' +
  'ANTHROPIC_API_KEY is documented in .env.production.example.';

const hasCredential = () =>
  !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export async function startDiscovery(
  pincode: string, city?: string | null, state?: string | null,
  disciplines?: string[] | null,
  trigger: DiscoveryTrigger = 'manual',
): Promise<{ claimed: boolean; error?: string }> {
  // Before the claim, not after. A claim taken for a search that cannot start
  // leaves the row marked in-flight with nothing running, and the card then
  // says "a search is already running" for two minutes about nothing.
  if (!hasCredential()) return { claimed: false, error: NO_CREDENTIAL };

  const staleDays = trigger === 'request_page' ? DISCOVERY_STALE_DAYS : 0;
  if (!(await claim(pincode, staleDays, trigger))) return { claimed: false };

  // Claimed already, so tell discoverForPincode not to claim again.
  void discoverForPincode(pincode, city, state, disciplines, { trigger, claimed: true })
    .catch((e) => console.error(`[discovery] ${pincode}: unhandled`, e));
  return { claimed: true };
}

export async function discoverForPincode(
  pincode: string, city?: string | null, state?: string | null,
  disciplines?: string[] | null,
  opts: { trigger?: DiscoveryTrigger; staleDays?: number; claimed?: boolean } = {},
): Promise<DiscoveryResult> {
  const trigger = opts.trigger ?? 'manual';
  // A human clicking "Search again" gets 0 — they asked for it, so only the
  // in-flight guard applies. The page firing on its own gets the full
  // staleness window, because nobody asked and it has to justify the spend.
  const staleDays = opts.staleDays ?? (trigger === 'request_page' ? DISCOVERY_STALE_DAYS : 0);

  if (!hasCredential()) return { found: 0, error: NO_CREDENTIAL };

  // Claimed before a rupee is spent. Two tabs opening the same request race
  // here and exactly one wins; the loser renders the winner's result.
  // startDiscovery has usually taken the claim already and says so.
  if (!opts.claimed && !(await claim(pincode, staleDays, trigger))) {
    return { found: 0, declined: true };
  }

  // Everything below is inside the try, client construction included. It was
  // outside, so a bad key or a bad config threw an unhandled rejection out of a
  // server action rather than returning an error the page could show.
  try {
    // Streamed, with a three-minute ceiling and no retry.
    //
    // It was a non-streaming call on a 45-second timeout, and in production
    // that timed out: Opus reading three listings closely enough to say
    // whether each claims NABL is minutes of work, not seconds, and a
    // non-streaming request has to hold a silent connection for all of it.
    // Streaming keeps data moving, which is what the SDK asks for on any long
    // or high-max_tokens request, and it is why the ceiling can be raised
    // without the connection going idle and being cut.
    //
    // Still no retry: a retry doubles the wall time of something a person is
    // waiting on, and the claim row means the next click picks up where this
    // left off rather than starting again from nothing.
    const anthropic = new Anthropic({ timeout: 180_000, maxRetries: 0 });
    const response = await search(anthropic, pincode, city, state, disciplines);

    if (response.stop_reason === 'refusal') {
      throw new Error(`Model declined (${response.stop_details?.category ?? 'no category'})`);
    }
    const raw = readLabs(response);
    // services and accreditation come back as comma-separated lines now — see
    // SEARCH_SCHEMA. Everything downstream works in arrays.
    const labs = raw.map((l) => ({
      ...l,
      services: splitLine(l.services),
      accreditation: splitLine(l.accreditation),
    }));

    for (const l of labs) await storeLead(pincode, city, state, l);

    await queryOne(`
      INSERT INTO atlas.discovery_run (pincode, ran_at, found, model)
      VALUES ($1, now(), $2, $3)
      ON CONFLICT (pincode) DO UPDATE SET
        ran_at = now(), found = EXCLUDED.found, model = EXCLUDED.model, error = NULL
    `, [pincode, labs.length, MODEL]);

    return { found: labs.length };
  } catch (e) {
    const msg = describe(e);
    await queryOne(`
      INSERT INTO atlas.discovery_run (pincode, ran_at, found, error)
      VALUES ($1, now(), 0, $2)
      ON CONFLICT (pincode) DO UPDATE SET ran_at = now(), error = EXCLUDED.error
    `, [pincode, msg]).catch(() => {});
    return { found: 0, error: msg };
  }
}

/**
 * Store one lead, with the pincode-level part of its score.
 *
 * `base_score` is scored with NO request disciplines, because it belongs to
 * the pincode and outlives any one request. The fit component is recomputed on
 * every read, against the request actually being looked at.
 *
 * Falls back to the pre-migration column list on 42703 so a host that has not
 * applied 20_lab_discovery_ranking.sql still gets working discovery — just
 * without the ranking.
 */
async function storeLead(
  pincode: string, city: string | null | undefined, state: string | null | undefined,
  l: LabFacts & { name: string; address?: string; source_url: string },
): Promise<void> {
  const score = scoreLead(l, null);
  const args = [
    pincode, l.name, l.address ?? null, l.phone ?? null, l.source_url,
    city ?? null, state ?? null, l.confidence ?? null, MODEL,
    l.disciplines ?? null, l.disciplines_absent ?? null,
    l.services ?? null, l.accreditation ?? null,
    l.rating ?? null, l.rating_count ?? null, l.home_collection ?? null,
    l.in_pincode ?? null, l.distance_km ?? null, l.chain ?? null,
    l.website ?? null, l.hours ?? null, l.note ?? null,
    score.total, score.reasons,
  ];
  try {
    await queryOne(`
      INSERT INTO atlas.discovered_lab
        (pincode, name, address, phone, source_url, city, state, confidence, model,
         disciplines, disciplines_absent, services, accreditation, rating, rating_count,
         home_collection, in_pincode, distance_km, chain, website, hours, note,
         base_score, score_reasons, scored_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
              $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
              $23,$24,now())
      ON CONFLICT (pincode, lower(name)) DO UPDATE SET
        address = COALESCE(EXCLUDED.address, atlas.discovered_lab.address),
        phone = COALESCE(EXCLUDED.phone, atlas.discovered_lab.phone),
        source_url = EXCLUDED.source_url,
        confidence = EXCLUDED.confidence,
        -- COALESCE throughout: a later search that happened not to find the
        -- accreditation must not erase the one an earlier search did find.
        disciplines = COALESCE(EXCLUDED.disciplines, atlas.discovered_lab.disciplines),
        disciplines_absent = COALESCE(EXCLUDED.disciplines_absent, atlas.discovered_lab.disciplines_absent),
        services = COALESCE(EXCLUDED.services, atlas.discovered_lab.services),
        accreditation = COALESCE(EXCLUDED.accreditation, atlas.discovered_lab.accreditation),
        rating = COALESCE(EXCLUDED.rating, atlas.discovered_lab.rating),
        rating_count = COALESCE(EXCLUDED.rating_count, atlas.discovered_lab.rating_count),
        home_collection = COALESCE(EXCLUDED.home_collection, atlas.discovered_lab.home_collection),
        in_pincode = COALESCE(EXCLUDED.in_pincode, atlas.discovered_lab.in_pincode),
        distance_km = COALESCE(EXCLUDED.distance_km, atlas.discovered_lab.distance_km),
        chain = COALESCE(EXCLUDED.chain, atlas.discovered_lab.chain),
        website = COALESCE(EXCLUDED.website, atlas.discovered_lab.website),
        hours = COALESCE(EXCLUDED.hours, atlas.discovered_lab.hours),
        note = COALESCE(EXCLUDED.note, atlas.discovered_lab.note),
        base_score = EXCLUDED.base_score,
        score_reasons = EXCLUDED.score_reasons,
        scored_at = now(),
        retrieved_at = now()
      -- Never overwrite something a human has already checked.
      WHERE atlas.discovered_lab.verified_at IS NULL
    `, args);
  } catch (e) {
    if ((e as { code?: string }).code !== '42703') throw e;
    await queryOne(`
      INSERT INTO atlas.discovered_lab
        (pincode, name, address, phone, source_url, city, state, confidence, model)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (pincode, lower(name)) DO UPDATE SET
        address = COALESCE(EXCLUDED.address, atlas.discovered_lab.address),
        phone = COALESCE(EXCLUDED.phone, atlas.discovered_lab.phone),
        source_url = EXCLUDED.source_url,
        confidence = EXCLUDED.confidence,
        retrieved_at = now()
      WHERE atlas.discovered_lab.verified_at IS NULL
    `, args.slice(0, 9));
  }
}

/** A lead as the page renders it. */
export type LeadRow = LabFacts & {
  id: number;
  name: string;
  address: string | null;
  retrieved_at: string;
  crm_provider_id: number | null;
  base_score: number | null;
  score_reasons: string[] | null;
};

const LEAD_COLUMNS = `
  id, name, address, phone, source_url, retrieved_at, crm_provider_id, confidence,
  disciplines, disciplines_absent, services, accreditation, rating, rating_count,
  home_collection, in_pincode, distance_km, chain, website, hours, note,
  base_score, score_reasons`;

/**
 * Read a pincode's live leads.
 *
 * Falls back to the pre-migration columns on 42703. This read sits on the
 * request detail page, which must not 500 because a migration is outstanding —
 * sql/init/ only runs on a database's first boot, so every host that already
 * exists has a window in which these columns do not. On such a host each lead
 * scores from confidence and phone alone, the ranking is uninformative, and
 * the page still renders.
 */
async function leadRows(pincode: string): Promise<LeadRow[]> {
  try {
    return await query<LeadRow>(
      `SELECT ${LEAD_COLUMNS} FROM atlas.discovered_lab
        WHERE pincode = $1 AND NOT dismissed`, [pincode]);
  } catch (e) {
    if ((e as { code?: string }).code !== '42703') throw e;
    return query<LeadRow>(`
      SELECT id, name, address, phone, source_url, retrieved_at, crm_provider_id, confidence
        FROM atlas.discovered_lab
       WHERE pincode = $1 AND NOT dismissed`, [pincode]);
  }
}

/**
 * A pincode's leads, ranked for THIS request.
 *
 * The fit component is computed here rather than stored, because the same
 * pincode legitimately ranks differently for a blood panel and an MRI.
 *
 * Every `numeric` is converted on the way through. pg returns numeric as a
 * STRING, and an unconverted one turns each weighting multiplication into
 * NaN: every total becomes NaN, the sort collapses to the tie-breaker, and the
 * page looks entirely fine while the order means nothing.
 */
export async function rankedLeadsForPincode(
  pincode: string, disciplines?: string[] | null,
): Promise<Ranked<LeadRow>[]> {
  const rows = (await leadRows(pincode)).map((r) => ({
    ...r,
    confidence: num(r.confidence),
    rating: num(r.rating),
    rating_count: num(r.rating_count),
    distance_km: num(r.distance_km),
    base_score: num(r.base_score),
  }));
  return rankLeads(rows, disciplines);
}

/**
 * When we last looked, so the UI can say so rather than implying never.
 *
 * Same 42703 fallback as the leads read, and for the same reason: both of
 * these sit on the request detail page. Hardening only one of the two leaves
 * the page 500ing on an outstanding migration, which defeats hardening either.
 */
export async function lastDiscoveryRun(
  pincode: string,
): Promise<(RunRow & { model?: string | null; trigger?: string | null }) | null> {
  try {
    return await queryOne(`
      SELECT ran_at, started_at, found, error, model, trigger
        FROM atlas.discovery_run WHERE pincode = $1`, [pincode]);
  } catch (e) {
    if ((e as { code?: string }).code !== '42703') throw e;
    return queryOne(`
      SELECT ran_at, found, error, model
        FROM atlas.discovery_run WHERE pincode = $1`, [pincode]);
  }
}
