# FedRooms hotels, daily check

Runs unattended as the `fireco-hotels` systemd service on the VIPR server (setup
below). For manual use, run `bash jobs/fedrooms-hotels/hotelsRun.sh` and supply
the database URL and monitored contact email (or set `SUPABASE_DB_URL` and
`FS_USER_AGENT`). Apply `supabase/migrations/20261230000100_fedrooms_hotels.sql`
first.

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

## System service setup (Linux/systemd)

The unit reads the existing `/etc/fireco/vipr.env` (see
`jobs/usfs-dispatch/README.md`) for `SUPABASE_DB_URL` and `FS_USER_AGENT`, so set
that up first. `/etc/fireco/hotels.env` is optional and only needed to override
`FEDROOMS_USER_AGENT` or `FEDROOMS_VENV`; copy `systemd/hotels.env.example` with
mode 600 if you use it. Create the virtualenv as the service user, not root:

```bash
cd /home/ryan/fireco
python3 -m venv "$HOME/.local/share/fireops/fedrooms-venv"
"$HOME/.local/share/fireops/fedrooms-venv/bin/pip" install -r jobs/fedrooms-hotels/requirements.txt
```

Stop any manual `hotelsRun.sh` loop first. Enabling the service runs a sync
immediately (the first one imports all ~12,000 hotels), then every 24 hours:

```bash
sudo install -m 644 jobs/fedrooms-hotels/systemd/fireco-hotels.service /etc/systemd/system/fireco-hotels.service
sudo systemctl daemon-reload
sudo systemctl enable --now fireco-hotels.service
sudo journalctl -u fireco-hotels.service -f
```

After code, dependency or config changes: `sudo systemctl restart fireco-hotels.service`.
Reinstall the unit and `daemon-reload` first if the unit file changed. Sync
failures are logged and retried on the next daily run, not in a tight loop;
`systemctl status` reports runner health, so check the journal for exit codes.

Tests:

```
~/.local/share/fireops/fedrooms-venv/bin/python -m pytest jobs/fedrooms-hotels/tests -q
```
