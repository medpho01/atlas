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

| Chain | Centres | How it was obtained |
|---|---|---|
| Thyrocare | 2,311 | The whole network is embedded in `thyrocare.com/location` as page data. One request. |
| Metropolis | 2,672 | 459 city pages under `/labs/<state>/<city>`, six per page, crawled in-page. 3,544 rows before de-duplicating on address and phone. |

Metropolis gives an address, a landline and a closing time but no centre name —
every card is headed "Metropolis Healthcare Ltd" — so the name is built as
`Metropolis Healthcare — <locality>`, the locality being the address segment
before the city, skipping landmark and shop-number fragments.

## The other chains

**Redcliffe** does publish a register, at
`app.redcliffelabs.com/api/v1/sample/labccs/`: 1,292 centres with coordinates,
email, NABL certificate number and opening hours. Page size is fixed at nine
and cannot be raised, so it is 144 requests — and the API starts refusing after
a burst. Pull it slowly, around one request every two seconds, and resume
rather than restart.

**Pathkind** returns centres from a search API that needs a pincode or city per
call, so it needs a city sweep driven from a list we supply.

Every one of these is bot-protected against plain `curl`; all the pulls were
done through a browser for that reason.

## Loading a chain

Stage a CSV with the columns of `atlas.chain_centre_stage`, then fold it in:

```bash
docker compose exec -T atlas-db psql -U atlas -d atlas \
  -c "\copy atlas.chain_centre_stage FROM '/dev/stdin' WITH (FORMAT csv, HEADER true)" \
  < sql/reports/chain-centres-thyrocare.csv
docker compose exec -T atlas-db psql -U atlas -d atlas \
  -c "SELECT atlas.load_chain_centres('Thyrocare')"
```

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
