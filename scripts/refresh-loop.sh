#!/bin/bash
# ============================================================================
# Refresh scheduler.
#
# Sleeps until the next 03:00 IST (container's TZ is Asia/Kolkata), runs the
# refresh, then loops. Doesn't drift the way fixed-86400 loops do — we
# recompute the target each iteration based on the current time.
#
# Manual one-shot runs (independent of this loop) are done with:
#   docker compose exec atlas-refresh /refresh.sh
# ============================================================================
set -u

TARGET_HOUR=3   # 03:00 IST

log() { echo "[scheduler $(date -Iseconds)] $*"; }

log "Atlas refresh scheduler started — target run time: ${TARGET_HOUR}:00 daily (TZ=$(cat /etc/timezone))"

while true; do
  # Seconds since midnight, locally
  now_s=$(date +%S); now_m=$(date +%M); now_h=$(date +%H)
  secs_today=$(( 10#$now_h * 3600 + 10#$now_m * 60 + 10#$now_s ))
  target_secs=$(( TARGET_HOUR * 3600 ))

  if [ "$secs_today" -lt "$target_secs" ]; then
    delay=$(( target_secs - secs_today ))
  else
    delay=$(( 86400 - secs_today + target_secs ))
  fi

  next_run=$(date -d "@$(( $(date +%s) + delay ))" 2>/dev/null || echo "in $delay seconds")
  log "Next refresh: $next_run (sleeping $delay s)"
  sleep "$delay"

  log "Triggering /refresh.sh"
  /refresh.sh
  log "Refresh complete (exit $?)"
done
