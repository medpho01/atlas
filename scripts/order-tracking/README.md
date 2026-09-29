# Order tracking desk runner

Drives `/order-tracking` for the stores the desk watches: reads the three
queues, exports them, and assigns the allocation queue in bulk.

```bash
npm i -D playwright && npx playwright install chromium
```

## Running it

```bash
# See what is there. Writes nothing.
node scripts/order-tracking/run.mjs --queue=needs-lab

# Narrow to tomorrow's appointments only
node scripts/order-tracking/run.mjs --queue=needs-lab --within=1

# Assign ten of them — still a dry run until --apply
node scripts/order-tracking/run.mjs --queue=needs-lab --assign-to="Varun Kansal" --limit=10
node scripts/order-tracking/run.mjs --queue=needs-lab --assign-to="Varun Kansal" --limit=10 --apply

# Today's pickups and the late reports, to a file
node scripts/order-tracking/run.mjs --queue=pickup-today       --out=pickup-today.csv
node scripts/order-tracking/run.mjs --queue=report-outstanding --out=late.csv
```

| flag | |
|---|---|
| `--queue=` | `needs-lab` · `pickup-today` · `report-outstanding` |
| `--assign-to=` | assignee name, matched against the dropdown |
| `--limit=` | how many to assign in one run (default 10) |
| `--within=` | `1` tomorrow · `3` · `7` · omit for everything ahead |
| `--apply` | **actually write.** Without it nothing is changed |
| `--out=` | CSV path |
| `--include-pii` | keep full phone numbers (they are masked otherwise) |
| `--stores=` | override the store list, comma separated |
| `--headed` | watch it work |
| `--pause=` | ms between navigations (default 1200) |
| `--base=` | portal URL (default `https://atlas.labstack.in`) |

## Signing in

It never handles a password. Either:

```bash
export ATLAS_SESSION_COOKIE='<the atlas_session cookie from your browser>'
```

or run it once with no session — it opens a window, waits for you to sign in,
and saves the state to `scripts/order-tracking/.session.json` for next time.

That file is a live session. It is gitignored; treat it like a password.

## Three things worth knowing

**Nothing is written without `--apply`.** Every run is a dry run: it reads,
decides, prints what it would do, and stops. This points at production.

**Assignment is one request, not one per row.** The page already has a bulk bar
and the action behind it takes up to 200 ids at once. Ten per-row dropdowns
would be ten round trips and ten chances to half-finish. After writing, the
script reloads and checks each one really shows an owner.

**Phone numbers are masked** in the log and the CSV unless you pass
`--include-pii`. Patient names and numbers are on this screen; the export
leaves the building.

## The Queue C caveat

Three of the six lifecycle states in the brief are not `OrderStatus` values and
cannot be filtered on:

| asked for | reality |
|---|---|
| Phlebo started | no such status — `PHLEBO_ASSIGNED` means assigned, not started |
| Sample in transit | no such status — nothing is recorded between collected and delivered |
| Partial delivered | `PARTIAL_DELIVERED` is on `PharmaOrderStatus`; lab orders never carry it |

The real enum is `PENDING, CREATED, ORDER_SCHEDULED, PHLEBO_ASSIGNED,
SAMPLE_COLLECTED, SAMPLE_DELIVERED, SAMPLE_PROCESSED, REPORT_DELIVERED,
RESCHEDULED, CANCELED, PATIENT_MISSED, PATIENT_VISITED, KIT_DISPATCHED`.

In practice it does not narrow anything: the server already defines the queue
as *the appointment has passed and no report has come back*, which covers every
state except `REPORT_DELIVERED`. The script prints the mismatch on each run
rather than silently applying two thirds of the rule.

## When to not use this

If this becomes a daily job, it should not stay a browser script. Everything it
does exists server-side already — `assignTasks` takes the ids directly. A
scheduled task calling that would be faster, testable, and would not break the
next time a column moves. This is the right shape for a hand-run batch and the
wrong shape for a cron job.
