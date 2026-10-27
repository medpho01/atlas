# Franchisee networks

*Directory › Franchisee networks — `/franchisees`*

The collection centres the national diagnostic chains publish: one row per
centre per chain in `atlas.chain_centre`, so the screen reads the same
whichever brand you are looking at.

Reference data, like the NABL register. A centre here is one the chain says it
has; it is not supply until somebody onboards it. **On our network** is the
same match as `/nabl` — same pincode, name similarity over 0.45 against an
active console lab — so the two screens mean the same thing by it.

## Loaded today

| Chain | Centres | Cities | How it was obtained |
|---|---|---|---|
| Metropolis | 2,672 | 430 | 459 city pages under `/labs/<state>/<city>`, six per page, crawled in-page. 3,544 rows before de-duplicating on address and phone. |
| Thyrocare | 2,311 | 832 | The whole network is embedded in `thyrocare.com/location` as page data. One request. |
| Pathkind | 2,206 | 466 | The locator's own state directory, `nearby.pathkindlabs.com/location/<state>`, paginated. Every page carries one JSON-LD `MedicalBusiness` per centre. |
| Agilus | 1,078 | 273 | A flat index at `labs.agilusdiagnostics.com/?page=N`, six per page, 182 pages. Each card already holds the address, pincode, coordinates, hours and phone, so no centre page is fetched. |

### What each chain actually publishes

Not every chain publishes every field, and the screen shows blanks rather than
guesses. What is missing is missing at source:

- **Metropolis** gives an address, a landline and a closing time but **no
  centre name** — every card is headed "Metropolis Healthcare Ltd" — so the
  name is built as `Metropolis Healthcare — <locality>`, the locality being the
  address segment before the city, skipping landmark and shop-number fragments.
- **Thyrocare** gives no **state** at all. It is filled from the city by
  `atlas.fill_chain_centre_states()` (see below), which is why Thyrocare shows
  a state for about two thirds of its centres and a blank for the rest.
- **Agilus** is the most complete of the four: name, address, pincode,
  coordinates, hours and phone on every one of its 1,078 centres, and 1,078
  distinct numbers. Those numbers are call-tracking lines (`+9180372…`,
  `+9180378…`) rather than the franchisee's own mobile — they route through
  Agilus — but they are per-centre, which is what makes them worth having.
  Its locator has a COCO/FOFO toggle, company-owned against franchise-owned,
  which would be exactly the split we want; it only applies through the form's
  POST, and passing `cot[]` on the query string silently returns everything,
  so the distinction is not recorded.
- **Pathkind** is the cleanest of the three published-as-data sources: name, phone, full address, pincode
  and coordinates on every centre, plus Pathkind's own numeric id in the centre
  URL, which is used as `external_id` so a renamed centre stays the same row.
## Why Redcliffe was dropped

Redcliffe was loaded and then removed on 2026-10-27. Its register publishes
**no phone number for collection centres at all** — the field is absent from
that record type, not empty. The only numbers it carries belong to Redcliffe's
own 74 pathology labs, and 62 of those are the same switchboard, so the whole
chain yielded about twelve distinct contacts for 1,280 centres. There is no
per-centre detail endpoint and the public network page is a JavaScript shell,
so there is nowhere else to look.

It was also the weakest chain on reach: against three months of requests it
added only 81 that the other three did not already cover within 10 km.

Removing it needs `sql/init/45_drop_redcliffe.sql`, which is a plain DELETE.
`load_chain_centres` only ever deletes within the chain it is loading — so that
a Thyrocare refresh can never look like Metropolis going missing — which means
loading the remaining chains does **not** clean up a chain we have stopped
carrying. It would otherwise sit on the screen indefinitely.

If it is ever worth revisiting, two things are worth knowing. The register
answers in **two different record shapes** — the common one gives `address`,
`city.name`, `area.pincode` and a `center_code`; the rarer one gives
`lab_address`, `contact_number` and an email — and a reader that knows only one
returns a near-empty row for every record of the other. And it rate-limits
after a burst: page size is fixed at nine, so it is 144 requests at roughly one
every 1.5–2 seconds.

## Filling in a missing state

`atlas.fill_chain_centre_states()`, in `sql/init/43_chain_state_fill.sql`,
fills a blank `state` from the state the other chains give that same city —
only where every chain that names the city agrees on the state. A city like
Hamirpur, which exists in both Himachal Pradesh and Uttar Pradesh, is left
blank rather than guessed: a wrong state on a sales screen is worse than an
empty one. `load_chain_centres` calls it at the end of every load.

## Deploying

Everything the screen needs is in the repo — the four CSVs are committed, so
production never re-scrapes.

```bash
cd ~/atlas && git pull \
  && docker compose exec -T atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 \
       -f /docker-entrypoint-initdb.d/42_chain_centres.sql \
  && docker compose exec -T atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 \
       -f /docker-entrypoint-initdb.d/43_chain_state_fill.sql \
  && docker compose exec -T atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 \
       -f /docker-entrypoint-initdb.d/44_chain_centre_email.sql \
  && docker compose exec -T atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 \
       -f /docker-entrypoint-initdb.d/45_drop_redcliffe.sql \
  && for chain in Thyrocare Metropolis Pathkind Agilus; do \
       docker compose exec -T atlas-db psql -U atlas -d atlas \
         -c "\copy atlas.chain_centre_stage FROM '/dev/stdin' WITH (FORMAT csv, HEADER true)" \
         < sql/reports/chain-centres-$(echo $chain | tr A-Z a-z).csv \
       && docker compose exec -T atlas-db psql -U atlas -d atlas \
            -c "SELECT atlas.load_chain_centres('$chain')"; \
     done \
  && docker compose up -d --build atlas-web
```

Run `42` before `43`: the loader calls `fill_chain_centre_states()`, which `43`
defines. It is resolved at call time, so creating the loader first is fine, but
loading a chain before `43` exists is not.

Then check it landed:

```bash
docker compose exec -T atlas-db psql -U atlas -d atlas -c \
  "SELECT chain, COUNT(*) centres, COUNT(DISTINCT city_key) cities,
          COUNT(*) FILTER (WHERE coalesce(state,'') <> '') with_state,
          COUNT(*) FILTER (WHERE matched_lab_id IS NOT NULL) matched,
          MAX(pulled_on) pulled
     FROM atlas.chain_centre GROUP BY chain ORDER BY 2 DESC"
```

Expect 2,672 Metropolis, 2,311 Thyrocare, 2,206 Pathkind and 1,078 Agilus —
8,267 in all.
`matched` will be small — around 27 in all — and that is a property of our own
data, not of the pull: most active console labs carry no pincode, and the match
needs one. Raising it means filling in pincodes on the console side.

## Loading a chain

Stage a CSV with the columns of `atlas.chain_centre_stage`, then fold it in:

```bash
docker compose exec -T atlas-db psql -U atlas -d atlas \
  -c "\copy atlas.chain_centre_stage FROM '/dev/stdin' WITH (FORMAT csv, HEADER true)" \
  < sql/reports/chain-centres-thyrocare.csv
docker compose exec -T atlas-db psql -U atlas -d atlas \
  -c "SELECT atlas.load_chain_centres('Thyrocare')"
```

`\copy` maps CSV columns **by position, not by header name**, so every chain's
CSV carries the staging table's columns in the staging table's order, with a
column the chain doesn't publish written empty rather than omitted.
`scripts/scrape/stage_order.py` normalises a CSV to that order and is
idempotent.

`load_chain_centres` works **one chain at a time**: it upserts that chain's
rows, deletes the ones that chain no longer lists, and re-runs the console
match. Loading Thyrocare can never look like Metropolis going missing.

## When something looks wrong

**A chain's count drops to nothing.** The staging table was loaded with a
different spelling of the chain name than the one already stored — the loader
matches on `chain` exactly. Check with
`SELECT DISTINCT chain FROM atlas.chain_centre;`.

**Shared phones.** A number used by several centres of one chain is flagged,
not removed: it is usually one franchisee running several branches, which is
worth knowing rather than hiding. When a whole chain's numbers collapse onto
one switchboard, though, the chain is not publishing franchisee contacts at
all — that is what got Redcliffe dropped.

**A chain shows far fewer centres than you expect.** Check the pull before
the loader. Pathkind repeats its first page at `?page=0`, which ends a
"stop when nothing is new" crawl after one page per state without erroring. A short CSV is the symptom; the counts above are what
a complete one looks like.
