# Scrapers

The pulls behind two Directory screens: `/nabl` (the NABL register) and
`/franchisees` (the diagnostic chains' collection centres). They are here
rather than in a notebook because every one of these sources changes shape
without notice, and the next person to refresh one needs to see how the last
pull read it.

Each script is standalone — no imports beyond the standard library except the
two `*_to_excel.py`, which need `openpyxl` — and each writes a CSV in
`atlas.*_stage` column order, ready for the `\copy` in the matching runbook.

| Script | Source | Output |
|---|---|---|
| `nabl.py` | `nabl-india.org`'s `nabl_labs_frontend_search` AJAX endpoint, 23 requests | the NABL register, 11,142 labs |
| `pathkind.py` | `nearby.pathkindlabs.com/location/<state>`, paginated | Pathkind's centres |
| `redcliffe.py` | `app.redcliffelabs.com/api/v1/sample/labccs/`, nine per page | Redcliffe's centres |
| `stage_order.py` | — | rewrites any chain CSV into staging-table column order |

Thyrocare and Metropolis were pulled in-browser, because both block plain
`curl`; `thyrocare_to_excel.py` and `nabl_to_excel.py` turn a pulled CSV into
the workbook that gets shared outside Atlas.

Two things to know before refreshing anything:

- **`\copy` maps columns by position, not by header name.** Run
  `stage_order.py` over a CSV before loading it.
- **Pagination is where these pulls go wrong.** Pathkind serves `?page=0` and
  `?page=1` as the same page, so "stop when a page adds nothing new" ends every
  state after one page and quietly returns a tenth of the network. Stop on an
  empty page instead.

Run them with `-I` — these scripts sit next to downloaded data, and `-I` keeps
the interpreter from importing anything out of the working directory:

```bash
python3 -I scripts/scrape/pathkind.py sql/reports/chain-centres-pathkind.csv
python3 -I scripts/scrape/stage_order.py sql/reports/chain-centres-pathkind.csv
```

See `docs/RUNBOOK-franchisees.md` and `docs/RUNBOOK-nabl.md` for what each
chain actually publishes and how to load it.
