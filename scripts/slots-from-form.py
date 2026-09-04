#!/usr/bin/env python3
"""
Turn the weekly Doctor Duty Slot Availability form into SlotConfig SQL.

    python3 scripts/slots-from-form.py responses.xlsx store-117-doctors.csv

Writes three files beside the inputs:
    slots-review.csv   every doctor, matched or not, with the parsed ranges
    slots-apply.sql    the statements to run  (review this before running it)
    slots-rollback.sql restores what was there before

Matching is on the last ten digits of the phone. Names are not used — the
form spells them differently from the console ("Dr M.Anu Shreeshma Devi"
against "Dr. Anu Shreeshma Devi"), and a wrong match writes one doctor's
hours onto another.

The form asks for availability hour by hour; SlotConfig stores contiguous
ranges against a set of days. So adjacent hours are merged into a range, and
days whose ranges are identical share one row — which is how the console's
own rows are shaped.
"""
import csv, re, sys, unicodedata
from collections import defaultdict
from datetime import datetime

DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
DAY_COL = {d: 6 + i for i, d in enumerate(DAYS)}          # columns G..M
SLOT_MINUTES = 30                                          # matches existing rows


def digits(v):
    """Last ten digits — the form has floats, the console has strings."""
    if v is None:
        return ''
    s = str(int(v)) if isinstance(v, float) else str(v)
    s = re.sub(r'\D', '', s)
    return s[-10:] if len(s) >= 10 else s


def parse_day(cell):
    """'07:00 – 08:00, 08:00 – 09:00' -> [(420, 480), (480, 540)] in minutes."""
    if not cell:
        return []
    # The form uses an en dash; normalise it and anything else unicode threw in.
    text = unicodedata.normalize('NFKC', str(cell)).replace('–', '-').replace('—', '-')
    out = []
    for part in text.split(','):
        part = part.strip()
        m = re.match(r'^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$', part)
        if not m:
            continue                                       # 'Not available on this day'
        h1, m1, h2, m2 = (int(x) for x in m.groups())
        a, b = h1 * 60 + m1, h2 * 60 + m2
        if b == 0:                                         # 23:00 - 00:00 means midnight
            b = 24 * 60
        if b > a:
            out.append((a, b))
    return sorted(out)


def merge(spans):
    """Adjacent or overlapping hours become one range."""
    merged = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return [(a, b) for a, b in merged]


def hhmm(mins):
    # 24:00 is midnight-end and prints as 00:00, which the console already uses
    # ("20:00-00:00"). A whole day would print 00:00-00:00 though — start and end
    # identical, indistinguishable from an empty range — so it stops at 23:59.
    return f'{(mins // 60) % 24:02d}:{mins % 60:02d}'


def span_text(a, b):
    if a == 0 and b >= 24 * 60:
        return '00:00', '23:59'
    return hhmm(a), hhmm(b)


def main():
    if len(sys.argv) < 3:
        sys.exit('usage: slots-from-form.py <responses.xlsx> <doctors.csv>')
    xlsx, doctors_csv = sys.argv[1], sys.argv[2]

    import openpyxl
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    rows = list(wb[wb.sheetnames[0]].iter_rows(values_only=True))[1:]

    # A doctor may submit more than once; the latest submission wins.
    latest = {}
    for r in rows:
        if not r or not r[2]:
            continue
        phone = digits(r[3])
        if not phone:
            continue
        ts = r[0] if isinstance(r[0], datetime) else datetime.min
        if phone not in latest or ts > latest[phone][0]:
            latest[phone] = (ts, r)

    doctors = list(csv.DictReader(open(doctors_csv)))
    by_phone = {digits(d['mobile']): d for d in doctors}

    review, apply_sql, rollback_ids = [], [], []

    for phone, (ts, r) in sorted(latest.items()):
        doc = by_phone.get(phone)
        # ranges keyed by the day they fall on, then inverted so identical
        # schedules across days collapse into a single row.
        per_day = {d: merge(parse_day(r[DAY_COL[d]])) for d in DAYS}
        by_range = defaultdict(list)
        for d in DAYS:
            for span in per_day[d]:
                by_range[span].append(d)

        pretty = ' | '.join(
            f'{d[:3]}: ' + (', '.join('%s-%s' % span_text(a, b) for a, b in per_day[d]) or '—')
            for d in DAYS)

        review.append({
            'form_name': r[2], 'phone': phone,
            'matched': 'yes' if doc else 'NO — not in this store',
            'provider_id': doc['provider_id'] if doc else '',
            'console_name': doc['name'] if doc else '',
            'existing_slots': doc['slot_hours'] if doc else '',
            'week_starting': r[5].date().isoformat() if isinstance(r[5], datetime) else '',
            'submitted': ts.isoformat(sep=' ', timespec='minutes') if ts != datetime.min else '',
            'new_config_rows': len(by_range),
            'parsed': pretty,
        })
        if not doc or not by_range:
            continue

        pid = int(doc['provider_id'])
        rollback_ids.append(pid)
        apply_sql.append(f'\n-- {r[2]}  ->  provider {pid} ({doc["name"].strip()})')
        # Replace rather than add: the form is a full weekly declaration, so
        # yesterday's rows are not additive with today's.
        apply_sql.append(f'UPDATE "SlotConfig" SET "isActive" = false, "updatedAt" = now()\n'
                         f' WHERE provider_id = {pid} AND "isActive";')
        for (a, b), days in sorted(by_range.items()):
            arr = '{' + ','.join(days) + '}'
            st, en = span_text(a, b)
            apply_sql.append(
                'INSERT INTO "SlotConfig"\n'
                '  ("startTime","endTime",duration,"daysOfWeek","slotBegin",provider_id,'
                '"isActive","createdAt","updatedAt")\n'
                f"VALUES ('{st}','{en}',{SLOT_MINUTES},'{arr}',"
                f"'1970-01-01 00:00:00',{pid},true,now(),now());")

    with open('slots-review.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(review[0].keys()))
        w.writeheader(); w.writerows(review)

    ids = sorted(set(rollback_ids))
    id_list = ','.join(str(i) for i in ids)
    stamp = datetime.now().strftime('%Y-%m-%d %H:%M')

    with open('slots-apply.sql', 'w') as f:
        f.write(f"""-- Doctor duty slots — bulk update
-- Generated {stamp} by scripts/slots-from-form.py from the weekly form.
--
-- Target: the LabStack PRIMARY database (this writes; the read replica cannot).
-- Run:    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f slots-apply.sql
--
-- {len(ids)} providers, {len([l for l in apply_sql if l.startswith('INSERT')])} SlotConfig rows.
-- The form is a full weekly declaration, so existing active configs for these
-- providers are deactivated (not deleted) and replaced. Re-running is safe:
-- it deactivates whatever is active and inserts the same set again.
--
-- Everything is one transaction. Any failure rolls the whole thing back.

\\set ON_ERROR_STOP on
BEGIN;

-- Pre-flight: stop before touching anything if a provider has gone missing.
DO $preflight$
DECLARE missing text;
BEGIN
  SELECT string_agg(x::text, ', ') INTO missing
  FROM unnest(ARRAY[{id_list}]) AS x
  WHERE NOT EXISTS (SELECT 1 FROM "Provider" p WHERE p.id = x);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'these provider ids do not exist: %', missing;
  END IF;
END $preflight$;

-- What is there now, for the record.
\\echo '--- active SlotConfig rows before:'
SELECT count(*) AS rows_before FROM "SlotConfig"
WHERE provider_id IN ({id_list}) AND "isActive";
""")
        f.write('\n'.join(apply_sql))
        f.write(f"""

\\echo '--- active SlotConfig rows after:'
SELECT count(*) AS rows_after FROM "SlotConfig"
WHERE provider_id IN ({id_list}) AND "isActive";

\\echo '--- per doctor:'
SELECT p.id, p.name,
       count(*) FILTER (WHERE sc."isActive")     AS active_now,
       count(*) FILTER (WHERE NOT sc."isActive") AS deactivated,
       string_agg(sc."startTime" || '-' || sc."endTime", ', '
                  ORDER BY sc."startTime") FILTER (WHERE sc."isActive") AS hours
FROM "Provider" p JOIN "SlotConfig" sc ON sc.provider_id = p.id
WHERE p.id IN ({id_list})
GROUP BY p.id, p.name ORDER BY p.name;

COMMIT;
""")

    with open('slots-rollback.sql', 'w') as f:
        f.write(f"""-- Undo the run generated {stamp}.
-- Drops the rows it inserted and revives the ones it deactivated.
-- Only safe if run before anyone else edits these providers' slots.

\\set ON_ERROR_STOP on
BEGIN;

DELETE FROM "SlotConfig"
WHERE provider_id IN ({id_list}) AND "createdAt" >= '{stamp}'::timestamp;

UPDATE "SlotConfig" SET "isActive" = true
WHERE provider_id IN ({id_list}) AND NOT "isActive"
  AND "updatedAt" >= '{stamp}'::timestamp;

SELECT provider_id, count(*) FILTER (WHERE "isActive") AS active
FROM "SlotConfig" WHERE provider_id IN ({id_list}) GROUP BY 1 ORDER BY 1;

COMMIT;
""")

    m = sum(1 for x in review if x['matched'] == 'yes')
    print(f'form responses (latest per doctor): {len(latest)}')
    print(f'matched to a doctor in the store:   {m}')
    print(f'not in this store:                  {len(latest) - m}')
    print(f'SlotConfig rows to insert:          '
          f'{sum(x["new_config_rows"] for x in review if x["matched"] == "yes")}')
    print('\nwrote slots-review.csv, slots-apply.sql, slots-rollback.sql')


if __name__ == '__main__':
    main()
