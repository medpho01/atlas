# Provider network deck

Three 16:9 slides for the monthly all-hands, published as a design canvas.

- `Main.dc.html` — slide 1, serviceability and last-30-days growth by thread
- `Reach.dc.html` — slide 2, metro depth and zonal spread against demand
- `Teleconsult.dc.html` — slide 3, doctor panel by speciality and hour
- `canvas.json` — layout and the two sticky notes

Numbers come from `sql/network-deck-data.sql` and `sql/ppmc-network.sql`, run
against prod on 2 Sep 2026 and pasted in by hand. Nothing here queries the
database — re-running those and editing `renderVals()` is the refresh path.

Everything is on a **serviceability** basis: the pincodes entered against a lab,
union the 20 km catchment of each centre (`analytics.mv_pincode_cv_reach`). That
matches how Atlas's own Overview counts, so the deck and the app agree. An
earlier version used pincodes where an order had actually been fulfilled, which
is a demand-limited proxy and understated reach roughly threefold.

Rows marked `*` are counted at the provider's own location with no travel
radius — a floor, not a reach. Specialised tests and Pharmacy are filled by hand.
