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

## The finding that should worry you most

**The quote path in your flow has essentially never run.**

| | count |
|---|---|
| Requests ever given a `Quoted Price` | 384 (1.4%) |
| Status `QUOTED` | 56 |
| Status `QUOTATION_ACCEPTED` | **3** |

Meanwhile, requests that *do* convert convert almost immediately — median 0.13
days, 88% same-day, 98% within three days. But that is survivorship: those are
the requests where supply **already existed**. They tell us nothing about how
long it takes to *acquire* supply.

So: **there is no historical evidence that a lab can be negotiated or onboarded
in 2–3 days, because it has never been done at volume.** Neither the request
data nor the CRM (`atlas.crm_thread_providers` keeps a current `stage_key` but
no stage history) can tell us the cycle time.

That is not a reason to abandon the flow. It is a reason to build v1 so that:

1. The promised date is **rule-based and deliberately conservative**, not
   learned — we have nothing to learn from yet.
2. **Promise-kept rate is instrumented from day one**, per gap class, so by
   month two the date *is* evidence-based.
3. Atlas **declines to promise** where it has no route, rather than defaulting
   to three days because three days sounds reasonable.

If we skip point 3, the failure mode is the expensive one: we quote, the store
accepts, the network team can't deliver, and we've converted a serviceability
problem into a broken commitment.

---

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

Promised date = **today + lead time for the state**, adjusted for the store's
preferred appointment where one exists (median lead time asked for today is 1.0
days; 90% ask for ≤3).

v1 lead times are **config, not inference** — starting values below, held in
`atlas.slot_policy`, revised monthly against measured promise-kept rate:

| State | Starting lead time |
|---|---|
| Package gap, partner reachable | 2 days |
| Supply gap, known candidate | 3 days |
| Supply gap, unknown | **no date — escalate** |

Three guards:

- Never promise past the store's stated preferred date without flagging it.
- Never promise into a pincode where the last two commitments were missed —
  degrade to escalation until it recovers.
- Working days, honouring the collection-day patterns already in the order data.

---

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
| 6 | **Commitment queue** with days-left and named target | Every accepted quote appears within one refresh |
| 7 | Promise-kept instrumentation | Promised vs actual serviced date, per state, from day one |
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

**Promise-kept rate is the one to watch.** If it sits below ~80% for
package-gap, the lead times are wrong and Atlas is manufacturing broken
commitments faster than the network team can absorb them. That should trigger a
policy change, not a UI change.

---

## Open questions

**Blocking:**

1. **What is an "LS lab" in step 4?** (you) A LabStack-owned entity, or a
   placeholder the order is parked against until a real lab is allocated? The
   commitment queue's join back to the order depends on which.
2. **What does `UNREACHABLE` mean?** (ops) 10,936 rows, 10,612 also flagged
   unserviceable. If ops marks a request unreachable when they already know we
   can't serve it, this feature's scope roughly doubles.
3. **Who owns the promise when it's missed?** (you) Does the commitment queue
   escalate to a person, and does the store get told before the date, not after?
4. **Can the console accept a deep link or an API write?** (engineering)
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
