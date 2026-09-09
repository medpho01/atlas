#!/usr/bin/env python3
"""
Rule-based ranking of diagnostic labs and hospitals for a pincode or city.

    python ranking.py
    python ranking.py --area 560034 --services mri,ct
    python ranking.py --area Bengaluru

Deliberately deterministic. No model, no training, no network. The same input
gives the same output every time, which is what makes the explanations below
trustworthy: each reason is emitted by the same term that moved the score, so
the two cannot drift apart.

Scope note. At 4-5 providers per area the ordering barely matters -- a human
reading five rows will spot the right one regardless. What earns its keep at
this size is the *explanation* and the missing-data handling, because those are
what a reviewer checks when they disagree with the order. The arithmetic is
here mostly so there is something honest to attach the reasons to.

Data shape mirrors atlas.discovered_lab (sql/init/16_requests.sql) so this can
later read real leads instead of the sample below. Four fields do not exist on
that table yet and would need adding: accredited, distance_km, services,
review_score. Until then, the sample is hand-written.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

# Weights as agreed. They sum to 1.0; nothing below assumes that, but keeping
# it true makes the raw score readable as "out of 1".
WEIGHTS: dict[str, float] = {
    "accreditation": 0.4,
    "proximity": 0.3,
    "service_match": 0.2,
    "reviews": 0.1,
}

# Distance at which proximity contributes nothing. 15 km is roughly the point
# where a same-day sample run stops being comfortable in a metro. Tune it per
# city later; it is the one constant here that is a business decision rather
# than arithmetic.
MAX_DISTANCE_KM = 15.0

# Review scores are published out of 5.
MAX_REVIEW_SCORE = 5.0


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Provider:
    """One lab or hospital. Optional fields are None when genuinely unknown."""

    name: str
    pincode: str
    city: str
    address: str
    phone: str
    services: list[str] = field(default_factory=list)
    accredited: bool | None = None
    distance_km: float | None = None
    review_score: float | None = None

    def offers(self, service: str) -> bool:
        return service.strip().lower() in {s.strip().lower() for s in self.services}


@dataclass(frozen=True)
class Signal:
    """One scoring signal after normalisation to 0..1."""

    key: str
    weight: float
    value: float

    @property
    def contribution(self) -> float:
        return self.weight * self.value


@dataclass
class Scored:
    """A provider with its score, the signals behind it, and its reasons."""

    provider: Provider
    score: float
    signals: list[Signal]
    missing: list[str]
    coverage: float = 0.0  # share of the applicable weight actually observed
    rank: int = 0
    explanation: str = ""

    def signal(self, key: str) -> Signal | None:
        return next((s for s in self.signals if s.key == key), None)


# --------------------------------------------------------------------------
# Signals -- each returns 0..1, or None when the input is unknown
# --------------------------------------------------------------------------


def _accreditation(p: Provider) -> float | None:
    if p.accredited is None:
        return None
    return 1.0 if p.accredited else 0.0


def _proximity(p: Provider) -> float | None:
    if p.distance_km is None:
        return None
    return max(0.0, 1.0 - (p.distance_km / MAX_DISTANCE_KM))


def _service_match(p: Provider, requested: list[str]) -> float | None:
    # Nothing requested means the signal does not apply -- not that the
    # provider scored zero on it. Returning None drops it from the weighting
    # rather than punishing every provider equally, which would be noise.
    if not requested:
        return None
    if not p.services:
        return None
    hits = sum(1 for s in requested if p.offers(s))
    return hits / len(requested)


def _reviews(p: Provider) -> float | None:
    if p.review_score is None:
        return None
    return min(1.0, max(0.0, p.review_score / MAX_REVIEW_SCORE))


# --------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------


def score_provider(provider: Provider, requested_services: list[str]) -> Scored:
    """
    Score one provider, in two steps.

    First, drop unknown signals and renormalise over what is left, so a
    provider with no published review score is treated as unknown rather than
    as zero-star. Substituting 0 would say "we know this is bad" when the truth
    is "we do not know", and that bias falls hardest on exactly the small
    independent labs discovery exists to surface.

    Second, scale by how much of the applicable weight was actually observed.
    Renormalising alone is not safe on its own: a provider known only on two
    flattering signals scores near 1.0 and tops the list on almost nothing.
    The first sample run of this file did exactly that -- an unverified
    collection centre outranked an accredited lab because its missing 0.4
    accreditation weight was simply removed from the denominator. The floor of
    0.6 demotes thin evidence without erasing it.

    Signals can be unknown (we looked, nothing there) or not applicable (no
    service filter was requested, so service_match cannot apply to anybody).
    Only the former counts against coverage; the latter leaves the weight
    budget entirely.
    """
    raw: dict[str, float | None] = {
        "accreditation": _accreditation(provider),
        "proximity": _proximity(provider),
        "reviews": _reviews(provider),
    }

    # service_match applies only when the caller asked for something.
    if requested_services:
        raw["service_match"] = _service_match(provider, requested_services)

    signals = [
        Signal(key, WEIGHTS[key], value)
        for key, value in raw.items()
        if value is not None
    ]
    missing = [key for key, value in raw.items() if value is None]

    if not signals:
        # Nothing at all is known. Rank it last rather than pretending to a 0.
        return Scored(provider=provider, score=0.0, signals=[], missing=missing)

    applicable_weight = sum(WEIGHTS[key] for key in raw)
    observed_weight = sum(s.weight for s in signals)

    base = sum(s.contribution for s in signals) / observed_weight
    coverage = observed_weight / applicable_weight
    confidence = 0.6 + 0.4 * coverage

    return Scored(
        provider=provider,
        score=base * confidence,
        signals=signals,
        missing=missing,
        coverage=coverage,
    )


def rank_providers(
    providers: list[Provider],
    area: str | None = None,
    requested_services: list[str] | None = None,
) -> list[Scored]:
    """Filter to the area, score everything, sort, and number the result."""
    requested = [s.strip() for s in (requested_services or []) if s.strip()]

    pool = providers
    if area:
        needle = area.strip().lower()
        pool = [
            p for p in providers
            if p.pincode.lower() == needle or p.city.lower() == needle
        ]

    # A service filter is a filter, not a preference. Somebody asking for an
    # MRI does not want a blood-only collection centre ranked second on the
    # strength of being nearby and well liked. Providers whose service list we
    # simply do not have are kept -- unknown is not the same as no.
    if requested:
        pool = [
            p for p in pool
            if not p.services or any(p.offers(s) for s in requested)
        ]

    scored = [score_provider(p, requested) for p in pool]

    # Ties are broken by distance, then name. Explicit rather than relying on
    # input order, so two runs of the same data never disagree.
    scored.sort(
        key=lambda s: (
            -s.score,
            s.provider.distance_km if s.provider.distance_km is not None else 999.0,
            s.provider.name,
        )
    )

    closest = min(
        (s.provider.distance_km for s in scored if s.provider.distance_km is not None),
        default=None,
    )

    for position, s in enumerate(scored, start=1):
        s.rank = position
        s.explanation = explain(s, requested, closest_km=closest)

    return scored


# --------------------------------------------------------------------------
# Explanations
# --------------------------------------------------------------------------


def explain(scored: Scored, requested: list[str], closest_km: float | None) -> str:
    """
    Build a plain-text reason from the signals that actually moved the score.

    Strengths are listed in order of how much they contributed, so the first
    clause is always the real reason the provider sits where it does.
    """
    p = scored.provider
    strengths: list[tuple[float, str]] = []
    against: list[str] = []

    acc = scored.signal("accreditation")
    if acc is not None:
        if acc.value >= 1.0:
            strengths.append((acc.contribution, "accredited"))
        else:
            against.append("not accredited")

    prox = scored.signal("proximity")
    if prox is not None and p.distance_km is not None:
        if closest_km is not None and p.distance_km == closest_km:
            strengths.append((prox.contribution, f"closest in this area ({p.distance_km} km)"))
        elif prox.value >= 0.6:
            strengths.append((prox.contribution, f"nearby ({p.distance_km} km)"))
        elif prox.value <= 0.35:
            against.append(f"{p.distance_km} km out")

    svc = scored.signal("service_match")
    if svc is not None and requested:
        matched = [s for s in requested if p.offers(s)]
        missed = [s for s in requested if not p.offers(s)]
        if not missed:
            strengths.append(
                (svc.contribution, f"offers everything asked for ({', '.join(matched)})")
            )
        elif matched:
            strengths.append(
                (svc.contribution, f"offers {len(matched)} of {len(requested)} requested")
            )
            against.append(f"no {', '.join(missed)}")
        else:
            against.append(f"offers none of {', '.join(requested)}")

    rev = scored.signal("reviews")
    if rev is not None and p.review_score is not None:
        if rev.value >= 0.86:
            strengths.append((rev.contribution, f"well reviewed ({p.review_score}/5)"))
        elif rev.value <= 0.70:
            against.append(f"modest reviews ({p.review_score}/5)")

    for key in scored.missing:
        if key == "reviews":
            against.append("no review data")
        elif key == "accreditation":
            against.append("accreditation unverified")
        elif key == "service_match" and requested:
            against.append("service list unknown")

    strengths.sort(key=lambda pair: -pair[0])
    phrases = [text for _, text in strengths]

    if phrases:
        head = f"Ranked #{scored.rank} — " + _join(phrases) + "."
    else:
        head = f"Ranked #{scored.rank} — nothing scored in its favour."

    tail = f" Against it: {_join(against)}." if against else ""
    return head + tail


def _join(items: list[str]) -> str:
    """a; a and b; a, b and c."""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f" and {items[-1]}"


# --------------------------------------------------------------------------
# Sample data
# --------------------------------------------------------------------------

# Invented, not scraped. Real businesses are not used here because the
# accreditation and review figures would be made up, and a made-up NABL status
# attached to a real lab is the kind of thing that ends up in a deck.
SAMPLE_PROVIDERS: list[Provider] = [
    Provider(
        name="Koramangala Diagnostics",
        pincode="560034",
        city="Bengaluru",
        address="4th Block, Koramangala, Bengaluru 560034",
        phone="080 4123 5566",
        services=["blood test", "thyroid panel", "ultrasound"],
        accredited=True,
        distance_km=1.8,
        review_score=4.4,
    ),
    Provider(
        name="Southside Imaging Centre",
        pincode="560034",
        city="Bengaluru",
        address="80 Feet Road, Koramangala, Bengaluru 560034",
        phone="080 4998 2210",
        services=["mri", "ct", "x-ray", "ultrasound"],
        accredited=True,
        distance_km=6.2,
        review_score=4.1,
    ),
    Provider(
        name="Ejipura Path Lab",
        pincode="560034",
        city="Bengaluru",
        address="Ejipura Main Road, Bengaluru 560034",
        phone="080 2552 7781",
        services=["blood test", "urine analysis"],
        accredited=False,
        distance_km=2.4,
        review_score=3.6,
    ),
    Provider(
        name="Sarjapur Multispecialty Hospital",
        pincode="560034",
        city="Bengaluru",
        address="Sarjapur Road, Bengaluru 560034",
        phone="080 6677 4400",
        services=["mri", "ct", "blood test", "x-ray", "ecg"],
        accredited=True,
        distance_km=11.5,
        review_score=None,  # no published rating -- deliberately left unknown
    ),
    Provider(
        name="Jyoti Collection Centre",
        pincode="560034",
        city="Bengaluru",
        address="1st Block, Koramangala, Bengaluru 560034",
        phone="080 4110 9034",
        services=["blood test"],
        accredited=None,  # never checked against the registry
        distance_km=0.9,
        review_score=4.8,
    ),
]


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------


def print_results(results: list[Scored], area: str, requested: list[str]) -> None:
    header = f"Providers for {area}"
    if requested:
        header += f"  ·  filtered to: {', '.join(requested)}"
    print(header)
    print("=" * len(header))

    if not results:
        print("\nNothing on file for that area.")
        print("Widen the search, or run `npm run labs:discover -- --pincode <code>`.")
        return

    for s in results:
        p = s.provider
        print(f"\n{s.rank}. {p.name}   [{s.score:.3f}]")
        print(f"   {p.address}")
        print(f"   {p.phone}")
        print(f"   Services: {', '.join(p.services) if p.services else 'unknown'}")
        print(f"   Why: {s.explanation}")
        if s.missing:
            print(f"   Unknown: {', '.join(s.missing)}")

    print(f"\n{len(results)} provider(s). Scores are relative, not absolute.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Rank diagnostic labs and hospitals for a pincode or city."
    )
    parser.add_argument("--area", default="560034", help="pincode or city name")
    parser.add_argument(
        "--services",
        default="",
        help="comma-separated services to require, e.g. 'mri,ct'",
    )
    args = parser.parse_args()

    requested = [s for s in (t.strip() for t in args.services.split(",")) if s]
    results = rank_providers(SAMPLE_PROVIDERS, area=args.area, requested_services=requested)
    print_results(results, args.area, requested)


if __name__ == "__main__":
    main()


# ---------------------------------------------------------------------------
# Sample run
# ---------------------------------------------------------------------------
#
# $ python ranking.py
#
# Providers for 560034
# ====================
#
# 1. Koramangala Diagnostics   [0.940]
#    4th Block, Koramangala, Bengaluru 560034
#    080 4123 5566
#    Services: blood test, thyroid panel, ultrasound
#    Why: Ranked #1 — accredited, nearby (1.8 km) and well reviewed (4.4/5).
#
# 2. Southside Imaging Centre   [0.823]
#    80 Feet Road, Koramangala, Bengaluru 560034
#    080 4998 2210
#    Services: mri, ct, x-ray, ultrasound
#    Why: Ranked #2 — accredited.
#
# 3. Jyoti Collection Centre   [0.756]
#    1st Block, Koramangala, Bengaluru 560034
#    080 4110 9034
#    Services: blood test
#    Why: Ranked #3 — closest in this area (0.9 km) and well reviewed (4.8/5). Against it: accreditation unverified.
#    Unknown: accreditation
#
# 4. Sarjapur Multispecialty Hospital   [0.638]
#    Sarjapur Road, Bengaluru 560034
#    080 6677 4400
#    Services: mri, ct, blood test, x-ray, ecg
#    Why: Ranked #4 — accredited. Against it: 11.5 km out and no review data.
#    Unknown: reviews
#
# 5. Ejipura Path Lab   [0.405]
#    Ejipura Main Road, Bengaluru 560034
#    080 2552 7781
#    Services: blood test, urine analysis
#    Why: Ranked #5 — nearby (2.4 km). Against it: not accredited.
#
# 5 provider(s). Scores are relative, not absolute.
#
# $ python ranking.py --area 560034 --services mri,ct
#
# Providers for 560034  ·  filtered to: mri, ct
# =============================================
#
# 1. Southside Imaging Centre   [0.858]
#    80 Feet Road, Koramangala, Bengaluru 560034
#    080 4998 2210
#    Services: mri, ct, x-ray, ultrasound
#    Why: Ranked #1 — accredited, offers everything asked for (mri, ct) and closest in this area (6.2 km).
#
# 2. Sarjapur Multispecialty Hospital   [0.715]
#    Sarjapur Road, Bengaluru 560034
#    080 6677 4400
#    Services: mri, ct, blood test, x-ray, ecg
#    Why: Ranked #2 — accredited and offers everything asked for (mri, ct). Against it: 11.5 km out and no review data.
#    Unknown: reviews
#
# 2 provider(s). Scores are relative, not absolute.
#
