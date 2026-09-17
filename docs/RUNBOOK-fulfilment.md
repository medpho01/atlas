# Runbook — the fulfilment desk

`/fulfilment`. One day, one table, filters that are links. It exists to say
what the team should work on today, in order.

Two different objects live here, and they are two tabs rather than two lanes,
because only one of them has an appointment date:

- **Day's orders** — requests that became orders with an appointment on the
  selected day. Filterable by source, whether a lab is assigned, first orders,
  and whether the appointment has moved. Clicking a row opens the lab context.
- **Promised, no order yet** — a quoted date with no order behind it. There is
  no appointment to filter on until a lab exists, so this list is sorted by the
  promised date instead.

## The sort is the advice

The default order of the day's table is the order the day should be worked:

| Rank | Row | Why |
|---|---|---|
| 1 | No lab assigned | An appointment with nobody behind it. |
| 2 | First order with this lab | Of the 98 labs that have ever taken an order, 41 have taken exactly one. |
| 3 | Three orders or fewer | Barely more track record than a first order. |
| 4 | Moved | Somebody has already rescheduled this. |
| 5 | Everything else | By time. |

`attention` in `getDayOrders` computes this once and the row prints the reason,
so the position on the page and the chip on the row can never disagree.

## The drawer

Clicking a row calls `/api/fulfilment/context?order=<id>` and shows: the lab
assigned with its delivered/failed record, every lab contracted to that store
that reaches the pincode — with what each is **missing** and what each has
actually delivered — and the assigned lab's last eight orders.

It is a route rather than a page navigation so that the table keeps its scroll
position and the filters stay where they were.

Web discovery for pincodes no lab reaches is **off** and being rebuilt; the
drawer says so rather than pretending the section is empty for another reason.

## What it is built on

| Object | What it does |
|---|---|
| `atlas.order_watch` | Remembers each live order's appointment, lab and status, and counts what changed. |
| `atlas.sync_order_watch()` | Compares the snapshot against that memory and writes the differences. Returns `(watched, appointment_moved, lab_moved)`. |
| `analytics.v_lab_order_history` | Per lab: orders all time, delivered, failed, first and last appointment. |
| `analytics.v_fulfilment_day` | One row per order with an appointment — lab, store, request, commitment, `is_first_order`, `appointment_moves`, `on_placeholder`. |

All of it is in `sql/init/21_fulfilment_desk.sql`, which is idempotent and safe
to re-run.

**Reschedules are only visible because something remembers.** `src_local` is
rebuilt nightly, so yesterday's appointment date is otherwise simply gone. The
first `sync_order_watch()` run records everything and reports **no** moves,
which is correct — an order seen once has not moved. Moves accumulate from the
second run on, which is why the Moved lane is empty on the day the desk is
installed and fills in from the first night after.

## How it stays current

`atlas.sync_commitments_full()` calls `sync_order_watch()`, and
`scripts/commitment-loop.sh` calls that every few minutes — so the desk is
current within one poll, and the **Sync** button on `/commitments` refreshes it
too. Nothing separate to schedule.

Check the poller is doing it:

```bash
docker logs --tail 50 atlas-commitments | grep -i moved
```

## Timezone

`Order."appointmentTime"` is a naive **UTC** timestamp. `v_fulfilment_day`
converts once, to IST, for both the clock and the day: a 6am collection belongs
to that morning, not to the previous day's UTC date. Do not add a second
conversion in the page — the view hands back an IST wall clock as text.

## When a lane looks wrong

**"Promised, no lab yet" is empty but you expect rows.** That lane is
`analytics.v_commitment_queue` — open commitments only. If `atlas.commitment`
has no open rows, there is nothing to show; run
`SELECT * FROM atlas.sync_commitments_full();` and look at `opened`.

**A first order is not flagged.** `is_first_order` compares the order's
appointment against the lab's earliest — so the *earliest* order is the flagged
one, not the first one to be worked. A lab whose history starts before the
snapshot window will never flag; that is the snapshot's horizon, not a bug.

**An appointment shows as moved but nobody moved it.** A status change alone
does not count; only `appointmentTime` or `labId` changing does. Check:

```sql
SELECT order_id, prev_appointment_time, appointment_time, appointment_moves, lab_moves
  FROM atlas.order_watch WHERE order_id = <id>;
```

## Access

Gated on the `commitments` feature — network, accounts and admin. Same set as
`/commitments`, deliberately: it is the same team's work, one step later.
