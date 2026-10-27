"""
Agilus Diagnostics' centres, from its store locator.

labs.agilusdiagnostics.com runs on the same SingleInterface platform as
Pathkind's locator, but exposes its network differently: a flat index at
?page=1..N, six centres per page, each card carrying everything we need —
name, address lines, pincode, city, state, coordinates, opening hours, phone
and Agilus's own outlet id in the centre URL. So this never fetches a centre
page; 182 index pages is the whole crawl.

Two things worth knowing:

The phone numbers are call-tracking lines (+9180372…, +9180378…), not the
franchisee's own mobile. They do reach the centre, but they route through
Agilus, so they are a switchboard with extra steps rather than a direct
contact.

The locator has a COCO/FOFO filter — company-owned versus franchise-owned —
which would be exactly the split we care about, but it only applies through
the form's POST; passing cot[] on the query string changes nothing. So every
centre is pulled and the distinction is not recorded.
"""

import csv
import re
import sys
import time
import urllib.request

ROOT = "https://labs.agilusdiagnostics.com/"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")
PAUSE = 0.4
MAX_PAGES = 400


def get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            if attempt == 3:
                raise
            print(f"  ! {url}: {e} — retrying", flush=True)
            time.sleep(4 * (attempt + 1))


def strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)).strip()


def attr(block: str, name: str) -> str:
    m = re.search(name + r'="([^"]*)"', block)
    return (m.group(1) if m else "").strip()


def cards(html: str):
    """One block per centre: the locator wraps each in a store-info-box."""
    parts = html.split('class="store-info-box"')[1:]
    for p in parts:
        yield p.split('class="store-info-box"')[0]


def parse(block: str):
    m = re.search(r'href="(https://labs\.agilusdiagnostics\.com/([a-z0-9-]+)-(\d+)/Home)"', block)
    if not m:
        return None
    url, slug, outlet_id = m.group(1), m.group(2), m.group(3)

    name = attr(block, "data-track-event-business-name")
    display = ""
    dm = re.search(r'data-track-event-eacsi="[^"]*"[^>]*>\s*([^<]+?)\s*</a>', block)
    if dm:
        display = re.sub(r"\s+", " ", dm.group(1)).strip()

    addr = ""
    am = re.search(r'class="info-address">(.*?)</div>', block, re.S)
    if am:
        # The address is a run of spans with <br> between the lines.
        addr = strip_tags(am.group(1).replace("<br>", "|"))
        parts, seen_part = [], set()
        for part in (p.strip(" ,") for p in addr.split("|")):
            key = re.sub(r"[^a-z0-9]", "", part.lower())
            if part and key not in seen_part:
                seen_part.add(key)
                parts.append(part)
        addr = re.sub(r"\s+-\s+(\d{6})$", r" - \1", ", ".join(parts))

    hours = ""
    hm = re.search(r'class="outlet-timings".*?class="info-text">(.*?)</div>', block, re.S)
    if hm:
        hours = strip_tags(hm.group(1))

    tel = ""
    tm = re.search(r'href="tel:([^"]+)"', block)
    if tm:
        tel = tm.group(1).strip()

    pin = ""
    pm = re.search(r"\b([1-9]\d{5})\b", addr)
    if pm:
        pin = pm.group(1)

    return {
        "chain": "Agilus",
        "external_id": outlet_id,
        "name": display or name or ("Agilus Diagnostics — " + slug.replace("-", " ").title()),
        "address": addr,
        "city": attr(block, "data-track-event-city"),
        "state": attr(block, "data-track-event-state"),
        "pincode": pin,
        "phone": tel,
        "whatsapp": "",
        "open_hours": hours,
        "map_link": "",
        "latitude": attr(block, 'class="outlet-latitude" value'),
        "longitude": attr(block, 'class="outlet-longitude" value'),
        "source_url": url,
        "email": "",
    }


def main() -> None:
    out_path = sys.argv[1]
    first = get(ROOT)
    pages = max((int(x) for x in re.findall(r"[?&]page=(\d+)", first)), default=1)
    print(f"{pages} index pages", flush=True)

    seen = {}
    for page in range(1, min(pages, MAX_PAGES) + 1):
        html = first if page == 1 else get(f"{ROOT}?page={page}")
        found = 0
        for block in cards(html):
            rec = parse(block)
            if rec:
                seen[rec["external_id"]] = rec
                found += 1
        if found == 0:
            print(f"  page {page}: no centres — stopping", flush=True)
            break
        if page % 25 == 0:
            print(f"  page {page}/{pages} — {len(seen)} centres", flush=True)
        time.sleep(PAUSE)

    cols = ["chain", "external_id", "name", "address", "city", "state", "pincode",
            "phone", "whatsapp", "open_hours", "map_link", "latitude", "longitude",
            "source_url", "email"]
    with open(out_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in sorted(seen.values(), key=lambda r: (r["state"], r["city"], r["name"])):
            w.writerow(r)

    def filled(k):
        return sum(1 for r in seen.values() if (r.get(k) or "").strip())
    print(f"\n{len(seen)} centres → {out_path}")
    for k in ("name", "address", "city", "state", "pincode", "phone", "latitude", "open_hours"):
        print(f"  {k}: {filled(k)}")


if __name__ == "__main__":
    main()
