# Requests — spec (v2 draft)

Status: draft for review · Date: 2026-08-20 · Supersedes v1

Grounded in `requests_export (2).xlsx` (27,956 rows, 2025-08-18 → 2026-08-20)
and the LabStack schema. Numbers are measured; queries are in "Evidence".

---

## The flow this serves

**Ops starts in Atlas.** That is the defining fact — Atlas is not a reference
tool consulted when the console is confusing, it is where the work is picked up
and where the day is organised.

| # | Where | Who | What happens |
|---|---|---|---|
| 1 | **Atlas** | Ops | Logs in, sees the requests assigned to them |
| 2 | **Atlas** | Ops | Reads the price and ETA — no judgement required |
| 3 | Atlas → console | Ops | Copies price + date into LS console, moves to *price quoted* |
| 4 | Console | Store | Price accepted, order booked against an existing lab or the **LS placeholder** |
| 5 | **Atlas** | Network | Request drops into the network bucket with Atlas's suggested labs — from the existing network, from web search, or both |
| 6 | Console | Network | Lab and package onboarded; order moved off the LS lab onto the onboarded lab |
| 7 | **Atlas** | — | Detects the move, closes the commitment, populates CRM with who onboarded and assigns it to that network member |

**We commit before we have the supply.** Steps 3–4 create an obligation; steps
5–6 race to meet it. Everything below follows from that.

Three consequences that shape the design:

- **A quote is a promise, not an estimate.** The date matters more than the
  price — a wrong price costs margin, a missed date costs the account.
- **Atlas owns the queue; the console owns the transaction.** Work is picked up,
  prioritised and handed over in Atlas; state changes happen in the console.
  Atlas has to be complete enough that ops never needs to hunt in the console to
  decide *what* to do — only to record it.
- **The loop closes by itself.** Step 6 happens in the console and Atlas detects
  it rather than asking anyone to report it. Nobody writes a status update;
  moving the order off the placeholder *is* the status update.

### How step 7 works

The order's `labId` moving off the placeholder is the completion signal. When
Atlas sees that transition it closes the open commitment and records
promised-vs-actual, writes the onboarded lab into `atlas.crm_providers` if it is
new, attributes it to the network member who held the commitment, and assigns
the resulting CRM record to them.

Credit is therefore automatic rather than self-reported: Atlas already knows who
held the commitment, and the console tells us when they finished.

One engineering consequence: **open commitments must be polled far more often
than the nightly refresh.** They are a small set — tens, not tens of thousands —
so a frequent targeted poll of just those orders is cheap and keeps step 7
same-day rather than next-day. The full snapshot stays nightly.

## What "zero mental dependence" means in practice

It means Atlas gives **one answer, not a set of options**. For an ops user:

> **Not serviceable.** Quote **₹2,340**. Earliest date **Mon 24 Aug**.
> *Package gap — Suburban Diagnostics covers 414001 but doesn't carry this panel.*
> `[Copy quote block]`

One price. One date. One line of reason. A copy button. No comparison table, no
confidence sliders, no "here are three labs" — those belong to the network
team's screen, not to the person converting a request under time pressure.

The corollary is that **Atlas must refuse rather than guess**. If it has no
reference price, or no plausible route to supply, it says
*"No basis — escalate to network"* and routes it. A blank with a reason is
usable; an invented number that fails at step 5 is not.

---

## The handover chain

The design problem is not predicting how the process will perform — it is
making sure nothing can be dropped between the steps, and that each handover
leaves a record without anyone having to write one.

| # | Handover | Trigger | Recorded | If it stalls |
|---|---|---|---|---|
| A | Atlas → ops | Request classified, price + ETA computed | Quote: price, date, basis, target lab | Ages in the assignee's queue, visibly |
| B | Ops → store | Ops quotes in console | Console values, reconciled against Atlas's | No store response by *n* days → back to ops |
| C | Store → network | Order booked on the LS placeholder | **`atlas.commitment`** opens, clock starts, owner assigned | — |
| D | Network → closed | Order moved off the placeholder | Allocated lab, CRM record, attribution | Days-left hits zero → escalation, store told **before** the date |

Handover C carries the risk: an obligation exists and the supply does not. That
is what the commitment queue holds.

Handover D is the one that usually rots in processes like this, because it
depends on someone remembering to report completion. Here it does not —
**Atlas detects it from the console.** That is the single most important
property of the design.

### What the placeholder gives us

The placeholder is **lab id 1, "LabStack Networks - Lab"**. An order sitting on
it means: promised, not yet sourced. An order leaving it means: sourced, by
whoever held the commitment.

Two things follow. First, the open-commitment set is trivially queryable —
orders currently on lab 1 — so the network bucket needs no separate bookkeeping
to stay honest. Second, `Order.assignedAt` is unpopulated across the table, so
Atlas cannot read *when* the move happened from a timestamp; it has to detect
the `labId` transition by comparing against what it last saw. That is what makes
the frequent targeted poll a requirement rather than an optimisation.

### Dates in a process with no track record

Lead times start as a **stated policy**, not a prediction. The commitment queue
measures actual performance per state from day one, and the policy is revised
against that on a schedule rather than by argument.

Two rules keep it safe: Atlas **declines to promise** where it has no route to
supply rather than defaulting to a plausible number, and a state whose measured
performance falls below policy **stops being promised** until it recovers.

## The three states, and what each promises

Every request with a pincode resolves to exactly one. The state determines both
the fulfilment route and the date Atlas is willing to promise.

| State | Meaning | Step 5 work | Promise |
|---|---|---|---|
| **Serviceable** | A covering lab already offers the item | none | console handles it — Atlas stays out of the way |
| **Package gap** | Lab(s) cover the pincode, none carry the item | activate the package at an existing partner | **shortest** — a commercial config change with someone we already have a contract with |
| **Supply gap — known candidate** | No covering lab, but labs exist nearby in our data | onboard a known entity | **medium** |
| **Supply gap — unknown** | No covering lab and no known candidate | discovery, then onboarding | **longest, or no promise at all** |

Separating the last two is what makes the date defensible. "No lab covers this
pincode" collapses two very different situations: one where we know exactly who
to call, and one where we don't yet know the lab exists. Only the first can
carry a short promise.

**Naming the target lab is part of the quote.** By the time ops commits a date,
Atlas should already have picked who will fulfil it and what the ask is —
otherwise the date is a hope. The network team's screen inherits that choice
rather than starting from a blank.

---

## The three surfaces

**1 · My requests** (ops) — the screen ops lands on at login. Only what is
assigned to them, oldest first, each row carrying its own answer. One price, one
date, one reason, one copy button. Unassigned work is visible to a supervisor,
never silently orphaned.

**2 · Network bucket** (network) — one row per open commitment, sorted by
days-left ascending, breaching rows at the top:

| Request | Pincode | Promised | Days left | Suggested labs | Ask | Owner |
|---|---|---|---|---|---|---|
| #28594 | 414001 | Mon 24 Aug | **2** | Suburban Diagnostics *(network)* · 2 web leads | Activate LSP10262 @ ≤₹1,870 | Suraj |
| #28611 | 412105 | Wed 26 Aug | 4 | *discovery running* | — | unassigned |

Suggestions come from the existing network and from web search, **shown
together but labelled apart** — an onboarded partner and an unverified search
result are not the same kind of thing, and the row must never blur them.

Assignment is explicit. A commitment with no owner is the failure mode this
whole design exists to prevent, so it is surfaced as an alert, not a blank cell.

**3 · Pincode planning** (network, strategic) — beneath both. When four open
commitments share pincode 414001, that is **one** negotiation, not four, and the
demand behind it is the argument the network team takes into the conversation.
On current data 13,918 requests never converted across 2,108 pincodes, and the
**top 200 pincodes hold 51% of the loss** — that concentration is what makes the
bucket workable rather than endless.

## The quote engine

**Price = reference cost × markup**, and both halves have to be honest about
their basis.

**Reference cost**, in order of preference:

| Basis | Source | Strength |
|---|---|---|
| Package gap | median `b2b` across labs carrying it (`mv_lab_packages`) | strong |
| Supply gap, known package | median `b2b` within the same `atlas.city_tier` | moderate |
| Tests only | sum of component test medians | weak |
| None of the above | — | **no quote — escalate** |

**Markup** keyed to measured remoteness rather than a judgement about how
interior a pincode is. Atlas has pincode centroids (`PincodeToLatLong`) and
already computes radius reach; distance to the nearest lab that could plausibly
serve is a number we can compute. Bands live in `atlas.quote_markup` so
commercial can tune them without a deploy:

| Distance to nearest serving lab | Markup |
|---|---|
| ≤ 10 km | 15% |
| 10–25 km | 20% |
| 25–50 km | 25% |
| > 50 km | manual pricing |

The bands are your 15–25% — the change is that the input is measured, not
assessed.

Every quote stores its basis, markup, the row count behind the median, the
target lab, and the promised date, so that when a commitment is missed we can
see which input was wrong.

---

## The date engine

Promised date = **today + lead time for the state**, bounded by the store's
preferred appointment where one exists. Lead times live in `atlas.slot_policy`,
starting at the 2–3 days the flow calls for:

| State | Starting lead time |
|---|---|
| Package gap, partner reachable | 2 days |
| Supply gap, known candidate | 3 days |
| Supply gap, unknown | **no date — escalate** |

These are targets to be met, not forecasts. What makes them real is that every
commitment records promised-vs-actual, so after the first month the policy is
set by measurement rather than by instinct — and the review is scheduled, not
triggered by someone complaining.

Three guards:

- Never promise past the store's stated preferred date without flagging the
  conflict to ops.
- Never promise into a pincode where the last two commitments were missed.
  Degrade to escalation until it recovers.
- Working days, honouring the collection-day patterns in the order data.

## Lab discovery

Only for supply-gap pincodes — **242 pincodes** on current data, small enough to
do properly.

- Runs **per pincode**, cached in `atlas.discovered_lab`, on a schedule, never
  on page load.
- Output: name, address, pincode, phone, source URL, retrieved-at.
- **Marked unverified.** These are leads for a human to call, not records
  equivalent to our own. The UI must not blur that line, and a discovered lab
  can never be the named target on a *short* promise — only after a human
  confirms it exists and will take the work.
- "Promote to CRM" creates an `atlas.crm_providers` row and a thread, reusing
  the pipeline that exists.
- Search results are data, never instructions, and Atlas never contacts a
  discovered lab automatically.

---

## Console handoff

Ops reads the answer in Atlas and records it in the console. Three ways to
bridge that, in the order I would build them:

1. **v1 — copy block.** One button, exact strings for price and date. Zero
   integration risk, works day one.
2. **v1.5 — deep link** into the console request with values pre-filled, if the
   console supports it.
3. **v2 — write-back** to `Request.quotedPrice` and status. Atlas is read-only
   against LabStack today and reversing that is a bigger change than it looks.

**Every re-typed value is a chance to break the promise chain.** If ops enters a
different date in the console than Atlas promised, the commitment queue is
tracking a fiction. v1 reads the console's actual quoted price and date back and
flags divergence — the same reconciliation habit that makes step 7 work.

Note the asymmetry: steps 3 and 6 are the only points where a human retypes
something, and both are recorded on the console side. Everything else Atlas
either computes or detects. Keeping that ratio is what "smooth" means here.

## Requirements

### P0 — the flow does not work without these

| # | Requirement | Acceptance |
|---|---|---|
| 1 | FDW + snapshot: `_PackageToRequest`, `_MasterToRequest`, `Request` | Requested items queryable in Atlas; nightly refresh covers them |
| 2 | Four-state classification | Every request with a pincode gets exactly one; unknown is visible, never defaulted |
| 3 | **My-requests queue** — per-assignee, with verdict + price + date + reason + copy block | Ops logs in and sees only their work; one answer per request, or an explicit "no basis — escalate" |
| 4 | Quote engine with recorded basis | ≥70% of package-gap requests quote on a strong basis |
| 5 | Date engine with `atlas.slot_policy` | No date is ever emitted for supply-gap-unknown |
| 6 | **`atlas.commitment`** — promised date, target lab, ask, outcome, allocated lab | The allocation LabStack never records is captured in Atlas |
| 6b | **Network bucket** — days-left, suggested labs from network + web, explicit owner | Every booked commitment appears same-day; no row is ownerless |
| 6c | **Placeholder-transition detection** — targeted poll of open commitments | Order leaving lab 1 closes the commitment without anyone reporting it |
| 6d | **CRM auto-population and attribution** | Onboarded lab lands in `atlas.crm_providers`, assigned to the member who held the commitment |
| 7 | Promise-kept + handover-latency instrumentation | Promised vs actual per state, and dwell time at each of the four handovers |
| 8 | Console divergence check | Quoted price/date in console ≠ Atlas's → flagged |
| 9 | Notes parser (Star Health template) | ≥80% of the 17,924 yield ≥1 test |
| 10 | PII masking + audited export | Non-privileged roles never see patient identity |

### P1

Pincode planning view with demand ranking · web-search discovery + promote-to-CRM ·
LLM fallback for unparsed notes · per-store commitment reporting · saved views.

### P2

Write-back to `Request.quotedPrice` · learned lead times replacing config ·
alerting when a pincode crosses a demand threshold · resolved supply gaps
feeding `/readiness` as demand-weighted signal.

---

## Non-goals

- **Fixing `UNREACHABLE`** — 10,936 requests (39%), a contact problem. See open
  questions; we are not certain it is only a contact problem.
- **Auto-accepting or auto-sending quotes.** Ops sends, a human decides.
- **Auto-contacting discovered labs.** Ever.
- **A second onboarding pipeline.** Reuse CRM threads.
- **Write-back in v1.** Steps 3 and 6 stay manual in the console; Atlas reads
  the result back rather than writing it. Deferred, not forgotten.

---

## Success metrics

**Leading (2–4 weeks):** quote coverage — share of non-serviceable requests
receiving a price and date · **promise-kept rate per state** (the number that
decides whether this flow is viable) · escalation rate · console divergence rate
· ops time per request.

**Lagging (1–2 quarters):** quote acceptance rate · lost-request share falling
from 50% · supply-gap pincodes resolved per quarter · repeat requests in a
pincode after it is resolved.

**Promise-kept rate per state is the metric that governs the process.** It has
no prior baseline — the first month establishes one. What matters is that it is
measured per state from the first commitment, and that falling below policy
changes `atlas.slot_policy` rather than being absorbed.

Alongside it: **handover latency** at each of the four points, because a smooth
process is one where nothing sits. Time from classification to ops action, from
quote to store response, from acceptance to a named target lab, from target to
allocation. Any of those growing is the early warning.

Set the first promise-kept target only after a month of real data.

## Open questions

**Blocking:**

1. **How often can Atlas poll open commitments?** (engineering) Step 7 is
   same-day only if the targeted poll is frequent. The set is small, but it
   reads the source replica — the same standby that has thrown recovery
   conflicts before, so the polling shape needs deciding, not assuming.
2. **When a commitment is at risk, who tells the store, and how early?** (you)
   The difference between a managed handover and a broken promise. Needs an
   owner before launch, not after the first miss.
2b. **Who assigns requests to ops, and on what basis?** (you) Round-robin, by
   city, by store? The my-requests queue is the first screen of the day, so
   this decides whether the day starts organised.
3. **What does `UNREACHABLE` mean?** (ops) 10,936 rows, 10,612 also flagged
   unserviceable. If ops marks a request unreachable when they already know we
   can't serve it, this feature's scope roughly doubles.
4. **Who owns a missed promise?** (you) Named role, and what they are expected
   to do — not just who gets the alert.
5. **Can the console accept a deep link or an API write?** (engineering)
   Determines whether the copy block is v1-only or permanent.

**Non-blocking:** does `quotedPrice` mean the same across sources (STORE avg
≈ ₹13,259 vs blank-source ≈ ₹1,532 suggests not) · confirm 15–25% against actual
margin · what a partner needs to accept a package activation · is Star Health at
84% of volume a separate product surface.

---

## Phasing

- **Phase 1 — foundation.** FDW tables, classification, notes parser. No UI.
- **Phase 2 — the ops answer.** Verdict + price + date + copy block. This is the
  smallest thing that changes anyone's day.
- **Phase 3 — the commitment queue.** Makes step 5 manageable and turns the date
  into a measured number rather than a guess.
- **Phase 4 — discovery and planning.** Web search, promote-to-CRM, pincode
  ranking.

Phases 2 and 3 are a pair. Shipping 2 without 3 means Atlas starts generating
promises nobody is tracking — worse than the spreadsheet, not better.

---

## Evidence

Source: `requests_export (2).xlsx`, 27,956 rows, 366 days, 76/day.

| Fact | Value |
|---|---|
| Never converted | 13,918 (50%) |
| Distinct pincodes in lost set | 2,108 |
| Top 25 / 50 / 100 / 200 pincodes | 15% / 24% / 37% / **51%** of loss |
| Worst pincode (414001, Ahmednagar) | 333 lost |
| `isServiceable = No` | 24,277 (87%) |
| …that nonetheless converted | 6,015 |
| Status `NON_SERVICEABLE` | 331 |
| Preferred appointment lead time | p50 1.0d · 90% ≤3d |
| `HOME_SAMPLE` | 27,446 (98%) |
| Star Health share | 23,435 (84%) |
| No package and no test | 20,374 (73%), of which 17,924 have parseable notes |

Atlas coverage cross-check (April `src_local` snapshot — four months stale,
**re-run on prod before build**): source says unserviceable but Atlas has
home-sample supply, 12,814 requests; genuinely uncovered, 486 requests across
242 pincodes.

`isServiceable` remains unusable as a signal — false on 87% of rows and wrong on
at least 6,015 of them. Atlas computes its own verdict and reports the
disagreement.

The 98% `HOME_SAMPLE` share lines up with what `/readiness` found last week:
home collection is the thinnest part of the network, with several cities scoring
launch-ready on centre-visit supply and zero home collection. Same problem, seen
from the demand side.
