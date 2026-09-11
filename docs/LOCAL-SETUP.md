# Running Atlas on your machine

Atlas normally sits on top of two databases: its own (`atlas-db`, which it
owns and writes to) and a read-only replica of the LabStack operational
database (which it never writes to). You will not be given access to the
second one to work on a chart, and you should not need it — this setup gives
you a small invented LabStack instead, and every page, query and view behaves
the way it does in production.

One command. The database part takes well under a minute; `npm install` is
the slow half:

```bash
./scripts/setup-local.sh
npm install
npm run dev
```

Then open <http://localhost:3010> and sign in as `admin@local.test` /
`atlas1234`.

---

## What you need first

| | |
|---|---|
| **Docker Desktop**, running | the database runs in a container; nothing else does |
| **Node 20 or 22** | `node -v`. Anything older will fail on the Next 14 build |
| about 1.5 GB of disk | Postgres image, the pincode directory, `node_modules` |

You do **not** need Postgres installed on the host, and you do not need any
LabStack credential.

---

## What the setup script does

`scripts/setup-local.sh`, in order:

1. Starts `postgres:16-alpine` as a container called `atlas-local-db` on port
   **15432**, with user/password/database all `atlas`.
2. Creates `src_local` — the shape of the LabStack tables Atlas reads — and a
   `src` schema of views over it, because a dozen queries name `src."Lab"`
   directly (`sql/local/01_source_schema.sql`).
3. Loads the sample dataset: ten cities, 46 labs, 60 doctors and phlebos,
   400 patients, 1,200 orders, 120 requests, a catalogue and a price list
   (`sql/local/02_source_seed.sql`).
4. Builds Atlas's own schema from `sql/init/*.sql` — the same files production
   was built from, in the same order, with the analytics views slotted in
   where `04_analytics_views.sh` would have run.
5. Runs the tail of the nightly refresh: resolves pincode coordinates, seeds
   city bands, recomputes readiness.
6. Creates five logins and a CRM with two campaigns in flight
   (`sql/local/03_atlas_seed.sql`).
7. Writes `.env.local` if you do not already have one.

It is safe to run again — it destroys the container and rebuilds from scratch,
which is the quickest way out of a half-built database. Nothing in it is worth
keeping. `KEEP_DB=1 ./scripts/setup-local.sh` reuses the running container if
you only want the SQL re-applied.

If port 15432 is taken (the compose stack in `docker-compose.yml` uses it too):

```bash
ATLAS_LOCAL_PORT=15433 ./scripts/setup-local.sh
```

and change the port in `.env.local` to match.

---

## Logins

Every one of these signs in with **`atlas1234`**. The password hash is
committed, in the open, which is exactly why these accounts use `@local.test`:
if one ever turns up in a real database, something has gone wrong.

| Email | Role | What it is for |
|---|---|---|
| `admin@local.test` | admin | Everything, including Users & roles and the CRM scoring rules |
| `lead@local.test` | network_lead | The whole CRM pipeline: threads, everyone's queue, the team score |
| `member@local.test` | network | One person's queue and their own daily update — use this to check what a member cannot see |
| `nina@local.test` | network | A second member, so the team views are not a single row |
| `viewer@local.test` | viewer | Read-only. Useful for checking that a page blocks the way it should |

---

## Environment variables

`setup-local.sh` writes `.env.local` for you. In full:

| Variable | Needed | What it is |
|---|---|---|
| `APP_DATABASE_URL` | **yes** | Atlas's own database. Everything the app writes — users, sessions, CRM, commitments — lives here |
| `DATABASE_URL` | **yes** | Where the analytics views are read from. Locally it is the same database as above; in production it is also `atlas-db`, because the views are materialised there |
| `SOURCE_DATABASE_URL` | no | The LabStack replica. Only the FDW bootstrap and the nightly refresh use it. Leave it unset locally — the sample data is already in `src_local` |
| `UPLOADS_DIR` | no | Where CRM document uploads are written. Defaults to `./.uploads` locally, a named volume in production |
| `ANTHROPIC_API_KEY` | no | Only the lab-discovery and enrichment scripts call the API. Every page works without it |
| `APP_URL` | no | Absolute base URL, used when a link has to be built outside a request |
| `CV_REACH_RADIUS_KM` | no | Centre-visit reach radius. Defaults to 10 km — see `lib/publicNetwork.ts` |
| `PHLEBO_REACH_RADIUS_KM` / `NURSE_REACH_RADIUS_KM` | no | The same idea for home-visit staff |

**Never commit `.env.local` or `.env.production`.** Both are gitignored;
keep it that way. The production file holds live database credentials.

---

## What the sample data does and does not cover

It is built so that every page has something real to show, and so that the
things that are easy to get wrong are visible:

- **Ten cities, tiered.** Four metros, four large cities, two smaller ones, so
  readiness, the metro/non-metro filters and the tier-dependent reach radii all
  have something to separate.
- **Eighty pincodes** with coordinates, which is what makes the coverage maps
  and the 10 km centre-visit reach meaningful rather than empty.
- **Labs that differ deliberately:** some do home collection and serve a list
  of nearby pincodes, some are centre-visit only. That difference is the whole
  reason the two coverage numbers on `/network` are not the same.
- **A CRM mid-flight:** two campaigns, 24 providers spread across every stage,
  three people carrying the work, and every third card left old enough to have
  gone stale — so the Score page has both halves of its arithmetic.
- **A year of orders**, weighted the way a real book is: mostly home
  collection, mostly delivered, a tail of cancellations.

What it does not have: real volumes (production has ~1,800 labs and ~46,000
orders, so anything you profile locally will be fast in a way production is
not), wellness providers, corporate overlays, or commitments. If you are
working on those, seed them the way `sql/local/03_atlas_seed.sql` does and send
the addition back.

---

## Working with it

```bash
npm run dev          # http://localhost:3010, hot reload
npm run build        # what CI and the Docker image run
npx tsc --noEmit     # types only, much faster than a build
```

Re-seed without rebuilding everything:

```bash
docker exec -i atlas-local-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 -q < sql/local/02_source_seed.sql
docker exec -i atlas-local-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 -q < sql/local/03_atlas_seed.sql
```

Open a psql shell:

```bash
docker exec -it atlas-local-db psql -U atlas -d atlas
```

After changing a view in `sql/`, rebuild just that file:

```bash
{ echo 'SET search_path = analytics, atlas, src_local, public;'; cat sql/coverage_views.sql; } \
  | docker exec -i atlas-local-db psql -U atlas -d atlas -v ON_ERROR_STOP=1
```

Stop and start the database without losing anything:

```bash
docker stop atlas-local-db
docker start atlas-local-db
```

---

## How this differs from production

Worth knowing before you conclude something is broken:

| | Local | Production |
|---|---|---|
| Source data | `src_local`, invented, static | nightly snapshot over `postgres_fdw` from the LabStack replica |
| `src` schema | views over `src_local` | foreign tables |
| Refresh | you re-run the seed | `atlas-refresh` sidecar, 3 AM IST |
| Scale | hundreds of rows | thousands of labs, tens of thousands of orders |
| Uploads | `./.uploads` on disk | a named Docker volume |
| The app | `next dev` on the host | a built image behind Caddy on `atlas.labstack.in` |

A query that is instant locally can still be slow in production. If you are
changing something that reads the big tables, say so in the PR — it is the one
class of change this setup cannot tell you the truth about.

---

## If you have access to the real source database

You do not need it for most work. If you genuinely do — debugging a snapshot
problem, say — use the compose stack rather than this script:

```bash
cp .env.production.example .env.production   # fill in SOURCE_DATABASE_URL
docker compose up -d
docker compose exec atlas-refresh /refresh.sh
```

That path runs the FDW bootstrap (`sql/init/03_fdw.sh`) and pulls a real
snapshot. Treat what lands in your database accordingly: it is production
patient and partner data, it does not belong on a laptop longer than the
debugging takes, and none of it may be committed.

---

## When it goes wrong

**`Port 15432 is already in use`** — the compose stack is running, or another
Postgres is. Either stop it, or use `ATLAS_LOCAL_PORT=15433` and update
`.env.local`.

**`Postgres did not come up`** — `docker logs atlas-local-db`. Nearly always
Docker Desktop being slow to start; run the script again.

**Pages load but everything is zero** — the derived pass did not finish. Run it
again: `KEEP_DB=1 ./scripts/setup-local.sh`.

**`relation "analytics.mv_…" does not exist`** — a view file was applied out of
order. The order is not alphabetical and it matters; the script has the correct
sequence, so re-run it rather than applying files by hand.

**`password authentication failed`** — `.env.local` and the container disagree,
usually after a re-run with a different `ATLAS_LOCAL_PW`. The script does not
overwrite an existing `.env.local`; fix it by hand or delete it and re-run.

**The app builds but a page 500s** — check the terminal running `npm run dev`.
The stack trace is server-side and will not appear in the browser.
