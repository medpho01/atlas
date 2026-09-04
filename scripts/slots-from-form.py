#!/usr/bin/env python3
"""
Weekly duty form -> SlotConfig SQL.

    python3 scripts/slots-from-form.py responses.xlsx
    python3 scripts/slots-from-form.py responses.xlsx --test
    python3 scripts/slots-from-form.py responses.xlsx --store 117   # optional

Reads the Google Form export and writes one self-contained .sql file. It does
NOT touch any database itself — the file is for whoever owns the LabStack
primary, since Atlas only ever reads a standby.

--test applies the generated SQL to a local database inside a transaction it
then rolls back, and prints what would have changed. Nothing is kept.

Design notes worth knowing before editing this:

* Doctors are matched on the last ten digits of the phone, never the name. The
  form spells them differently from the console ("Dr M.Anu Shreeshma Devi"
  against "Dr. Anu Shreeshma Devi"), and a wrong match writes one doctor's
  hours onto another.
* The form is the roster, so by default every provider is in scope. --store
  narrows it if you ever want that. Either way the SQL aborts if a phone
  reaches two providers, because numbers are not unique: 9999900005 belongs to
  both Dr Ayush Goel and Dr Tuhin Mitra. No number in the current form is
  ambiguous, but a future one could be, and silently updating the wrong doctor
  is worse than stopping.
* The form collects availability hour by hour; SlotConfig stores a contiguous
  range against a set of days. So the SQL merges adjacent hours into ranges and
  collapses days whose ranges match — the shape the console's own rows have.
* The matching and merging happen IN the SQL rather than here, so the file the
  team runs is auditable on its own and does not depend on this script having
  been given the right roster.
"""
import argparse
import os
import re
import subprocess
import sys
import unicodedata
from datetime import datetime

DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
DAY_COLS = range(6, 13)          # columns G..M
SLOT_MINUTES = 30                # matches the console's existing rows


def phone10(v):
    """Last ten digits. The form stores numbers as floats, the console as text."""
    if v is None:
        return ''
    s = str(int(v)) if isinstance(v, float) else str(v)
    s = re.sub(r'\D', '', s)
    return s[-10:] if len(s) >= 10 else s


def clean(v):
    """Normalise the form's en dashes and smart punctuation, and quote for SQL."""
    if v is None:
        return "''"
    t = unicodedata.normalize('NFKC', str(v)).replace('–', '-').replace('—', '-')
    return "'" + t.replace("'", "''") + "'"


def read_form(path):
    """Latest submission per phone — doctors do resubmit."""
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    rows = list(wb[wb.sheetnames[0]].iter_rows(values_only=True))[1:]
    latest = {}
    skipped = 0
    for r in rows:
        if not r or not r[2]:
            continue
        p = phone10(r[3])
        if not p:
            skipped += 1
            continue
        ts = r[0] if isinstance(r[0], datetime) else datetime.min
        if p not in latest or ts > latest[p][0]:
            latest[p] = (ts, r)
    return latest, len(rows), skipped


def build_sql(latest, store, commit=True):
    # A store, when given, is an extra join everywhere a provider is resolved.
    scope_join = ('\n  JOIN "ProvidersOnStore" pos ON pos."providerId" = p.id'
                  '\n                            AND pos."storeId" = (SELECT store FROM cfg)'
                  if store else '')
    cfg = (f'CREATE TEMP TABLE cfg (store int) ON COMMIT DROP;\nINSERT INTO cfg VALUES ({store});\n'
           if store else '')
    scope_note = f'store {store}' if store else 'all providers'
    values = ',\n'.join(
        "  ({}, {}, {})".format(
            clean(p), clean(r[2]), ','.join(clean(r[i]) for i in DAY_COLS))
        for p, (_, r) in sorted(latest.items()))

    day_pairs = ',\n    '.join(
        "('{}', f.d{})".format(d, i) for i, d in enumerate(DAYS))
    day_cols = ', '.join('d{} text'.format(i) for i in range(7))

    return f"""-- Doctor duty slots — bulk update ({scope_note})
-- Generated {datetime.now():%Y-%m-%d %H:%M} from the weekly availability form.
--
-- Target: the LabStack PRIMARY (this writes; the replica Atlas reads cannot).
-- Run:    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f {os.path.basename(sys.argv[0]).replace('.py','')}.sql
--
-- {len(latest)} form responses, latest per doctor. One transaction throughout:
-- any failure rolls the whole thing back. Re-running is safe — it deactivates
-- whatever is active and reinserts the same set.

\\set ON_ERROR_STOP on
BEGIN;

-- psql does not substitute :variables inside dollar-quoted blocks, so a store
-- filter (when used) goes somewhere the DO blocks below can read it.
{cfg}
CREATE TEMP TABLE form (phone text, form_name text, {day_cols}) ON COMMIT DROP;
INSERT INTO form VALUES
{values};

-- One row per (phone, day, slot). Anything not matching HH:MM - HH:MM is
-- dropped, which is how "Not available on this day" disappears.
CREATE TEMP TABLE slot ON COMMIT DROP AS
WITH long AS (
  SELECT f.phone, d.day, d.txt
  FROM form f, LATERAL (VALUES
    {day_pairs}) AS d(day, txt)
),
piece AS (
  SELECT phone, day, btrim(p) AS p
  FROM long, unnest(string_to_array(txt, ',')) AS p
  WHERE txt IS NOT NULL
)
SELECT phone, day,
       substring(p from '^(\\d{{1,2}}):')::int * 60
         + substring(p from '^\\d{{1,2}}:(\\d{{2}})')::int AS a,
       CASE WHEN substring(p from '-\\s*(\\d{{1,2}}):') = '00'
             AND substring(p from '-\\s*\\d{{1,2}}:(\\d{{2}})') = '00'
            THEN 1440
            ELSE substring(p from '-\\s*(\\d{{1,2}}):')::int * 60
                 + substring(p from '-\\s*\\d{{1,2}}:(\\d{{2}})')::int END AS b
FROM piece
WHERE p ~ '^\\d{{1,2}}:\\d{{2}}\\s*-\\s*\\d{{1,2}}:\\d{{2}}$';

-- Adjacent hours become one range (gaps and islands).
CREATE TEMP TABLE merged ON COMMIT DROP AS
SELECT phone, day, min(a) AS a, max(b) AS b
FROM (SELECT *, sum(brk) OVER (PARTITION BY phone, day ORDER BY a, b) AS grp
      FROM (SELECT *, CASE WHEN a <= lag(b) OVER (PARTITION BY phone, day ORDER BY a, b)
                           THEN 0 ELSE 1 END AS brk
            FROM slot WHERE b > a) x) y
GROUP BY phone, day, grp;

-- A phone reaching two providers in this store is ambiguous — writing to both
-- would put one doctor's hours on another. Stop rather than guess.
DO $ambiguous$
DECLARE bad text;
BEGIN
  SELECT string_agg(t.phone || ' -> ' || t.who, '; ') INTO bad FROM (
    SELECT f.phone, string_agg(p.id || ' ' || p.name, ' / ') AS who
    FROM form f
    JOIN "Provider" p ON right(regexp_replace(p.mobile, '\\D', '', 'g'), 10) = f.phone{scope_join}
    GROUP BY f.phone HAVING count(*) > 1) t;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'phone numbers matching more than one provider: %', bad;
  END IF;
END $ambiguous$;

-- Days sharing a range collapse into one row.
CREATE TEMP TABLE final ON COMMIT DROP AS
SELECT p.id AS provider_id, p.name AS provider_name,
       -- a whole day would print 00:00-00:00, indistinguishable from empty
       CASE WHEN m.a = 0 AND m.b >= 1440 THEN '00:00'
            ELSE to_char((m.a || ' minutes')::interval, 'HH24:MI') END AS start_time,
       CASE WHEN m.a = 0 AND m.b >= 1440 THEN '23:59'
            ELSE to_char((m.b % 1440 || ' minutes')::interval, 'HH24:MI') END AS end_time,
       array_agg(m.day ORDER BY array_position(ARRAY[{','.join("'%s'" % d for d in DAYS)}], m.day)) AS days
FROM merged m
JOIN "Provider" p ON right(regexp_replace(p.mobile, '\\D', '', 'g'), 10) = m.phone{scope_join}
GROUP BY p.id, p.name, 3, 4;

\\echo ''
\\echo '--- matched:'
SELECT count(DISTINCT provider_id) AS doctors, count(*) AS slot_rows FROM final;

\\echo ''
\\echo '--- not updated, and why:'
SELECT f.form_name, f.phone, 'no provider with this number' AS reason
FROM form f
WHERE NOT EXISTS (
  SELECT 1 FROM "Provider" p{scope_join}
  WHERE right(regexp_replace(p.mobile, '\\D', '', 'g'), 10) = f.phone)
ORDER BY 1;

-- Replace, not append: the form is a full weekly declaration.
UPDATE "SlotConfig" SET "isActive" = false, "updatedAt" = now()
WHERE provider_id IN (SELECT provider_id FROM final) AND "isActive";

INSERT INTO "SlotConfig"
  ("startTime", "endTime", duration, "daysOfWeek", "slotBegin",
   provider_id, "isActive", "createdAt", "updatedAt")
SELECT start_time, end_time, {SLOT_MINUTES}, days::"DayOfWeek"[], '1970-01-01 00:00:00',
       provider_id, true, now(), now()
FROM final;

\\echo ''
\\echo '--- result per doctor:'
SELECT p.id, p.name,
       count(*) FILTER (WHERE sc."isActive")     AS active_now,
       count(*) FILTER (WHERE NOT sc."isActive") AS deactivated,
       string_agg(sc."startTime" || '-' || sc."endTime", ', '
                  ORDER BY sc."startTime") FILTER (WHERE sc."isActive") AS hours
FROM "Provider" p JOIN "SlotConfig" sc ON sc.provider_id = p.id
WHERE p.id IN (SELECT provider_id FROM final)
GROUP BY p.id, p.name ORDER BY p.name;

{'COMMIT;' if commit else "\\echo ''\n\\echo '*** DRY RUN — rolling back, nothing was kept ***'\nROLLBACK;"}
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('xlsx', help='the Google Form responses export')
    ap.add_argument('--store', type=int,
                    help='optional: only touch providers attached to this store')
    ap.add_argument('-o', '--out', help='output .sql (default slots-<store>-<date>.sql)')
    ap.add_argument('--test', action='store_true',
                    help='dry-run it against a local database and roll back')
    ap.add_argument('--db', default=os.environ.get('LOCAL_DATABASE_URL'),
                    help='connection string for --test (or set LOCAL_DATABASE_URL)')
    ap.add_argument('--psql', default='psql', help='psql to use, e.g. a docker exec wrapper')
    a = ap.parse_args()

    latest, total, no_phone = read_form(a.xlsx)
    print(f'form rows: {total}   doctors (latest submission each): {len(latest)}'
          + (f'   skipped, no phone: {no_phone}' if no_phone else ''))

    out = a.out or (f'slots-{a.store}-{datetime.now():%Y%m%d}.sql' if a.store
                    else f'slots-{datetime.now():%Y%m%d}.sql')
    with open(out, 'w') as f:
        f.write(build_sql(latest, a.store, commit=True))
    print(f'wrote {out}')

    if not a.test:
        print('\nrun --test to dry-run it against a local database first')
        return

    if not a.db:
        sys.exit('--test needs --db or LOCAL_DATABASE_URL')
    dry = build_sql(latest, a.store, commit=False)
    print(f'\n--- dry run against {a.db.split("@")[-1]} (rolls back) ---')
    p = subprocess.run(a.psql.split() + [a.db, '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                       input=dry, text=True, capture_output=True)
    print(p.stdout.strip() or p.stderr.strip())
    if p.returncode:
        sys.exit(f'\ndry run FAILED — fix this before running {out} anywhere')
    print('\ndry run clean.')


if __name__ == '__main__':
    main()
