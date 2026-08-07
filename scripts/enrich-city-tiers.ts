/**
 * Classify the cities Atlas sees into Tier 1 / 2 / 3.
 *
 *   npm run cities:enrich            [--limit 50] [--dry-run] [--reclassify]
 *
 * City, state and pincode all exist on Lab already — every lab quoting a
 * package carries all three, so none of that needs a model. Tier does not
 * exist anywhere at source, and it's the axis network planning uses: the same
 * package price means one thing in a metro and another in a tier-3 town.
 *
 * Classified once per city and cached in atlas.city_tier. 392 distinct cities
 * appear across the labs that quote packages, so this is one small job rather
 * than a per-export cost — the answer for "Pune" does not change between runs.
 *
 * Same three properties as the catalogue enricher: a re-run skips rows already
 * classified at the current prompt version, rows corrected by a human are
 * never overwritten, and model + prompt_version are stored per row.
 *
 * Reads LabStack through the read-only FDW; writes only to atlas.*.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';

const PROMPT_VERSION = 1;
const MODEL = 'claude-opus-5';
const BATCH = 60;

const connectionString =
  process.env.APP_DATABASE_URL ??
  process.env.DATABASE_URL ??
  process.env.SOURCE_DATABASE_URL;

if (!connectionString) throw new Error('No database URL — set APP_DATABASE_URL.');
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  throw new Error('No Anthropic credential — set ANTHROPIC_API_KEY in the environment.');
}

const pool = new Pool({ connectionString });
const anthropic = new Anthropic();

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const LIMIT = opt('--limit') ? Number(opt('--limit')) : undefined;
const DRY_RUN = flag('--dry-run');
const RECLASSIFY = flag('--reclassify');

const SYSTEM = `You classify Indian cities into market tiers for a diagnostics network.

Use the common Indian business convention:

Tier 1 — the eight metros and their contiguous urban agglomerations:
  Mumbai, Delhi (incl. New Delhi), Bengaluru, Hyderabad, Chennai, Kolkata,
  Pune, Ahmedabad. Satellite cities inside those agglomerations count as
  Tier 1 when they function as part of the metro: Gurugram, Noida, Ghaziabad,
  Faridabad, Navi Mumbai, Thane, Secunderabad.

Tier 2 — established state capitals and large regional centres, roughly
  1–5 million: Jaipur, Lucknow, Kanpur, Nagpur, Indore, Bhopal, Patna,
  Vadodara, Coimbatore, Kochi, Visakhapatnam, Surat, Ludhiana, Chandigarh,
  Nashik, Rajkot, Varanasi, Guwahati, Bhubaneswar, Mysuru, and similar.

Tier 3 — everything else: district towns, smaller cities, semi-urban centres.

Rules:
- Judge the city, not the state. A small town in Maharashtra is Tier 3.
- "states" lists every state spelling seen at source for that city, and may be
  empty — the field is unreliable. Judge on the city name; use states only as a
  hint. If a name exists in several states with different tiers and the states
  field does not settle it, pick the larger and say so in the rationale.
- If the name is unrecognisable, a spelling you cannot place, or clearly not
  a city (a locality, a building, a person's name), return "Unknown" rather
  than guessing. Unknown is a useful answer; a wrong tier is not.
- confidence: 0.0–1.0, how sure you are of the tier.
- rationale: at most 12 words.

Return one item per input city, in the same order, with the id echoed back.`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tier: { type: 'string', enum: ['Tier 1', 'Tier 2', 'Tier 3', 'Unknown'] },
          rationale: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['id', 'tier', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

type CityRow = { city_key: string; city: string; states: string | null; labs: number };

/**
 * Cities worth classifying: those attached to a lab that actually quotes a
 * package. The Lab table holds thousands more that quote nothing, and
 * classifying them would be spend with no reader.
 */
async function pending(): Promise<CityRow[]> {
  const { rows } = await pool.query<CityRow>(`
    SELECT regexp_replace(lower(TRIM(l.city)), '[^a-z0-9]', '', 'g') AS city_key,
           MIN(TRIM(l.city)) AS city,
           string_agg(DISTINCT NULLIF(TRIM(l.state), '-'), ', ') AS states,
           COUNT(*)::int     AS labs
    FROM src."Lab" l
    WHERE NULLIF(TRIM(l.city), '') IS NOT NULL
      AND EXISTS (SELECT 1 FROM analytics.mv_lab_packages lp
                  WHERE lp.lab_id = l.id AND lp.b2b > 10)
      AND (
        $1::boolean
        OR NOT EXISTS (
          SELECT 1 FROM atlas.city_tier ct
          WHERE ct.city_key = regexp_replace(lower(TRIM(l.city)), '[^a-z0-9]', '', 'g')
            AND (ct.source = 'human' OR ct.prompt_version >= $2)
        )
      )
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    ${LIMIT ? `LIMIT ${Number(LIMIT)}` : ''}
  `, [RECLASSIFY, PROMPT_VERSION]);
  return rows;
}

async function classify(batch: CityRow[]) {
  const payload = batch.map((c) => ({ id: c.city_key, city: c.city, states: c.states }));

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    // A fixed, well-known taxonomy applied to short inputs — low effort is the
    // right trade, and it keeps a 392-city pass inexpensive.
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: JSON.stringify({ cities: payload }) }],
  } as never);

  if (response.stop_reason === 'refusal') {
    throw new Error(`Model declined the batch (${response.stop_details?.category ?? 'no category'})`);
  }
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('No text block in response');
  return JSON.parse(text.text).items as
    { id: string; tier: string; rationale?: string; confidence: number }[];
}

async function main() {
  const cities = await pending();
  console.log(
    `${cities.length} cities to classify` +
    (RECLASSIFY ? ' (--reclassify: everything, human corrections still protected)' : ''),
  );
  if (!cities.length) return;

  if (DRY_RUN) {
    console.log('--dry-run: stopping before any API call or write.');
    console.log(cities.slice(0, 10));
    return;
  }

  const byKey = new Map(cities.map((c) => [c.city_key, c]));
  let done = 0, written = 0, failed = 0;

  for (let i = 0; i < cities.length; i += BATCH) {
    const batch = cities.slice(i, i + BATCH);
    try {
      const items = await classify(batch);
      for (const item of items) {
        const c = byKey.get(item.id);
        if (!c) continue;   // model invented a key; ignore rather than write junk
        await pool.query(`
          INSERT INTO atlas.city_tier
            (city_key, city, states, tier, rationale, confidence, source, model, prompt_version, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'llm', $7, $8, now())
          ON CONFLICT (city_key) DO UPDATE SET
            tier = EXCLUDED.tier, rationale = EXCLUDED.rationale,
            confidence = EXCLUDED.confidence, model = EXCLUDED.model,
            prompt_version = EXCLUDED.prompt_version, updated_at = now()
          WHERE atlas.city_tier.source <> 'human'
        `, [c.city_key, c.city, c.states, item.tier, item.rationale ?? null,
            item.confidence ?? null, MODEL, PROMPT_VERSION]);
        written++;
      }
    } catch (e) {
      failed += batch.length;
      console.error(`  batch ${i / BATCH + 1} failed: ${(e as Error).message}`);
    }
    done += batch.length;
    console.log(`  ${done}/${cities.length} · ${written} written · ${failed} failed`);
  }

  const { rows } = await pool.query(
    `SELECT tier, COUNT(*)::int AS cities FROM atlas.city_tier GROUP BY 1 ORDER BY 1`,
  );
  console.table(rows);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
