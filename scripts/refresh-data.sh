#!/bin/sh
# ============================================================================
# Atlas daily data refresh.
#
# Triggered by cron in the atlas-refresh sidecar at 3 AM IST. Can also be run
# manually:  docker compose exec atlas-refresh /refresh.sh
#
# Pipeline:
#   1. TRUNCATE every src_local.* table.
#   2. Re-INSERT from the FDW src.* foreign tables. Small tables go in one shot;
#      big ones (Order/Appointment/PharmaOrder) are chunked by id to survive
#      the source's hot-standby recovery-conflict window. Each chunk retries
#      up to 3 times before being logged as failed.
#   3. ANALYZE the rebuilt tables so the planner has fresh stats.
#   4. REFRESH every analytics.mv_* materialized view in dependency order.
#
# Notes:
# - src_local is NOT directly queried by the app — only the MVs in analytics
#   are. So the brief window where src_local is empty/partial during phase 2
#   doesn't affect the dashboards; they keep serving yesterday's MV data.
# - When phase 4 starts, MVs flip to the new src_local snapshot. From an app
#   perspective that's effectively atomic per-MV.
# - Big tables filter to the last 18 months. Adjust BIG_TABLE_WINDOW below
#   if you need more (or less) history. The full table would be too slow over
#   FDW given the standby conflicts we've seen.
# ============================================================================
set -u

PG="psql -h atlas-db -U atlas -d atlas -v ON_ERROR_STOP=1 -X -q"
LOG=/var/log/atlas-refresh.log
BIG_TABLE_WINDOW='18 months'
CHUNK_SIZE=1000
# Iterate id ranges blindly from 0 up to this ceiling. Past the real MAX(id)
# every chunk is fast no-op. Raise this if the source DB grows past ~200k ids.
BIG_TABLE_CEILING=200000
# Stop a table's loop after this many consecutive empty chunks — table is done.
EMPTY_THRESHOLD=20
# ALSO stop a table's loop after this many consecutive failed chunks. Without
# this, a persistent source-side issue can grind the script for hours.
FAILED_STREAK_THRESHOLD=5
# Hard timeout per chunk INSERT. Without this an FDW cursor can hang for
# hours when the source standby gets congested. 60s is enough for healthy
# chunks (each is ~5s) and short enough that retries don't waste a day.
CHUNK_TIMEOUT_MS=60000

log()  { echo "[$(date -Iseconds)] $*" | tee -a "$LOG" >&2; }
fail() { log "FATAL: $*"; exit 1; }

log "=========================================="
log "Atlas data refresh starting"

# Sanity check — atlas-db reachable + has the expected schemas.
$PG -c "SELECT 1 FROM information_schema.schemata WHERE schema_name='src_local';" -t -A \
  | grep -q 1 || fail "src_local schema missing on atlas-db. Was init run?"

# ---- Phase 0: sync enum values from source -------------------------------
# Source DB may add new enum values over time (e.g. LabAPIProvider gained
# 'GENEBOX' after initial setup). FDW foreign tables would then fail with
# "invalid input value for enum" because atlas-db's local enum copy is stale.
# Pull every enum value from source and idempotently ALTER TYPE ADD VALUE
# on the local side. SOURCE_DATABASE_URL is provided to this container via
# env_file in docker-compose.
if [ -n "${SOURCE_DATABASE_URL:-}" ]; then
  log "Phase 0/4 · syncing enum schema from source"
  SRC_PSQL="psql $SOURCE_DATABASE_URL -v ON_ERROR_STOP=1 -X -q -t -A"

  # Step a: CREATE TYPE for any enum that doesn't yet exist on atlas-db.
  # We wrap each CREATE in a DO block with EXCEPTION WHEN duplicate_object
  # so it's idempotent — types we already have are skipped silently.
  $SRC_PSQL -c "
    SELECT format(
      E'DO \$\$ BEGIN CREATE TYPE public.%I AS ENUM (%s); EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;',
      t.typname,
      string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder)
    )
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    GROUP BY t.typname
    ORDER BY t.typname;
  " 2>>"$LOG" | $PG >>"$LOG" 2>&1 \
    && log "  enum types ensured" \
    || log "  WARN: enum CREATE TYPE pass failed (continuing anyway)"

  # Step b: ALTER TYPE ADD VALUE for any enum value missing on atlas-db.
  # If a type just got created in step a, this is a no-op (values already in
  # the CREATE). If a type pre-existed but has new values, this catches them.
  $SRC_PSQL -c "
    SELECT format('ALTER TYPE public.%I ADD VALUE IF NOT EXISTS %L;',
                  t.typname, e.enumlabel)
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    ORDER BY t.typname, e.enumsortorder;
  " 2>>"$LOG" | $PG >>"$LOG" 2>&1 \
    && log "  enum values synced" \
    || log "  WARN: enum ALTER TYPE pass failed (refresh may fail on rows with new enum values)"
else
  log "Phase 0/4 · SOURCE_DATABASE_URL not set; skipping enum sync"
fi

# ---- Phase 0.5: ensure pricing-catalog tables exist (self-bootstrapping) ----
# DOS (per-lab test rates) + Master (canonical test catalog) were added after
# the original FDW migration. Instead of a manual prod migration, the refresh
# bootstraps them: import the foreign tables if absent, create the src_local
# snapshots if absent. Idempotent — no-ops once they exist.
log "Phase 0.5/4 · ensure pricing-catalog foreign tables + snapshots exist"
for t in DOS Master Package PackagesOnLab _MasterToPackage; do
  exists=$($PG -t -A -c "SELECT 1 FROM information_schema.foreign_tables
                          WHERE foreign_table_schema='src' AND foreign_table_name='$t';")
  if [ "$exists" != "1" ]; then
    log "  importing foreign table src.\"$t\""
    $PG -c "IMPORT FOREIGN SCHEMA public LIMIT TO (\"$t\") FROM SERVER labstack_src INTO src;" >>"$LOG" 2>&1 \
      || log "  WARN: IMPORT of $t failed (pricing MVs will be stale)"
  fi
  $PG -c "CREATE TABLE IF NOT EXISTS src_local.\"$t\" (LIKE src.\"$t\");" >>"$LOG" 2>&1 \
    || log "  WARN: snapshot table src_local.$t create failed"
done

# ---- Phase 1: TRUNCATE -----------------------------------------------------
log "Phase 1/4 · TRUNCATE src_local tables"
$PG <<'SQL' || fail "Truncate failed"
TRUNCATE
  src_local."Chain", src_local."ProviderType", src_local."Lab",
  src_local."Provider", src_local."Pharmacy", src_local."Store",
  src_local."PincodeToLatLong", src_local."Profile", src_local."User",
  src_local."Request", src_local."Order", src_local."Appointment",
  src_local."PharmaOrder", src_local."DOS", src_local."Master",
  src_local."Package", src_local."PackagesOnLab", src_local."_MasterToPackage";
SQL

# ---- Phase 2a: small tables (full copy, retried) ---------------------------
log "Phase 2a/4 · copying small tables in full"
for t in Chain ProviderType Pharmacy Store PincodeToLatLong Lab Provider Profile User Request Master DOS Package PackagesOnLab _MasterToPackage; do
  ok=0
  for try in 1 2 3; do
    if $PG -c "INSERT INTO src_local.\"$t\" SELECT * FROM src.\"$t\";" >>"$LOG" 2>&1; then
      n=$($PG -t -A -c "SELECT COUNT(*) FROM src_local.\"$t\";")
      log "  $t → $n rows"
      ok=1
      break
    fi
    log "  $t attempt $try failed, retrying in 5s"
    sleep 5
  done
  [ "$ok" -eq 0 ] && log "  WARN: $t copy failed after 3 attempts (MVs will be partially stale)"
done

# ---- Phase 2b: big tables (chunked by id, with retry per chunk) ------------
# We do NOT query SELECT MAX(id) FROM src.<table> — even though it's
# logically a cheap index lookup, against the source standby it can block
# for many minutes (replication conflict / lag). Instead we iterate blindly
# from 0 to BIG_TABLE_CEILING, stopping early when we see EMPTY_THRESHOLD
# consecutive empty chunks. Each chunk is bounded by id BETWEEN x AND y,
# which pushes a fast range scan to the source.
log "Phase 2b/4 · chunked copy of big tables (window=$BIG_TABLE_WINDOW, step=$CHUNK_SIZE, ceiling=$BIG_TABLE_CEILING)"
for big in Order Appointment PharmaOrder; do
  start=0
  failed_chunks=0
  empty_streak=0
  failed_streak=0
  while [ "$start" -le "$BIG_TABLE_CEILING" ] \
     && [ "$empty_streak" -lt "$EMPTY_THRESHOLD" ] \
     && [ "$failed_streak" -lt "$FAILED_STREAK_THRESHOLD" ]; do
    end=$((start + CHUNK_SIZE - 1))
    chunk_ok=0
    rows_before=$($PG -t -A -c "SELECT COUNT(*) FROM src_local.\"$big\";" 2>/dev/null || echo 0)
    for try in 1 2 3; do
      # statement_timeout caps each chunk's wait. If the FDW remote stalls,
      # postgres cancels the cursor after CHUNK_TIMEOUT_MS and we move on.
      if $PG -c "SET statement_timeout = $CHUNK_TIMEOUT_MS;
                 INSERT INTO src_local.\"$big\"
                 SELECT * FROM src.\"$big\"
                 WHERE id BETWEEN $start AND $end
                   AND \"createdAt\" >= now() - interval '$BIG_TABLE_WINDOW';" \
                 >>"$LOG" 2>&1; then
        chunk_ok=1
        break
      fi
      sleep 2
    done
    if [ "$chunk_ok" -eq 0 ]; then
      failed_chunks=$((failed_chunks + 1))
      failed_streak=$((failed_streak + 1))
      log "  $big id $start..$end: FAILED after 3 attempts (streak $failed_streak)"
    else
      failed_streak=0
      rows_after=$($PG -t -A -c "SELECT COUNT(*) FROM src_local.\"$big\";" 2>/dev/null || echo 0)
      added=$((rows_after - rows_before))
      if [ "$added" -eq 0 ]; then
        empty_streak=$((empty_streak + 1))
        # Only log every 10 empty chunks to keep the log readable
        if [ $((empty_streak % 10)) -eq 0 ]; then
          log "  $big id $start..$end: empty (streak $empty_streak)"
        fi
      else
        empty_streak=0
        log "  $big id $start..$end → +$added rows (total $rows_after)"
      fi
    fi
    start=$((start + CHUNK_SIZE))
  done
  n=$($PG -t -A -c "SELECT COUNT(*) FROM src_local.\"$big\";")
  if [ "$failed_streak" -ge "$FAILED_STREAK_THRESHOLD" ]; then
    log "  $big GIVING UP → $n rows total ($failed_chunks failed chunks, $failed_streak consecutive — source standby unreliable, moving on)"
  else
    log "  $big DONE → $n rows total ($failed_chunks failed chunks, stopped at id $start after empty streak $empty_streak)"
  fi
done

# ---- Phase 3: ANALYZE ------------------------------------------------------
log "Phase 3/4 · ANALYZE"
$PG <<'SQL' >>"$LOG" 2>&1
ANALYZE src_local."Order";
ANALYZE src_local."Appointment";
ANALYZE src_local."PharmaOrder";
ANALYZE src_local."Lab";
ANALYZE src_local."Provider";
ANALYZE src_local."Profile";
ANALYZE src_local."Store";
ANALYZE src_local."Pharmacy";
ANALYZE src_local."Request";
SQL

# ---- Phase 4: REFRESH MATERIALIZED VIEWs (dependency order) ----------------
log "Phase 4/4 · REFRESH MATERIALIZED VIEW for all analytics.mv_*"
$PG <<'SQL' >>"$LOG" 2>&1
SET search_path = analytics, atlas, src_local, src, public;
REFRESH MATERIALIZED VIEW analytics.mv_pincode_supply;
REFRESH MATERIALIZED VIEW analytics.mv_pincode_demand;
REFRESH MATERIALIZED VIEW analytics.mv_pincode_requests;
REFRESH MATERIALIZED VIEW analytics.mv_pincode_summary;
REFRESH MATERIALIZED VIEW analytics.mv_city_rollup;
REFRESH MATERIALIZED VIEW analytics.mv_lab_health;
REFRESH MATERIALIZED VIEW analytics.mv_provider_unified;
-- mv_pincode_geo must refresh BEFORE mv_pincode_coverage — coverage's RADIUS
-- rows haversine-join against the geo MV. Same dependency at first-boot init.
REFRESH MATERIALIZED VIEW analytics.mv_pincode_geo;
REFRESH MATERIALIZED VIEW analytics.mv_pincode_coverage;
REFRESH MATERIALIZED VIEW analytics.mv_pincode_city;
REFRESH MATERIALIZED VIEW analytics.mv_city_coverage;
REFRESH MATERIALIZED VIEW analytics.mv_store_health;
REFRESH MATERIALIZED VIEW analytics.mv_unified_demand;
REFRESH MATERIALIZED VIEW analytics.mv_service_line_momentum;
REFRESH MATERIALIZED VIEW analytics.mv_service_line_city;
REFRESH MATERIALIZED VIEW analytics.mv_lab_quality_v2;
REFRESH MATERIALIZED VIEW analytics.mv_chain_summary;
-- Center-visit per-lab distance detail. Stays last — only used by the public
-- /network page for "X.Y km" labels on neighbour-pincode cards.
REFRESH MATERIALIZED VIEW analytics.mv_pincode_cv_reach;
-- Phlebo repository: derived from src_local."Order" so must refresh AFTER
-- the snapshot is loaded (Phase 2). Merged view atlas.phlebos_all reads this.
REFRESH MATERIALIZED VIEW analytics.mv_phlebos_derived;
-- Pricing intelligence: per-lab test rates from src_local DOS + Master.
REFRESH MATERIALIZED VIEW analytics.mv_test_rates;
REFRESH MATERIALIZED VIEW analytics.mv_test_catalog;
REFRESH MATERIALIZED VIEW analytics.mv_lab_packages;
SQL

MV_COUNT=$($PG -t -A -c "SELECT COUNT(*) FROM pg_matviews WHERE schemaname='analytics';")
log "Refresh complete. analytics has $MV_COUNT MVs."
