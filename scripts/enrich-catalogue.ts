/**
 * Classify the LabStack catalogue into Atlas's commercial taxonomy.
 *
 *   npm run catalogue:enrich -- --stage tests    [--limit 200] [--dry-run]
 *   npm run catalogue:enrich -- --stage packages [--limit 50]  [--dry-run]
 *
 * Why this exists: LabStack tags tests clinically (LabDepartment) and for
 * billing (ROUTINE / NON_ROUTINE). Neither answers "what have we got for
 * nutrition", which is how every account conversation actually opens. Only
 * ~27% of tests even carry a department, so the commercial axis has to be
 * created rather than derived.
 *
 * Three properties this job is built around:
 *
 *   Idempotent — every row stores a hash of what the classifier saw. A re-run
 *   skips unchanged rows, so a second pass over 12k tests is nearly free and
 *   only new or edited tests cost anything.
 *
 *   Corrections stick — rows with source='human' are never touched. Somebody
 *   fixing a wrong category is making a permanent decision, not one that
 *   survives until the next run.
 *
 *   Auditable — model and prompt_version are stored per row, and each run is
 *   logged to atlas.enrichment_run. If a prompt revision degrades the output,
 *   the affected rows are identifiable by prompt_version alone.
 *
 * Reads LabStack through the read-only FDW; writes only to atlas.*.
 */

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';

// Bump when the prompt or taxonomy changes meaningfully — it invalidates
// nothing on its own, but it makes "which rows came from the old prompt"
// answerable, and `--reclassify` re-runs anything below the current version.
const PROMPT_VERSION = 1;
const MODEL = 'claude-opus-5';

/** Tests per request. Large enough to amortise the cached system prompt,
 *  small enough that one bad batch costs little to retry. */
const TEST_BATCH = 40;
const PACKAGE_BATCH = 15;
const CONCURRENCY = 4;

type Args = { stage: 'tests' | 'packages'; limit?: number; dryRun: boolean; reclassify: boolean; all: boolean };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const stage = (get('--stage') ?? 'tests') as Args['stage'];
  if (stage !== 'tests' && stage !== 'packages') {
    throw new Error(`--stage must be "tests" or "packages", got "${stage}"`);
  }
  const limitRaw = get('--limit');
  return {
    stage,
    limit: limitRaw ? Number(limitRaw) : undefined,
    dryRun: argv.includes('--dry-run'),
    reclassify: argv.includes('--reclassify'),
    all: argv.includes('--all'),
  };
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const anthropic = new Anthropic();

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);

// ---------------------------------------------------------------- taxonomy --

type Category = { key: string; label: string; blurb: string | null };

async function loadCategories(): Promise<Category[]> {
  const { rows } = await pool.query<Category>(
    `SELECT key, label, blurb FROM atlas.catalogue_category ORDER BY sort_order`,
  );
  if (!rows.length) throw new Error('atlas.catalogue_category is empty — apply sql/init/08_catalogue.sql first');
  return rows;
}

/** The stable half of the prompt. Cached, so it is paid for once per run
 *  rather than once per batch — it is the largest fixed cost here. */
function systemPrompt(categories: Category[], stage: Args['stage']): string {
  const taxonomy = categories.map((c) => `- ${c.key} — ${c.label}: ${c.blurb ?? ''}`).join('\n');

  const shared = `You classify an Indian diagnostics catalogue into commercial categories used by a sales team.

The categories are how a customer conversation is framed, not how a lab is organised. A test belongs to a category when someone shopping for that category would expect to find it there.

Available categories:
${taxonomy}

Rules:
- Assign every item 1–3 categories. Choose the ones a buyer would search; do not pad the list.
- ANNUAL_HEALTH_CHECK is for broad multi-system screening, not for any single test that happens to appear in a check-up.
- If an item is genuinely unclassifiable (an administrative line item, a duplicate, a courier or handling charge), return an empty category list and a confidence at or below 0.3.
- confidence is your own certainty, 0 to 1. Be honest: a low score routes the item to human review rather than being discarded.
- Never invent a category key. Use only the keys listed above, exactly as written.
- Indian catalogue conventions apply: names are frequently abbreviated, inconsistently cased, and carry local brand or panel names.`;

  if (stage === 'tests') {
    return `${shared}

For each test also write:
- consumer_name: the test in plain English, as you would print it on a package sheet for a corporate client. Keep any name the client would recognise. Under 60 characters.
- why_it_matters: one sentence, under 20 words, saying what it tells you. Plain language, no clinical jargon, no diagnostic claims or advice.`;
  }

  return `${shared}

You are classifying packages — bundles of tests sold as one item. You are given each package's name and its actual test composition.

For each package also write:
- intent: who this package is for, in one line under 15 words. Ground it in the tests listed, not only in the name.
- positioning: one sentence a salesperson can say about what makes this package worth buying. Under 25 words, no clinical claims.

Where a package name and its composition disagree, trust the composition and lower your confidence.`;
}

// -------------------------------------------------------- structured output --

const testSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          categories: { type: 'array', items: { type: 'string' } },
          consumer_name: { type: 'string' },
          why_it_matters: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['id', 'categories', 'consumer_name', 'why_it_matters', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

const packageSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          categories: { type: 'array', items: { type: 'string' } },
          intent: { type: 'string' },
          positioning: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['id', 'categories', 'intent', 'positioning', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

type Usage = { input: number; output: number; cached: number };

async function classify(
  system: string,
  payload: unknown,
  schema: unknown,
): Promise<{ items: Record<string, unknown>[]; usage: Usage }> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    // Bulk classification against a fixed taxonomy: low effort is the right
    // trade here, and it is the main cost lever on a 12k-row catalogue.
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  } as never);

  if (response.stop_reason === 'refusal') {
    throw new Error(`Model declined the batch (${response.stop_details?.category ?? 'no category'})`);
  }
  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('No text block in response');

  return {
    items: JSON.parse(text.text).items ?? [],
    usage: {
      input: response.usage.input_tokens ?? 0,
      output: response.usage.output_tokens ?? 0,
      cached: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}

// --------------------------------------------------------------- the stages --

type TestRow = {
  id: number; name: string; department: string | null; sample_type: string | null;
  aliases: string[] | null; description: string | null; hsc: boolean; is_profile: boolean;
  sub_tests: string[] | null;
};

/**
 * Defaults to the sellable catalogue — the ~2.5k tests carrying at least one
 * lab rate, which is everything a salesperson can actually quote. The other
 * ~10k Master rows have no price anywhere and would be classified only to sit
 * unquotable behind a filter. `--all` covers them when that changes.
 */
async function fetchTests(limit?: number, all = false): Promise<TestRow[]> {
  const { rows } = await pool.query<TestRow>(`
    SELECT m.id, m.name, d.department, st."sampleType" AS sample_type,
           m.aliases, m."testDescription" AS description,
           m.hsc, m."isTestProfile" AS is_profile, m."subTests" AS sub_tests
    FROM src."Master" m
    LEFT JOIN src."LabDepartment" d ON d.id = m."labDepartment_id"
    LEFT JOIN src."SampleType"   st ON st.id = m."sampleType_id"
    ${all ? '' : 'WHERE EXISTS (SELECT 1 FROM analytics.mv_test_catalog c WHERE c.master_id = m.id)'}
    ORDER BY m.id
    ${limit ? `LIMIT ${Number(limit)}` : ''}
  `);
  return rows;
}

/** Only the fields the classifier sees — so the hash changes exactly when the
 *  classification could reasonably change, and not when an unrelated column does. */
const testInput = (t: TestRow) => ({
  id: t.id,
  name: t.name,
  department: t.department,
  sample: t.sample_type,
  aliases: t.aliases?.slice(0, 6) ?? [],
  description: t.description?.slice(0, 400) ?? null,
  health_screening_flag: t.hsc,
  is_panel: t.is_profile,
  sub_tests: t.sub_tests?.slice(0, 25) ?? [],
});

type PackageRow = {
  id: number; name: string; is_custom: boolean; description: string | null;
  order_types: string[] | null; tat: number | null;
  linked_tests: string[] | null; text_tests: string[] | null;
};

async function fetchPackages(limit?: number): Promise<PackageRow[]> {
  const { rows } = await pool.query<PackageRow>(`
    SELECT p.id, p."packageName" AS name, p."isCustom" AS is_custom, p.description,
           p."orderTypes"::text[] AS order_types, p."defaultTat" AS tat,
           ARRAY(SELECT m.name FROM src."_MasterToPackage" mp
                 JOIN src."Master" m ON m.id = mp."A"
                 WHERE mp."B" = p.id ORDER BY m.name)         AS linked_tests,
           p."panelSubTests"                                   AS text_tests
    FROM src."Package" p
    WHERE p.active
    ORDER BY p.id
    ${limit ? `LIMIT ${Number(limit)}` : ''}
  `);
  return rows;
}

const packageInput = (p: PackageRow) => ({
  id: p.id,
  name: p.name,
  custom_built: p.is_custom,
  description: p.description?.slice(0, 300) ?? null,
  modalities: p.order_types ?? [],
  turnaround_hours: p.tat,
  // Structural composition where we have it; the free-text panel list is a
  // display field and only used when nothing is linked.
  tests: p.linked_tests?.length ? p.linked_tests : (p.text_tests ?? []),
  composition_source: p.linked_tests?.length ? 'linked' : 'text_only',
});

// ------------------------------------------------------------------ runner --

async function pooled<T>(items: T[], n: number, worker: (item: T, i: number) => Promise<void>) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        await worker(items[i], i);
      }
    }),
  );
}

async function main() {
  const args = parseArgs();
  const startedAt = new Date();
  const categories = await loadCategories();
  const validKeys = new Set(categories.map((c) => c.key));
  const system = systemPrompt(categories, args.stage);

  const table = args.stage === 'tests' ? 'atlas.test_enrichment' : 'atlas.package_enrichment';
  const idCol = args.stage === 'tests' ? 'master_id' : 'package_id';

  // Existing state, so we can skip unchanged rows and never touch human edits.
  const { rows: existing } = await pool.query<{ id: number; input_hash: string; source: string; prompt_version: number }>(
    `SELECT ${idCol} AS id, input_hash, source, prompt_version FROM ${table}`,
  );
  const seen = new Map(existing.map((r) => [r.id, r]));

  const source = args.stage === 'tests'
    ? await fetchTests(args.limit, args.all)
    : await fetchPackages(args.limit);
  const toInput = args.stage === 'tests'
    ? (r: unknown) => testInput(r as TestRow)
    : (r: unknown) => packageInput(r as PackageRow);

  const pending: { id: number; payload: ReturnType<typeof toInput>; hash: string }[] = [];
  let skippedHuman = 0;
  let skippedUnchanged = 0;

  for (const row of source as { id: number }[]) {
    const payload = toInput(row);
    const h = hash(payload);
    const prev = seen.get(row.id);
    if (prev?.source === 'human') { skippedHuman++; continue; }
    if (prev && prev.input_hash === h && prev.prompt_version >= PROMPT_VERSION && !args.reclassify) {
      skippedUnchanged++; continue;
    }
    pending.push({ id: row.id, payload, hash: h });
  }

  console.log(
    `${args.stage}: ${source.length} in catalogue · ${pending.length} to classify · ` +
    `${skippedUnchanged} unchanged · ${skippedHuman} human-edited (protected)`,
  );
  if (args.dryRun) {
    console.log('--dry-run: stopping before any API call or write.');
    console.log(JSON.stringify(pending.slice(0, 2).map((p) => p.payload), null, 2));
    await pool.end();
    return;
  }
  if (!pending.length) { await pool.end(); return; }

  const size = args.stage === 'tests' ? TEST_BATCH : PACKAGE_BATCH;
  const schema = args.stage === 'tests' ? testSchema : packageSchema;
  const batches = Array.from({ length: Math.ceil(pending.length / size) }, (_, i) =>
    pending.slice(i * size, (i + 1) * size),
  );

  const usage: Usage = { input: 0, output: 0, cached: 0 };
  let classified = 0;
  let failed = 0;
  const t0 = Date.now();

  await pooled(batches, CONCURRENCY, async (batch, bi) => {
    const byId = new Map(batch.map((b) => [b.id, b]));
    let items: Record<string, unknown>[];
    try {
      const res = await classify(system, { items: batch.map((b) => b.payload) }, schema);
      items = res.items;
      usage.input += res.usage.input; usage.output += res.usage.output; usage.cached += res.usage.cached;
    } catch (err) {
      // One bad batch must not lose the run's work — the rows simply stay
      // unclassified and are picked up by the next invocation.
      failed += batch.length;
      console.error(`  batch ${bi + 1}/${batches.length} failed: ${(err as Error).message}`);
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of items) {
        const id = Number(item.id);
        const rec = byId.get(id);
        if (!rec) continue; // model returned an id we didn't ask about
        const cats = (item.categories as string[] ?? []).filter((c) => validKeys.has(c));

        if (args.stage === 'tests') {
          await client.query(`
            INSERT INTO atlas.test_enrichment
              (master_id, categories, consumer_name, why_it_matters, confidence,
               source, model, prompt_version, input_hash, updated_at)
            VALUES ($1,$2,$3,$4,$5,'llm',$6,$7,$8, now())
            ON CONFLICT (master_id) DO UPDATE SET
              categories = EXCLUDED.categories, consumer_name = EXCLUDED.consumer_name,
              why_it_matters = EXCLUDED.why_it_matters, confidence = EXCLUDED.confidence,
              model = EXCLUDED.model, prompt_version = EXCLUDED.prompt_version,
              input_hash = EXCLUDED.input_hash, updated_at = now()
            WHERE atlas.test_enrichment.source <> 'human'
          `, [id, cats, item.consumer_name ?? null, item.why_it_matters ?? null,
              item.confidence ?? null, MODEL, PROMPT_VERSION, rec.hash]);
        } else {
          await client.query(`
            INSERT INTO atlas.package_enrichment
              (package_id, categories, intent, positioning, confidence,
               source, model, prompt_version, input_hash, updated_at)
            VALUES ($1,$2,$3,$4,$5,'llm',$6,$7,$8, now())
            ON CONFLICT (package_id) DO UPDATE SET
              categories = EXCLUDED.categories, intent = EXCLUDED.intent,
              positioning = EXCLUDED.positioning, confidence = EXCLUDED.confidence,
              model = EXCLUDED.model, prompt_version = EXCLUDED.prompt_version,
              input_hash = EXCLUDED.input_hash, updated_at = now()
            WHERE atlas.package_enrichment.source <> 'human'
          `, [id, cats, item.intent ?? null, item.positioning ?? null,
              item.confidence ?? null, MODEL, PROMPT_VERSION, rec.hash]);
        }
        classified++;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      failed += batch.length;
      console.error(`  batch ${bi + 1} write failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }

    const done = bi + 1;
    if (done % 5 === 0 || done === batches.length) {
      const pct = Math.round((done / batches.length) * 100);
      console.log(`  ${done}/${batches.length} batches (${pct}%) · ${classified} classified · ${failed} failed`);
    }
  });

  // Opus 5 list rates. Cache reads bill at ~0.1x, which is where most of the
  // fixed taxonomy prompt lands after the first batch.
  const cost = ((usage.input - usage.cached) * 5 + usage.cached * 0.5 + usage.output * 25) / 1e6;

  await pool.query(`
    INSERT INTO atlas.enrichment_run
      (stage, model, prompt_version, considered, classified, skipped, failed,
       input_tokens, output_tokens, cached_tokens, started_at, note)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [args.stage, MODEL, PROMPT_VERSION, source.length, classified,
      skippedUnchanged + skippedHuman, failed, usage.input, usage.output, usage.cached,
      startedAt, `~$${cost.toFixed(2)}`]);

  console.log(
    `\n${args.stage}: ${classified} classified, ${failed} failed in ${Math.round((Date.now() - t0) / 1000)}s\n` +
    `tokens: ${usage.input.toLocaleString()} in (${usage.cached.toLocaleString()} cached), ` +
    `${usage.output.toLocaleString()} out · ~$${cost.toFixed(2)}`,
  );
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
