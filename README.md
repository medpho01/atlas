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

## What's next

- Onboarding pipeline CRM
- Catchment analysis via PostGIS
- Demand forecasting per pincode
- Auto-routing rules engine
- Mobile-first BD field app
- Public SEO city pages (`/city/[slug]`)
