/**
 * Fixtures that hold the lab ranking in place.
 *
 *   npm run test:scoring
 *
 * No database, no API key, no Next. That is the whole reason lib/labDiscovery.ts
 * imports nothing — the scoring is the part of this feature that decides which
 * lab a person phones first, and it is the part that can be checked properly
 * without production data.
 *
 * Each case below is a claim about what the ranking is FOR, not a snapshot of
 * what it currently returns. If a weight changes and a case fails, the case is
 * the thing to argue with first.
 */

import {
  scoreLead, rankLeads, scoreBand, adjustedRating, shouldAutoSearch, isSearchRunning,
  WEIGHTS, WEIGHT_TOTAL, num, type LabFacts, type RunRow,
} from '../lib/labDiscovery';

let passed = 0;
const failures: string[] = [];

function check(what: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${what}`); }
  else { failures.push(`${what}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${what}${detail ? ` — ${detail}` : ''}`); }
}

function group(name: string) { console.log(`\n${name}`); }

/**
 * A believable, unremarkable lead. Cases override only what they are about,
 * so what each one is testing is the only thing that differs.
 *
 * `id` is optional because rankLeads() uses it as the last tie-breaker, and
 * the stability cases below need to set it.
 */
type Fixture = LabFacts & { name: string; id?: number };
const base = (over: Partial<Fixture> & { name: string }): Fixture => ({
  phone: '02224001234',
  source_url: 'https://example.test/listing',
  confidence: 0.8,
  in_pincode: true,
  ...over,
});

// ---------------------------------------------------------------------------
group('The weights are what the table in the PR says');
// ---------------------------------------------------------------------------

check('the five weights sum to 100', WEIGHT_TOTAL === 100, `got ${WEIGHT_TOTAL}`);
check('fit is the largest single component',
  Object.values(WEIGHTS).every((w) => w <= WEIGHTS.fit));
check('rating is the smallest',
  Object.values(WEIGHTS).every((w) => w >= WEIGHTS.rating));
{
  // Nothing known at all still has to produce a number in range, because a
  // lead with almost no facts is the normal case in a supply-gap pincode.
  const empty = scoreLead({ name: 'Bare' }, null);
  check('a lead with no facts at all scores inside 0..100',
    empty.total >= 0 && empty.total <= 100, `got ${empty.total}`);
  check('component points never exceed their max',
    empty.components.every((c) => c.points <= c.max));
  check('every component is explained',
    empty.components.every((c) => c.detail.length > 0));
}

// ---------------------------------------------------------------------------
group('An imaging request must not rank a NABL pathology chain first');
// ---------------------------------------------------------------------------
{
  // The failure this is here to prevent: the best-credentialled lab in the
  // pincode goes to the top of an MRI request, somebody phones it, and it
  // cannot do MRIs. That is the Google tab this feature is replacing.
  const pathologyChain = base({
    name: 'Metropolis Diagnostics',
    disciplines: ['PATHOLOGY'],
    accreditation: ['NABL'],
    rating: 4.6, rating_count: 900,
    home_collection: true, website: 'https://metro.test', hours: '7am-9pm',
    confidence: 0.95,
  });
  const smallImaging = base({
    name: 'Shree Imaging Centre',
    disciplines: ['RADIOLOGY'],
    confidence: 0.7,
  });

  const ranked = rankLeads([pathologyChain, smallImaging], ['RADIOLOGY']);
  check('the imaging centre ranks first on an imaging request',
    ranked[0].name === 'Shree Imaging Centre',
    `got ${ranked.map((r) => `${r.name} ${r.score.total}`).join(' | ')}`);
  check('the pathology chain is flagged as the wrong kind of centre',
    ranked[1].score.caveats.some((c) => /wrong kind of centre/.test(c)));

  // ...and the same two rows must flip on a pathology request, or the fit
  // component is doing nothing.
  const flipped = rankLeads([pathologyChain, smallImaging], ['PATHOLOGY']);
  check('the same two flip on a pathology request',
    flipped[0].name === 'Metropolis Diagnostics',
    `got ${flipped.map((r) => `${r.name} ${r.score.total}`).join(' | ')}`);

  // A lab that says nothing about what it does must not be buried under a
  // confirmed mismatch: silence is not a "no".
  const silent = base({ name: 'Unknown Kind Lab', confidence: 0.7 });
  const mixed = rankLeads([pathologyChain, silent], ['RADIOLOGY']);
  check('a lab that does not say what it does beats a confirmed mismatch',
    mixed[0].name === 'Unknown Kind Lab',
    `got ${mixed.map((r) => `${r.name} ${r.score.total}`).join(' | ')}`);

  // The near-zero fit component was not enough on its own to achieve that:
  // the chain lost fit by 16 points and won the other four by more. The
  // discount is what makes "scored down hard" bite on the total, so it is
  // asserted directly rather than only through the order above.
  const mismatch = scoreLead(pathologyChain, ['RADIOLOGY']);
  check('a confirmed mismatch is discounted on the total, not just on fit',
    !!mismatch.discount, 'no discount recorded');
  check('the discount is explained, so the chip and the hover agree',
    !!mismatch.discount?.why);
  check('nothing else triggers the discount',
    !scoreLead(pathologyChain, ['PATHOLOGY']).discount &&
    !scoreLead(silent, ['RADIOLOGY']).discount &&
    !scoreLead(pathologyChain, null).discount);
  check('a partial cover is not treated as a mismatch',
    !scoreLead(pathologyChain, ['PATHOLOGY', 'RADIOLOGY']).discount);
  check('a partially-covering lab still beats a fully mismatched one',
    rankLeads([pathologyChain, smallImaging], ['PATHOLOGY', 'RADIOLOGY'])
      .every((r) => r.score.total > 0));
}

// ---------------------------------------------------------------------------
group('A mixed lab is recognised from the DATA, not from an inferred rule');
// ---------------------------------------------------------------------------
{
  // The real-world case this is for: a great many Indian businesses called
  // "... Pathology Lab" also run X-ray, ultrasound and ECG at their main
  // branch. The fix is that the search reports both disciplines, not that the
  // scoring guesses one from the other — a guess cannot be made safe here,
  // because a strong pathology chain outscores a sparse imaging centre by more
  // than the whole 32-point fit component (see MISMATCH_DISCOUNT).
  const mixedChain = base({
    name: 'Suyash Scan & Pathology',
    disciplines: ['PATHOLOGY', 'RADIOLOGY'],
    accreditation: ['NABL'], rating: 4.4, rating_count: 386, home_collection: true,
  });
  const pureScanCentre = base({ name: 'City Scan Centre', disciplines: ['RADIOLOGY'] });

  check('a path lab that ALSO reports imaging is a full match on an imaging ask',
    scoreLead(mixedChain, ['RADIOLOGY']).components.find((c) => c.key === 'fit')!.points === 32);
  check('...and on a pathology ask',
    scoreLead(mixedChain, ['PATHOLOGY']).components.find((c) => c.key === 'fit')!.points === 32);
  check('...and on a package needing both',
    scoreLead(mixedChain, ['PATHOLOGY', 'RADIOLOGY']).components.find((c) => c.key === 'fit')!.points === 32);
  check('a mixed lab is never discounted for either ask',
    !scoreLead(mixedChain, ['RADIOLOGY']).discount &&
    !scoreLead(mixedChain, ['PATHOLOGY']).discount);

  // disciplines_absent upgrades an inferred mismatch to a stated one. It must
  // change the WORDS the caller sees without weakening the penalty.
  const statedNoImaging = base({
    name: 'Collection Point Only', disciplines: ['PATHOLOGY'],
    disciplines_absent: ['RADIOLOGY'],
  });
  const inferredNoImaging = base({ name: 'Just A Path Lab', disciplines: ['PATHOLOGY'] });

  const stated = scoreLead(statedNoImaging, ['RADIOLOGY']);
  const inferred = scoreLead(inferredNoImaging, ['RADIOLOGY']);
  check('a STATED absence is still discounted', !!stated.discount);
  check('an INFERRED absence is still discounted', !!inferred.discount);
  check('the two are scored the same — the data changes the words, not the penalty',
    stated.total === inferred.total, `${stated.total} vs ${inferred.total}`);
  check('a stated absence says the listing said so',
    stated.caveats.some((c) => /listing states it does not do/.test(c)),
    stated.caveats.join('; '));
  check('an inferred absence admits it is only what the listing showed',
    inferred.caveats.some((c) => /listing only shows/.test(c)),
    inferred.caveats.join('; '));

  // On a mixed ask, an explicitly ruled-out gap must cost more than a silent
  // one — otherwise reporting the absence honestly would gain the lab nothing.
  const silentGap = scoreLead(
    base({ name: 'Silent', disciplines: ['PATHOLOGY'] }), ['PATHOLOGY', 'RADIOLOGY']);
  const statedGap = scoreLead(
    base({ name: 'Stated', disciplines: ['PATHOLOGY'], disciplines_absent: ['RADIOLOGY'] }),
    ['PATHOLOGY', 'RADIOLOGY']);
  check('on a mixed ask, a stated gap scores below a silent one',
    statedGap.total < silentGap.total, `${statedGap.total} vs ${silentGap.total}`);
  check('but a stated gap is still not a full mismatch',
    !statedGap.discount && statedGap.total > scoreLead(pureScanCentre, ['PATHOLOGY']).total);
  check('positive evidence of absence is never invented from silence',
    !scoreLead(base({ name: 'X', disciplines: ['PATHOLOGY'] }), ['PATHOLOGY'])
      .caveats.some((c) => /states it does not/.test(c)));
}

// ---------------------------------------------------------------------------
group('Ratings are discounted by review volume');
// ---------------------------------------------------------------------------
{
  check('4.4 from 380 beats 5.0 from 3, once discounted',
    adjustedRating(4.4, 380) > adjustedRating(5.0, 3),
    `${adjustedRating(4.4, 380).toFixed(3)} vs ${adjustedRating(5.0, 3).toFixed(3)}`);

  // The same claim end-to-end through the ranking, because a correct
  // adjustedRating() wired up wrongly would still get the order wrong.
  const thin = base({ name: 'Perfect Five Lab', rating: 5.0, rating_count: 3 });
  const deep = base({ name: 'Four Four Lab', rating: 4.4, rating_count: 380 });
  const ranked = rankLeads([thin, deep], null);
  check('and it beats it in the ranking too',
    ranked[0].name === 'Four Four Lab',
    `got ${ranked.map((r) => `${r.name} ${r.score.total}`).join(' | ')}`);
  check('the three-review lead says so in its caveats',
    ranked[1].score.caveats.some((c) => /only 3 reviews/.test(c)));

  check('a lot of reviews moves the rating close to its face value',
    Math.abs(adjustedRating(4.4, 5000) - 4.4) < 0.01);
  check('a rating with no count is treated as unrated',
    scoreLead(base({ name: 'X', rating: 4.9, rating_count: null }), null)
      .components.find((c) => c.key === 'rating')!.detail.includes('No public rating'));
}

// ---------------------------------------------------------------------------
group('Unknown is not "no"');
// ---------------------------------------------------------------------------
{
  const unrated = base({ name: 'Quiet Lab' });
  const badlyRated = base({ name: 'Badly Rated Lab', rating: 2.6, rating_count: 140 });

  const ranked = rankLeads([badlyRated, unrated], null);
  check('an unrated lab outranks a badly-rated one',
    ranked[0].name === 'Quiet Lab',
    `got ${ranked.map((r) => `${r.name} ${r.score.total}`).join(' | ')}`);

  // ...but not by a landslide. The rating component is 15 points and it is
  // the weakest signal here; if silence became a big win, every listed lab
  // would lose to every unlisted one.
  const gap = ranked[0].score.total - ranked[1].score.total;
  check('but not by a landslide (under 15 points)', gap < 15, `gap was ${gap}`);
  check('and the gap is real, not zero', gap > 0, `gap was ${gap}`);

  // Accreditation ladder, including the rung for "nothing published".
  const withAcc = (acc: string[] | null) =>
    scoreLead(base({ name: 'L', accreditation: acc }), null)
      .components.find((c) => c.key === 'accreditation')!.points;
  const nabl = withAcc(['NABL']);
  const iso = withAcc(['ISO 9001:2015']);
  const none = withAcc(null);
  check('NABL > ISO', nabl > iso, `${nabl} vs ${iso}`);
  check('ISO > nothing published', iso > none, `${iso} vs ${none}`);
  check('nothing published is mid-band, not zero',
    none > WEIGHTS.accreditation * 0.35 && none < WEIGHTS.accreditation * 0.6,
    `${none} of ${WEIGHTS.accreditation}`);
  check('NABH sits between ICMR and ISO',
    withAcc(['ICMR']) > withAcc(['NABH']) && withAcc(['NABH']) > iso);
  check('CAP is weighed like NABL', withAcc(['CAP']) === nabl);
  check('an unrecognised mark scores like nothing published',
    withAcc(['Trusted Partner']) === none);
  check('the best mark wins when several are claimed',
    withAcc(['ISO 9001', 'NABL']) === nabl);

  // Every unknown has to be on the call agenda, or the score quietly stands
  // in for a fact nobody checked.
  const bare = scoreLead({ name: 'Bare' }, ['PATHOLOGY']);
  for (const expect of [/accreditation/, /rating/, /phone number/, /in the pincode/, /can do pathology/]) {
    check(`a bare lead's caveats mention ${expect}`,
      bare.caveats.some((c) => expect.test(c)), bare.caveats.join('; '));
  }
}

// ---------------------------------------------------------------------------
group('Reachability: a lead with no phone number is not yet a lead');
// ---------------------------------------------------------------------------
{
  const withPhone = scoreLead(base({ name: 'A' }), null).total;
  const without = scoreLead(base({ name: 'A', phone: null }), null).total;
  check('a phone number is worth points', withPhone > without);
  check('and it is the biggest part of reachability',
    withPhone - without > WEIGHTS.reach * 0.4, `worth ${(withPhone - without).toFixed(1)}`);

  const reach = (o: Partial<LabFacts>) =>
    scoreLead(base({ name: 'L', ...o }), null).components.find((c) => c.key === 'reach')!.points;
  check('in the pincode beats 8 km away',
    reach({ in_pincode: true }) > reach({ in_pincode: false, distance_km: 8 }));
  check('8 km away beats 60 km away',
    reach({ in_pincode: false, distance_km: 8 }) > reach({ in_pincode: false, distance_km: 60 }));
  check('an unstated location scores between in-pincode and far away',
    reach({ in_pincode: null }) < reach({ in_pincode: true }) &&
    reach({ in_pincode: null }) > reach({ in_pincode: false, distance_km: 60 }));
  check('home collection offered beats home collection refused',
    reach({ home_collection: true }) > reach({ home_collection: false }));
  check('home collection unstated sits between the two',
    reach({ home_collection: null }) > reach({ home_collection: false }) &&
    reach({ home_collection: null }) < reach({ home_collection: true }));
}

// ---------------------------------------------------------------------------
group('Evidence it is operating');
// ---------------------------------------------------------------------------
{
  const live = (o: Partial<LabFacts>) =>
    scoreLead(base({ name: 'L', ...o }), null).components.find((c) => c.key === 'liveness')!.points;
  check('higher search confidence scores higher',
    live({ confidence: 0.95 }) > live({ confidence: 0.4 }));
  check('corroborating signals add to it',
    live({ website: 'https://x.test', hours: '9-6', rating_count: 90 }) > live({}));
  check('missing confidence is scored mid, not zero',
    live({ confidence: null }) > 0 && live({ confidence: null }) < live({ confidence: 1 }));
  check('a low-confidence lead says so in its caveats',
    scoreLead(base({ name: 'L', confidence: 0.3 }), null)
      .caveats.some((c) => /not confident/.test(c)));
}

// ---------------------------------------------------------------------------
group('The order does not depend on the order the rows arrived in');
// ---------------------------------------------------------------------------
{
  // Two people looking at the same request have to see the same list, or
  // "the third one" stops meaning anything in a thread.
  const leads = [
    base({ id: 1, name: 'Alpha Diagnostics', accreditation: ['NABL'], rating: 4.5, rating_count: 200 }),
    base({ id: 2, name: 'Beta Labs', rating: 4.1, rating_count: 60 }),
    base({ id: 3, name: 'Gamma Scan', disciplines: ['RADIOLOGY'] }),
    base({ id: 4, name: 'Delta Path', disciplines: ['PATHOLOGY'], phone: null }),
    // Deliberately identical to Beta on every scored field, so only the
    // tie-breaker separates them.
    base({ id: 5, name: 'Beta Labs Annexe', rating: 4.1, rating_count: 60 }),
  ];

  const order = (xs: typeof leads) => rankLeads(xs, ['PATHOLOGY']).map((r) => r.name).join(' > ');
  const forward = order(leads);
  const reversed = order([...leads].reverse());
  const shuffled = order([leads[2], leads[4], leads[0], leads[3], leads[1]]);
  check('reversing the input does not change the order', forward === reversed,
    `${forward}  vs  ${reversed}`);
  check('shuffling the input does not change the order', forward === shuffled,
    `${forward}  vs  ${shuffled}`);
  check('ranks are 1..n with no gaps',
    rankLeads(leads, null).every((r, i) => r.rank === i + 1));
  check('an empty list ranks to an empty list', rankLeads([], null).length === 0);
}

// ---------------------------------------------------------------------------
group('numeric arrives from pg as a string');
// ---------------------------------------------------------------------------
{
  // The trap this guards: unconverted, every weighting multiplication becomes
  // NaN, the sort collapses to the tie-breaker, and nothing looks wrong.
  check('num parses a numeric string', num('4.40') === 4.4);
  check('num passes a number through', num(0.85) === 0.85);
  check('num maps null and empty to null', num(null) === null && num('') === null);
  check('num maps rubbish to null rather than NaN', num('not a number') === null);

  // The shape rankedLeadsForPincode() converts before ranking. If that
  // conversion were dropped, these strings would reach the arithmetic.
  const asPgReturnsIt = {
    name: 'Stringly Lab',
    confidence: '0.80' as unknown as number,
    rating: '4.40' as unknown as number,
    rating_count: 380,
    distance_km: '3.50' as unknown as number,
  };
  const scored = scoreLead(asPgReturnsIt, null);
  check('a score computed from numeric strings is still a finite number',
    Number.isFinite(scored.total) && scored.total > 0, `got ${scored.total}`);
}

// ---------------------------------------------------------------------------
group('Bands');
// ---------------------------------------------------------------------------
{
  check('bands run strong > promising > thin > weak',
    scoreBand(90).key === 'strong' && scoreBand(65).key === 'promising' &&
    scoreBand(50).key === 'thin' && scoreBand(20).key === 'weak');
  check('every band has a label and a tone',
    [90, 65, 50, 20].every((n) => !!scoreBand(n).label && !!scoreBand(n).tone));
}

// ---------------------------------------------------------------------------
group('shouldAutoSearch mirrors claim_discovery');
// ---------------------------------------------------------------------------
{
  // The same seven branches the SQL is exercised against in
  // scripts/test-discovery-db.sh. If these two answers diverge, the card
  // announces a search the database then declines.
  const now = Date.UTC(2026, 8, 11, 12, 0, 0);
  const ago = (mins: number) => new Date(now - mins * 60_000).toISOString();
  const run = (o: Partial<RunRow>): RunRow =>
    ({ ran_at: null, started_at: null, found: 0, error: null, ...o });

  check('never searched (no row) → search', shouldAutoSearch(null, 30, now));
  check('in flight 30s ago → do not search',
    !shouldAutoSearch(run({ started_at: ago(0.5) }), 30, now));
  check('answered 1h ago with leads → do not search',
    !shouldAutoSearch(run({ ran_at: ago(60), started_at: ago(61), found: 3 }), 30, now));
  check('answered empty 2h ago → do not search yet',
    !shouldAutoSearch(run({ ran_at: ago(120), started_at: ago(121), found: 0 }), 30, now));
  check('answered empty 2 days ago → search again',
    shouldAutoSearch(run({ ran_at: ago(60 * 48), started_at: ago(60 * 48), found: 0 }), 30, now));
  check('failed 2 days ago → search again',
    shouldAutoSearch(run({ ran_at: ago(60 * 48), started_at: ago(60 * 48), found: 2, error: 'HTTP 429' }), 30, now));
  check('40 days stale with leads → search again',
    shouldAutoSearch(run({ ran_at: ago(60 * 24 * 40), started_at: ago(60 * 24 * 40), found: 3 }), 30, now));
  check('crashed 10 minutes ago, never answered → search again',
    shouldAutoSearch(run({ started_at: ago(10), ran_at: null }), 30, now));
  check('stale_days 0 re-searches anything not in flight',
    shouldAutoSearch(run({ ran_at: ago(60), started_at: ago(61), found: 3 }), 0, now));
  check('stale_days 0 still refuses over a running search',
    !shouldAutoSearch(run({ started_at: ago(0.5) }), 0, now));

  check('isSearchRunning is true inside the 2-minute window',
    isSearchRunning(run({ started_at: ago(1) }), now));
  check('isSearchRunning is false outside it',
    !isSearchRunning(run({ started_at: ago(5) }), now));
  check('isSearchRunning is false with no row at all', !isSearchRunning(null, now));
  check('a Date is accepted as well as a string',
    isSearchRunning({ ran_at: null, started_at: new Date(now - 30_000), found: 0, error: null }, now));
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('The ranking still means what the PR says it means.');
}
