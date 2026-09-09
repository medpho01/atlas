# Shared CSV handling for the pincode-geo scripts. Sourced, not run.
#
# Do not parse the CSV in shell. Real datasets quote fields that contain
# commas — "Mumbai, Maharashtra" is one field, not two — and splitting on
# commas shifts every column after it, which is how a state name ended up
# being read as a latitude.
#
# So: read only the HEADER in shell, to work out which columns we want and
# what to call them, then hand the file to Postgres, whose CSV parser handles
# quoting, embedded newlines and escapes properly.
#
# Prints four lines: the column list for CREATE TABLE, then the pincode,
# latitude and longitude column names.
pincode_csv_plan() {
  head -1 "$1" | tr -d '\r' | awk -F',' '
    {
      for (i = 1; i <= NF; i++) {
        raw = $i; gsub(/^[ "]+|[ "]+$/, "", raw)
        n = tolower(raw); gsub(/[^a-z0-9]/, "", n)
        if (n == "") n = "col" i
        if (n in seen) { seen[n]++; n = n seen[n] } else seen[n] = 1
        cols = cols (i > 1 ? ", " : "") "\"" n "\" text"
        if (!pc && (n=="pincode"||n=="pin"||n=="pincodes"||n=="postalcode" \
                    ||n=="postcode"||n=="zip"||n=="zipcode"||n=="key"))      pc = n
        else if (!la && (n=="latitude"||n=="lat"))                            la = n
        else if (!lo && (n=="longitude"||n=="lng"||n=="lon"||n=="long"))      lo = n
      }
      if (!pc || !la || !lo) {
        print "ERROR: need a pincode column and latitude/longitude columns." > "/dev/stderr"
        print "       Header was: " $0 > "/dev/stderr"
        exit 1
      }
      print cols; print pc; print la; print lo
    }'
}

# Load $1 into atlas.pincode_raw_stage and export the three column names.
# Postgres parses the file; we only ever named the columns.
stage_pincode_csv() {
  _plan=$(pincode_csv_plan "$1") || return 1
  _cols=$(printf '%s\n' "$_plan" | sed -n 1p)
  PIN_COL=$(printf  '%s\n' "$_plan" | sed -n 2p)
  LAT_COL=$(printf  '%s\n' "$_plan" | sed -n 3p)
  LNG_COL=$(printf  '%s\n' "$_plan" | sed -n 4p)
  $PG -c "DROP TABLE IF EXISTS atlas.pincode_raw_stage;
          CREATE TABLE atlas.pincode_raw_stage ($_cols);" || return 1
  $PG -c "\copy atlas.pincode_raw_stage FROM '$1' WITH (FORMAT csv, HEADER true)" || return 1
}

# One clean row per pincode, from whatever shape arrived. Non-numeric
# coordinates and anything without a six-digit code are dropped here rather
# than blowing up a cast three queries later.
PINCODE_CLEAN_SQL="
  SELECT (regexp_match(p, '[0-9]{6}'))[1] AS pincode,
         lat::float8 AS lat, lng::float8 AS lng
  FROM (
    SELECT %PIN% AS p, %LAT% AS lat, %LNG% AS lng
    FROM atlas.pincode_raw_stage
  ) r
  WHERE p ~ '[0-9]{6}'
    AND lat ~ '^-?[0-9]+(\.[0-9]+)?$'
    AND lng ~ '^-?[0-9]+(\.[0-9]+)?$'
"
pincode_clean_sql() {
  printf '%s' "$PINCODE_CLEAN_SQL" \
    | sed "s/%PIN%/\"$PIN_COL\"/; s/%LAT%/\"$LAT_COL\"/; s/%LNG%/\"$LNG_COL\"/"
}
