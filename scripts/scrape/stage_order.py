"""
Put a chain CSV into atlas.chain_centre_stage column order.

copy maps CSV columns by position, not by header name, so every chain's CSV
has to present the same columns in the same order as the staging table — one
load command for all four chains. A column a chain doesn't publish is written
empty rather than omitted.

Run this over a CSV before loading it; it is idempotent.
"""

import csv
import sys

STAGE = ["chain", "external_id", "name", "address", "city", "state", "pincode",
         "phone", "whatsapp", "open_hours", "map_link", "latitude", "longitude",
         "source_url", "email"]


def main() -> None:
    for path in sys.argv[1:]:
        rows = list(csv.DictReader(open(path)))
        extra = sorted(set(rows[0]) - set(STAGE)) if rows else []
        if extra:
            sys.exit(f"{path}: columns the staging table has no room for: {extra}")
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=STAGE)
            w.writeheader()
            for r in rows:
                w.writerow({k: (r.get(k) or "") for k in STAGE})
        print(f"{path}: {len(rows)} rows in stage order")


if __name__ == "__main__":
    main()
