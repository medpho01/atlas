# Runbook — order tracking

`/order-tracking`. Three queues an order passes through after it leaves the
request queue.

**Only orders that came from a request appear anywhere on this page.** A
store's own direct order has no quote to honour and nobody on this team owns
it. `analytics.v_request_order` is the ledger — it inner-joins Request, which
also cuts the base the queues derive from by twelve times.

The three queues, each with its own deadline:

| Tab | Due | Applies to | Closes when |
|---|---|---|---|
| **Needs a lab** | day before the appointment | orders still on the placeholder lab, appointment **strictly after today** | `labId` is no longer the placeholder, or the day arrives |
| **Pickup today** | the day itself | today's appointments at a lab under the threshold **or** with no lab at all | status reaches `SAMPLE_COLLECTED` or beyond |
| **Report outstanding** | appointment or last update + 48 hours | at a lab under the threshold: the appointment has passed, **or** the sample is collected — in any status short of `REPORT_DELIVERED` | status reaches `REPORT_DELIVERED` (or the order is cancelled / the patient missed) |

The three are disjoint by construction and, between them, leave no gap once an
appointment date is set. *Needs a lab* stops at the end of yesterday because on
the day itself an unallocated order is not an allocation problem to work
through in order — it is today's emergency, and *Pickup today* already carries
every unallocated appointment for today. *Report outstanding* picks up from
where *Pickup today* stops: the statuses it excludes (collected, delivered,
processed) are exactly the ones that start the 48-hour clock.

**Report outstanding is defined by exclusion, not by a status list.** It used
to name three statuses — collected, delivered, processed — which quietly meant
that an order whose appointment was on Tuesday and was still sitting at
`PHLEBO_ASSIGNED` on Friday appeared in *no queue at all*: it left the pickup
queue at midnight and never arrived anywhere else. Now the rule is "the
appointment happened and no report came back", whatever state it stopped in,
so `ORDER_SCHEDULED`, `PHLEBO_ASSIGNED`, `KIT_DISPATCHED` and `PATIENT_VISITED`
all land here. `CANCELED` and `PATIENT_MISSED` do not — those are closed, not
outstanding — and a `RESCHEDULED` order takes itself out through its new date.

The 48 hours run from **whichever is later, the appointment or the last status
change**. `statusUpdatedAt` is routinely *before* the appointment — a phlebo is
assigned in advance, so every `PHLEBO_ASSIGNED` order has one — and keying the
clock off it alone marked orders late before anybody had been to the house.

## Derived, not filed

`analytics.v_order_task` reads the order data and says what is due. A row
appears because the data says it should and disappears when the data says it
is done — **nobody creates a task and nobody closes one.** Verified: putting a
real lab on an order drops it out of *Needs a lab*; marking a sample collected
drops it out of *Pickup today* and into *Report outstanding*; delivering the
report drops it out of that.

Two tables store the part no query can work out:

- `atlas.order_task` — who a task is assigned to, and who assigned it.
- `atlas.order_task_note` — what the lab said. Kept after the task closes.

Both are keyed on `(order_id, kind)`. Delete every row in them and the queues
still work; they just stop saying who is on what.

## The threshold

Pickup and report are filtered to labs with fewer than
`followup_max_lifetime_orders` (default **5**) orders ever, because that is
where orders actually fail:

| Lab cohort | Failure rate |
|---|---|
| under 5 orders ever | **41.2%** |
| 5–19 | 27.2% |
| 20+ | 15.9% |

Change it without a deploy:

```sql
UPDATE atlas.request_settings SET value = '8'
 WHERE key = 'followup_max_lifetime_orders';
```

*Needs a lab* is deliberately **not** filtered by it — there is no lab yet. Nor
is the no-lab half of *Pickup today*: today's pickup list has to be the whole
day or it is not a pickup list, so an unallocated appointment appears in both
queues. They are two different questions about the same order.

## Seeing today

This is the part that makes the whole feature possible, and the part to check
first when a queue looks wrong.

`src_local."Order"` is rebuilt once a night, so without help a sample collected
at 8am is invisible until tomorrow. `atlas.sync_orders_live()` tops the
snapshot up from the live foreign table for appointments in a window (default
−7 to +21 days), and `scripts/commitment-loop.sh` calls it every few minutes.
It **never raises** — a source standby that is briefly unreachable must not
take the poller down — so a failure shows up as a row, not a crash:

```bash
docker exec atlas-db psql -U atlas -d atlas -c "SELECT * FROM atlas.sync_orders_live();"
```

`failed` non-null means the queues are reading last night's data. Check the
poller log:

```bash
docker logs --tail 50 atlas-commitments | grep -i order
```

## Who can do what

Gated on the `orderTracking` feature. **Network lead and admin** get `manage`
and are the only ones who see the assign controls — work is handed out, not
picked up. **Network and operations** get `view`: they work the rows they are
given and can add notes to anything.

Assignment needs the team to exist as users. If the assign picker is empty,
nobody has an active `network`, `network_lead` or `admin` account yet.

## When it is slow

Run the speed check before anything else:

```bash
docker exec -i atlas-db psql -U atlas -d atlas -f - < sql/reports/speed-check.sql
```

Section 1 is the usual answer. `src_local.*` tables are created with
`CREATE TABLE ... (LIKE src.X)`, which copies no indexes, so a table showing
`0` means every join against it is a sequential scan and every page that
touches it is slow. Apply `sql/init/22_src_local_indexes.sql`.

Section 4 tells you whether the live order sync is working; a non-null
`failed` means the queues are reading last night's data.

## When a queue looks wrong

**Empty when it should not be.** Check `sync_orders_live` above, then check the
window: the view ignores appointments more than 30 days old, on purpose — a
queue that never empties is a queue nobody opens.

**A pickup task for a lab that plainly collected the sample.** The queue reads
`orderStatus`. If the console has not moved the order on, Atlas cannot know.

**"Report outstanding" on something collected minutes ago.** Correct, and not
yet late: the row shows *Due in 2 days* until the clock runs out. The table
shows the **appointment** rather than a collection time, because most rows in
this queue were never collected; `collected_at` is still `statusUpdatedAt` for
anything that wants it, and `clock_from` is what the deadline is measured from.

## First deploy

```bash
cd ~/atlas && git pull
docker exec -i atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 -f - < sql/init/24_order_tracking.sql
docker compose up -d --build atlas-web atlas-commitments
```

`sql/init/` only runs on a database's first boot, so this is applied by hand on
an existing host. Idempotent — safe to run twice. `atlas-commitments` has to be
rebuilt because it carries the poller script that calls the live sync.

It depends on `22_src_local_indexes.sql` for the unique index on `Order(id)`
that the live sync upserts against. Apply that first if it has not been.
