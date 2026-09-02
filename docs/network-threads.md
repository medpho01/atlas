# Provider network threads — where each number comes from

Step 2 of the network deck: the source and the logic for every figure on the
three slides, and an honest column for the ones the database cannot answer.

Counts below are from the **local April snapshot**, so treat them as shape, not
truth — they say whether a signal exists and how sparse it is. Prod will differ.

---

## Can each thread be measured?

| # | Thread | Source | Verdict |
|---|--------|--------|---------|
| 1 | Home sample collection (Pathology) | `Lab.homeCollection` | **Yes** |
| 2 | Centre visit (Radiology and/or Pathology) | `Lab.centerVisit` | **Yes**, but the radiology/pathology split is 82% unknown |
| 3 | Specialised tests | `DOS` → `Master.testCategory = 'NON_ROUTINE'` | **Yes** |
| 4 | Processing labs | `Lab.labFacilities->>'ProcessOtherLabSamples'` | **Weak** — 10 labs flagged, 82% blank |
| 5 | PPMC network | `Lab.isApiPpmc` | **Yes** — but 0 rows locally, confirm on prod |
| 6 | Online teleconsult | `Appointment.appointmentType = 'ONLINE'` | **Barely** — 22 appointments ever, none in 90 days |
| 7 | Offline doctor consultation | `Provider` + `ProviderType.typeName = 'Doctor'` | **Yes** — 155 |
| 8 | Pharmacy | `Pharmacy` | **No** — 1 row |
| 9 | Phlebotomists | `ProviderType.typeName = 'Phlebotomist'` | **Yes** — 89 |
| 10 | Nurses | `ProviderType.typeName = 'Nurse'` | **Yes** — 46 |
| 11 | Dental network | `_ProviderToSpeciality` → `Speciality.name = 'Dentist'` | **Weak** — 5 providers, and 0 under the `Dentist` provider *type* |

Atlas already reads threads 1, 2, 7, 9, 10 through `analytics.mv_provider_unified`
(`kind` ∈ LAB, HOSPITAL, DOCTOR, PHLEBO, NURSE) and the taxonomies in
`lib/providerKinds.ts` and `lib/serviceLines.ts`. Reuse those rather than
introducing a twelfth classification.

### The three that need a decision

**Centre visit — radiology or pathology.** The only signal is `labFacilities`, a
jsonb blob with `XRay`, `USG`, `CT`, `MRI`, `Mammogram`, `TwoDEcho`, `BMD`, `TMT`,
`EMG`. It is populated on 336 of 1,776 labs. Of the 1,746 active centre-visit labs:

| | labs |
|---|---|
| radiology (any imaging facility true) | 65 |
| pathology only | 242 |
| **no facilities record at all** | **1,439** |

So the split is knowable for 18% of the estate. Either the slide says
"radiology 65, pathology 242, unclassified 1,439", or the field gets backfilled.
It should not silently fold the unknowns into pathology.

**Processing labs.** `ProcessOtherLabSamples` is true on 10 labs and blank on the
same 82%. That is not a thread, it is a rounding error. Either it is genuinely
tiny, or nobody fills the field — worth asking the network team which.

**Dental.** `ProviderType` has a `Dentist` row with **zero** providers; five
providers carry `Dentist` as a *speciality* instead. So the thread exists only
through speciality, and at n=5.

---

## Metric logic

### Providers
Count of active rows for the thread. For threads 1–5 that is `src."Lab"` filtered
on the flag; for 7 and 9–11 it is `src."Provider"` joined to `ProviderType`
(or `_ProviderToSpeciality` for dental).

### Pincodes reached — **proven, not claimed**
```sql
SELECT lab_id, count(*) FROM analytics.mv_lab_pincode_served GROUP BY 1
```
`mv_lab_pincode_served` is built from real orders. The alternative,
`Lab.pincodesServiced`, claims 40,727 lab-pincode pairs against 7,826 distinct
pincodes — roughly 6× the proven figure. Deck uses proven; show claimed only as
a faded secondary if anyone asks.

### Depth
Median providers per **serviceable** pincode, not per city:
```sql
WITH claim AS (
  SELECT id AS lab_id, unnest("pincodesServiced") AS pincode
  FROM src."Lab" WHERE active AND "pincodesServiced" IS NOT NULL
)
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY n)
FROM (SELECT pincode, count(DISTINCT lab_id) AS n FROM claim GROUP BY 1) t;
```
Per-city counts flatter metros: Bengaluru has many providers clustered into ~40
pincodes, and a city-level count hides that a specific patient has no choice.

### Demand covered
Share of the last 90 days' orders whose pincode the thread reaches:
```sql
SELECT count(*) FILTER (WHERE o."Pincode" IN (SELECT pincode FROM thread_pincodes))::numeric
     / nullif(count(*), 0)
FROM src."Order" o WHERE o."createdAt" >= now() - interval '90 days'
```
This is the column that should drive decisions — raw pincode counts weight
Ladakh the same as Bengaluru.

### Growth (added in the last 30 days) — the one real build

**Providers added** is easy: `Lab."createdAt"` / `Provider."createdAt"` inside
the window.

**Pincodes added is not.** `Lab.pincodesServiced` is an array overwritten in
place with no history, so nothing in the source can say what a lab covered last
month. History has to come from a snapshot.

`atlas.network_snapshot` already exists and already captures it weekly:

```
week_start, city, kind, city_tier, providers, pincodes_served, active, backfilled, captured_at
```

But it is keyed on **`kind`** — LAB, HOSPITAL, DOCTOR, PHLEBO, NURSE, PHARMACY —
not on the eleven threads. Home sample and centre visit are both `LAB`, so the
month-on-month deltas the deck asks for cannot be split out of it as it stands.

Two ways forward:
1. **Add a `thread` column** to `network_snapshot` and capture per thread from
   the next run. Cheap, but the deck has no history until the snapshots
   accumulate — the first month shows providers-added only.
2. **Backfill** `pincodes_served` per thread from `mv_lab_pincode_served` plus
   `Order."createdAt"`, since a lab's first order into a pincode dates when that
   coverage became real. Gives history immediately, and measures proven
   coverage, which is what the deck uses anyway.

Option 2 is the better one and it is the only genuine build in Step 3.

### Zonal and metro views
State → zone is a static mapping Atlas must own (`atlas.state_zone`); the source
has no zone column. And `Lab.state` is dirty — **71 distinct values, 48 after
case and whitespace normalising**, including pincodes typed into the state field
(`'110093'`) and Hyderabad and Pune recorded as states. Derive state from
`atlas.pincode_directory` via the pincode; do not trust the text column.

### Teleconsult — specialities, hours
- Specialities: `_ProviderToSpeciality` → `Speciality.name`. 22 distinct, led by
  General Physician (53 providers).
- **Hours of day: `SlotConfig`** (`provider_id`, `startTime`, `endTime`,
  `daysOfWeek`, `isActive`) — the real source for the slide-3 heatmap, and it is
  populated: 179 configs, 178 active, across 148 providers. Expand each active
  config over its hour range and count distinct providers per (speciality, hour).
- Languages: `MDMLanguage` + `_MDMLanguageToProvider` (`name`, not
  `languageName`). Feeds the stat tile only, now the heatmap is gone.

---

## What this means for the deck

Four of the eleven threads are too thin to present as drawn: **pharmacy (1)**,
**online teleconsult (22 appointments)**, **dental (5)**, **processing labs (10)**.
Slide 3 is currently a full slide about the thread with 22 lifetime appointments.

Three options:
1. Keep all eleven and let the small numbers show — honest, and makes the case
   for investment.
2. Group the four thin ones into an "Emerging" family on slide 1 and give
   slide 3 back to something with volume.
3. Confirm on prod first — `isApiPpmc` is 0 here and pharmacy is 1, which smells
   like the local snapshot rather than reality.

**Do 3 before deciding between 1 and 2.** The verification query is in
`sql/network-threads-check.sql`.


---

## Note on `src`

`SlotConfig`, `Speciality`, `_ProviderToSpeciality`, `MDMLanguage` and
`_MDMLanguageToProvider` were not in `src` — the check script imports them if
missing, the same guarded pattern `sql/init/16_requests.sql` uses. That touches
only Atlas's own catalog; the source database is never written to.
