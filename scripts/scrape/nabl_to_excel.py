"""
Turn the raw NABL pull into a workbook meant to be read and then loaded.

Three sheets: every lab, the medical ones on their own because that is the
sheet Atlas cares about, and a summary that makes the shape of the data
obvious before anybody trusts it.

Columns are ordered the way somebody reads a lab record — who it is, where it
is, how to reach it, what it is accredited for, and the certificate — not the
order the API happens to return.
"""

import json
import sys
from collections import Counter

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

COLUMNS = [
    ("cab_name", "Lab name", 46),
    ("cab_id", "CAB ID", 12),
    ("certificate_no", "Certificate no", 16),
    ("field", "Field", 14),
    ("application_status", "Accreditation status", 40),
    ("validity", "Certificate validity", 24),
    ("certificate_link", "NABL certificate", 20),
    ("contact_name", "Contact person", 26),
    ("phone", "Phone", 16),
    ("email", "Email", 32),
    ("address", "Address", 46),
    ("city", "City", 18),
    ("state", "State", 20),
    ("pincode", "Pincode", 10),
    ("country", "Country", 12),
    ("latitude", "Latitude", 12),
    ("longitude", "Longitude", 12),
    ("discipline", "Discipline", 40),
    ("groupname", "Group", 34),
    ("subgroup", "Subgroup", 40),
    ("permanent_facility", "Permanent facility", 16),
    ("site_facility", "Site facility", 13),
    ("mobile_facility", "Mobile facility", 14),
    ("type_of_cab", "Application type", 26),
    ("integrated_lab", "Integrated lab", 14),
    ("last_updated_date", "NABL last updated", 20),
    ("id", "NABL row id", 12),
]

HEAD_FILL = PatternFill("solid", fgColor="0F2238")
HEAD_FONT = Font(color="FFFFFF", bold=True, size=11)


def write_sheet(wb, title, rows):
    ws = wb.create_sheet(title)
    ws.append([label for _, label, _ in COLUMNS])

    for cell in ws[1]:
        cell.fill = HEAD_FILL
        cell.font = HEAD_FONT
        cell.alignment = Alignment(vertical="center")

    link_col = next(i for i, (k, _, _) in enumerate(COLUMNS, start=1)
                    if k == "certificate_link")

    for r in rows:
        ws.append([(r.get(key) or "") for key, _, _ in COLUMNS])
        # The certificate column is the point of the sheet, so it is a real
        # hyperlink rather than text somebody has to copy out. The page it
        # opens carries both PDFs: the certificate and the scope.
        cell = ws.cell(row=ws.max_row, column=link_col)
        value = str(cell.value or "")
        if value.startswith("https://nablwp.qci.org.in/"):
            cell.hyperlink = value
            cell.value = "Open certificate"
            cell.font = Font(color="1155CC", underline="single")
        elif value:
            # NABL holds a bare filename for a few dozen labs; the URL it
            # implies serves an error page, so it is shown rather than linked.
            cell.value = "No working link"
            cell.font = Font(color="B5651D")

    for i, (_, _, width) in enumerate(COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNS))}{ws.max_row}"
    ws.row_dimensions[1].height = 24
    return ws


def main() -> None:
    raw, out = sys.argv[1], sys.argv[2]
    labs = json.load(open(raw))

    # Newest accreditation first where a date exists, then alphabetical: a
    # stable order so two pulls can be diffed.
    labs.sort(key=lambda r: ((r.get("state") or ""), (r.get("city") or ""),
                             (r.get("cab_name") or "")))

    medical = [r for r in labs if (r.get("field") or "").strip().lower() == "medical"]

    wb = Workbook()
    wb.remove(wb.active)

    summary = wb.create_sheet("Summary")
    summary.append(["NABL accredited laboratories"])
    summary["A1"].font = Font(bold=True, size=14)
    summary.append([])
    summary.append(["Source", "nabl-india.org/lab-accreditation (public directory search)"])
    summary.append(["Pulled", __import__("datetime").date.today().isoformat()])
    summary.append(["Total labs", len(labs)])
    summary.append(["Medical labs", len(medical)])
    summary.append(["With an email", sum(1 for r in labs if (r.get("email") or "").strip())])
    summary.append(["With a phone", sum(1 for r in labs if (r.get("phone") or "").strip())])
    summary.append(["With coordinates", sum(1 for r in labs if (r.get("latitude") or "").strip())])
    summary.append([])

    summary.append(["By field", "Labs"])
    for field, n in Counter((r.get("field") or "—") for r in labs).most_common():
        summary.append([field, n])
    summary.append([])

    summary.append(["Top states", "Labs", "of which medical"])
    med_by_state = Counter((r.get("state") or "—") for r in medical)
    for state, n in Counter((r.get("state") or "—") for r in labs).most_common(15):
        summary.append([state, n, med_by_state.get(state, 0)])

    summary.column_dimensions["A"].width = 46
    summary.column_dimensions["B"].width = 16
    summary.column_dimensions["C"].width = 18

    write_sheet(wb, "All labs", labs)
    write_sheet(wb, "Medical labs", medical)

    wb.save(out)
    print(f"{out}: {len(labs)} labs, {len(medical)} medical")


if __name__ == "__main__":
    main()
