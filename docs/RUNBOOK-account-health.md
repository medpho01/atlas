# Account health

*Growth › Account health — `/accounts`*

The Accounts team's workspace: every store that sends us business, what it sent
**this month**, and **which of its business lines are live**.

## Two rules the whole screen is built on

**Months, not rolling windows.** This month, last month, the same month a year
ago. The third is the one that says whether a dip is seasonal. `this month` is
compared against last month **cut at the same day** — otherwise on the 3rd of
November every account in the company looks like it collapsed.

**Lines are never blended.** Status is computed per line in
`analytics.v_account_line`:

| | |
|---|---|
| `never` | nothing, ever, on this line |
| `stopped` | ordered before, nothing this month or last |
| `declining` | this month below half of last month-to-date |
| `growing` | above 1.5× last month-to-date |
| `active` | everything else |

The list shows `worst_line_status` — the worst thing happening on **any one**
line, so the table can be sorted by what needs attention. It is not a score. An
account flat on diagnostics with pharmacy at zero is *declining on pharmacy*,
and a blended number would hide exactly that.

## What counts

**Transactions**: lab orders + consultations + pharmacy orders.
**Requests are excluded** — an enquiry is not a transaction, and counting one
would make an account look busy for asking rather than buying.

## No money

`Order.storePayment` is negative on 28,197 of 46,182 rows and positive on 533.
Until somebody confirms the sign convention, nothing here carries a ₹ label.

## What Atlas stores

| | Table |
|---|---|
| Who owns the account commercially | `atlas.store_profile.account_manager_id` |
| Who to call at the account | `atlas.store_contact` |
| What has to happen next | `atlas.account_task` |
| What was said | `atlas.account_note` |

`account_manager_id` sits on `store_profile` beside `ops_owner_id` — one row
per store, one place to look — but in **its own column**, because chasing a
late pickup and owning the relationship are different jobs, and collapsing them
would make "my accounts" mean two things depending on the screen.

## Recurring tasks

`repeat_every` is `none | monthly | quarterly`, and that is the whole model. A
completed recurring task **writes its own successor**; unticking removes it
again. No scheduler, so a month nobody did the review shows up as one overdue
task rather than a backlog of twelve that everybody learns to ignore.

## Lines not activated — `/accounts/cross-sell`

Accounts already buying one thing and nothing else. **Start activation** writes
the same four tasks every time — confirm the need, price it, one pilot order,
review at 30 days — owned by the account's manager. It refuses if an activation
for that line is already open, and the account needs a manager first.

Nothing here infers that an account is a good fit. It ranks by what they
already send us; the judgement stays with the person who knows them.

## Deploying

```bash
cd ~/atlas && git pull \
  && docker compose exec -T atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 \
       -f /docker-entrypoint-initdb.d/33_account_health.sql \
  && docker compose up -d --build atlas-web
```

`33` creates `atlas.store_profile` with `IF NOT EXISTS`, so it works whether or
not the Stores & Orders work has landed, and merging that later is a no-op for
these columns.

## When something looks wrong

**Every account reads zero.** The snapshot is stale — these are calendar
months, so a mirror that stopped in April shows nothing for October. Check
`docker compose logs atlas-refresh`.

**Consultations missing.** `mv_account_activity` attributes an appointment
through its order's store, falling back to the patient's store. That branch was
broken until Oct 2026 — if the stream reads zero, re-apply
`/atlas-sql/account_views.sql` (note: `/atlas-sql`, not the init directory).

---

# The accounts book — `/accounts/book`

The spine. One row per company, from first meeting to quarterly review, in
`atlas.account`.

## Why it exists

A prospect was `atlas.sales_deal`, keyed by a typed company name. A customer
was a console `store_id`. Between them — the weeks where a signed account is
being brought live — Atlas had no row at all, which is why nothing could carry
a promise from the meeting that made it to the team that has to keep it.

`atlas.account` is created by sales, linked to a store at go-live, and never
replaced. Deals, meetings, contacts, contracted services and tasks all point at
it, so a handover moves a pointer instead of re-keying a history. Atlas still
cannot create a store: `src` is read-only, `store_id` stays nullable, and
going live is the moment it gets filled in.

## What is stored, and where

| | Table |
|---|---|
| The company, its stage, owner, book sizes and cadence | `atlas.account` |
| Who we talk to, and who decides | `atlas.account_contact` |
| Every meeting, with its notes and next step | `atlas.meeting` |
| What they are entitled to order | `atlas.account_service` |
| Work, with a department and a phase | `atlas.account_task` |
| The teams that own steps | `atlas.department` |

## Three rules worth knowing

**A meeting is an object, not a note.** First met, last met, next booked, how
many, and what was agreed each time all come from one table, shared by all
three stages, so the count never resets at a handover. A next step with a date
also writes a task — an agreement nobody is chased for is a note.

**Contracted is not the same as ordered.** `analytics.v_account_line` knows what
an account ordered; only a person knows what it may order. The gap is the
cross-sell list and the never-activated line, and the account screen marks the
second in amber.

**Share is in services, not rupees.** `share_pct` needs both an OPD book and an
average ticket, typed by a human; without them the column is blank rather than
resting on an invented constant. No ₹ appears on anything we delivered, for the
same reason as the rest of this file.

## Deploying

```bash
cd ~/atlas && git pull \
  && docker compose exec -T atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 \
       -f /docker-entrypoint-initdb.d/36_account_lifecycle.sql \
  && docker compose up -d --build atlas-web
```

`36` backfills: one account per existing deal, one per live store, existing
tasks follow their store, and every line an account has actually ordered is
recorded as live. It is idempotent — the inserts all skip what is already there.

## When something looks wrong

**Every date renders as `[object Date]`.** A column was added to
`analytics.v_account_lifecycle` without `::text`. Dates leave that view as text
because everything that reads them renders them.

**Changing the cadence blanked the book sizes.** It cannot now — owner/cadence
and the sizing are separate actions — but that was the shape of the bug, and
any new field added to `updateAccount` should ask which form owns it.
