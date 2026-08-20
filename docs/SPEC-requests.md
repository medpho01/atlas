# Requests — spec (v2 draft)

Status: draft for review · Date: 2026-08-20 · Supersedes v1

Grounded in `requests_export (2).xlsx` (27,956 rows, 2025-08-18 → 2026-08-20)
and the LabStack schema. Numbers are measured; queries are in "Evidence".

---

## The flow this serves

1. Ops opens a request in the **LabStack console**.
2. **Serviceable** — lab and package both available → ops converts to order. Done.
3. **Not serviceable** — Atlas supplies a **price and an earliest date**. Ops
   marks it quoted in the console with those values.
4. Store accepts → becomes an order, assigned to an existing lab or an LS lab.
5. **Network team now has until that date** to negotiate the package with an
   existing partner or onboard a new lab, and allocate it to the order.

The defining property: **we commit before we have the supply.** Steps 3 and 4
create an obligation; step 5 races to meet it. Everything below follows from
that.

Two consequences that shape the whole design:

- **A quote is a promise, not an estimate.** The date matters more than the
  price — a wrong price costs margin, a missed date costs the account.
- **Atlas is not where ops works.** The console is. Atlas is the second screen
  that answers the question, and its output has to be copy-ready.

---

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

## The LS lab: this flow already runs, and it fails twice as often

"LS lab" is **lab id 1, "LabStack Networks - Lab"**, and it is not theoretical —
**1,788 orders and 1,346 requests are already parked on it.** Steps 3–5 are
happening today, just unmanaged. So we are not designing a new flow; we are
instrumenting one that already exists and currently runs badly:

| | on the placeholder | every other lab |
|---|---|---|
| Orders | 1,788 | 44,400 |
| Delivered | 68.8% | 84.1% |
| **Cancelled** | **31.2%** | **15.3%** |

**A commitment made before supply exists is cancelled at roughly twice the rate
of a normal order.** 558 cancelled placeholder orders are 558 promises broken to
a store. That number — not quote coverage, not adoption — is the baseline this
feature has to move.

### The real answer on "2 to 3 days"

Measured across every commitment ever parked on the placeholder, from order
creation to final status:

| Promised | Kept | | Promised | Kept |
|---|---|---|---|---|
| 1 day | 25% | | 6 days | 56% |
| 2 days | 32% | | 7 days | **59%** |
| **3 days** | **39%** | | 8 days | 61% |
| 4 days | 45% | | 9 days | 62% |
| 5 days | 51% | | 10 days | 63% |

Delivered orders land at a median of 2.2 days — which is why 2–3 days *feels*
right — but the tail is long (p90 = 8.8 days) and 31% never arrive at all.

So **a 3-day promise is kept 39% of the time.** Stretching to 7 days buys 20
points and then the curve flattens, because the ceiling is the 69% that ever
deliver. Past about a week, a longer promise buys nothing.

That makes the date a stated policy choice rather than an instinct:

- **Promise 3 days** — matches the store's expectation, breaks 6 times in 10.
- **Promise 5–7 days** — keeps 51–59%, and sets an expectation we can meet.
- **Either way, the lever that matters is the 31% cancellation, not the number
  of days.** No promise length fixes supply that never arrives.

My recommendation: **start at 5 days for package gap, 7 for supply-gap-known,
and no promise at all for supply-gap-unknown** — then let measured keep rate
pull it down. It is far easier to shorten a promise you are beating than to
rebuild trust with a store you have missed six times.

### The gap that makes this unmeasurable today

`Order.assignedAt` is **NULL on all 46,202 orders** — the field is never
written. Orders parked on lab 1 stay on lab 1 even after `REPORT_DELIVERED`, so
**the real lab that fulfilled the order is never recorded anywhere.**

The consequence is sharp: the network team's entire step-5 contribution is
invisible in the data. We can see that 1,230 commitments were met; we cannot see
who met them, how, or which negotiation worked.

**So Atlas must own the allocation record.** `atlas.commitment` holds the
promised date, the target lab, the ask, and the actual outcome — because
LabStack does not capture it and we cannot wait for it to.

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

## The two queues

**Ops queue** — per request, real time, one answer each. Feeds steps 2–3.

**Commitment queue** — the network team's actual work, and the piece your flow
needs that doesn't exist today. One row per open promise:

| Request | Pincode | Promised | Days left | Target | Ask | Owner |
|---|---|---|---|---|---|---|
| #28594 | 414001 | Mon 24 Aug | **2** | Suburban Diagnostics *(existing)* | Activate LSP10262 @ ≤₹1,870 | Suraj |
| #28611 | 412105 | Wed 26 Aug | 4 | *none — discovery running* | — | unassigned |

Sorted by days-left ascending. Breaching rows at the top, loudly. This is the
screen that makes step 5 manageable, and it is the one thing here with a clock
on it.

**Pincode ranking sits underneath both**, as the planning layer. When four open
commitments share pincode 414001, that is **one** negotiation, not four — and
the demand behind it (333 lost requests) is the argument the network team takes
into the conversation. My v1 analysis stands: 13,918 requests never converted,
across 2,108 pincodes, and the **top 200 pincodes hold 51% of the loss.**

---

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
preferred appointment where one exists (median lead time asked for is 1.0 days;
90% ask for ≤3 — note this is already tighter than we reliably deliver).

Lead times live in `atlas.slot_policy`. Starting values, set from the keep-rate
curve above rather than from instinct:

| State | Lead time | Expected keep rate |
|---|---|---|
| Package gap, partner reachable | 5 days | ~51% initially |
| Supply gap, known candidate | 7 days | ~59% initially |
| Supply gap, unknown | **no date — escalate** | — |

These are deliberately longer than the 2–3 days in the flow as described,
because 3 days is measurably a 39% promise. Revise monthly against actual keep
rate per state; the expectation is they come *down* as the commitment queue
starts working.

Three guards:

- Never promise past the store's stated preferred date without flagging the
  conflict to ops — this will happen often, since stores ask for ≤3 days.
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

Ops has to get Atlas's answer into the LabStack console. Three options, and I'd
do them in this order:

1. **v1 — copy block.** One button, exact strings for price and date. Zero
   integration risk, works day one.
2. **v1.5 — deep link** into the console request with values pre-filled in the
   URL, if the console supports it.
3. **v2 — write-back** to `Request.quotedPrice` and status. This needs an
   explicit decision: Atlas is read-only against LabStack today, and reversing
   that is a bigger change than it looks.

Worth being blunt: **every re-typed value is a chance to break the promise
chain.** If ops types a different date into the console than Atlas promised,
the commitment queue is tracking a fiction. v1 must reconcile — read the
console's actual quoted price and date back, and flag divergence.

---

## Requirements

### P0 — the flow does not work without these

| # | Requirement | Acceptance |
|---|---|---|
| 1 | FDW + snapshot: `_PackageToRequest`, `_MasterToRequest`, `Request` | Requested items queryable in Atlas; nightly refresh covers them |
| 2 | Four-state classification | Every request with a pincode gets exactly one; unknown is visible, never defaulted |
| 3 | **Ops answer**: verdict + price + date + reason + copy block | One answer per request, or an explicit "no basis — escalate" |
| 4 | Quote engine with recorded basis | ≥70% of package-gap requests quote on a strong basis |
| 5 | Date engine with `atlas.slot_policy` | No date is ever emitted for supply-gap-unknown |
| 6 | **`atlas.commitment`** — promised date, target lab, ask, outcome, allocated lab | The allocation LabStack never records is captured in Atlas |
| 6b | **Commitment queue** with days-left and named target | Every accepted quote appears within one refresh |
| 7 | Promise-kept instrumentation | Promised vs actual, per state, against the 39%/51%/59% baseline |
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
- **Write-back in v1.** Explicitly deferred, not forgotten.

---

## Success metrics

**Leading (2–4 weeks):** quote coverage — share of non-serviceable requests
receiving a price and date · **promise-kept rate per state** (the number that
decides whether this flow is viable) · escalation rate · console divergence rate
· ops time per request.

**Lagging (1–2 quarters):** quote acceptance rate · lost-request share falling
from 50% · supply-gap pincodes resolved per quarter · repeat requests in a
pincode after it is resolved.

**The headline metric is the placeholder cancellation rate: 31.2% today,
against 15.3% for normal orders.** Halving that gap is what success looks like.

**Promise-kept rate is the operational one**, measured per state against the
baseline curve — 39% at 3 days, 51% at 5, 59% at 7. If a state runs below its
baseline, the lead time is wrong and Atlas is manufacturing broken commitments
faster than the network team can absorb them. That triggers a policy change in
`atlas.slot_policy`, not a UI change.

A caution on targets: **the ceiling is ~69%**, because 31% of placeholder
commitments never deliver at any horizon. Do not set a promise-kept target
above that until the cancellation rate itself moves.

---

## Open questions

**Blocking:**

1. **Will the console record the lab that actually fulfils a placeholder
   order?** (engineering / you) Today it does not — `assignedAt` is unused and
   `labId` stays at 1 through delivery. Atlas can hold this itself, but then
   the allocation is only as accurate as what the network team enters. Fixing
   it at source is better if it is cheap.
2. **Is 31.2% cancellation a supply failure or a price failure?** (ops) We
   cannot tell them apart from the order record, and they need opposite fixes.
   This decides whether the quote engine or the sourcing engine gets attention
   first.
3. **What does `UNREACHABLE` mean?** (ops) 10,936 rows, 10,612 also flagged
   unserviceable. If ops marks a request unreachable when they already know we
   can't serve it, this feature's scope roughly doubles.
4. **Who owns the promise when it's missed?** (you) Given a 39% keep rate at
   3 days, this is not an edge case — it is the majority path. Does the store
   get told before the date, not after?
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
| Ever quoted a price | 384 · `QUOTED` 56 · `QUOTATION_ACCEPTED` **3** |
| Create → convert, when it converts | p50 0.13d · 88% same-day · 98% ≤3d |
| Preferred appointment lead time | p50 1.0d · 90% ≤3d |
| `HOME_SAMPLE` | 27,446 (98%) |
| Star Health share | 23,435 (84%) |
| No package and no test | 20,374 (73%), of which 17,924 have parseable notes |

**The LS placeholder (lab id 1, "LabStack Networks - Lab"):**

| Fact | Value |
|---|---|
| Orders parked | 1,788 · requests 1,346 |
| Delivered / cancelled | 68.8% / **31.2%** (vs 84.1% / 15.3% elsewhere) |
| Delivered cycle time | p50 2.20d · p90 8.79d |
| Keep rate at 3 / 5 / 7 days | **39% / 51% / 59%** (ceiling ~69%) |
| `Order.assignedAt` populated | **0 of 46,202** — fulfilling lab never recorded |

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
