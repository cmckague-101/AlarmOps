# FedRooms hotels, daily check

Run `bash jobs/fedrooms-hotels/hotelsRun.sh` on the VIPR server and supply the
database URL and monitored contact email. Apply
`supabase/migrations/20261230000100_fedrooms_hotels.sql` first.

Each run loads https://www.gsa.gov/travel/hotels-fedrooms, finds the "full list of
FedRooms properties" XLSX link (its filename changes with each GSA update, e.g.
`Oct26-2026 Accepted PropertiesAC.xlsx`), and downloads it. If the file's SHA-256
matches the last import, the run is recorded as `unchanged` and nothing is written.
Otherwise the hotel list is replaced: new properties are inserted, missing ones are
deleted. Web and mobile both read `public.fedrooms_hotels`.

The XLSX has only name, address, city, state, zip and country, with no property
ID, so each hotel is keyed by a hash of those fields. An address correction shows up
as one removal plus one addition.

A run refuses to remove more than half the stored hotels (a sign of a broken or
reformatted upstream file). Rerun with `--allow-shrink` if the drop is real.

Other options: `--dry-run` (download and parse only), `--force` (import even if
unchanged), `--url URL` (skip page discovery). Run history is in
`public.fedrooms_sync_runs` (backend-only).

Tests:

```
~/.local/share/fireops/fedrooms-venv/bin/python -m pytest jobs/fedrooms-hotels/tests -q
```
