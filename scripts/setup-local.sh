#!/usr/bin/env bash
# ============================================================================
# One command to get Atlas running on a laptop.
#
#   ./scripts/setup-local.sh
#
# Starts a Postgres 16 container, builds the Atlas schema, loads a small
# invented dataset, builds every analytics view on top of it, and creates
# three logins. It does NOT need the LabStack source database — see
# docs/LOCAL-SETUP.md for what that costs you.
#
# Safe to run again: it drops and recreates the local container. That is the
# fastest way out of a half-built database, and there is nothing in it worth
# keeping.
#
# Env:
#   ATLAS_LOCAL_PORT   host port for Postgres        (default 15432)
#   ATLAS_LOCAL_NAME   container name                (default atlas-local-db)
#   ATLAS_LOCAL_PW     password for the atlas user   (default atlas)
#   KEEP_DB=1          reuse the running container instead of recreating it
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

PORT=${ATLAS_LOCAL_PORT:-15432}
NAME=${ATLAS_LOCAL_NAME:-atlas-local-db}
PW=${ATLAS_LOCAL_PW:-atlas}
IMAGE=postgres:16-alpine

say()  { printf '\033[36m→\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "docker not found. Install Docker Desktop first."
docker info >/dev/null 2>&1 || fail "docker is installed but not running. Start Docker Desktop."

psqlq() { docker exec -i "$NAME" psql -U atlas -d atlas -v ON_ERROR_STOP=1 -q "$@"; }

# The view files name tables unqualified — "Lab", "Order" — and rely on the
# search_path to find them. Prepend it rather than editing eleven files that
# production also reads.
runsql() {
  { echo 'SET search_path = analytics, atlas, src_local, public;'; cat "$1"; } \
    | docker exec -i "$NAME" psql -U atlas -d atlas -v ON_ERROR_STOP=1 -q
}

# ---- 1. The container ------------------------------------------------------
if [ "${KEEP_DB:-0}" = "1" ] && docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  say "Reusing the running $NAME (KEEP_DB=1)"
else
  if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
    say "Removing the old $NAME"
    docker rm -f "$NAME" >/dev/null
  fi
  # Another Postgres on the same port is the one failure that looks like a
  # mystery later: the container starts, and every query goes somewhere else.
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Port $PORT is already in use. Stop what is on it, or run: ATLAS_LOCAL_PORT=15433 $0"
  fi
  say "Starting Postgres 16 on port $PORT"
  docker run -d --name "$NAME" \
    -e POSTGRES_USER=atlas -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=atlas \
    -p "$PORT":5432 "$IMAGE" >/dev/null

  # Over TCP, not the socket: while the image is running its own initdb it
  # brings up a temporary server on the unix socket only. A socket check
  # passes against that one and then the real server restarts underneath you,
  # which looks like Postgres dying a second after it started.
  printf '  waiting for it to accept connections'
  ready=0
  for _ in $(seq 1 90); do
    if docker exec "$NAME" psql -h 127.0.0.1 -U atlas -d atlas -c 'SELECT 1' >/dev/null 2>&1; then
      ready=1; break
    fi
    printf '.'; sleep 1
  done
  echo
  [ "$ready" = "1" ] || fail "Postgres did not come up. Try: docker logs $NAME"
fi
ok "Database up"

# ---- 2. The shape of the source data --------------------------------------
# Before Atlas's own schema, not after: a dozen of its views and functions name
# src."Lab" and friends at create time. In production that schema is the
# foreign tables; here it is a view over the local copy.
say "Creating the source tables Atlas reads"
# analytics is created by 04_analytics_views.sh in production, which this
# setup replaces; several of the init files write into it before it is built.
psqlq -c "CREATE SCHEMA IF NOT EXISTS analytics;"
psqlq < "$ROOT/sql/local/01_source_schema.sql" || fail "source schema failed"
ok "src_local and src ready"

# ---- 3. The sample rows ----------------------------------------------------
# Before the views, so they are built with data in them rather than refreshed
# into life afterwards — the same order production saw on its first boot.
say "Loading the sample dataset"
psqlq < "$ROOT/sql/local/02_source_seed.sql" || fail "source seed failed"
ok "Sample source data loaded"

# Unqualified "Lab", "Order" and friends in the view files resolve through the
# search_path. In production that points at src (the foreign tables); here it
# points at the local copy, and nothing else has to change.
psqlq -c "ALTER DATABASE atlas SET search_path = analytics, atlas, src_local, public;"

# ---- 4. Atlas's own schema, in two halves ---------------------------------
# The init files run in filename order, and production slots the analytics
# build in at 04 — everything numbered 05 and up is written expecting those
# views to exist. Same order here.
# 02_pincode_directory.sql \copy's the India Post CSV from a path inside the
# container — in production compose mounts it there; here we hand it over.
docker exec "$NAME" mkdir -p /docker-entrypoint-initdb.d
docker cp "$ROOT/sql/init/pincode_directory_india_post.csv" \
          "$NAME":/docker-entrypoint-initdb.d/pincode_directory_india_post.csv >/dev/null

say "Building the Atlas schema (01-02)"
for f in "$ROOT"/sql/init/0[12]_*.sql; do
  printf '  %s\n' "$(basename "$f")"
  psqlq < "$f" || fail "$(basename "$f") failed"
done

# Two passes, because the dependency runs both ways: the core views read the
# source tables, and the later init files read the core views — but the phlebo,
# nurse, account and pricing views read tables those init files create.
say "Building the analytics views (core)"
for f in materialized_views geo_inferred coverage_views customer_views demand_views \
         quality_v2 cv_reach pricing_views; do
  printf '  %s.sql\n' "$f"
  runsql "$ROOT/sql/$f.sql" || fail "$f.sql failed"
done

say "Building the Atlas schema (05 onwards)"
for f in "$ROOT"/sql/init/*.sql; do
  base=$(basename "$f")
  case "$base" in 0[12]_*) continue ;; esac
  printf '  %s\n' "$base"
  psqlq < "$f" || fail "$base failed"
done
ok "Atlas schema built"

say "Building the analytics views (the ones that read Atlas's own tables)"
for f in phlebos_derived nurses_derived account_views; do
  printf '  %s.sql\n' "$f"
  runsql "$ROOT/sql/$f.sql" || fail "$f.sql failed"
done
ok "$(psqlq -tAc "SELECT COUNT(*) FROM pg_matviews WHERE schemaname='analytics'" | tr -d '[:space:]') analytics views built"

# ---- 6. Everything the nightly refresh would do ---------------------------
# The same tail the 3 AM job runs (scripts/refresh-data.sh, phases 3.9 onward):
# resolve pincode coordinates, then recompute what reads them. Without this the
# readiness pages are honestly empty, which reads like a broken setup.
say "Running the derived-data pass"
psqlq -c "SELECT total FROM atlas.rebuild_pincode_geo();" >/dev/null 2>&1 || true
psqlq -c "SELECT atlas.seed_city_bands();" >/dev/null 2>&1 || true
psqlq -c "SELECT atlas.seed_integration_from_signals();" >/dev/null 2>&1 || true
for mv in mv_provider_unified mv_pincode_geo mv_pincode_city mv_pincode_coverage \
          mv_pincode_cv_reach mv_city_coverage mv_public_network_pincode \
          mv_public_network_summary mv_city_readiness mv_city_readiness_segment; do
  psqlq -c "REFRESH MATERIALIZED VIEW analytics.$mv;" >/dev/null 2>&1 || true
done
ok "Derived data built"

# ---- 7. Logins and a CRM with something in it ------------------------------
say "Creating logins and CRM sample data"
psqlq < "$ROOT/sql/local/03_atlas_seed.sql" || fail "atlas seed failed"
ok "Logins and CRM sample data created"

# ---- 8. The env file -------------------------------------------------------
if [ -f "$ROOT/.env.local" ]; then
  say ".env.local exists — leaving it alone"
else
  cat > "$ROOT/.env.local" <<ENV
# Written by scripts/setup-local.sh. Local development only.
APP_DATABASE_URL=postgres://atlas:$PW@localhost:$PORT/atlas
DATABASE_URL=postgres://atlas:$PW@localhost:$PORT/atlas
UPLOADS_DIR=./.uploads
ENV
  ok "Wrote .env.local"
fi
mkdir -p "$ROOT/.uploads"

cat <<'DONE'

  Ready.

    npm install
    npm run dev        →  http://localhost:3010

  Sign in with any of these (local only):

    admin@local.test    atlas1234    Admin — sees everything, including scoring rules
    lead@local.test     atlas1234    Network lead — the whole CRM pipeline
    member@local.test   atlas1234    Network — their own queue

  docs/LOCAL-SETUP.md has the rest: what the sample data does and does not
  cover, and how to point at a real source database if you have one.
DONE
