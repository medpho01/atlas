# Sales CRM

*Growth › Sales CRM — `/sales`*

One card per company we are trying to sign as a **LabStack store**. Not the
same thing as `/crm`, which is supply-side: a thread there is a campaign to
onboard N providers and the card is a provider inside it. Same shapes — jsonb
stages, an activity trail, an assignee — different nouns, different team,
different lifecycle. Sharing the tables would mean a change for sales could
break the network team's board.

## The anchor: a won deal becomes a Store

LabStack's customers **are** stores, so `sales_deal.store_id` is the outcome,
and from the moment it is set, Stores & Orders already answers what that
account went on to send. Nothing else in Atlas can say *"we signed them in
March, and here is what they have actually sent since."*

Atlas cannot create a store — `src` is read-only and the console owns it. So
winning a deal **asks which store it became** and will not proceed without one:
a won deal pointing nowhere would claim a customer Stores & Orders has never
heard of. A store already claimed by another deal is hidden from the picker.

## Stuck is derived, not a stage

A deal is stuck when nothing has been logged against it for **fourteen days**.
Computed in `analytics.v_sales_deal`, so it can never be stale and there is
nothing to configure.

`last_touch_at` moves for the three things that mean somebody worked the deal:
a note, a task, a stage move. **Editing a field does not.** Correcting a
misspelled city is tidying, not contact, and a clock that any keystroke resets
is a clock that never says anything.

## What is stored, and where

| | Table |
|---|---|
| The deal, its stage, value, close date, owner, contact | `atlas.sales_deal` |
| What was said | `atlas.sales_note` (kind: note/call/email/meeting/stage) |
| What has to happen next | `atlas.sales_task` |
| Tags | `atlas.sales_tag` + `atlas.sales_deal_tag` |
| When it moved, and who moved it | `atlas.sales_stage_event` |
| The stages themselves | `atlas.sales_pipeline.stages` (jsonb) |

Tags are created by using them. A separate screen to mint a tag is a screen
nobody opens.

## The pipeline — Admin › Configure pipelines

Three rules the editor enforces, with a sentence each rather than a constraint
violation:

- **Exactly one won stage and one lost stage.** Renameable and reorderable,
  not removable — every report counts on them.
- **A stage holding deals cannot be deleted**, and renaming one never changes
  its key. Either would leave those deals on a stage that does not exist.
- **Stuck is not a stage.** Nothing to configure, nothing to drag into.

One pipeline today. `pipeline_id` is on every deal so the planned
account-management CRM adds a row rather than a migration.

**The screen configures every CRM's pipelines, not just this one, and it is the
only place that creates one.** Provider onboarding used to carry its own funnel
builder in a modal on the board — same idea, different code, different rules,
and it could create a funnel but never edit one, so a typo in a stage name was
permanent. That modal is gone; the board links here.

A pipeline created here appears on its CRM's board straight away, because both
read the same tables. The sales board grows a pipeline switcher as soon as
there is more than one, so a second pipeline is never invisible.

 It lists
`atlas.sales_pipeline` under Sales CRM and `atlas.crm_funnels` under Network
CRM, and the editor asks each pipeline what shape it is: a sales stage carries
a probability and an outcome, a network stage is a key and a label with one of
them marked as the one that means onboarded. The shapes are not flattened —
writing sales fields into a CRM funnel would put data in the database that
nothing reads.

## Roles

`salesCrm`: **sales** and **admin** manage, **accounts** view (the handover
from a signed deal to a managed account is theirs).

**Sales can open the Directory even though its row says `none`.** That is the
dependency promotion in `lib/access.ts` doing its job, not a bug: `catalogue`
and `pricing` are declared to require `directory`, because a rate card is a
list of labs. Sales reads it; sales cannot change it. The Roles & screens grid
shows the **effective** answer, so it reads `view` there rather than claiming
to be off.

Order tracking and Provider onboarding are genuinely closed to sales — nothing
sales can reach depends on them.

## Deploying

```bash
cd ~/atlas && git pull \
  && docker compose exec -T atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 \
       -f /docker-entrypoint-initdb.d/30_role_access.sql \
       -f /docker-entrypoint-initdb.d/31_sales_crm.sql \
       -f /docker-entrypoint-initdb.d/35_sales_account_type.sql \
  && docker compose up -d --build atlas-web
```

`35` adds the account types and rebuilds `v_sales_deal`; it is idempotent, so
re-running it on a database that already has them changes nothing.

`30` seeds the role matrix with `ON CONFLICT DO NOTHING`, so it is a starting
point and never a reset — an admin who moves a screen keeps that change through
every later deploy.

## When something looks wrong

**A role change has not taken effect.** The overrides are cached for thirty
seconds per web process. Wait, or restart `atlas-web`.

**Everyone suddenly has the compiled permissions.** `atlas.role_feature` could
not be read. That is the designed failure — the rules that shipped with the
code, rather than an empty table that would open or close everything at once.
Check `docker compose logs atlas-web`.

**A won deal has no store.** It cannot happen through the UI. If one exists it
was written by hand; `UPDATE atlas.sales_deal SET store_id = …` or move it back
to an open stage.
