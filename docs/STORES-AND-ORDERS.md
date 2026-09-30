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
| Change a **console** store's name, address, GST, serviceability | **Console.** Atlas cannot. |
| Close a partner in LabStack | **Console.** Atlas cannot. |
| Move an appointment, cancel an order, assign a phlebo | **Console.** Atlas cannot. |
| Add a store **to Atlas** | Atlas — `atlas.store` |
| Remove a store from this screen | Atlas — delete (`atlas.store`) or archive (`atlas.store_archive`) |
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

## The tracked stores, and the two queues

Step one of the spec: *all the data needs to be tracked for the following
stores*. That list is `atlas.store_group_member` for the group `TRACKED`, and
the two operational columns on this screen derive from it. A store that is not
on the list shows a **dash, not a zero** — nothing is being counted for it, and
a zero would claim otherwise.

The list is managed here. The eye on each row turns tracking on and off, and
the store's own page has the same control with the counts beside it. Taking a
store off deletes nothing: its orders, its ledger and its history are
untouched, and putting it back brings the counts straight back.

### The two queues

S1, S2 … in the spec are the **stores themselves** — "all orders originating
from S1" means one partner's orders — so both of these are read store by store,
and every count belongs to a store.

| | |
|---|---|
| **Needs a lab** | Appointment from **tomorrow onward**, still on the LabStack placeholder lab (`placeholder_lab_id`, or no lab at all). Nobody has said where it is happening. |
| **Pickup today** | **Every** appointment today, whichever lab it is at. No history filter — the question today is simply whether each one is happening. |

Cancelled and patient-missed fall out of both: closed is closed.

Within a tracked store this counts **every** order, not only the ones a request
turned into. A partner's direct orders are still that partner's orders, and on
the sample data the request-born ones are 15 of 1,085.

`Today's pile` sorts by the appointments today that still have no lab named,
which is the worst number on the page: it is happening in hours and nobody has
said where.

### This is not /order-tracking

`/order-tracking` is a different screen with its own three queues, its own
rules and its own `analytics.v_order_task`. **Nothing in this feature touches
it.** The views here are separate:

```
atlas.store_group / store_group_member        which stores are tracked
  └─ analytics.v_store_tracked_order          their orders, tagged by queue
       └─ analytics.v_store_queue             one row per store, counts beside it
```

`atlas.store_tracking` is a third thing again and stays as it is: which
partners the **requests** queue is for. A store can be tracked here and not
there.

---

## Adding and removing a store

### Why a store added here does not reach the console

`src_local."Store"` is a **mirror**. `scripts/refresh-data.sh` TRUNCATEs it at
3 AM and refills it from LabStack. A row inserted there would work all
afternoon and be gone by morning with nothing to explain it — a partner
onboarded, worked, and silently lost.

So **Add a store** writes to `atlas.store`, which survives the refresh. The
store gets an id from 900000 up (LabStack's are a low serial; sharing a
namespace would eventually put one store's orders under another's name), it
appears in the list immediately, and it is badged **Atlas-side** everywhere it
shows. The form says the same thing in as many words: the console cannot take
an order for that partner until somebody adds them there too.

It captures what the brief asked for — name, location, contact, service
coverage — plus a note. Duplicate name-and-city is refused and the message
names the store that already exists.

### Removing means one of two different things

Which one is decided by the data, not by the button, and the confirmation is
fetched before it is shown:

| | |
|---|---|
| Atlas owns it **and** nothing is behind it | **Deleted.** Cannot be undone, so the confirmation asks you to type the store's name. |
| Anything else — LabStack's, or it has orders | **Archived.** Hidden from this screen; the record and its history are untouched. |

Archiving is the honest form of "remove" for a record Atlas does not own.
Deleting a store with an order book behind it is not a removal, it is a hole in
the ledger — `atlas.store_dependencies()` counts what is there and the dialog
says so ("Behind it: 155 orders, 15 requests").

`removeStore` re-derives the plan on the server rather than trusting what the
browser was shown: the dialog may have been open a while, and an order can
arrive in that time.

### Archiving is reversible, and does not break a sync

Archived stores are listed under the table with who archived them, why, and how
many orders were kept; an admin can put one back.

The API keeps serving an archived store's orders and reports `archived: true`
rather than 404ing. Archiving is a decision about one screen — an integration
syncing a partner's book should not break because somebody tidied a list in
Atlas. A store id that does not exist at all still 404s.

---

## Deploying this

### Before you merge: does it run against the real database?

```bash
docker exec -i atlas-db psql -U atlas -d atlas -f -   < scripts/check-labstack-columns.sql
```

Every column this feature reads from the mirrored LabStack tables — 51 of them
across Lab, LabDepartment, Master, Order, Profile, Request, Store and User —
checked against what that database actually has. It reads only the catalogue,
writes nothing, and takes a second. A column named by the code and absent there
means the view will not create.

The list is generated from the SQL and the query modules, so it is what the code
asks for rather than what somebody remembered to write down.

**One row is worth reading even when it passes.** The catalogue fix changes
`d.department` to `d.name` on `LabDepartment`, because that table has `id` and
`name` — `department` never existed, which is why `/catalogue/tests` was
returning a 500. The check prints that table's real columns at the bottom. If
your database disagrees, that one query needs the other name.


**`sql/init/` runs once, on a database's first boot.** A host that already
exists will not pick up `28_store_orders.sql` from a deploy, and `/stores` will
fail with `relation "analytics.v_store_order" does not exist` until it is
applied by hand — the same step `20_lab_discovery_ranking.sql` and
`24_order_tracking.sql` needed:

```bash
cd ~/atlas && git pull
for f in 28_store_orders 29_store_registry 30_store_groups; do
  docker exec -i atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 -f -     < "sql/init/$f.sql"
done
```

`30_store_groups.sql` deliberately does not touch `analytics.v_order_task`, so
it has no ordering relationship with `25_request_orders.sql` and
`/order-tracking` is unaffected by any of this.

Idempotent throughout — safe to run twice, and verified over three
consecutive runs. Between them they create `atlas.order_stage()`, seven
Atlas-owned tables (`store_profile`, `store_change_log`,
`order_reschedule_flag`, `store`, `store_archive`, `store_group`,
`store_group_member`), the views `analytics.v_store_order`,
`v_store_directory`, `v_tracked_order`, `v_order_task` and `v_store_queue`,
`atlas.store_dependencies()`, and the indexes on `src_local."Order"`.

Two things it does **not** do, deliberately:

- **It does not touch LabStack.** Every object is in `atlas` or `analytics`;
  the only thing it does to `src_local` is add indexes, and `TRUNCATE` in the
  nightly refresh keeps those.
- **It adds no materialized view, so there is nothing new to refresh.**
  `v_store_order` is a plain view over the `src_local` mirror, which means it
  is exactly as fresh as the 3 AM refresh and never separately stale.

Then confirm:

```bash
docker exec -i atlas-db psql -U atlas -d atlas -f - < scripts/check-stores-feature.sql
```

Every row should read **PASS**. It checks that all twenty objects exist, that
`/order-tracking` still owns its own view and reads none of this feature's,
that the stage map agrees between SQL and `lib/stores.ts`, and that the two
tracked queues match a recomputation done straight off `src_local."Order"`.
Anything reading FAIL names the file to apply. It writes nothing.

**If you forget this step the page tells you.** Without the SQL every query
here throws, and Next renders a blank page — HTTP 200, no heading, no text,
nothing in the console, which is the most expensive way a feature can fail.
Both pages catch the `42P01` and show what is missing and the command above
instead. Requests and Order tracking are unaffected either way; they read none
of this.

The stage map alone can also be checked with:

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

| Role | Sees it | Edit the overlay | Flag orders | Add / remove a store | Queue on-off |
|---|---|---|---|---|---|
| admin | yes | yes | yes | **yes** | **yes** |
| network_lead | yes | yes | yes | no | no |
| accounts | yes | yes | yes | no | no |
| network | yes | no | no | no | no |
| operations | yes | no | no | no | no |
| viewer | **no** | no | no | no | no |

Accounts gets `manage` because the partner relationship is theirs, and the
writable part of this screen is the account overlay rather than the store
record. Operations reads it because they answer the calls it is about.

Adding a store, removing one, and taking a store out of the requests queue are
all **admin only**, stricter than the rest. It is the one action here that changes what other people see on a screen
they are working, and a wrong click is invisible to the person it affects. It
is also not a delete: nothing is removed, the orders stay on this page, and the
queue keeps saying how many requests are hidden.

Every write lands in `atlas.store_change_log` with the before and after.
`atlas.audit_log` answers "was this page opened"; this answers "who turned this
partner off on the fourteenth", which is the question actually asked afterwards.
CSV exports are audited too — they leave the building.

---

## Performance

Measured against 40,241 orders over 40 stores — roughly the size of the real
book — with `EXPLAIN (ANALYZE, BUFFERS)`:

| Query | Time |
|---|---|
| Store list, 25 rows, 90-day window | 54 ms |
| The overview strip | 36 ms |
| One store's orders, page 1 | 2 ms |
| The same store, page 20 (deep `OFFSET`) | 2 ms |
| Stage facets | 1 ms |
| Search inside a store | 2 ms |
| Full 20,000-row export | 6 ms |

The two aggregate queries were originally 101 ms and 77 ms. The difference was
`atlas.store_delay_hours()`: a `STABLE` function that reads a table is
evaluated **once per row**, so computing `delayed` across a 22,788-row window
cost 17,796 buffer reads on its own — more than a third of the total, and
growing with the book rather than with the page. `analytics.v_store_order`
joins `atlas.store_profile` once instead.

The functions remain for single-row callers, where they read better and cost
nothing. `atlas.store_delay_hours_default()` is `IMMUTABLE`, so the default
folds at plan time and the number still lives in exactly one place.

Page latency in dev sits in the same 1.3–2.0 s band as `/requests` and
`/order-tracking` on the same data, which is the only comparison that means
anything — dev figures are inflated by per-request compilation.

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
    → { store_id, rows, total, limit, offset, archived, window: { from, to } }

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
- An **archived** store is not missing. Its orders keep being served and the
  response carries `archived: true`, because archiving hides a store from one
  screen and changes nothing about its data — a sync should not break because
  somebody tidied a list.
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
  When a filter matches more than that, the file's last row says so in its
  first column and the response carries `X-Atlas-Truncated`, `X-Atlas-Rows` and
  `X-Atlas-Total` — a truncated export that looks complete is the worst kind of
  wrong number, because somebody reconciles against it. A partner who routinely
  exceeds the cap needs a streaming export, which is its own change.
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
