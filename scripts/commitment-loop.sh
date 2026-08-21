#!/bin/bash
# ============================================================================
# Commitment poller.
#
# Steps 3 and 6 of the request flow happen in the LabStack console. LabStack
# records no event for either — Order.assignedAt is unpopulated across the
# whole table — so the only way Atlas learns that a lab was onboarded is by
# noticing the order has moved off the placeholder.
#
# Runs every INTERVAL_MIN minutes rather than nightly, because "who onboarded
# this lab" landing same-day is the difference between a live handover and a
# report someone writes the next morning.
#
# Cheap by construction: it only looks at orders that already have an open
# commitment — tens of rows, not the 46k-order table. That matters because the
# source is a hot standby that has killed long reads before.
# ============================================================================
set -u

INTERVAL_MIN="${COMMITMENT_INTERVAL_MIN:-5}"
PGHOST="${PGHOST:-atlas-db}"

log() { echo "[commitments $(date -Iseconds)] $*"; }
log "Commitment poller started — every ${INTERVAL_MIN} min against ${PGHOST}"

while true; do
  # Two jobs on the same tick, for the same reason: both exist so that what a
  # person did in the console shows up in Atlas within minutes rather than
  # overnight. The item top-up is what stops a request created this morning
  # reading as "nothing identifiable was requested".
  out=$(psql -h "$PGHOST" -U atlas -d atlas -tA \
        -c "SELECT opened || ' opened, ' || closed || ' closed, ' || expired ||
                   ' expired, ' || crm_created || ' CRM rows'
              FROM atlas.sync_commitments_full();" \
        -c "SELECT CASE WHEN pkg_links + test_links + items = 0 THEN ''
                        ELSE pkg_links || ' pkg links, ' || test_links ||
                             ' test links, ' || items || ' items' END
              FROM atlas.topup_request_items();" 2>&1)
  status=$?
  if [ $status -ne 0 ]; then
    log "FAILED: $out"
  elif [ "$(echo "$out" | tr -d '[:space:]')" != "0opened,0closed,0expired,0CRMrows" ]; then
    # Quiet when nothing changed — a poller that logs every five minutes is a
    # poller nobody reads.
    log "$out"
  fi
  sleep $(( INTERVAL_MIN * 60 ))
done
