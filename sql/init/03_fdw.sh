#!/bin/sh
# ============================================================================
# atlas-db init #3: postgres_fdw bootstrap.
# Runs once on first boot. Reads SOURCE_DATABASE_URL from container env.
#
# Pipeline:
#   1. Parse SOURCE_DATABASE_URL into pieces.
#   2. Connect to source DB and discover enum types in public schema.
#      Replicate them in atlas-db's public schema so foreign-table column
#      types resolve. (FDW can't auto-import custom types.)
#   3. Create the foreign server + user mapping + src schema.
#   4. IMPORT FOREIGN SCHEMA for the 13 operational tables we use.
#   5. ALTER DATABASE search_path so unqualified table refs in queries
#      resolve to src.* without changes to the app code.
# ============================================================================
set -e

if [ -z "$SOURCE_DATABASE_URL" ]; then
  echo "FATAL: SOURCE_DATABASE_URL not set. Cannot configure FDW." >&2
  exit 1
fi

# ---- Parse the URL ---------------------------------------------------------
url="$SOURCE_DATABASE_URL"
no_scheme="${url#postgresql://}"
no_scheme="${no_scheme#postgres://}"
userpass="${no_scheme%@*}"
hostportdb="${no_scheme##*@}"
src_user="${userpass%%:*}"
src_pass="${userpass#*:}"
src_db="${hostportdb##*/}"
hostport="${hostportdb%/*}"
src_host="${hostport%%:*}"
src_port="${hostport##*:}"
[ "$src_host" = "$src_port" ] && src_port=5432

echo "FDW target: $src_user@$src_host:$src_port/$src_db"

# ---- 1. Discover enum types in source DB ----------------------------------
# Use libpq env vars + URL form to connect to the remote.
ENUM_SQL=$(PGPASSWORD="$src_pass" psql \
  -h "$src_host" -p "$src_port" -U "$src_user" -d "$src_db" \
  -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT format(
  E'DROP TYPE IF EXISTS public.%I CASCADE;\nCREATE TYPE public.%I AS ENUM (%s);',
  t.typname, t.typname,
  string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder)
)
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typnamespace = 'public'::regnamespace
GROUP BY t.typname
ORDER BY t.typname;
SQL
)

# Count discovered enums for log clarity
ENUM_COUNT=$(printf '%s' "$ENUM_SQL" | grep -c '^CREATE TYPE' || true)
echo "Discovered $ENUM_COUNT enum types in source DB; replicating in atlas-db…"

# ---- 2. Replicate enums locally -------------------------------------------
if [ -n "$ENUM_SQL" ]; then
  printf '%s\n' "$ENUM_SQL" | \
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
fi

# ---- 3. FDW server + 4. IMPORT FOREIGN SCHEMA -----------------------------
TABLES='"Appointment","Chain","Lab","Order","PharmaOrder","Pharmacy","PincodeToLatLong","Profile","Provider","ProviderType","Request","Store","User"'

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

DROP SERVER IF EXISTS labstack_src CASCADE;
CREATE SERVER labstack_src
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host '${src_host}', port '${src_port}', dbname '${src_db}',
           fetch_size '10000');

CREATE USER MAPPING FOR ${POSTGRES_USER}
  SERVER labstack_src
  OPTIONS (user '${src_user}', password '${src_pass}');

DROP SCHEMA IF EXISTS src CASCADE;
CREATE SCHEMA src AUTHORIZATION ${POSTGRES_USER};

IMPORT FOREIGN SCHEMA public
  LIMIT TO (${TABLES})
  FROM SERVER labstack_src
  INTO src;

-- 5. search_path so existing FROM "Lab" queries resolve via src.
ALTER DATABASE ${POSTGRES_DB} SET search_path = analytics, atlas, src, public;

DO \$\$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM information_schema.foreign_tables
   WHERE foreign_table_schema = 'src';
  RAISE NOTICE 'FDW src schema imported % foreign tables', n;
END\$\$;
SQL
