# NABL labs

*Directory › NABL labs — `/nabl`*

The 2,640 pathology and imaging centres NABL has accredited, with contact
person, phone, email, address, pincode, coordinates, discipline and a link to
the certificate and scope PDFs.

**The screen shows the Medical field only.** NABL accredits 11,142 labs, but
8,502 of them are industrial — fertiliser chemistry, electrical calibration,
corrugated box testing — and none of that is supply Atlas can use. The full
snapshot stays in `atlas.nabl_lab`; `lib/nablLabs.ts` simply never asks for the
rest, so a future screen can use the industrial rows without a re-pull.

## Where it comes from

NABL publishes the directory only through a search box — no export, and no API
we are entitled to poll. The public search reads a WordPress AJAX endpoint that
returns the whole record per lab, so the pull is 23 requests, one every 1.5
seconds, deduplicated on NABL's own row id. `robots.txt` allows it.

The scripts are in the session scratchpad rather than the repo; the CSV they
produce is committed at `sql/reports/nabl-labs.csv` so the table can be rebuilt
without re-scraping.

**It is a snapshot, not a feed.** `pulled_on` carries the date and the screen
shows it. Nothing refreshes by itself.

## Reference data, not supply

A row in `atlas.nabl_lab` is a lab NABL accredited. That is a different claim
from a lab LabStack can send an order to, and the two must not be conflated:
nothing here is foreign-keyed to `src`, and onboarding still happens in
Provider onboarding.

**On our network** on the list is a match on pincode plus a name similarity
above 0.45 against an active `src_local."Lab"`. It is a strong hint — 61 labs
match today — and it is meant to be checked, not trusted.

## Loading

```bash
cd ~/atlas && git pull \
  && docker compose exec -T atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 \
       -f /docker-entrypoint-initdb.d/39_nabl_labs.sql \
  && docker compose exec -T atlas-db psql -U atlas -d atlas \
       -c "\copy atlas.nabl_lab_stage FROM '/dev/stdin' WITH (FORMAT csv, HEADER true)" \
       < sql/reports/nabl-labs.csv \
  && docker compose exec -T atlas-db psql -U atlas -d atlas -c "SELECT atlas.load_nabl_labs()" \
  && docker compose up -d --build atlas-web
```

`load_nabl_labs()` folds the staging table in on `nabl_id`, so a refresh
updates rows in place and empties the staging table behind it.

## The console match is stored, not computed

`matched_lab_name` is written by `atlas.match_nabl_labs()` at load time.
Computing it per row made /nabl the slowest screen in Atlas (1.1s); stored, the
page is 48ms. `load_nabl_labs()` calls it, so a refresh never leaves a stale
match, and it also clears marks for labs that were renamed or deactivated.

Re-run it by hand after a provider refresh if the match matters:

```bash
docker compose exec -T atlas-db psql -U atlas -d atlas -c "SELECT atlas.match_nabl_labs()"
```

## When something looks wrong

**A certificate says "no link".** NABL holds a bare filename rather than a URL
for a few dozen labs, and the address it implies serves an error page. The
loader drops anything that is not a `nablwp.qci.org.in` URL rather than linking
somewhere dead.

**Nothing matches "on our network".** The match needs a pincode on both sides.
2,157 active labs in the console have no serviced pincodes recorded at all.
