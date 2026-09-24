# Stores & Orders

*Fulfilment › Stores & Orders — `/stores`*

The other two fulfilment screens are queues. Requests holds what needs quoting;
Order tracking holds the three ways an order in flight can quietly fail. Both
are meant to empty, and both are organised around what we have to do next.

Neither can answer the question a partner asks on the phone: **what is
happening to our orders.** That needs every order they have ever sent —
including the cancelled ones, including March — grouped by store rather than by
urgency. This is that ledger.

---

## What Atlas may and may not change

This is the first thing to understand about the screen, because the gap between
what it looks like it does and what it does is otherwise an afternoon of
confusion.

`Store` and `Order` belong to **LabStack**. Atlas reads them through a
read-only replica, mirrored into `src_local`, and has never written a row
there. So:

| | Where it happens |
|---|---|
| Add a store, change its name, address, GST, serviceability | **Console.** Atlas cannot. |
| Close a partner | **Console.** Atlas cannot. |
| Move an appointment, cancel an order, assign a phlebo | **Console.** Atlas cannot. |
| Who runs the account on our side, who to ring, alert thresholds, notes | Atlas — `atlas.store_profile` |
| Whether the requests queue includes this partner | Atlas — `atlas.store_tracking` |
| Which orders somebody has decided need a new date | Atlas — `atlas.order_reschedule_flag` |
| Who changed any of the above, and when | Atlas — `atlas.store_change_log` |

That division is not new here. `atlas.commitment` sits beside `Request` and
`atlas.order_task` beside `Order` for the same reason: Atlas records the human
layer — decisions, ownership, what was said — and the console holds the record
of truth. Keeping to it means a partner's data cannot be damaged from a
dashboard.

**The bulk "reschedule" action is a decision, not an edit.** It records which
orders need a new date, why, who decided and when, puts them on the export, and
shows them on the row. It does not touch `appointmentTime`. The screen says so
above the button, because a button labelled *Reschedule* that quietly did not
would be worse than no button at all.

---

## The two screens

### `/stores` — the list

One row per store. Collapsed by default: forty partners each showing ten
orders is four hundred rows nobody asked for, and the first question is always
*which store*, not *which order*. Opening a row fetches that store's ten most
recent orders and nothing else, so the page costs one query however many stores
are on it.

Each row carries the stage mix as a single stacked bar. Six numbers in a row is
six things to read; the same six as proportions of a bar is one, and the point
of a list of forty is spotting the one whose bar is half red from across the
desk.

**The window.** Counts, turnaround and cancellation rate are all measured
inside the window at the top, defaulting to ninety days. A rate or an average
without a window cannot be compared between two partners — a store onboarded in
March and one onboarded last week are not comparable on lifetime totals, and
"all time" quietly averages this quarter's turnaround with last year's.

**Quiet stores.** The strip counts active, tracked partners that sent *nothing*
in the window. It is the one thing a table of orders can never show you, and it
is usually the more expensive problem.

### `/stores/[id]` — one partner

Lifetime figures, not windowed: this page is about one store, and the question
is what their whole book looks like rather than how they compare. Stage tabs,
search, an appointment date range, and the two filters that matter operationally
(past the promise, needs a new date). Below that, the account overlay and the
change log.

---

## Deploying this

**`sql/init/` runs once, on a database's first boot.** A host that already
exists will not pick up `28_store_orders.sql` from a deploy, and `/stores` will
fail with `relation "analytics.v_store_order" does not exist` until it is
applied by hand — the same step `20_lab_discovery_ranking.sql` and
`24_order_tracking.sql` needed:

```bash
cd ~/atlas && git pull
docker exec -i atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 -f -   < sql/init/28_store_orders.sql
```

Idempotent throughout — safe to run twice. It creates `atlas.order_stage()`,
three Atlas-owned tables (`store_profile`, `store_change_log`,
`order_reschedule_flag`), the view `analytics.v_store_order`, and four indexes
on `src_local."Order"`.

Two things it does **not** do, deliberately:

- **It does not touch LabStack.** Every object is in `atlas` or `analytics`;
  the only thing it does to `src_local` is add indexes, and `TRUNCATE` in the
  nightly refresh keeps those.
- **It adds no materialized view, so there is nothing new to refresh.**
  `v_store_order` is a plain view over the `src_local` mirror, which means it
  is exactly as fresh as the 3 AM refresh and never separately stale.

Then confirm:

```bash
docker exec -i atlas-db psql -U atlas -d atlas -f - < scripts/check-stage-map.sql
```

Every row should read `ok`. A row reading `NEW ENUM VALUE` means LabStack has
added an `OrderStatus` that neither this file nor `lib/stores.ts` knows about;
it will be counted as `pending` until both are updated.

### What merging changes for people already using Atlas

- **Nobody's existing access moves.** The permission change is purely additive:
  one new feature row, and zero existing (feature, role) pairs change
  capability. Verified by diffing `permissionMatrix()` across the branch.
- **One nav item is renamed.** Admin › *Stores* becomes Admin › *Tracked
  stores*, because "Stores" sitting one word away from "Stores & Orders" while
  doing an entirely different job is a trap. Same route, same page.
- **`viewer` gains nothing** — the one role that cannot reach this screen.
- **The seed and `setup-local.sh` changes are local-only.** Neither runs
  against a deployed database.

---

## Definitions

**Stage.** `OrderStatus` has thirteen values and nobody groups orders by
thirteen things. `atlas.order_stage()` maps them to six:

| Stage | `OrderStatus` |
|---|---|
| Pending | `PENDING`, `CREATED` |
| Scheduled | `ORDER_SCHEDULED`, `PHLEBO_ASSIGNED`, `KIT_DISPATCHED` |
| Rescheduled | `RESCHEDULED` |
| In progress | `SAMPLE_COLLECTED`, `SAMPLE_DELIVERED`, `SAMPLE_PROCESSED`, `PATIENT_VISITED` |
| Completed | `REPORT_DELIVERED` |
| Cancelled | `CANCELED`, `PATIENT_MISSED` |

The mapping is computed **in SQL**, so the screen, the API and the CSV cannot
disagree about what `SAMPLE_DELIVERED` counts as. `lib/stores.ts` carries the
same mapping backwards for the tooltips; `scripts/check-stage-map.sql` asserts
the two still agree and shouts if a new value appears in the enum.

It is deliberately total — an unmapped status reads `pending` rather than
`NULL`, so a status added in LabStack surfaces as work to look at instead of
disappearing from every count on the page.

**Turnaround.** Order taken → report delivered, in hours. Counted **only on
completed orders**. An unfinished order has no turnaround yet, and averaging in
its age would report a confident number that means nothing. The median sits
beside the mean because one nine-day order moves the mean and not the median.

**Cancellation rate.** Cancelled ÷ *every* order in the window, not ÷ finished
ones. A store whose orders are mostly still open would otherwise read 50% off
two rows.

**Delayed.** Past its appointment by more than that store's own threshold
(default 48h) and still unfinished. Cancelled is not delayed — it is closed,
badly, and counted in the cancellation rate instead. Per store because a
corporate camp settles in a day and a home collection in a small town does not,
and one global number made both wrong.

---

## Permissions

Feature key `storeOrders` in `lib/access.ts`.

| Role | Sees it | Can edit the overlay | Can take a store out of the queue |
|---|---|---|---|
| admin | yes | yes | **yes** |
| network_lead | yes | yes | no |
| accounts | yes | yes | no |
| network | yes | no | no |
| operations | yes | no | no |
| viewer | **no** | no | no |

Accounts gets `manage` because the partner relationship is theirs, and the
writable part of this screen is the account overlay rather than the store
record. Operations reads it because they answer the calls it is about.

Taking a store out of the requests queue is **admin only**, stricter than the
rest. It is the one action here that changes what other people see on a screen
they are working, and a wrong click is invisible to the person it affects. It
is also not a delete: nothing is removed, the orders stay on this page, and the
queue keeps saying how many requests are hidden.

Every write lands in `atlas.store_change_log` with the before and after.
`atlas.audit_log` answers "was this page opened"; this answers "who turned this
partner off on the fourteenth", which is the question actually asked afterwards.
CSV exports are audited too — they leave the building.

---

## API

Both endpoints are read-only, gated on the same feature as the page, and built
from the same functions the screen renders from, so an integration can never
see a number the screen disagrees with.

```
GET /api/stores
    ?q= &from= &to= &active=0 &tracked=1 &attention=1 &sort= &limit= &offset=
    → { rows, total, limit, offset, window: { from, to } }

GET /api/stores/[id]/orders
    ?q= &stage= &from= &to= &delayed=1 &flagged=1 &limit= &offset=
    → { store_id, rows, total, limit, offset, window: { from, to } }

GET /api/stores/[id]/export      (same filters; CSV, UTF-8 BOM, max 20,000 rows)
```

- **Authentication is the ordinary Atlas session.** There is no API key and no
  service account. This endpoint is for the browser and for scripts run by
  somebody who already has a login. Machine-to-machine access wants a token
  with its own scope and expiry — that is a decision about how Atlas is
  operated, not something to quietly invent in a route handler.
- **`window` comes back in the response.** With no `from`/`to` the API counts
  every order ever, which is what a sync wants and is *not* what `/stores`
  shows. Echoing the window lets a caller comparing a figure against the screen
  see which question it answered.
- A missing store is **404** on both `orders` and `export`. An empty list would
  be indistinguishable from a real store having no orders, which is the
  difference between a quiet day and a broken integration.
- Bad input is **400** with a sentence: `stage=nonsense` and
  `from=last week` are refused rather than ignored. Silently dropping an
  unknown filter answers a question nobody asked with a full, confident list.
- `limit` is clamped (200 stores, 500 orders), so a bigger number in the URL
  cannot pull the whole book into memory.

---

## Patient data

The order rows carry a patient **name** and serving city, and not the phone
number — deliberately. This screen is for judging whether a store's book is
healthy, which needs a row to be identifiable, not contactable. The number
stays in the console behind its own access rules; there is no reason to copy it
into a dashboard several teams can open, and the CSV does not carry it either.

The export *is* patient data and does leave the building, so it is audited, and
it is capped at 20,000 rows.

---

## Things worth knowing

- **During the 3 AM refresh this page can read low or empty.**
  `scripts/refresh-data.sh` TRUNCATEs the `src_local` tables in one committed
  transaction and re-inserts them in chunks afterwards, so for the minutes that
  takes, anything reading `src_local` live sees a partial table. That is not
  new — `analytics.v_request_order` behind `/order-tracking` is a plain view
  over the same mirror and has the same window; the comment in the refresh
  script claiming only materialized views are queried has been out of date
  since order tracking shipped.

  Left as a live view deliberately. Making it materialized would fix the
  window and break something worse: the reschedule flags and the account
  overlay are Atlas-owned and edited during the day, and they would then be as
  stale as the last refresh. A page that is briefly thin at 3 AM is better than
  one that shows yesterday's flags at noon.

- **Sideways scroll below 1366px.** The store list fits at 1920, 1600, 1440 and
  1366; the order table has a 1180px minimum and scrolls inside its own box
  below that. A phone wants a different layout, not a narrower table.
- **Export is capped at 20,000 rows** and held in memory before it is sent.
  A partner with more than that needs a streaming export, which is its own
  change.
- **`notFound()` renders the 404 page with a 200 status.** A consequence of
  streaming a `force-dynamic` page, shared with `/requests/[id]`,
  `/chain/[id]` and `/pincode/[code]`. Not introduced here.
- **Reschedule flags clear themselves visually, not actually.** Once an order
  reaches completed, cancelled or rescheduled the flag is shown as *moved on —
  clear it* rather than as outstanding work, but somebody still has to clear
  it. A sweep would be a reasonable follow-up.
- **`atlas.store_profile` thresholds are per store and have no bulk editor.**
  Setting forty partners to the same threshold is forty saves. Fine at the
  current count; a default-by-store-type would be the fix if it grows.
