"""
Pull the NABL accredited-laboratory directory into one workbook.

The public search at nabl-india.org/lab-accreditation reads a WordPress AJAX
endpoint that returns the whole record per lab — contact, address, geocode,
certificate link and validity — so there is nothing to parse out of HTML.

A nonce is required and is minted per page load; it is passed in rather than
scraped, because the browser already has one. Pages are fetched one at a time
with a pause: 23 requests against a public directory, not a crawl.
"""

import json
import sys
import time
import urllib.parse
import urllib.request

AJAX = "https://nabl-india.org/wp-admin/admin-ajax.php"
PER_PAGE = 500
PAUSE_SECONDS = 1.5


def fetch_page(nonce: str, page: int, seed: str | None) -> dict:
    body = {
        "action": "nabl_labs_frontend_search",
        "nonce": nonce,
        "page": str(page),
        "per_page": str(PER_PAGE),
    }
    # The seed keeps the ordering stable across pages; without it the server is
    # free to reshuffle and a lab can appear twice or not at all.
    if seed:
        body["search_seed"] = seed

    req = urllib.request.Request(
        AJAX,
        data=urllib.parse.urlencode(body).encode(),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            "Referer": "https://nabl-india.org/lab-accreditation/",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        payload = json.loads(r.read().decode())

    if not payload.get("success"):
        raise RuntimeError(f"page {page}: {payload}")
    return payload["data"]


def main() -> None:
    nonce = sys.argv[1]
    out = sys.argv[2]

    first = fetch_page(nonce, 1, None)
    seed = str(first.get("search_seed") or "")
    total, pages = first["total"], first["total_pages"]
    print(f"{total} labs across {pages} pages", flush=True)

    rows = list(first["items"])
    for page in range(2, pages + 1):
        time.sleep(PAUSE_SECONDS)
        data = fetch_page(nonce, page, seed)
        rows.extend(data["items"])
        print(f"  page {page}/{pages} — {len(rows)} rows", flush=True)

    # The endpoint paginates over a live table, so a lab can land on two pages
    # if a row is inserted mid-run. id is the directory's own key.
    seen, unique = set(), []
    for r in rows:
        key = r.get("id") or (r.get("cab_id"), r.get("certificate_no"))
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)

    with open(out, "w") as f:
        json.dump(unique, f)
    print(f"{len(unique)} unique labs written to {out}", flush=True)


if __name__ == "__main__":
    main()
