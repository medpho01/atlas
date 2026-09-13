# Requests — runbook

What runs, how often, and what to do when it doesn't.

## The moving parts

| Piece | Where | Cadence | What it does |
|---|---|---|---|
| `atlas-refresh` | sidecar | 03:00 IST daily | Snapshots `src_local`, then rebuilds the whole request pipeline (Phase 4.6) |
| `atlas-commitments` | sidecar | every 5 min | Detects orders moving on/off the placeholder lab; closes commitments; writes CRM |
| `enrich.sh labs` | manual | when you choose | Web search for supply-gap pincodes |
| Lab discovery | `/requests/[id]` | **on page load** | Searches the web when the network cannot reach the pincode and there are no leads yet. Guarded by `atlas.claim_discovery()` — see "Web discovery" below |
| **Check console** button | `/commitments` | on demand | Same as the poller, for the moment right after someone moves an order |

The split matters: the nightly job is broad and slow, the poller is narrow and
frequent. The poller only touches orders that already have an open commitment —
tens of rows — because the source is a hot standby that has killed long reads
twice before.

## First deploy

```bash
cd ~/atlas && git pull
docker exec -i atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 -f - < sql/init/16_requests.sql
docker exec -i atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 -f - < sql/init/20_lab_discovery_ranking.sql
docker compose up -d --build atlas-web atlas-commitments atlas-refresh
```

`sql/init/` only runs on a database's first boot, so both files above are
applied by hand on a host that already exists. See "Applying
20_lab_discovery_ranking.sql to an existing host" under Web discovery.

Then build the pipeline once, in this order — items first, because the
classification is computed on top of them:

```bash
docker exec -i atlas-db psql -U atlas -d atlas \
  -c "REFRESH MATERIALIZED VIEW analytics.mv_master_lookup;" \
  -c "SELECT atlas.sync_request_items();" \
  -c "REFRESH MATERIALIZED VIEW analytics.mv_lab_pincode_home;" \
  -c "REFRESH MATERIALIZED VIEW analytics.mv_lab_offering;" \
  -c "REFRESH MATERIALIZED VIEW analytics.mv_request_state;" \
  -c "SELECT * FROM atlas.sync_commitments_full();"
```

`_PackageToRequest` and `_MasterToRequest` are picked up by the refresh's
Phase 0.5 self-bootstrap, so no FDW rebuild is needed. If you want them
immediately rather than at 03:00:

```bash
docker exec -i atlas-db psql -U atlas -d atlas \
  -c 'IMPORT FOREIGN SCHEMA public LIMIT TO ("_PackageToRequest","_MasterToRequest") FROM SERVER labstack_src INTO src;' \
  -c 'CREATE TABLE IF NOT EXISTS src_local."_PackageToRequest" (LIKE src."_PackageToRequest");' \
  -c 'CREATE TABLE IF NOT EXISTS src_local."_MasterToRequest" (LIKE src."_MasterToRequest");'
```

## Sanity checks

```bash
docker exec -i atlas-db psql -U atlas -d atlas -c "SELECT state, COUNT(*), COUNT(quote_price) AS quoted, COUNT(promised_date) AS dated FROM analytics.v_request_quote GROUP BY 1 ORDER BY 2 DESC;"
```

Every request should appear in exactly one state. If a state is missing from
that output entirely, it has no `atlas.slot_policy` row — add one. The view
LEFT-joins policy specifically so a missing row shows up as an unpriced request
rather than a vanished one, but the row still needs adding.

```bash
docker compose logs atlas-commitments --tail 20
```

The poller is quiet when nothing changed. Silence is the healthy state; a line
per five minutes would be noise nobody reads.

## Tuning

Everything below is a table, not a deploy.

```sql
-- How many days we promise, per state. NULL = do not promise, escalate.
UPDATE atlas.slot_policy SET lead_days = 3 WHERE state = 'PACKAGE_GAP';

-- Markup bands by distance to the nearest lab.
UPDATE atlas.quote_markup SET markup_pct = 18 WHERE max_km = 25;

-- How far away a lab can be and still count as an onboardable candidate.
UPDATE atlas.request_settings SET value = '30' WHERE key = 'known_candidate_km';

-- If the placeholder lab ever changes id, this is the only place to say so.
UPDATE atlas.request_settings SET value = '1' WHERE key = 'placeholder_lab_id';
```

Changes to markup and lead time take effect immediately — `v_request_quote` is
a plain view on purpose, because a pricing change that needs a refresh before
it applies is a pricing change someone will forget to apply.

**A promise already made is never rewritten.** `atlas.commitment` captures the
price and date at the moment the obligation appeared, so retuning policy today
does not silently restate what a store was told last week.

## Web discovery

```bash
./scripts/enrich.sh labs --dry-run --limit 5   # which pincodes it would search
./scripts/enrich.sh labs --limit 20            # actually search
./scripts/enrich.sh labs --pincode 641602      # one pincode
```

Scoped to supply-gap pincodes only, busiest first, skipping anything searched
in the last 30 days. Results are **leads, not records**: unverified, never
merged into the lab directory, never contacted automatically. Somebody calls
them, then clicks *Add to CRM*.

Needs `ANTHROPIC_API_KEY` in `.env.production` — the file compose loads into
the app. The shell scripts also read `.env`, so a key in only one of the two
gives you a working `curl` and a failing search at the same time. The card
reports the last four characters of whichever key it actually used.

### The request detail page searches on its own

A request with no covering lab and no leads triggers its own search on load.
This is deliberate and it reverses the old "never on page load" rule — see
docs/SPEC-requests.md, "Searching on page load", for why.

`atlas.claim_discovery(pincode, stale_days, trigger)` is what keeps that from
becoming a search on every page load. It returns true, and takes the claim, in
one statement, so two tabs opening the same request cannot both pay for it.

To see what it is costing:

```sql
-- Who has been asking, and how recently.
SELECT trigger, COUNT(*), MAX(ran_at) FROM atlas.discovery_run GROUP BY 1;

-- Searches in flight right now (the 2-minute window).
SELECT pincode, started_at, trigger FROM atlas.discovery_run
 WHERE started_at > now() - interval '2 minutes'
   AND (ran_at IS NULL OR ran_at < started_at);

-- Why this pincode would or would not be searched. Read-only: does NOT claim.
SELECT pincode, ran_at, found, error,
       started_at > now() - interval '2 minutes' AS in_flight
  FROM atlas.discovery_run WHERE pincode = '641602';
```

To stop auto-searching without a deploy, remove the call rather than the
function: `autoSearch` is computed in `app/requests/[id]/page.tsx` and the
condition is one expression. Widening the staleness window in
`claim_discovery` also works and needs no rebuild, and it leaves the batch and
the *Search again* button working — a deliberate click passes a zero-day
window, so only the in-flight guard applies to it.

**A pincode stuck on "searching".** `started_at` set with no later `ran_at` is
a claim whose process died. It unjams itself after two minutes, which is what
the window is for. If it has not, the search really is still running.

```sql
-- Only if you are sure nothing is running. Releases the claim.
UPDATE atlas.discovery_run SET started_at = NULL WHERE pincode = '641602';
```

### Applying 20_lab_discovery_ranking.sql to an existing host

`sql/init/` runs **once**, on a database's first boot. Every database that
already exists needs this applied by hand:

```bash
cd ~/atlas && git pull
docker exec -i atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 -f - \
  < sql/init/20_lab_discovery_ranking.sql
```

Idempotent throughout, so it is safe to run twice — the second run reports
`already exists, skipping` per column. Nothing is rewritten and no lead is
touched. It adds the ranking columns to `atlas.discovered_lab`, adds
`started_at` and `trigger` to `atlas.discovery_run`, drops the `NOT NULL` on
`discovery_run.ran_at`, creates `atlas.claim_discovery()`, and replaces
`atlas.promote_discovered_lab()` so the CRM note carries the ranking evidence.

**No restart needed, and the order does not matter.** The app tolerates the
migration being outstanding: both reads on the request detail page catch
Postgres `42703` and fall back to the old columns, and the claim catches
`42883` and searches anyway. On an unmigrated host discovery keeps working and
the ranking is simply uninformative. That fallback is covered by
`npm run test:discovery-db`, which runs the read path against a migrated
database and an unmigrated one.

Existing `discovery_run` rows get `started_at` backfilled from `ran_at`, so
they read as "last attempted then" rather than "never attempted". Without that,
`claim_discovery` would treat every one of them as a reason to search, and the
first night after the migration would be a few hundred searches nobody asked
for.

Verify:

```bash
docker exec -i atlas-db psql -U atlas -d atlas \
  -c "\d atlas.discovered_lab" \
  -c "SELECT atlas.claim_discovery('000000', 30, 'manual');" \
  -c "DELETE FROM atlas.discovery_run WHERE pincode = '000000';"
```

### Checking the ranking

```bash
npm run test:scoring         # 71 fixtures. No database, no API key, no network.
npm run test:discovery-db    # throwaway Postgres 16. Needs docker, nothing else.
npm run test:discovery-read  # the read path, against APP_DATABASE_URL.
```

`test:discovery-read` runs against whatever `APP_DATABASE_URL` points at, so it
can be pointed at the real database — before applying the migration and again
after. It writes only to pincode `000000`, which is not an assigned Indian
pincode, and deletes what it wrote.

If the weights or the two rules ever change, `npm run test:scoring` is what
argues back. Each fixture is a claim about what the ranking is *for*, not a
snapshot of what it currently returns.

## When something looks wrong

**A request is classified serviceable but ops says it isn't.** Open the request
and look at "Labs that can collect here". Serviceable requires *one* lab to do
the whole ask — check whether the covering lab's rate card really carries every
item. If the console can actually split an order across labs, that assumption
needs revisiting.

**A quote looks too low or too high.** The detail page names the basis. A
`network_median` quote on an unusual item is a weak inference over few rows;
`reference_n` in `atlas.commitment` records how many labs were behind it.

**Nothing appears in the network bucket.** Commitments only open for orders on
the placeholder lab in a live status. An order that already reached
`REPORT_DELIVERED` is not an outstanding promise, whatever lab it sits on —
without that guard the first run opened 410 "urgent" commitments that had all
been delivered months earlier.

**The poller reports failures.** It talks to `atlas-db` only, so a failure is a
database or credential problem, not the source. Check `PGPASSWORD` matches
`ATLAS_DB_PASSWORD`.
