import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { query, queryOne } from './db';
import {
  SEARCH_SYSTEM, SEARCH_SCHEMA, searchPrompt, DISCOVERY_STALE_DAYS,
  scoreLead, rankLeads, num, isSearchRunning, shouldAutoSearch,
  type LabFacts, type RunRow, type Ranked,
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
export { isSearchRunning, shouldAutoSearch };

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
  return key ? `${base} (key …${key.slice(-4)})` : base;
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

export async function discoverForPincode(
  pincode: string, city?: string | null, state?: string | null,
  disciplines?: string[] | null,
  opts: { trigger?: DiscoveryTrigger; staleDays?: number } = {},
): Promise<DiscoveryResult> {
  const trigger = opts.trigger ?? 'manual';
  // A human clicking "Search again" gets 0 — they asked for it, so only the
  // in-flight guard applies. The page firing on its own gets the full
  // staleness window, because nobody asked and it has to justify the spend.
  const staleDays = opts.staleDays ?? (trigger === 'request_page' ? DISCOVERY_STALE_DAYS : 0);

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return {
      found: 0,
      error: 'No Anthropic credential in this container. The app loads .env.production, ' +
             'not .env — the key has to be in the file compose actually reads. ' +
             'ANTHROPIC_API_KEY is documented in .env.production.example.',
    };
  }

  // Claimed before a rupee is spent. Two tabs opening the same request race
  // here and exactly one wins; the loser renders the winner's result.
  if (!(await claim(pincode, staleDays, trigger))) {
    return { found: 0, declined: true };
  }

  // Everything below is inside the try, client construction included. It was
  // outside, so a bad key or a bad config threw an unhandled rejection out of a
  // server action rather than returning an error the page could show.
  try {
    // 45 seconds, no retry.
    //
    // This runs inside a server action, so the browser holds an open HTTP
    // request for its whole duration. Reverse proxies commonly cut idle
    // responses at 60s, and when that happens the client never receives an
    // answer at all — the button spins forever and no error is ever shown.
    // Better to fail inside the window with something to read than to exceed
    // it and hang. A retry would double the wall time, so there isn't one.
    const anthropic = new Anthropic({ timeout: 45_000, maxRetries: 0 });
    const response = await anthropic.messages.create({
      model: MODEL,
      // 4000 was enough for four labs of name, address and phone. The schema
      // now asks for disciplines, accreditation, ratings, hours and a note per
      // lab, and a truncated response is a parse failure, not a short list.
      max_tokens: 8000,
      system: [{ type: 'text', text: SEARCH_SYSTEM, cache_control: { type: 'ephemeral' } }],
      // Four, not six: each use pulls page content back through the model,
      // and memory is the binding constraint in this container.
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
      // 'medium', not 'low'. At low effort the model answers out of the search
      // snippets and leaves every new field empty — which makes every lead
      // score alike and the whole ranking pointless. Reading a listing closely
      // enough to say whether it claims NABL is the work here, not a lookup.
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SEARCH_SCHEMA } },
      messages: [{ role: 'user', content: searchPrompt(pincode, city, state, disciplines) }],
    } as never);

    if (response.stop_reason === 'refusal') {
      throw new Error(`Model declined (${response.stop_details?.category ?? 'no category'})`);
    }
    const text = response.content.filter((b: { type: string }) => b.type === 'text').pop();
    if (!text || text.type !== 'text') throw new Error('No text block in response');
    const labs = JSON.parse(text.text).labs as (LabFacts & {
      name: string; address?: string; source_url: string; confidence: number;
    })[];

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
    l.disciplines ?? null, l.services ?? null, l.accreditation ?? null,
    l.rating ?? null, l.rating_count ?? null, l.home_collection ?? null,
    l.in_pincode ?? null, l.distance_km ?? null, l.chain ?? null,
    l.website ?? null, l.hours ?? null, l.note ?? null,
    score.total, score.reasons,
  ];
  try {
    await queryOne(`
      INSERT INTO atlas.discovered_lab
        (pincode, name, address, phone, source_url, city, state, confidence, model,
         disciplines, services, accreditation, rating, rating_count, home_collection,
         in_pincode, distance_km, chain, website, hours, note,
         base_score, score_reasons, scored_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
              $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
              $22,$23,now())
      ON CONFLICT (pincode, lower(name)) DO UPDATE SET
        address = COALESCE(EXCLUDED.address, atlas.discovered_lab.address),
        phone = COALESCE(EXCLUDED.phone, atlas.discovered_lab.phone),
        source_url = EXCLUDED.source_url,
        confidence = EXCLUDED.confidence,
        -- COALESCE throughout: a later search that happened not to find the
        -- accreditation must not erase the one an earlier search did find.
        disciplines = COALESCE(EXCLUDED.disciplines, atlas.discovered_lab.disciplines),
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
  disciplines, services, accreditation, rating, rating_count, home_collection,
  in_pincode, distance_km, chain, website, hours, note, base_score, score_reasons`;

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
