/**
 * Exercise the discovery READ path against a real Postgres.
 *
 *   npm run test:discovery-read
 *
 * Runs against whatever APP_DATABASE_URL points at, so the maintainer can
 * point it at the actual Atlas database in one command — before applying
 * sql/init/20_lab_discovery_ranking.sql, and again after.
 *
 * It exists for two failures that both look like nothing is wrong:
 *
 *   1. pg returns `numeric` as a STRING. Unconverted, every weighting
 *      multiplication becomes NaN, every total becomes NaN, the sort collapses
 *      to the tie-breaker, and the page renders a confident order that means
 *      nothing. Reading the code does not catch this. This asserts that pg
 *      really does hand back strings AND that what comes out of
 *      rankedLeadsForPincode() is numbers.
 *
 *   2. sql/init/ runs once, on a database's first boot, so every host that
 *      already exists has a window where the new columns do not. BOTH reads on
 *      the request detail page — the leads and the run row — have to survive
 *      that, or the page 500s over an outstanding migration. Hardening one of
 *      the two is the easy mistake, so both are called here on both kinds of
 *      database.
 *
 * Writes only to the sentinel pincode below, and deletes what it wrote. It
 * refuses to touch anything else.
 *
 * Note the invocation: --conditions=react-server. lib/discoverLabs.ts is
 * `import 'server-only'`, which throws outside a React server context. That
 * import is correct and should stay — it is also exactly why the scoring lives
 * in lib/labDiscovery.ts, which needs no such trick (see npm run test:scoring).
 * Here we want the real read path, imports and all, so we give Node the
 * resolution condition Next would.
 */

import 'dotenv/config';
import { pool, query } from '../lib/db';
import { rankedLeadsForPincode, lastDiscoveryRun } from '../lib/discoverLabs';

/** Not an assigned Indian pincode. Nothing real can collide with it. */
const PIN = '000000';

let passed = 0;
const failures: string[] = [];

function check(what: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${what}`); }
  else {
    failures.push(`${what}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${what}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Is the migration applied here? Decides what to assert, not whether to run. */
async function migrated(): Promise<boolean> {
  const rows = await query<{ n: string }>(`
    SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = 'atlas' AND table_name = 'discovered_lab'
       AND column_name = 'base_score'`);
  return Number(rows[0]?.n) > 0;
}

async function cleanup() {
  // Belt and braces: the literal is the sentinel, and nothing else is passed.
  await query(`DELETE FROM atlas.discovered_lab WHERE pincode = $1`, [PIN]);
  await query(`DELETE FROM atlas.discovery_run WHERE pincode = $1`, [PIN]);
}

/**
 * Four leads whose right order is not their insertion order, so a collapsed
 * sort shows up as a wrong answer rather than as a coincidence.
 */
async function seed(withNewColumns: boolean) {
  await cleanup();
  if (!withNewColumns) {
    // Pre-migration shape: the eight columns that have always existed.
    for (const [name, phone, conf] of [
      ['Old Shape A', '02211110000', 0.4],
      ['Old Shape B', '02222220000', 0.9],
    ] as [string, string, number][]) {
      await query(`
        INSERT INTO atlas.discovered_lab (pincode, name, phone, source_url, confidence)
        VALUES ($1, $2, $3, 'https://example.test/old', $4)`, [PIN, name, phone, conf]);
    }
    await query(`
      INSERT INTO atlas.discovery_run (pincode, found) VALUES ($1, 2)
      ON CONFLICT (pincode) DO UPDATE SET found = 2`, [PIN]);
    return;
  }

  await query(`
    INSERT INTO atlas.discovered_lab
      (pincode, name, phone, source_url, confidence, disciplines, accreditation,
       rating, rating_count, home_collection, in_pincode, distance_km,
       website, hours, note, base_score, score_reasons, scored_at)
    VALUES
      -- Deliberately first in, and should not come out first on an imaging
      -- request: a confirmed pathology-only lab, however well credentialled.
      ($1, 'Zeta Pathology Chain', '02211110000', 'https://example.test/zeta', 0.95,
       ARRAY['PATHOLOGY'], ARRAY['NABL'], 4.6, 900, true, true, NULL,
       'https://zeta.test', '7am-9pm', 'Regional chain', 71.2,
       ARRAY['nabl accredited'], now()),
      -- The one that should win it.
      ($1, 'Alpha Imaging Centre', '02222220000', 'https://example.test/alpha', 0.78,
       ARRAY['RADIOLOGY'], NULL, 4.1, 44, false, true, NULL,
       NULL, NULL, 'Has a 1.5T scanner', 58.0, ARRAY['in the pincode'], now()),
      -- Says nothing about what it does. Must not be buried under the
      -- mismatch: unknown is not "no".
      ($1, 'Mid Unknown Lab', '02233330000', 'https://example.test/mid', 0.6,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
       47.5, NULL, now()),
      -- Dismissed. Must never be read back at all.
      ($1, 'Dismissed Lab', '02244440000', 'https://example.test/x', 0.99,
       ARRAY['RADIOLOGY'], ARRAY['NABL'], 5.0, 500, true, true, 1.5,
       NULL, NULL, NULL, 90.0, NULL, now())`, [PIN]);
  await query(`UPDATE atlas.discovered_lab SET dismissed = true
                WHERE pincode = $1 AND name = 'Dismissed Lab'`, [PIN]);
  await query(`
    INSERT INTO atlas.discovery_run (pincode, ran_at, started_at, found, trigger)
    VALUES ($1, now() - interval '3 hours', now() - interval '3 hours', 3, 'batch')
    ON CONFLICT (pincode) DO UPDATE SET
      ran_at = now() - interval '3 hours', found = 3, trigger = 'batch'`, [PIN]);
}

async function main() {
  const isMigrated = await migrated();
  console.log(`\nDatabase: ${isMigrated ? 'MIGRATED' : 'NOT migrated'} ` +
              `(atlas.discovered_lab.base_score ${isMigrated ? 'exists' : 'does not exist'})`);
  console.log(isMigrated
    ? 'Asserting the ranking reads back correctly.'
    : 'Asserting the page survives an outstanding migration.');

  await seed(isMigrated);

  // -----------------------------------------------------------------------
  console.log('\nBoth reads on the request detail page return something');
  // -----------------------------------------------------------------------
  const leads = await rankedLeadsForPincode(PIN, ['RADIOLOGY']);
  check('the leads read did not throw', true);
  const run = await lastDiscoveryRun(PIN);
  check('the run-row read did not throw', true);
  check('the run row came back', !!run, JSON.stringify(run));
  check('dismissed leads are not read back',
    !leads.some((l) => l.name === 'Dismissed Lab'));

  if (!isMigrated) {
    // This is the whole point of the unmigrated pass: no 42703 escaping, and
    // a usable page rather than a 500.
    check('leads still come back without the new columns', leads.length === 2,
      `got ${leads.length}`);
    check('they are still ranked, and every total is a finite number',
      leads.every((l) => Number.isFinite(l.score.total)),
      leads.map((l) => `${l.name}=${l.score.total}`).join(', '));
    check('confidence still converts to a number',
      leads.every((l) => l.confidence === null || typeof l.confidence === 'number'));
    check('the new fields read as absent rather than breaking',
      leads.every((l) => l.rating == null && l.accreditation == null));
    check('ranks are still 1..n', leads.every((l, i) => l.rank === i + 1));
    check('the higher-confidence lead ranks first',
      leads[0].name === 'Old Shape B',
      leads.map((l) => `${l.name}=${l.score.total}`).join(', '));
    console.log('\nThe detail page reads clean on a host that has not applied the migration.');
  } else {
    // ---------------------------------------------------------------------
    console.log('\npg returns numeric as a string, and the read converts it');
    // ---------------------------------------------------------------------
    const raw = await query<Record<string, unknown>>(`
      SELECT rating, confidence, distance_km, base_score
        FROM atlas.discovered_lab
       WHERE pincode = $1 AND name = 'Zeta Pathology Chain'`, [PIN]);
    // Asserted, not assumed. If a pg upgrade ever changes this, the trap the
    // conversion guards against has gone away and this test should say so
    // rather than keep passing for the wrong reason.
    check('pg really does hand numeric back as a string',
      typeof raw[0].rating === 'string' && typeof raw[0].confidence === 'string',
      `rating is ${typeof raw[0].rating}, confidence is ${typeof raw[0].confidence}`);

    const zeta = leads.find((l) => l.name === 'Zeta Pathology Chain')!;
    check('rating comes out of the read path as a number', typeof zeta.rating === 'number',
      `${typeof zeta.rating}: ${String(zeta.rating)}`);
    check('confidence comes out as a number', typeof zeta.confidence === 'number');
    check('base_score comes out as a number', typeof zeta.base_score === 'number');
    check('rating_count comes out as a number', typeof zeta.rating_count === 'number');
    const withDist = leads.find((l) => l.distance_km != null);
    check('distance_km comes out as a number when set',
      withDist == null || typeof withDist.distance_km === 'number');

    // The failure the conversion prevents, stated as its symptom: not one
    // total may be NaN, because NaN sorts as a tie and nothing looks wrong.
    check('no score total is NaN',
      leads.every((l) => Number.isFinite(l.score.total)),
      leads.map((l) => `${l.name}=${l.score.total}`).join(', '));
    check('no component is NaN',
      leads.every((l) => l.score.components.every((c) => Number.isFinite(c.points))));
    check('the totals are not all equal, so the order carries information',
      new Set(leads.map((l) => l.score.total)).size > 1,
      leads.map((l) => l.score.total).join(', '));

    // ---------------------------------------------------------------------
    console.log('\nThe order is the ranking, against this request');
    // ---------------------------------------------------------------------
    check('an imaging request puts the imaging centre first',
      leads[0].name === 'Alpha Imaging Centre',
      leads.map((l) => `${l.name}=${l.score.total}`).join(' > '));
    check('the pathology-only chain does not outrank the unknown lab',
      leads.findIndex((l) => l.name === 'Mid Unknown Lab') <
      leads.findIndex((l) => l.name === 'Zeta Pathology Chain'),
      leads.map((l) => l.name).join(' > '));
    check('scores descend down the list',
      leads.every((l, i) => i === 0 || leads[i - 1].score.total >= l.score.total));
    check('every lead carries reasons or caveats to show',
      leads.every((l) => l.score.reasons.length + l.score.caveats.length > 0));

    // The same rows, ranked for a different ask, must come out differently —
    // that is the reason fit is computed on read and not stored.
    const forPath = await rankedLeadsForPincode(PIN, ['PATHOLOGY']);
    check('the same pincode ranks differently for a pathology request',
      forPath[0].name === 'Zeta Pathology Chain',
      forPath.map((l) => `${l.name}=${l.score.total}`).join(' > '));
    check('...while base_score, the stored part, is unchanged by the ask',
      forPath.find((l) => l.name === 'Zeta Pathology Chain')!.base_score ===
      leads.find((l) => l.name === 'Zeta Pathology Chain')!.base_score);

    // ---------------------------------------------------------------------
    console.log('\nThe run row tells running from finished');
    // ---------------------------------------------------------------------
    check('started_at is read back', run?.started_at != null);
    check('trigger is read back', (run as { trigger?: string })?.trigger === 'batch');
    check('a finished run reports ran_at', run?.ran_at != null);
  }

  await cleanup();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.error('\nFailures:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  }
}

main()
  .catch(async (e) => {
    console.error('\nThe read path threw, which is the failure this test is for:');
    console.error(e);
    // A leaked 42703 is the specific bug: it means one of the two reads on the
    // request detail page is not hardened against an outstanding migration.
    if ((e as { code?: string }).code === '42703') {
      console.error('\nPostgres 42703 (undefined column) escaped a read. One of the two ' +
                    'reads on the request detail page is missing its fallback.');
    }
    await cleanup().catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => pool.end());
