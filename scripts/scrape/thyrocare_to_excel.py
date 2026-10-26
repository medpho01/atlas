"""
Turn the Thyrocare centre list into a workbook.

The brief was to drop the centres that only carry a central switchboard number.
There are none: every one of the 2,311 centres publishes its own ten-digit
mobile, and Thyrocare's central numbers (8657858858, 022 6712 3400, 9870666333)
appear in the site footer, never in a centre record. So nothing is dropped.

What does exist is a weaker version of the same idea — 49 numbers shared by
more than one centre, usually a franchisee running two or three branches. That
is flagged rather than filtered, because a shared number is still a real
franchisee contact.
"""

import csv
import re
import sys
from collections import Counter

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

COLUMNS = [
    ("name", "Centre", 46),
    ("city", "City", 22),
    ("pincode", "Pincode", 11),
    ("address", "Address", 62),
    ("mobile", "Phone", 14),
    ("whatsapp", "WhatsApp", 14),
    ("availability", "Open hours", 30),
    ("shared_with", "Phone shared with", 16),
    ("number_ok", "Number looks valid", 17),
    ("map_link", "Map", 16),
    ("id", "Thyrocare id", 12),
]

HEAD_FILL = PatternFill("solid", fgColor="0F2238")
HEAD_FONT = Font(color="FFFFFF", bold=True, size=11)


def digits(v: str) -> str:
    return re.sub(r"\D", "", v or "")


def write_sheet(wb, title, rows):
    ws = wb.create_sheet(title)
    ws.append([label for _, label, _ in COLUMNS])
    for cell in ws[1]:
        cell.fill = HEAD_FILL
        cell.font = HEAD_FONT
        cell.alignment = Alignment(vertical="center")

    link_col = next(i for i, (k, _, _) in enumerate(COLUMNS, start=1) if k == "map_link")

    for r in rows:
        ws.append([r.get(k, "") for k, _, _ in COLUMNS])
        cell = ws.cell(row=ws.max_row, column=link_col)
        if cell.value:
            cell.hyperlink = str(cell.value)
            cell.value = "Open map"
            cell.font = Font(color="1155CC", underline="single")

    for i, (_, _, width) in enumerate(COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNS))}{ws.max_row}"
    ws.row_dimensions[1].height = 24
    return ws


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    rows = list(csv.DictReader(open(src)))

    counts = Counter(digits(r["mobile"]) for r in rows)
    for r in rows:
        d = digits(r["mobile"])
        r["shared_with"] = counts[d] if counts[d] > 1 else ""
        r["number_ok"] = "yes" if len(d) == 10 and d[0] in "6789" else "check"

    rows.sort(key=lambda r: ((r.get("city") or "").title(), r.get("name") or ""))
    shared = [r for r in rows if r["shared_with"]]

    wb = Workbook()
    wb.remove(wb.active)

    s = wb.create_sheet("Summary")
    s.append(["Thyrocare franchisee network"])
    s["A1"].font = Font(bold=True, size=14)
    s.append([])
    s.append(["Source", "thyrocare.com/location (Labs Near Me)"])
    s.append(["Pulled", __import__("datetime").date.today().isoformat()])
    s.append(["Centres", len(rows)])
    s.append(["Distinct phone numbers", len(counts)])
    s.append(["Centres on a central number", 0])
    s.append(["Centres sharing a number with another", len(shared)])
    s.append(["Numbers that are not a 10-digit mobile", sum(1 for r in rows if r["number_ok"] != "yes")])
    s.append([])
    s.append(["Note", "Thyrocare's central numbers (8657858858, 022 6712 3400, 9870666333) "
                      "appear only in the site footer. No centre record carries one, so no "
                      "centre was dropped."])
    s.append([])
    s.append(["Top cities", "Centres"])
    for city, n in Counter((r.get("city") or "—").title() for r in rows).most_common(20):
        s.append([city, n])
    s.column_dimensions["A"].width = 44
    s.column_dimensions["B"].width = 60

    write_sheet(wb, "All centres", rows)
    write_sheet(wb, "Shared numbers", shared)

    wb.save(out)
    print(f"{out}: {len(rows)} centres, {len(shared)} sharing a number")


if __name__ == "__main__":
    main()
