#!/bin/sh
# Run an enrichment job on a host that has no Node.
#
#   ./scripts/enrich.sh cities  [--dry-run] [--limit 50] [--reclassify]
#   ./scripts/enrich.sh tests   [--reclassify]
#   ./scripts/enrich.sh packages [--reclassify]
#
# The production VM runs Atlas only as a built image, so Node was never
# installed there — and the runner image is a standalone Next build with
# devDependencies pruned, so tsx isn't in it either. This runs the job in a
# throwaway node container instead of installing a toolchain on the host.
#
# --network container:atlas-db shares that container's network namespace, so
# the database is reachable at localhost:5432 without needing to know the
# compose network's name, and outbound calls to the Anthropic API still work.
#
# node_modules lives in a named volume, not the mounted repo: a bind-mounted
# install would leave root-owned files in your working tree, and the volume
# means only the first run pays for `npm ci`.
set -e

JOB="$1"
[ -n "$JOB" ] || { echo "usage: $0 {cities|tests|packages} [flags...]" >&2; exit 2; }
shift

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO/.env.production}"
[ -f "$ENV_FILE" ] || { echo "No env file at $ENV_FILE (override with ENV_FILE=)" >&2; exit 1; }

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

[ -n "$ANTHROPIC_API_KEY" ] || { echo "ANTHROPIC_API_KEY not set in $ENV_FILE" >&2; exit 1; }
[ -n "$ATLAS_DB_PASSWORD" ] || { echo "ATLAS_DB_PASSWORD not set in $ENV_FILE" >&2; exit 1; }

case "$JOB" in
  cities)   SCRIPT="scripts/enrich-city-tiers.ts"; ARGS="$*" ;;
  tests)    SCRIPT="scripts/enrich-catalogue.ts";  ARGS="--stage tests $*" ;;
  packages) SCRIPT="scripts/enrich-catalogue.ts";  ARGS="--stage packages $*" ;;
  *) echo "unknown job '$JOB' — expected cities, tests or packages" >&2; exit 2 ;;
esac

echo "Running $SCRIPT $ARGS"

docker run --rm -i \
  --network "container:atlas-db" \
  -v "$REPO:/app" \
  -v atlas-enrich-modules:/app/node_modules \
  -w /app \
  -e ANTHROPIC_API_KEY \
  -e APP_DATABASE_URL="postgres://atlas:${ATLAS_DB_PASSWORD}@localhost:5432/atlas" \
  node:20-alpine \
  sh -c "[ -d node_modules/.bin ] || npm ci --no-audit --no-fund; npx tsx $SCRIPT $ARGS"
