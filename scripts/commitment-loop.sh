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
  out=$(psql -h "$PGHOST" -U atlas -d atlas -tA \
        -c "SELECT opened || ' opened, ' || closed || ' closed, ' || expired ||
                   ' expired, ' || crm_created || ' CRM rows'
              FROM atlas.sync_commitments_full();" 2>&1)
  status=$?
  if [ $status -ne 0 ]; then
    log "FAILED: $out"
  elif [ "$out" != "0 opened, 0 closed, 0 expired, 0 CRM rows" ]; then
    # Quiet when nothing changed — a poller that logs every five minutes is a
    # poller nobody reads.
    log "$out"
  fi
  sleep $(( INTERVAL_MIN * 60 ))
done
