# Requests — runbook

What runs, how often, and what to do when it doesn't.

## The moving parts

| Piece | Where | Cadence | What it does |
|---|---|---|---|
| `atlas-refresh` | sidecar | 03:00 IST daily | Snapshots `src_local`, then rebuilds the whole request pipeline (Phase 4.6) |
| `atlas-commitments` | sidecar | every 5 min | Detects orders moving on/off the placeholder lab; closes commitments; writes CRM |
| `enrich.sh labs` | manual | when you choose | Web search for supply-gap pincodes |
| **Check console** button | `/commitments` | on demand | Same as the poller, for the moment right after someone moves an order |

The split matters: the nightly job is broad and slow, the poller is narrow and
frequent. The poller only touches orders that already have an open commitment —
tens of rows — because the source is a hot standby that has killed long reads
twice before.

## First deploy

```bash
cd ~/atlas && git pull
docker exec -i atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 -f - < sql/init/16_requests.sql
docker compose up -d --build atlas-web atlas-commitments atlas-refresh
```

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
