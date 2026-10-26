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
| Redcliffe | 1,281 | — | `app.redcliffelabs.com/api/v1/sample/labccs/`, nine per page, 144 requests. |

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
- **Pathkind** is the cleanest of the four: name, phone, full address, pincode
  and coordinates on every centre, plus Pathkind's own numeric id in the centre
  URL, which is used as `external_id` so a renamed centre stays the same row.
- **Redcliffe** publishes **no phone for most centres**. Of the ones that do
  carry a number, most carry Redcliffe's own switchboard rather than the
  franchisee's line, so a Redcliffe row is a location, not a contact.

## Two traps in the Redcliffe API

Both of these silently lose data rather than failing, so they are worth knowing
before anyone refreshes it.

**It answers in two different record shapes.** The common shape gives
`address`, `city.name`, `area.pincode`, `area.state`, a `center_code` and a
Google Maps cid link, and no phone. The rarer shape gives `lab_address`,
`contact_number`, an operations email and a `goo.gl` link, and no structured
city. A reader that knows only one shape returns a near-empty row for every
record of the other — which is exactly what the first pull of this register
did. `scripts/scrape/redcliffe.py` reads both and prefers whichever field is
present.

**It rate-limits after a burst.** Page size is fixed at nine and cannot be
raised, so it is 144 requests; pull it at roughly one request every 1.5–2
seconds and resume rather than restart.

## Filling in a missing state

`atlas.fill_chain_centre_states()`, in `sql/init/43_chain_state_fill.sql`,
fills a blank `state` from the state the other chains give that same city —
only where every chain that names the city agrees on the state. A city like
Hamirpur, which exists in both Himachal Pradesh and Uttar Pradesh, is left
blank rather than guessed: a wrong state on a sales screen is worse than an
empty one. `load_chain_centres` calls it at the end of every load.

## Loading a chain

Stage a CSV with the columns of `atlas.chain_centre_stage`, then fold it in:

```bash
for chain in thyrocare metropolis pathkind redcliffe; do
  docker compose exec -T atlas-db psql -U atlas -d atlas \
    -c "\copy atlas.chain_centre_stage FROM '/dev/stdin' WITH (FORMAT csv, HEADER true)" \
    < sql/reports/chain-centres-$chain.csv
  docker compose exec -T atlas-db psql -U atlas -d atlas \
    -c "SELECT atlas.load_chain_centres('$(echo ${chain:0:1} | tr a-z A-Z)${chain:1}')"
done
```

`\copy` maps CSV columns **by position, not by header name**, so every chain's
CSV carries the staging table's columns in the staging table's order, with a
column the chain doesn't publish written empty rather than omitted.
`scripts/scrape/stage_order.py` normalises a CSV to that order and is idempotent.

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
worth knowing rather than hiding.
