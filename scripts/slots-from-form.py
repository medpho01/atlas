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

    with open('slots-apply.sql', 'w') as f:
        f.write('-- Generated by scripts/slots-from-form.py — REVIEW BEFORE RUNNING.\n')
        f.write('-- Run against the LabStack PRIMARY, not the read replica Atlas reads.\n')
        f.write('BEGIN;\n')
        f.write('\n'.join(apply_sql))
        f.write('\n\nCOMMIT;\n')

    with open('slots-rollback.sql', 'w') as f:
        ids = ','.join(str(i) for i in sorted(set(rollback_ids)))
        f.write('-- Undo: drop the rows this run inserted and revive what it deactivated.\n')
        f.write('BEGIN;\n')
        f.write(f'DELETE FROM "SlotConfig" WHERE provider_id IN ({ids}) '
                f'AND "createdAt" >= now() - interval \'1 hour\';\n')
        f.write(f'UPDATE "SlotConfig" SET "isActive" = true WHERE provider_id IN ({ids}) '
                f'AND NOT "isActive" AND "updatedAt" >= now() - interval \'1 hour\';\n')
        f.write('COMMIT;\n')

    m = sum(1 for x in review if x['matched'] == 'yes')
    print(f'form responses (latest per doctor): {len(latest)}')
    print(f'matched to a doctor in the store:   {m}')
    print(f'not in this store:                  {len(latest) - m}')
    print(f'SlotConfig rows to insert:          '
          f'{sum(x["new_config_rows"] for x in review if x["matched"] == "yes")}')
    print('\nwrote slots-review.csv, slots-apply.sql, slots-rollback.sql')


if __name__ == '__main__':
    main()
