# Things worth fixing in the LabStack database

Found while building Atlas's coverage and readiness views. Ordered by what it
costs us. Numbers are from the production snapshot on 10 Sep 2026.

## 1. `PincodeToLatLong` is mostly empty, and its filled rows include a placeholder

- **15,034 of 19,418 rows have NULL latitude and longitude** — 77%. Only 4,384
  pincodes have a position at all.
- Of those that do, a batch share the single coordinate **20.594, 78.963** —
  the geographic centre of India, evidently a default written when the real
  location is unknown. 97 pincodes sit on that one point in our copy.

**Why it matters.** Any question of the form "which pincodes can this centre
reach" needs both ends located. With 77% missing we can only measure
centre-visit coverage across a quarter of India, and the placeholder rows are
worse than missing — they look authoritative and put a crowd of pincodes in
central India at zero distance from each other.

**Ask.** Populate the coordinates (a public pincode dataset covers ~19,300),
and stop writing the centroid as a fallback — leave it NULL, which is honest
and which consumers can detect.

## 2. Every doctor is configured for every modality

All **155 doctors carry both `CENTER_VISIT` and `HOME_VISIT`** — no exceptions.
That is a default rather than a description of what each doctor offers.

**Why it matters.** We cannot tell who actually takes in-clinic appointments,
so a consult readiness score counts all 155 regardless. There is also no
`VIRTUAL` modality on any provider, so teleconsult is invisible to us entirely.

**Ask.** Configure modality per doctor, and add the teleconsult modality if
that service exists.

## 3. `Master.isTestProfile` was dropped with nothing to replace it

The column is gone from the source. Nothing distinguishes a profile (a bundle
of tests) from a single test any more.

**Why it matters.** Atlas now infers it from `subTests` being non-empty, which
is a guess that happens to work. Anything else reading the catalogue has to
make the same guess, or get it wrong quietly.

**Ask.** Either restore the flag or confirm that non-empty `subTests` is the
official definition so everyone infers it the same way.

## 4. Almost no lab has a catalogue

**127 of 1,774 centres have any `DOS` rows** — 7%. So test-level questions
("who can do an MRI here") can only be answered for a fourteenth of the
network.

**Ask.** Not a bug, but worth knowing that test-level coverage reporting is
blocked on catalogue onboarding rather than on tooling.

## 5. Schema changes land without notice

Two columns disappeared during this work — `Lab."labCenterEmail"` and
`Master."isTestProfile"`. Each broke Atlas's nightly copy silently: the foreign
table still listed the column, so every full-width read failed while
`count(*)` kept working, and a table quietly emptied.

Atlas now self-heals both directions, so this is no longer urgent for us.

**Ask.** A heads-up on column removals would still save the next consumer the
same debugging.
