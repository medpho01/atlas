#!/bin/sh
# ============================================================================
# Rebuild the derived views — without re-copying anything from the source.
#
#   docker compose exec atlas-refresh /refresh-views.sh
#
# /refresh.sh does two jobs. Phases 1-2b copy tables out of the LabStack source
# over FDW, which is the slow part and is what the 3 AM scheduler exists for.
# Phases 3.9-4 rebuild the analytics views ON TOP of that copy, which is all a
# code or SQL deploy actually needs.
#
# So use this after a deploy, and leave /refresh.sh to the scheduler or to the
# times you genuinely need fresher source data.
#
# Order matters and is not alphabetical: pincode coordinates resolve first
# because the geo view reads them, then geo, then everything that measures
# distance against it. Getting this wrong does not error — it silently
# produces views built on an empty table.
# ============================================================================
set -u

PG="psql -h ${PGHOST:-atlas-db} -U ${PGUSER:-atlas} -d ${PGDATABASE:-atlas} -X -q"
log() { echo "[$(date -Iseconds)] $*"; }

log "Resolving pincode coordinates"
if $PG -t -A -c "SELECT to_regproc('atlas.rebuild_pincode_geo')" | grep -q .; then
  n=$($PG -t -A -c "SELECT total FROM atlas.rebuild_pincode_geo();" 2>/dev/null || echo '')
  [ -n "$n" ] && log "  $n located pincodes" || log "  WARN rebuild failed — keeping previous"
else
  log "  skipped (atlas.rebuild_pincode_geo absent)"
fi

# Dependency order. Each is skipped rather than failing the run if it does not
# exist in this environment, so an older database still gets what it has.
for mv in \
  mv_provider_unified \
  mv_pincode_geo \
  mv_pincode_city \
  mv_pincode_coverage \
  mv_pincode_cv_reach \
  mv_city_coverage \
  mv_public_network_pincode \
  mv_public_network_summary \
  mv_city_readiness \
  mv_city_readiness_segment
do
  if $PG -t -A -c "SELECT to_regclass('analytics.$mv')" | grep -q .; then
    start=$(date +%s)
    if $PG -c "REFRESH MATERIALIZED VIEW analytics.$mv;" >/dev/null 2>&1; then
      log "  $mv ($(( $(date +%s) - start ))s)"
    else
      log "  WARN $mv failed"
    fi
  fi
done

log "Done. Source tables untouched — the 3 AM run refreshes those."
