"""
Pathkind's centres, from the locator's own state directory.

nearby.pathkindlabs.com publishes /location/<state>, paginated, and every page
carries one JSON-LD MedicalBusiness per centre: name, telephone, full street
address, locality, region and coordinates. The centre URL ends in Pathkind's
own id (…-surajkund-faridabad-37504/home), so centres key on that rather than
on a hash — a renamed or re-addressed centre stays the same row.

Walking the state directory rather than sweeping city searches means no radius
overlap, no de-duplication guesswork, and a page count the site itself tells us.
The main site is bot-protected; this subdomain is not, so it all runs from the
shell.
"""

import csv
import json
import re
import sys
import time
import urllib.request

ROOT = "https://nearby.pathkindlabs.com"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")
PAUSE = 0.4
# A state stops when a page adds nothing new; this is the belt-and-braces cap.
MAX_PAGES = 120


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read().decode("utf-8", "replace")


def states(home: str):
    return sorted(set(re.findall(r'href="' + ROOT + r'/location/([a-z0-9-]+)"', home)))


def centres_on(html: str):
    """Every MedicalBusiness in the page's JSON-LD."""
    out = []
    for block in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', html, re.S):
        try:
            doc = json.loads(block)
        except Exception:
            continue
        for g in (doc.get("@graph") or [doc]):
            if "MedicalBusiness" not in str(g.get("@type", "")):
                continue
            url = g.get("url") or ""
            m = re.search(r'/pathkind-labs-([a-z0-9-]+?)-(\d+)/home', url)
            if not m:
                continue
            addr = g.get("address") or {}
            geo = g.get("geo") or {}
            street = re.sub(r"\s+", " ", (addr.get("streetAddress") or "")).strip()
            out.append({
                "external_id": m.group(2),
                # The slug is "<locality>-<city>"; the city is already its own
                # column, so the name reads "Pathkind Labs — Surajkund".
                "slug": m.group(1),
                "address": street,
                "city": (addr.get("addressLocality") or "").strip(),
                "state": (addr.get("addressRegion") or "").strip(),
                "phone": re.sub(r"\s+", " ", (g.get("telephone") or "")).strip(),
                "latitude": geo.get("latitude") or "",
                "longitude": geo.get("longitude") or "",
                "source_url": url,
            })
    return out


def area_from(slug: str, city: str) -> str:
    """Drop the city suffix the slug repeats, and title-case the locality."""
    words = slug.split("-")
    city_words = [w for w in re.split(r"[\s-]+", city.lower()) if w]
    while city_words and len(words) > len(city_words) and \
            [w.lower() for w in words[-len(city_words):]] == city_words:
        words = words[:-len(city_words)]
    return " ".join(w.capitalize() for w in words) or city


def main() -> None:
    out_path = sys.argv[1]
    home = get(ROOT + "/")
    st = states(home)
    print(f"{len(st)} states", flush=True)

    seen = {}
    for name in st:
        before = len(seen)
        # Pages are 1-based and ?page=0 is an alias for the first page, so a
        # repeated page is not the end of the state — an empty one is.
        for page in range(1, MAX_PAGES):
            url = f"{ROOT}/location/{name}?page={page}"
            try:
                found = centres_on(get(url))
            except Exception as e:
                print(f"  ! {name} page {page}: {e}", flush=True)
                break
            for c in found:
                seen[c["external_id"]] = c
            time.sleep(PAUSE)
            if not found:
                break
        print(f"  {name}: +{len(seen) - before} (total {len(seen)})", flush=True)

    cols = ["chain", "external_id", "name", "address", "city", "state", "pincode",
            "phone", "whatsapp", "open_hours", "map_link", "latitude", "longitude",
            "source_url"]
    with open(out_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for c in sorted(seen.values(), key=lambda c: (c["state"], c["city"], c["slug"])):
            pin = (re.search(r"\b(\d{6})\b", c["address"]) or [None, ""])[1]
            w.writerow({
                "chain": "Pathkind",
                "external_id": c["external_id"],
                "name": "Pathkind Labs — " + area_from(c["slug"], c["city"]),
                "address": c["address"], "city": c["city"], "state": c["state"],
                "pincode": pin, "phone": c["phone"], "whatsapp": "", "open_hours": "",
                "map_link": "", "latitude": c["latitude"], "longitude": c["longitude"],
                "source_url": c["source_url"],
            })
    print(f"{len(seen)} centres → {out_path}")


if __name__ == "__main__":
    main()
