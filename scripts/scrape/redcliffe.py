"""
Redcliffe's collection centres, from its own register.

app.redcliffelabs.com/api/v1/sample/labccs/ pages the whole network nine at a
time — page_size is fixed, so it is ~144 requests — and each record carries
lab_address, contact_number, the franchisee's operations email, a map link, coordinates and opening hours.

The address is one free-text line ending "<city>, <state abbrev> - <pincode>",
so city, state and pincode are pulled out of its tail. Where the tail doesn't
parse, the fields are left blank and atlas.fill_chain_centre_states() fills the
state from the city later.

The API starts refusing after a burst, hence the deliberate pace and the retry.
"""

import csv
import json
import re
import sys
import time
import urllib.error
import urllib.request

API = "https://app.redcliffelabs.com/api/v1/sample/labccs/?page="
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")
PAUSE = 1.6

STATES = {
    "UP": "Uttar Pradesh", "MP": "Madhya Pradesh", "AP": "Andhra Pradesh",
    "HP": "Himachal Pradesh", "UK": "Uttarakhand", "UA": "Uttarakhand",
    "WB": "West Bengal", "TN": "Tamil Nadu", "KA": "Karnataka", "KL": "Kerala",
    "MH": "Maharashtra", "GJ": "Gujarat", "RJ": "Rajasthan", "PB": "Punjab",
    "HR": "Haryana", "BR": "Bihar", "JH": "Jharkhand", "OD": "Odisha",
    "OR": "Odisha", "CG": "Chhattisgarh", "AS": "Assam", "TS": "Telangana",
    "TG": "Telangana", "DL": "Delhi", "GA": "Goa", "CH": "Chandigarh",
    "JK": "Jammu and Kashmir", "TR": "Tripura", "ML": "Meghalaya",
    "MN": "Manipur", "MZ": "Mizoram", "NL": "Nagaland", "SK": "Sikkim",
    "AR": "Arunachal Pradesh", "PY": "Puducherry",
}

# Whatever is parsed out of the tail of an address has to be a real state, or
# it is thrown away. Redcliffe's addresses are hand-typed and plenty of them
# end in a locality, a district or the rest of the street — "Chandivali
# Andheri East Mumbai" is not a state, and a city-shaped value in the state
# column breaks the state filter more quietly than a blank does.
INDIAN_STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
    "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim",
    "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
    "West Bengal", "Andaman and Nicobar Islands", "Chandigarh", "Delhi",
    "Dadra and Nagar Haveli and Daman and Diu", "Jammu and Kashmir", "Ladakh",
    "Lakshadweep", "Puducherry",
]


# "4-Himachal Pradesh" and "HIMACHAL PRADESH" are both Himachal Pradesh, so
# names are compared with everything but the letters removed.
CANON = {re.sub(r"[^a-z]", "", s.lower()): s for s in INDIAN_STATES}


def clean_state(value: str) -> str:
    """A state name, or nothing."""
    v = re.sub(r"\s+", " ", (value or "")).strip().strip("-,. ")
    if not v:
        return ""
    canon = CANON.get(re.sub(r"[^a-z]", "", v.lower()))
    if canon:
        return canon
    return STATES.get(re.sub(r"[^A-Z]", "", v.upper()), "")


def fetch(page: int) -> dict:
    req = urllib.request.Request(API + str(page),
                                 headers={"User-Agent": UA, "Accept": "application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            wait = 5 * (attempt + 1)
            print(f"  ! page {page}: {e} — retrying in {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"page {page} would not answer")


def split_tail(address: str):
    """city, state, pincode out of "..., Azamgarh, UP - 276001"."""
    a = re.sub(r"\s+", " ", address or "").strip()
    parts = [p.strip() for p in a.split(",") if p.strip()]
    city = state = pin = ""

    tail = parts[-1] if parts else ""
    m = re.match(r"^(.*?)[\s-]*[-–]\s*(\d{6})$", tail)
    if m:
        state = m.group(1).strip().strip("-").strip()
        pin = m.group(2)
        city = parts[-2] if len(parts) > 1 else ""
    else:
        m = re.search(r"\b(\d{6})\b", a)
        pin = m.group(1) if m else ""
        # "Azamgarh, UP 276001" — same shape, no dash.
        m2 = re.match(r"^([A-Za-z .&]+?)\s*\d{6}$", tail)
        if m2:
            state = m2.group(1).strip()
            city = parts[-2] if len(parts) > 1 else ""

    return city.title(), clean_state(state), pin


def hours(extra: dict) -> str:
    """One line like "07:00-20:00 daily" when every day is the same."""
    rows = (extra or {}).get("regular_hours") or []
    spans = set()
    for r in rows:
        o, c = r.get("openTime") or {}, r.get("closeTime") or {}
        if o.get("hours") is None or c.get("hours") is None:
            continue
        spans.add(f"{o['hours']:02d}:{o.get('minutes') or 0:02d}-"
                  f"{c['hours']:02d}:{c.get('minutes') or 0:02d}")
    if len(spans) == 1 and len(rows) >= 7:
        return f"{spans.pop()} daily"
    return "; ".join(sorted(spans))


def main() -> None:
    out_path = sys.argv[1]
    first = fetch(1)
    total = first.get("count") or 0
    per = len(first.get("results") or []) or 9
    pages = -(-total // per)
    print(f"{total} centres, {per} per page, {pages} pages", flush=True)

    rows, page = {}, 1
    while page <= pages:
        d = first if page == 1 else fetch(page)
        for r in (d.get("results") or []):
            area = r.get("area") or {}
            # The common shape's `address`, else the rarer shape's `lab_address`.
            addr = re.sub(r"\s+", " ", (r.get("address") or r.get("lab_address") or "")).strip()
            city, state, pin = split_tail(addr)
            name = (r.get("name") or r.get("display_name") or r.get("public_key") or "").strip()
            rows[str(r.get("id"))] = {
                "chain": "Redcliffe",
                "external_id": str(r.get("id")),
                "name": "Redcliffe Labs — " + (name or city or "Collection centre"),
                "address": addr,
                # Structured fields beat anything parsed out of the address.
                "city": ((r.get("city") or {}).get("name") or area.get("city_name")
                         or city or "").strip().title(),
                "state": clean_state(area.get("state") or state),
                "pincode": (area.get("pincode") or pin or "").strip(),
                "phone": re.sub(r"\s+", "", r.get("contact_number") or ""),
                "whatsapp": "",
                "email": (r.get("email") or "").strip().lower(),
                "open_hours": hours(r.get("extra_details")),
                "map_link": r.get("google_map") or r.get("admin") or "",
                "latitude": r.get("latitude") or "",
                "longitude": r.get("longitude") or "",
                "source_url": "https://redcliffelabs.com/lab-centre-network",
            }
        if page % 20 == 0:
            print(f"  page {page}/{pages} — {len(rows)} centres", flush=True)
        page += 1
        time.sleep(PAUSE)

    cols = list(next(iter(rows.values())).keys())
    with open(out_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in sorted(rows.values(), key=lambda r: (r["state"], r["city"], r["name"])):
            w.writerow(r)

    def filled(k):
        return sum(1 for r in rows.values() if (r.get(k) or "").strip())
    print(f"{len(rows)} centres → {out_path}")
    for k in ("address", "city", "state", "pincode", "phone", "email", "map_link"):
        print(f"  {k}: {filled(k)}")


if __name__ == "__main__":
    main()
