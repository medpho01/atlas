# Atlas · LabStack

> **Map every pincode, find every gap.**

Atlas is the network intelligence layer for LabStack — a unified view of supply, demand and gaps across every pincode, designed for the CEO and Head of Provider Networks.

## What it answers

- **Today:** what does my network look like?
- **This quarter:** where should I add capacity, and what kind?
- **This year:** where do I invest to capture the most demand?

## Tech stack

- **Next.js 14** App Router (server components everywhere)
- **Tailwind CSS** with full dark-mode support
- **Leaflet + OpenStreetMap** (light tiles) / **CartoDB Dark Matter** (dark tiles) — fully free
- **Recharts** for charts
- **lucide-react** for icons
- **PostgreSQL** (read-only) with materialized views as the engine
- **node-pg** (no ORM)

Zero paid SaaS. Runs entirely on the existing `labstack` database.

## Setup

```bash
npm install
npm run db:views       # build materialized views (one-time + nightly refresh)
npm run dev            # http://localhost:3010
```

## Routes

| Route | Purpose |
|---|---|
| `/` | Overview — KPIs, India map, leaderboard, operator action queues |
| `/pincodes` | Pincode search & browse |
| `/pincode/[code]` | Pincode Explorer — coverage matrix, funnel, labs serving |
| `/heatmap` | Order origin heatmap with kind × modality lens |
| `/directory` | All labs / providers / pharmacies with data-quality nudges |
| `/gaps` | Network gaps queue ranked by (pincode × kind × modality) |
| `/quality` | Lab health watchtower |
| `/check` | **Public** pincode serviceability check (lead-gen) |

## Materialized views

All defined in `sql/coverage_views.sql` and `sql/materialized_views.sql`:

| View | Purpose |
|---|---|
| `mv_provider_unified` | All providers (Lab + Provider + Pharmacy) in one shape |
| `mv_pincode_coverage` | (pincode × kind × modality) counts |
| `mv_pincode_city` | Pincode → best-guess city |
| `mv_city_coverage` | City × kind × modality with unique provider counts |
| `mv_pincode_supply` / `mv_pincode_demand` / `mv_pincode_requests` | Legacy flat supply/demand |
| `mv_pincode_summary` | Joined headline view |
| `mv_city_rollup` | City × order stats |
| `mv_lab_health` | Per-lab composite health score |

Refresh:
```bash
npm run db:views
```

## Audit & data quality

Atlas surfaces real data-quality gaps surfaced through audit:

- **Mass-claim labs** (14 labs declaring ≥500 pincodes) — split into verified vs claimed counts on Pincode Explorer
- **Inactive labs** filtered out of all coverage rollups
- **Funnel anomalies** detected & flagged when Request → Order overrides occur
- **Lat/long outliers** bbox-filtered to India
- **Chain concentration risk** surfaced in the City Leaderboard

## Provider ranking (prototype)

`ranking.py` ranks the labs and hospitals known for a pincode or city and
attaches a plain-text reason to each one. Rule-based and deterministic — no
model, no training, no network calls. Python 3.10+, standard library only.

```bash
python ranking.py                                    # sample area, no filter
python ranking.py --area 560034 --services mri,ct    # filter by service
python ranking.py --area Bengaluru                    # city instead of pincode
```

### Signals and weights

| Signal | Weight | Normalised as |
|---|---|---|
| Accreditation | 0.40 | 1 if accredited, 0 if not |
| Proximity | 0.30 | linear decay to 0 at `MAX_DISTANCE_KM` (15 km) |
| Service match | 0.20 | share of requested services offered |
| Reviews | 0.10 | `review_score / 5` |

Two behaviours are worth knowing about before reading a score:

- **Unknown is not zero.** A signal with no data is dropped and the remaining
  weights are renormalised, then the result is scaled by how much of the weight
  budget was actually observed (floor 0.6). A lab with no published rating is
  not treated as a zero-star lab, but it also cannot top the list on two
  flattering signals alone.
- **`--services` filters, it does not merely weight.** Providers whose known
  service list matches nothing requested are excluded. Providers with no
  service list on file are kept and flagged, because unknown is not "no".

Scores are relative within one run. Comparing a score across two different
areas or two different service filters is meaningless.

### Sample output

```
1. Koramangala Diagnostics   [0.940]
   4th Block, Koramangala, Bengaluru 560034
   080 4123 5566
   Services: blood test, thyroid panel, ultrasound
   Why: Ranked #1 — accredited, nearby (1.8 km) and well reviewed (4.4/5).

2. Southside Imaging Centre   [0.823]
   80 Feet Road, Koramangala, Bengaluru 560034
   080 4998 2210
   Services: mri, ct, x-ray, ultrasound
   Why: Ranked #2 — accredited.

3. Jyoti Collection Centre   [0.756]
   1st Block, Koramangala, Bengaluru 560034
   080 4110 9034
   Services: blood test
   Why: Ranked #3 — closest in this area (0.9 km) and well reviewed (4.8/5).
        Against it: accreditation unverified.
   Unknown: accreditation
```

The full run for both the unfiltered and the `mri,ct` case is pasted at the
bottom of `ranking.py`.

### Wiring it to real data

The sample dataset mirrors `atlas.discovered_lab` (`sql/init/16_requests.sql`),
which `npm run labs:discover` already populates. Four fields the ranker needs
do not exist on that table yet and would have to be added or joined:
`accredited`, `distance_km`, `services`, `review_score`. Until then the sample
list in `ranking.py` is hand-written and clearly marked as such.

## What's next

- Onboarding pipeline CRM
- Catchment analysis via PostGIS
- Demand forecasting per pincode
- Auto-routing rules engine
- Mobile-first BD field app
- Public SEO city pages (`/city/[slug]`)
