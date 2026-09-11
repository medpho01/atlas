/**
 * Find labs on the open web for pincodes where the network has nothing.
 *
 *   npm run labs:discover -- [--limit 20] [--pincode 414001] [--dry-run] [--stale-days 30]
 *
 * Scoped deliberately: only pincodes classified SUPPLY_GAP_UNKNOWN or
 * SUPPLY_GAP_KNOWN with real unmet demand behind them. That is a couple of
 * hundred pincodes, not the 2,400 the source flags as unserviceable, so the
 * search is cheap enough to run properly and read carefully.
 *
 * Results are LEADS, not records. They land in atlas.discovered_lab marked
 * unverified, they are never merged into the lab directory, and nothing here
 * contacts anybody. A human calls, confirms, and promotes into CRM.
 *
 * The prompt, the schema, DISCIPLINE_SEARCH and the scoring all come from
 * lib/labDiscovery.ts. This script used to carry its own copies, and they had
 * drifted from the app's: different effort, different search budget, and two
 * system prompts describing different jobs. One module now, so a change to how
 * leads are ranked cannot apply to only half the leads.
 *
 * Search results are data, not instructions. Anything in a fetched page that
 * looks like a directive is ignored — the model is asked for facts in a fixed
 * schema and nothing it returns can cause Atlas to act.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import {
  SEARCH_SYSTEM, SEARCH_SCHEMA, searchPrompt, DISCOVERY_STALE_DAYS, scoreLead,
  type LabFacts,
} from '../lib/labDiscovery';

const MODEL = 'claude-opus-5';

const connectionString =
  process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.SOURCE_DATABASE_URL;
if (!connectionString) throw new Error('No database URL — set APP_DATABASE_URL.');

const pool = new Pool({ connectionString });

// Constructed lazily. --dry-run promises to stop before any search, so it must
// also work without a credential — otherwise you cannot check which pincodes
// would be searched from a machine that has no key, which is exactly when you
// most want to look first.
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error('No Anthropic credential — set ANTHROPIC_API_KEY.');
  }
  return (_client ??= new Anthropic());
}

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const LIMIT = Number(opt('--limit') ?? 20);
const ONE = opt('--pincode');
const DRY_RUN = flag('--dry-run');
const STALE_DAYS = Number(opt('--stale-days') ?? DISCOVERY_STALE_DAYS);

type Target = { pincode: string; city: string | null; state_name: string | null;
                requests: number; disciplines: string[] | null };

async function targets(): Promise<Target[]> {
  if (ONE) {
    const { rows } = await pool.query<Target>(`
      SELECT pincode, MIN(city) AS city, MIN(state_name) AS state_name, COUNT(*)::int AS requests
      FROM analytics.mv_request_state WHERE pincode = $1 GROUP BY pincode`, [ONE]);
    return rows;
  }
  const { rows } = await pool.query<Target>(`
    SELECT s.pincode, MIN(s.city) AS city, MIN(s.state_name) AS state_name, COUNT(*)::int AS requests,
           -- Every kind of centre this pincode's stranded requests need, so one
           -- search covers the pathology and the imaging asks together.
           (SELECT ARRAY_AGG(DISTINCT atlas.test_discipline(m.name))
              FROM analytics.mv_request_state s3
              JOIN atlas.request_item ri ON ri.request_id = s3.request_id
              LEFT JOIN src_local."Master" m ON m.id = ri.master_id
             WHERE s3.pincode = s.pincode) AS disciplines
    FROM analytics.mv_request_state s
    LEFT JOIN atlas.discovery_run dr ON dr.pincode = s.pincode
    WHERE s.pincode IS NOT NULL
      AND s.state IN ('SUPPLY_GAP_UNKNOWN','SUPPLY_GAP_KNOWN')
      -- Do not pay to re-search a barren pincode every night. ran_at is now
      -- nullable — a NULL means claimed-but-never-answered, which is a reason
      -- to search, not a reason to skip.
      AND (dr.pincode IS NULL OR dr.ran_at IS NULL
           OR dr.ran_at < now() - ($1 || ' days')::interval)
    GROUP BY s.pincode
    ORDER BY COUNT(*) DESC
    LIMIT $2`, [STALE_DAYS, LIMIT]);
  return rows;
}

/** Surface the API's own explanation, not just "400". */
function describe(e: unknown): string {
  const err = e as { status?: number; message?: string; error?: { error?: { message?: string } } };
  const detail = err?.error?.error?.message ?? err?.message ?? String(e);
  return err?.status ? `HTTP ${err.status}: ${detail}` : detail;
}

type FoundLab = LabFacts & {
  name: string; address?: string; source_url: string; confidence: number;
};

async function search(t: Target): Promise<FoundLab[]> {
  const response = await client().messages.create({
    model: MODEL,
    // The schema now asks for eleven more fields per lab than it used to, and
    // a truncated response is a parse failure rather than a short list.
    max_tokens: 8000,
    system: [{ type: 'text', text: SEARCH_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
    // Verifying that a business exists and is currently operating is a
    // judgement over messy sources, not a lookup — worth the effort. At 'low'
    // the new fields come back empty, every lead scores alike, and the ranking
    // says nothing.
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SEARCH_SCHEMA } },
    messages: [{
      role: 'user',
      content: searchPrompt(t.pincode, t.city, t.state_name, t.disciplines),
    }],
  } as never);

  if (response.stop_reason === 'refusal') {
    throw new Error(`Model declined (${response.stop_details?.category ?? 'no category'})`);
  }
  const text = response.content.filter((b: { type: string }) => b.type === 'text').pop();
  if (!text || text.type !== 'text') throw new Error('No text block in response');
  return JSON.parse(text.text).labs as FoundLab[];
}

/**
 * Store one lead and the pincode-level part of its score.
 *
 * Scored with NO request disciplines: base_score belongs to the pincode and
 * outlives any one request, so the fit component is left to be recomputed on
 * read against whatever request is actually being looked at.
 */
async function store(t: Target, l: FoundLab) {
  const score = scoreLead(l, null);
  await pool.query(`
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
  `, [t.pincode, l.name, l.address ?? null, l.phone ?? null, l.source_url,
      t.city, t.state_name, l.confidence ?? null, MODEL,
      l.disciplines ?? null, l.services ?? null, l.accreditation ?? null,
      l.rating ?? null, l.rating_count ?? null, l.home_collection ?? null,
      l.in_pincode ?? null, l.distance_km ?? null, l.chain ?? null,
      l.website ?? null, l.hours ?? null, l.note ?? null,
      score.total, score.reasons]);
}

async function main() {
  const list = await targets();
  console.log(`${list.length} pincode(s) to search` +
    (ONE ? '' : ` (unsearched or older than ${STALE_DAYS} days, busiest first)`));
  if (!list.length) return;

  if (DRY_RUN) {
    console.log('--dry-run: stopping before any search or write.');
    console.table(list);
    return;
  }

  let found = 0, failed = 0, skipped = 0;
  for (const t of list) {
    // The same claim the request page takes, for the same reason: the batch
    // and somebody's open tab can pick the same pincode within the same
    // minute, and only one of them should pay for it.
    //
    // --pincode is somebody naming one deliberately, so it gets the same
    // zero-day window the "Search again" button does: always allowed, except
    // over the top of a search already running. Without that, `--pincode X`
    // would silently skip a pincode it had searched last week, which is not
    // what typing it means — and the sweep's own query already filters on
    // staleness, so this claim is the concurrency guard there, not the
    // staleness one.
    const { rows: [c] } = await pool.query<{ claimed: boolean }>(
      `SELECT atlas.claim_discovery($1, $2, 'batch') AS claimed`,
      [t.pincode, ONE ? 0 : STALE_DAYS]);
    if (!c?.claimed) {
      skipped++;
      console.log(`  ${t.pincode} skipped — ` +
        (ONE ? 'a search is already running for it' : 'searched recently, or in flight elsewhere'));
      continue;
    }
    try {
      const labs = await search(t);
      for (const l of labs) await store(t, l);
      await pool.query(`
        INSERT INTO atlas.discovery_run (pincode, ran_at, found, model)
        VALUES ($1, now(), $2, $3)
        ON CONFLICT (pincode) DO UPDATE SET
          ran_at = now(), found = EXCLUDED.found, model = EXCLUDED.model, error = NULL
      `, [t.pincode, labs.length, MODEL]);
      found += labs.length;
      console.log(`  ${t.pincode} (${t.city ?? '?'}, ${t.requests} requests) → ${labs.length} lead(s)`);
    } catch (e) {
      failed++;
      const msg = describe(e);
      await pool.query(`
        INSERT INTO atlas.discovery_run (pincode, ran_at, found, error)
        VALUES ($1, now(), 0, $2)
        ON CONFLICT (pincode) DO UPDATE SET ran_at = now(), error = EXCLUDED.error
      `, [t.pincode, msg]);
      console.error(`  ${t.pincode} failed: ${msg}`);
    }
  }
  console.log(`\n${found} lead(s) across ${list.length - failed - skipped} pincode(s); ` +
              `${failed} failed, ${skipped} skipped.`);
  console.log('All unverified. Somebody has to call them before they mean anything.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
