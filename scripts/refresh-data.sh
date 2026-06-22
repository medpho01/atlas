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

log()  { echo "[$(date -Iseconds)] $*" | tee -a "$LOG" >&2; }
fail() { log "FATAL: $*"; exit 1; }

log "=========================================="
log "Atlas data refresh starting"

# Sanity check — atlas-db reachable + has the expected schemas.
$PG -c "SELECT 1 FROM information_schema.schemata WHERE schema_name='src_local';" -t -A \
  | grep -q 1 || fail "src_local schema missing on atlas-db. Was init run?"

# ---- Phase 1: TRUNCATE -----------------------------------------------------
log "Phase 1/4 · TRUNCATE src_local tables"
$PG <<'SQL' || fail "Truncate failed"
TRUNCATE
  src_local."Chain", src_local."ProviderType", src_local."Lab",
  src_local."Provider", src_local."Pharmacy", src_local."Store",
  src_local."PincodeToLatLong", src_local."Profile", src_local."User",
  src_local."Request", src_local."Order", src_local."Appointment",
  src_local."PharmaOrder";
SQL

# ---- Phase 2a: small tables (full copy, retried) ---------------------------
log "Phase 2a/4 · copying small tables in full"
for t in Chain ProviderType Pharmacy Store PincodeToLatLong Lab Provider Profile User Request; do
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
log "Phase 2b/4 · chunked copy of big tables (window=$BIG_TABLE_WINDOW, step=$CHUNK_SIZE)"
for big in Order Appointment PharmaOrder; do
  MAX=$($PG -t -A -c "SELECT MAX(id) FROM src.\"$big\";" 2>/dev/null)
  if [ -z "$MAX" ] || [ "$MAX" = "" ]; then
    log "  $big: source empty or unreachable; skipping"
    continue
  fi
  start=0
  failed_chunks=0
  while [ "$start" -le "$MAX" ]; do
    end=$((start + CHUNK_SIZE - 1))
    chunk_ok=0
    for try in 1 2 3; do
      if $PG -c "INSERT INTO src_local.\"$big\"
                 SELECT * FROM src.\"$big\"
                 WHERE id BETWEEN $start AND $end
                   AND \"createdAt\" >= now() - interval '$BIG_TABLE_WINDOW';" \
                 >>"$LOG" 2>&1; then
        chunk_ok=1
        break
      fi
      sleep 2
    done
    [ "$chunk_ok" -eq 0 ] && failed_chunks=$((failed_chunks + 1))
    start=$((start + CHUNK_SIZE))
  done
  n=$($PG -t -A -c "SELECT COUNT(*) FROM src_local.\"$big\";")
  log "  $big → $n rows ($failed_chunks chunks failed)"
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
REFRESH MATERIALIZED VIEW analytics.mv_pincode_coverage;
REFRESH MATERIALIZED VIEW analytics.mv_pincode_city;
REFRESH MATERIALIZED VIEW analytics.mv_city_coverage;
REFRESH MATERIALIZED VIEW analytics.mv_store_health;
REFRESH MATERIALIZED VIEW analytics.mv_unified_demand;
REFRESH MATERIALIZED VIEW analytics.mv_service_line_momentum;
REFRESH MATERIALIZED VIEW analytics.mv_service_line_city;
REFRESH MATERIALIZED VIEW analytics.mv_lab_quality_v2;
REFRESH MATERIALIZED VIEW analytics.mv_chain_summary;
REFRESH MATERIALIZED VIEW analytics.mv_pincode_geo;
SQL

MV_COUNT=$($PG -t -A -c "SELECT COUNT(*) FROM pg_matviews WHERE schemaname='analytics';")
log "Refresh complete. analytics has $MV_COUNT MVs."
