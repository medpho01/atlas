/**
 * Fixtures that hold the places sources in place.
 *
 *   npm run test:discovery-sources
 *
 * No database, no API key, no network, no Next — same reason
 * scripts/test-lab-scoring.ts has none. lib/discoverySources.ts imports only
 * the pure scoring module, so the parts of it that decide what a lead looks
 * like and which source gets asked can be checked properly without spending a
 * rupee or holding a credential.
 *
 * The response fixtures are hand-written from each provider's published shape.
 * They are NOT recordings of live calls — no credentials were available when
 * this was written, which is exactly why the parsers read several plausible
 * field names rather than one. `npm run labs:discover -- --probe <pincode>` is
 * what proves them against a real response, and the field names are the thing
 * to expect to adjust.
 */

import {
  sourcesConfig, anySourceConfigured, queriesFor, distanceKm, placeFacts,
  disciplinesFrom, mapplsToLead, olaToLead, googleToLead, searchSources,
  type SourceTarget, type PlaceSource, type SourceName, type SourceLead,
} from '../lib/discoverySources';

let passed = 0;
const failures: string[] = [];

function check(what: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${what}`); }
  else { failures.push(`${what}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${what}${detail ? ` — ${detail}` : ''}`); }
}

// Shrigonda, Ahmednagar — a real supply-gap pincode with a real centroid.
const T: SourceTarget = {
  pincode: '413736', city: 'Shrigonda', state: 'Maharashtra',
  disciplines: ['PATHOLOGY'], lat: 18.6167, lng: 74.7000,
};

const env = (over: Record<string, string | undefined>) =>
  ({ ...over } as unknown as NodeJS.ProcessEnv);

// ---------------------------------------------------------------------------
console.log('\nthe chain is configuration, not code');
{
  check('the default chain puts the free Indian directory first',
    sourcesConfig(env({})).chain.join(',') === 'mappls,ola,google');
  check('and the metered global provider last',
    sourcesConfig(env({})).chain.at(-1) === 'google');
  check('the order can be changed without touching code',
    sourcesConfig(env({ DISCOVERY_SOURCES: 'google,mappls' })).chain.join(',') === 'google,mappls');
  const typo = sourcesConfig(env({ DISCOVERY_SOURCES: 'mappls,gogle,ola' }));
  check('a typo is dropped rather than crashing at import time',
    typo.chain.join(',') === 'mappls,ola', typo.chain.join(','));
  check('and the typo is reported rather than swallowed',
    typo.ignored.join(',') === 'gogle', typo.ignored.join(','));
  check('no credential means no source can run',
    anySourceConfigured(env({})) === false);
  check('one key is enough to have a source',
    anySourceConfigured(env({ GOOGLE_PLACES_API_KEY: 'k' })) === true);
  check('a key for a source not in the chain does not count',
    anySourceConfigured(env({ DISCOVERY_SOURCES: 'mappls', GOOGLE_PLACES_API_KEY: 'k' })) === false);
}

// ---------------------------------------------------------------------------
console.log('\nwhat gets typed into a places search');
{
  const q = queriesFor(T);
  check('the pincode is in every query', q.every((s) => s.includes('413736')), q.join(' | '));
  check('the city is too, because a bare pincode is a weak search term',
    q.every((s) => s.includes('Shrigonda')));
  check('a pathology ask does not search for MRI centres',
    !q.join(' ').toLowerCase().includes('mri'), q.join(' | '));
  const both = queriesFor({ ...T, disciplines: ['PATHOLOGY', 'RADIOLOGY'] });
  check('asking for two disciplines still costs at most three calls', both.length <= 3, String(both.length));
  check('and an imaging ask does search for imaging',
    both.join(' ').toLowerCase().includes('imaging'));
}

// ---------------------------------------------------------------------------
console.log('\nplace facts are measured, not asserted');
{
  check('a known distance is about right',
    Math.abs(distanceKm(18.6167, 74.7, 18.6167, 74.8) - 10.5) < 1.5,
    String(distanceKm(18.6167, 74.7, 18.6167, 74.8)));

  const named = placeFacts(T, 'Main Rd, Shrigonda 413736', null, null);
  check('an address naming the pincode is in the pincode', named.in_pincode === true);

  const far = placeFacts(T, 'Pune', 18.5204, 73.8567);
  check('a place 80 km away is not in the pincode', far.in_pincode === false);
  check('and its distance is recorded', (far.distance_km ?? 0) > 50, String(far.distance_km));

  const blind = placeFacts(T, 'Somewhere', null, null);
  check('an address that says nothing and no coordinates is unknown, not outside',
    blind.in_pincode === null && blind.distance_km === null);

  const noCentroid = placeFacts({ ...T, lat: null, lng: null }, 'Somewhere', 18.6, 74.7);
  check('a pincode with no centroid cannot measure distance, and says so',
    noCentroid.in_pincode === null && noCentroid.distance_km === null);
}

// ---------------------------------------------------------------------------
console.log('\nreading a listing');
{
  check('a pathology lab reads as pathology',
    (disciplinesFrom('Shree Sai Pathology Laboratory', null) ?? []).includes('PATHOLOGY'));
  check('an MRI centre reads as radiology',
    (disciplinesFrom('Suyash MRI and CT Scan Centre', null) ?? []).includes('RADIOLOGY'));
  check('an unrecognisable name falls back to what was asked for',
    (disciplinesFrom('Agarwal Centre', ['RADIOLOGY']) ?? []).join(',') === 'RADIOLOGY');
  check('and a listing never claims a discipline is ABSENT',
    mapplsToLead({ placeName: 'X', placeAddress: 'Y' }, T)?.disciplines_absent == null);
}

// ---------------------------------------------------------------------------
console.log('\nMappls');
{
  const hit = mapplsToLead({
    placeName: 'Shree Sai Pathology Lab',
    placeAddress: 'Nagar-Manmad Rd, Shrigonda 413736',
    tel: '02487222333', latitude: 18.6167, longitude: 74.7, eLoc: 'ABC123',
  }, T);
  check('the name is read', hit?.name === 'Shree Sai Pathology Lab');
  check('the phone is read', hit?.phone === '02487222333');
  check('the address naming the pincode makes it in-pincode', hit?.in_pincode === true);
  check('the eLoc becomes a link somebody can open', (hit?.source_url ?? '').includes('ABC123'));
  check('Mappls publishes no rating, and we do not invent one',
    hit?.rating === null && hit?.rating_count === null);

  check('a row with no name at all is not a lead', mapplsToLead({ placeAddress: 'x' }, T) === null);

  // The alternate shape: the suggest endpoint names things differently.
  const alt = mapplsToLead({ poi: 'Jai Diagnostics', address: 'Bazar Peth 413736', mobileNo: '9876543210' }, T);
  check('the other field names Mappls ships are read too',
    alt?.name === 'Jai Diagnostics' && alt?.phone === '9876543210');
}

// ---------------------------------------------------------------------------
console.log('\nOla');
{
  const hit = olaToLead({
    name: 'Nagar Diagnostic Centre',
    formatted_address: 'MIDC Rd, Shrigonda 413736',
    geometry: { location: { lat: 18.6167, lng: 74.7 } },
    rating: 4.2, user_ratings_total: 31, place_id: 'ola-1',
  }, T);
  check('the name is read', hit?.name === 'Nagar Diagnostic Centre');
  check('the rating and its count are both kept',
    hit?.rating === 4.2 && hit?.rating_count === 31);
  check('the pincode fit is worked out', hit?.in_pincode === true);
}

// ---------------------------------------------------------------------------
console.log('\nGoogle');
{
  const hit = googleToLead({
    id: 'g1', displayName: { text: 'Metropolis Labs' },
    formattedAddress: 'Station Rd, Shrigonda 413736',
    nationalPhoneNumber: '024 8712 3456', rating: 4.6, userRatingCount: 214,
    location: { latitude: 18.6167, longitude: 74.7 }, types: ['medical_lab'],
    websiteUri: 'https://example.test', businessStatus: 'OPERATIONAL',
  }, T);
  check('the display name is unwrapped', hit?.name === 'Metropolis Labs');
  check('the rating count comes through', hit?.rating_count === 214);
  check('the place id becomes a maps link', (hit?.source_url ?? '').includes('g1'));

  const closed = googleToLead({
    id: 'g2', displayName: { text: 'Gone Diagnostics' }, businessStatus: 'CLOSED_PERMANENTLY',
  }, T);
  check('a permanently closed place is not offered as a lead at all', closed === null);

  const temp = googleToLead({
    id: 'g3', displayName: { text: 'Paused Diagnostics' }, businessStatus: 'CLOSED_TEMPORARILY',
  }, T);
  check('a temporarily closed one survives', temp !== null);
  check('and carries a note saying so', /temporarily closed/i.test(temp?.note ?? ''));
}

// ---------------------------------------------------------------------------
async function chainChecks() {
console.log('\nwalking the chain');
{
  const lead = (name: string): SourceLead => ({
    name, address: `Main Rd ${T.pincode}`, source_url: 'https://example.test',
    phone: '02487222333', rating: null, rating_count: null,
    in_pincode: true, distance_km: 0,
  });

  const stub = (name: SourceName, labs: SourceLead[], cost = 0): PlaceSource => ({
    name,
    unavailable: () => null,
    costPerPincodeUsd: () => cost,
    search: async () => ({ source: name, labs, calls: 1, costUsd: cost }),
  });

  process.env.DISCOVERY_SOURCES = 'mappls,ola,google';
  process.env.DISCOVERY_MIN_LEADS = '2';

  let googleAsked = 0;
  const watchedGoogle: PlaceSource = {
    name: 'google', unavailable: () => null, costPerPincodeUsd: () => 0.035,
    search: async () => { googleAsked++; return { source: 'google', labs: [], calls: 1, costUsd: 0.035 }; },
  };

  const enough = await searchSources(T, {
    sources: {
      mappls: stub('mappls', [lead('Alpha Labs'), lead('Beta Diagnostics')]),
      google: watchedGoogle,
    },
  });
  check('two leads from the first source is enough', enough.labs.length === 2);
  check('so the metered source is never reached', googleAsked === 0);
  check('and the run costs nothing', enough.costUsd === 0);
  check('the answering source is named', enough.source === 'mappls');

  googleAsked = 0;
  const thin = await searchSources(T, {
    sources: { mappls: stub('mappls', [lead('Alpha Labs')]), google: watchedGoogle },
  });
  check('one lead is not enough, so the chain keeps walking', googleAsked === 1);
  check('and the metered call is billed', thin.costUsd === 0.035, String(thin.costUsd));

  const dupes = await searchSources(T, {
    sources: {
      mappls: stub('mappls', [lead('Alpha Labs')]),
      ola: stub('ola', [lead('ALPHA LABS'), lead('Gamma Path')]),
      google: watchedGoogle,
    },
  });
  check('the same lab from two sources is stored once',
    dupes.labs.filter((l) => l.name.toLowerCase() === 'alpha labs').length === 1);

  googleAsked = 0;
  const broke = await searchSources(T, {
    sources: {
      mappls: {
        name: 'mappls', unavailable: () => null, costPerPincodeUsd: () => 0,
        search: async () => ({ source: 'mappls', labs: [], calls: 1, costUsd: 0, error: 'HTTP 500' }),
      },
      google: watchedGoogle,
    },
  });
  check('a source that fails does not end the walk', googleAsked === 1);
  check('and its failure is recorded rather than thrown',
    broke.attempts.some((a) => a.error === 'HTTP 500'));

  const skint = await searchSources(T, {
    sources: { google: watchedGoogle },
    budgetUsd: 0.001,
  });
  check('a source that would break the budget is skipped, not called',
    skint.skipped.some((s) => s.source === 'google' && /would cost/.test(s.why)),
    JSON.stringify(skint.skipped));

  delete process.env.DISCOVERY_SOURCES;
  delete process.env.DISCOVERY_MIN_LEADS;
}

}

// ---------------------------------------------------------------------------
void chainChecks().then(() => {
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('The sources still mean what the PR says they mean.');
}
});
