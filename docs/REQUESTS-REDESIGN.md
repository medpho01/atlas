# The requests queue: audit, what shipped, and what is next

An audit of `/requests` as the fulfilment team actually works it, the changes
made on the back of it, and the ones deliberately left for later.

The queue is the only screen in Atlas where somebody is doing a job rather
than reading an answer. Everything below is judged against that: does the
screen help a person get through a morning's requests, or does it describe
them accurately and leave the work where it was.

---

## 1. Usability audit

### 1.1 The page sorted by a number it did not show

The queue opens sorted by longest wait. The table declared a `min-width` of
1810px across fifteen columns, so on a 1600px laptop — the common case —
everything from **Quote** rightwards sat outside the card behind a horizontal
scrollbar: the price, how long it had waited, the date the store asked for,
the date we could do, and the resulting order.

That is the wrong half to lose. A person deciding what to work on next needs
the age and the two dates; what they got without scrolling was the store name,
the requester, the city and the item list. The one column pinned against the
right edge was **Actions**, which meant the Copy button was reachable and the
evidence for using it was not.

**Root cause, worth naming:** the column set was fixed while the page was not.
Inside a queue the **Request status** column prints the tab's own answer on
every row, and the **Order** column is empty on every row, because a queue
excludes converted requests. Two of fifteen columns were structurally dead and
still charged full width.

### 1.2 Age without a threshold

`Waiting` rendered a number with three tones hard-coded at 3 and 14 days,
applied identically in every queue. But the three queues are three different
promises. A quote unanswered for six days is normal; an accepted quote not
converted for six days means a date we promised a patient has already moved.
One scale cannot be right for both, and the reader was left to supply the
judgement the screen should have carried.

### 1.3 One row at a time, against a queue that arrives in batches

The only action was a per-row **Copy**. Thirty-four requests needing a price
is thirty-four copy-paste round trips into the console, in an order nobody is
tracking, with no way to tell where you stopped. There was no selection model
at all — no multi-select, no "these eleven", no export.

This is the single largest time cost on the page and the least visible one,
because each individual interaction is fast.

### 1.4 The model knew who owned the work and never said so

`STATE_OWNER` has mapped every serviceability state to `console`, `network` or
`data` since the state model was written. The table never rendered it. Instead
every serviceable row printed the literal string "Convert in console" — the
same sentence up to fifteen times — while the three states that are *not* ops'
work (supply gap, unidentified items, no pincode) said nothing about whose
work they were.

So a queue of thirty-four rows was really three queues for three teams,
interleaved, and the screen made the reader separate them by eye.

### 1.5 A count is not a briefing

The tab said "Needs a quote · 34" and that was the whole summary. Thirty-four
that arrived this morning and thirty-four that have been sitting a fortnight
are the same number and opposite situations. Nothing on the page distinguished
them without reading rows.

The funnel existed but was switched off inside every queue — correctly, since
it is a shape-of-the-month chart and costs an extra pass over the table — which
left the queues with no aggregate at all.

### 1.6 Repeated failures looked like unrelated ones

Four requests from the same pincode that no lab can serve is a network
decision. Sorted by age those four rows are nowhere near each other, and the
pattern is invisible. The page could tell you about a request; it could not
tell you about a pincode.

### 1.7 Stale data was silent on the screen that opens first

There is a good stale-snapshot warning, gated on `!queue && funnel.received === 0`.
Inside a queue — the default landing — it could never fire. A queue rendered
from a two-day-old snapshot looks completely convincing: the rows present are
real, and the ones missing are precisely this morning's arrivals.

### 1.8 Smaller things

- **Redundancy:** a row with no parsed items printed "Not identified" in
  *Requested items* and "Unidentified items" in *Serviceability* — two columns,
  one fact.
- **Row rhythm:** rows with two or three covering labs are visibly taller than
  rows with none, so the eye cannot use vertical position to scan.
- **No density control**, and no pagination UI behind the 150-row cap.

---

## 2. Visual design

### 2.1 Shipped

**A severity rail.** A 3px left border per row, coloured against the promise
for that row's stage. It is the only thing on the row readable without reading
anything, which is what a list of thirty needs before it needs detail.

**One scale, three renderings.** `STAGE_SLA` defines the thresholds once; the
rail, the colour on the age cell, and the counts in the strip all read it. They
cannot drift into disagreeing.

**Restraint on the loud signal.** The first build printed the word "LATE" beside
every age. With most of a queue behind, that is thirty-three identical alarms
and the column stops ranking anything. The word came out; colour ranks, and
*how many* are late is stated once, in the strip. A per-row signal should
describe the row; magnitude belongs to the aggregate.

**Owner chips.** `Ops` / `Network` / `Data` rendered from `STATE_OWNER`, toned
to match, each carrying the sentence describing what that owner is being asked
to do.

**Columns that follow the queue.** `showStage` and `showOrder` are off inside a
queue. With store and requester folded into one cell, the two dates merged into
`wanted → offered`, and arrival tucked under the request id, the table drops
from 1810px to **1200px — no horizontal scroll**, with the sort key visible.

**Density.** Comfortable/compact, persisted in `localStorage`, 81px → 51px per
row. It changes leading and padding only: a density control that hides columns
is a column chooser wearing the wrong label.

**Responsive column priority.** The first pass fitted 1600px and quietly
scrolled below it — and worse, it only *appeared* to fit, because the table
declared a smaller minimum than its own columns summed to and the browser
squeezed them. Widths now come from one `COL_W` map, and covering labs — the
widest column that is not the job itself — drops below `2xl`. Measured: fits at
1920, 1600, 1440 and 1366.

**A pager.** `offset` had been in `RequestFilters` since it was written and the
page never set one, so the queue showed the first 150 matches and nothing could
reach the rest. 100 to a page now, with `1–100 of 120` and `Page 1 of 2`, and
every filter link drops `page` so narrowing while on page three cannot land you
on an out-of-range page reading as "no matches".

**A keyboard path.** The row carried an `onClick` and nothing else, so a request
could only be opened with a pointer. The id is a real link now — one tab stop
per row, an `aria-label` that reads "Request 119, Supply gap", a visible focus
ring, and Enter opens it.

### 2.2 Still open

- **Supply gap and package gap share amber** but need different teams. The
  owner chip disambiguates them today; distinct hues would be better.
- **Row height still varies** with the covering-lab list. Clamping that cell to
  one line in compact mode would fix the scan rhythm.
- **No column chooser.** The adaptive set is a good default, not a preference.
- **Below 1366px it still scrolls.** 1280 and under is a laptop nobody on this
  team works a queue on; the fix there is a different layout, not a narrower
  table.
- **Select-all remains page-scoped.** It now says so — "Select all 100 on this
  page. Rows on other pages are not included." — rather than implying it took
  the queue. Scoping an export to the filter rather than the page is server-side
  work and wants its own change.

---

## 3. Workflow

### 3.1 Shipped

**Selection and a bulk bar** — per-row checkboxes, select-all, and a sticky bar
carrying: copy every quote block at once, copy just the ids, export CSV.

**Honest bulk operations.** The bar states when a selected row has no price or
date yet and is therefore excluded from the quote block. A bulk action that
silently drops rows is worse than one that refuses: the person pastes it and
believes it covered everything they ticked.

**An export built for where the work actually goes.** UTF-8 BOM so Excel does
not mangle lab names, and a leading-`=`/`+`/`-`/`@` guard so a value cannot
arrive as a formula.

**Filterable issue mix.** Each state in the strip is a link that filters the
table while keeping the queue pinned — a subtlety worth stating, because an
absent `queue` param means the default queue but a present `state` param means
"show me the full surface", so a naive link would have dropped the reader out
of their queue without saying so.

### 3.2 Recommended next

| | Why | Cost |
|---|---|---|
| **Bulk mark-as-quoted** writing back through `refreshRequests`' path | Closes the loop the CSV export currently leaves open. Today Atlas computes the answer and a human retypes it into the console. | High — needs a console write path |
| **Smart lab suggestion on the row** — nearest candidate lab with the missing items named | `getCoveringLabs` already computes this for the detail page. Surfacing the top candidate inline turns a supply gap from a report into a decision. | Medium |
| **Escalation from the row** — "hand to network" / "flag data fix" with an audit entry | Makes the owner chip actionable instead of descriptive. | Medium |
| **Saved views** (`?queue=open&state=SUPPLY_GAP_KNOWN&store=…` as a named, shareable filter) | The URL already carries complete state; only the naming and the list are missing. | Low |
| **Keyboard traversal** — `j`/`k`, `x` to select, `c` to copy | A queue worked daily is a queue worked by muscle memory. Each row is focusable now, so this is shortcuts on top of a path that exists rather than building the path. | Low |

---

## 4. Analytics

### 4.1 Shipped — `getQueueHealth`

One query, running beside the list rather than after it, returning:

- **past due / due today**, counted against the same `STAGE_SLA` the rows use
  (thresholds passed as bind parameters, not written twice)
- **oldest wait** and **median wait** — the pair that separates a busy morning
  from a losing month
- **priced, not sent** — requests where Atlas already has a price and a date
  and the console has not been told; the answer exists and only the handoff is
  missing. Rendered only where it is that queue's actual next action
- **the state mix**, each entry a filter
- **repeating gap pincodes** — supply gaps grouped by pincode, `HAVING COUNT(*) > 1`,
  linking to the pincode explorer rather than back to the requests, because by
  the time you are asking this the individual request has stopped being the
  subject

The strip is deliberately **blind to the serviceability filter**: it describes
the queue, the table shows the selected slice. Scoping it too would collapse
the mix to the one chip already clicked and remove the only control that undoes
it.

### 4.2 Recommended next

- **Trend, not just level.** Every figure here is a snapshot. "33 past due" is
  materially different when yesterday was 12. A seven-day sparkline per figure
  needs a small daily rollup table — nothing here can produce it, because the
  queue only knows the present.
- **Ageing histogram** rather than a median: the median hides a bimodal queue,
  which is the common shape when a batch arrives late.
- **Time-in-stage**, not time-since-touched. `waiting_days` reads the console's
  `updatedAt`, so any edit resets it. A true stage-entry timestamp would make
  the SLA measure what it claims to.
- **Geo.** `repeating gap pincodes` is the text version of a map. Atlas already
  has Leaflet and `mv_pincode_geo`; plotting open gaps weighted by count, beside
  existing coverage, is the natural home for the "where do we onboard next"
  question.
- **Quote-to-acceptance rate by store and by markup band** — the one analysis
  that would tell us whether the pricing model is winning work.

---

## 5. Reliability and trust

### 5.1 Shipped

- **The stale-snapshot warning now fires inside queues**, with wording that
  adapts: with no rows it explains the absence, with rows it warns that this
  may not be everything and that anything raised since is missing.

### 5.2 Recommended next

- **Audit trail.** `atlas.audit_log` exists and records page views and logins.
  It does not record that a quote was copied, an export taken, or a lab
  blocked. Bulk actions make this more pressing, not less: one click can now
  move thirty-four requests' worth of information out of the system.
- **Error resolution prompts.** `NO_ITEMS` and `NO_PINCODE` are 18 of 120
  requests in the sample and every one is a dead end on this screen — the row
  says what is wrong and offers no way to fix it. An inline "add the pincode" /
  "match these items" affordance would convert the largest silent-failure
  bucket into work.
- **Feedback loop on the price.** `price_basis` and `BASIS_STRENGTH` already
  grade how much to trust a quote, and nothing records whether the store
  accepted it. Capturing that would let the markup bands learn.
- **Say when a figure is partial.** `getQueueHealth` counts the whole filtered
  queue while the table shows one page of it. The pager now names the gap —
  `1–100 of 120` — so the strip counting more than the list is legible rather
  than a contradiction.

---

## 6. Mockup guidance — the redesigned surface

The layout that shipped, top to bottom, with the reasoning attached. Widths
assume a 1600px viewport and the 143px sidebar.

```
┌ Requests ──────────────────────────────────────────────── [i] ┐
│ Serviceability, price, earliest available date, order status  │
│                                                               │
│ [ search: id, pincode, city, store, test ]  [Check for new]   │  ← identity lookup,
│                                                               │    never scoped to a queue
│ ●Needs a quote 34 │ ○Awaiting 18 │ ○Ready 17 │ All requests   │  ← the three jobs, in
│ ───────────────────                                           │    pipeline order
│ Price it and give the store an earliest available date.       │  ← the queue's instruction
│                                                               │
│ ┌ QUEUE HEALTH ───────────────────────────────────────────┐   │
│ │ ⚠ 33      ⏱ 1        🕐 59d      30d        ▤ 15        │   │  ← time first, then cause
│ │ past due  due today  oldest     median     priced,      │   │
│ │                      wait       wait       not sent     │   │
│ │                                                         │   │
│ │ What it is made of                                      │   │
│ │ [Serviceable 15][Supply gap 9][Package gap 7][Unid. 3]  │   │  ← each one a filter
│ │ ─────────────────────────────────────────────────────── │   │
│ │ Gaps repeating in  [📍400007 Mumbai 2][📍682008 Kochi 2]│   │  ← the network's question
│ └─────────────────────────────────────────────────────────┘   │
│                                                               │
│ [CREATED Today|7d|30d|All] [STORE ▾] [SORT Waiting|Newest|…]  │  ← one line, no disclosure
│                                                               │
│ ┌ 34 shown · sorted by waiting longest ───────────────────┐   │
│ │                                 ROWS [Comfortable][Compact]│ ← changes reading, not rows
│ │ ☐ REQUEST  AGE  STORE &      LOCATION  ITEMS   SERVICE-   │ │
│ │                 REQUESTER                      ABILITY … │ │
│ │ ▌☐ #119    59d  Harbourside  Nagpur    Basic   Supply gap│ │  ← ▌ rail = SLA
│ │    25 Jul       Requester…   440008    Health  [Network] │ │  ← owner chip
│ │                 📞 97000…    lab 6.6km  Check            │ │
│ │ …                                                        │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ 3 selected │ Copy 2 quotes │ Copy ids │ Export CSV │ ✕   │ │  ← appears on selection
│ └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

**Column order and why.** `☐ · Request+created · Age · Store & requester ·
Location · Items · Serviceability+owner · Covering labs · Quote · Wanted →
offered · [Stage] · [Order] · Actions(sticky)`.

Age sits third because it is the sort key and the triage signal. Serviceability
and owner are adjacent because they are one question — what is wrong and whose
job is it. The two dates are one cell because they are only ever read against
each other. Stage and Order appear only on **All requests**, where the wider
table and its scroll are an acceptable cost for an exploratory surface.

**Principles worth carrying to the other queues (`/order-tracking` next):**

1. *A per-row signal describes the row; magnitude belongs to the aggregate.*
2. *Columns should follow the view.* A column that prints the same value on
   every row is the filter restating itself.
3. *The threshold ships with the number.* A duration with no stated promise is
   a fact the reader has to have an opinion about.
4. *Name the owner.* If the model knows who acts, the row should say so.
5. *Bulk actions must state what they skipped.*
6. *Make staleness loud on the screen people land on*, not the one they
   navigate to.

---

## Appendix: what this needed from the local dataset

None of the above was testable on a fresh laptop. `atlas.request_item` was
always empty — the seed created `_PackageToRequest` and `_MasterToRequest` and
never filled them, and `setup-local.sh` never called `atlas.sync_request_items()`
— so all 120 sample requests classified `NO_ITEMS` and five of the six
serviceability states were unreachable.

Both are fixed, and a clean `./scripts/setup-local.sh` now yields 44 supply gap,
35 serviceable, 20 package gap, 13 no items, 5 no pincode and 3 no-lab-in-range.
