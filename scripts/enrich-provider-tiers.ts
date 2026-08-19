/**
 * Classify each active lab into an experience tier.
 *
 *   ./scripts/enrich.sh tiers [--dry-run] [--limit N] [--reclassify]
 *
 * Unlike the city-tier job, this is not a recall task. The model is not being
 * asked what tier Apollo is; it is being asked to weigh measured signals from
 * this network — brand, centre type, city tier, price position against the
 * national median, quality composite — and say where the centre sits.
 *
 * The signal coverage is uneven and the prompt is built around that:
 *
 *   brand/chain     1,649 of 1,774 labs   the dominant signal
 *   price position    123 of 1,774        strong but rare — only labs with rates
 *   order history      97 of 1,774        rarer still
 *   name only          74 of 1,774        classify low-confidence or Unknown
 *
 * So confidence is not decoration here. A tier derived from brand alone is a
 * weaker claim than one corroborated by price, and the score has to say so,
 * because the readiness score downstream weights tier completeness.
 *
 * Per centre, never per chain: a chain's flagship and its suburban collection
 * point are different experiences, which is the distinction the tier exists to
 * capture. Human corrections are never overwritten.
 */

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';

const PROMPT_VERSION = 1;
const MODEL = 'claude-opus-5';
const BATCH = 25;

const connectionString =
  process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.SOURCE_DATABASE_URL;
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

const SYSTEM = `You assign Indian diagnostic centres to an experience tier.

The four tiers, by what a patient experiences and pays:

Affordable — neighbourhood labs and collection points. Basic premises, no
  frills, priced at or below the market median. The bulk of any network.
Prime — established regional and national brands. Clean branded centres,
  reliable turnaround, priced around 1.5x the affordable baseline.
Elite — premium hospital labs and top-end brands. Strong accreditation,
  fast reporting, hospital-grade premises, roughly 2.5x baseline.
Uber — luxury and concierge. Very few of these exist. 4x baseline or more,
  usually attached to a premium hospital or a boutique wellness brand.

You are given measured signals. Weigh them; do not recall facts about brands
you are not shown.

  brand            the chain, if any. The strongest available signal for most
                   centres — a national premium brand is rarely Affordable.
  center_type      HOSPITAL leans Elite; COLLECTION_CENTER leans Affordable
                   regardless of brand, because it is a draw point, not a lab.
  price_index      median B2B price against the national median for the same
                   tests. 1.0 is market rate. Present for few centres; when
                   present it outweighs brand.
  city_tier        context, not a tier in itself. A metro's cheapest lab is
                   still Affordable.
  health_score     operational quality 0-100. Corroborates, rarely decides.

Rules:
- Judge the centre, not the brand's flagship. A collection point carrying a
  premium brand is Prime at most, usually Affordable.
- With only a name and nothing else, return "Unknown" unless the name itself
  is unmistakable. A wrong tier is worse than an admitted gap.
- confidence must reflect the evidence: >=0.8 only with price or a clear
  brand; <=0.5 when inferring from a name alone.
- rationale: at most 14 words, naming the signal that decided it.

Return one item per input centre, echoing the id.`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          tier: { type: 'string', enum: ['Affordable', 'Prime', 'Elite', 'Uber', 'Unknown'] },
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

type LabRow = {
  lab_id: number; lab_name: string; center_type: string | null; chain_name: string | null;
  city: string | null; city_tier: string | null; price_index: string | null;
  priced_tests: number | null; has_nabl: boolean | null;
  health_score: number | null; orders_total: number | null; repeat_rate_pct: string | null;
};

const payloadOf = (l: LabRow) => ({
  id: l.lab_id,
  name: l.lab_name,
  brand: l.chain_name,
  center_type: l.center_type,
  city: l.city,
  city_tier: l.city_tier,
  price_index: l.price_index ? Number(l.price_index) : null,
  priced_tests: l.priced_tests ?? 0,
  nabl: l.has_nabl ?? false,
  health_score: l.health_score,
  orders: l.orders_total ?? 0,
});

const hashOf = (l: LabRow) =>
  createHash('sha256').update(JSON.stringify(payloadOf(l))).digest('hex').slice(0, 32);

async function pending(): Promise<LabRow[]> {
  const { rows } = await pool.query<LabRow>(`
    SELECT v.* FROM analytics.v_provider_tier_input v
    LEFT JOIN atlas.provider_tier pt ON pt.lab_id = v.lab_id
    WHERE $1::boolean
       OR pt.lab_id IS NULL
       OR (pt.source <> 'human' AND pt.prompt_version < $2)
    ORDER BY COALESCE(v.orders_total, 0) DESC, v.lab_id
    ${LIMIT ? `LIMIT ${Number(LIMIT)}` : ''}
  `, [RECLASSIFY, PROMPT_VERSION]);
  // Skip rows whose inputs are unchanged — same contract as the catalogue job.
  if (RECLASSIFY) return rows;
  const { rows: seen } = await pool.query<{ lab_id: number; input_hash: string }>(
    `SELECT lab_id, input_hash FROM atlas.provider_tier WHERE input_hash IS NOT NULL`);
  const known = new Map(seen.map((s) => [s.lab_id, s.input_hash]));
  return rows.filter((l) => known.get(l.lab_id) !== hashOf(l));
}

async function classify(batch: LabRow[]) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    // Weighing several signals per centre, not recalling a fact — worth more
    // effort than the city job, which is a lookup.
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: JSON.stringify({ centres: batch.map(payloadOf) }) }],
  } as never);

  if (response.stop_reason === 'refusal') {
    throw new Error(`Model declined the batch (${response.stop_details?.category ?? 'no category'})`);
  }
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('No text block in response');
  return JSON.parse(text.text).items as
    { id: number; tier: string; rationale?: string; confidence: number }[];
}

async function main() {
  const labs = await pending();
  console.log(`${labs.length} centres to classify${RECLASSIFY ? ' (--reclassify)' : ''}`);
  if (!labs.length) return;

  if (DRY_RUN) {
    console.log('--dry-run: stopping before any API call or write.');
    console.log(JSON.stringify(labs.slice(0, 3).map(payloadOf), null, 2));
    return;
  }

  const byId = new Map(labs.map((l) => [l.lab_id, l]));
  let done = 0, written = 0, failed = 0;

  for (let i = 0; i < labs.length; i += BATCH) {
    const batch = labs.slice(i, i + BATCH);
    try {
      for (const item of await classify(batch)) {
        const l = byId.get(item.id);
        if (!l) continue;
        await pool.query(`
          INSERT INTO atlas.provider_tier
            (lab_id, tier, rationale, confidence, evidence, source, model, prompt_version, input_hash, updated_at)
          VALUES ($1, $2, $3, $4, $5, 'llm', $6, $7, $8, now())
          ON CONFLICT (lab_id) DO UPDATE SET
            tier = EXCLUDED.tier, rationale = EXCLUDED.rationale,
            confidence = EXCLUDED.confidence, evidence = EXCLUDED.evidence,
            model = EXCLUDED.model, prompt_version = EXCLUDED.prompt_version,
            input_hash = EXCLUDED.input_hash, updated_at = now()
          WHERE atlas.provider_tier.source <> 'human'
        `, [l.lab_id, item.tier, item.rationale ?? null, item.confidence ?? null,
            JSON.stringify(payloadOf(l)), MODEL, PROMPT_VERSION, hashOf(l)]);
        written++;
      }
    } catch (e) {
      failed += batch.length;
      console.error(`  batch ${Math.floor(i / BATCH) + 1} failed: ${(e as Error).message}`);
    }
    done += batch.length;
    console.log(`  ${done}/${labs.length} · ${written} written · ${failed} failed`);
  }

  const { rows } = await pool.query(`
    SELECT tier, COUNT(*)::int AS centres, ROUND(AVG(confidence), 2) AS avg_confidence
    FROM atlas.provider_tier GROUP BY 1 ORDER BY 2 DESC`);
  console.table(rows);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
