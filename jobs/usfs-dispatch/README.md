# VIPR daily sync

Run `bash jobs/usfs-dispatch/viprRun.sh` and supply the database URL and monitored
contact email. Restart an already-running loop after changing the script.

The runner now checks **all published lists every run**, without a 50-list cap.
It downloads each distinct PDF fresh once per run (shared agreement PDFs are
reused within that run), and refreshes equipment rows and agreement rates even
when a DPL is unchanged. This detects changes to pricing as well as list content.

The runner uses `--force --recheck-days 1 --fresh-pdfs --cleanup
--retention-days 30`. `--force` avoids a timing edge where a check late in yesterday's
run is not yet 24 hours old at the start of today's run. The sync starts roughly
every 24 hours; if a run exceeds that, the next starts 60 seconds after it finishes.
Keep USDA's request interval enabled. A full refresh may take substantially longer
than the previous capped run; it is a periodic snapshot, not a real-time guarantee.
Web and mobile both read this same Supabase dataset.

## Reading the output

- **Eligible**: total backlog before applying any cap, grouped by processing priority.
- **Selected / deferred / not due**: how much this run covers and what is left.
  The daily runner should report zero deferred and zero not due.
- **DPL / Agreement PDFs**: unique successfully parsed PDFs that are new to the
  database, changed in content, or unchanged, using stored SHA-256 hashes.
  Agreements shared by multiple lists are counted only once. These are content
  checks, not a count of equipment changes or proof that every PDF was written
  successfully; check errors too.
- **PDF reads**: successful downloads versus local cache reuses.
- **Equipment rows written**: all rows replaced for successfully written lists,
  not the number of new PDFs or newly added equipment records.
- **Errors / warnings**: warnings include USDA agreement PDF 404s. A missing
  agreement PDF can mean current pricing was unavailable even if there are no
  errors. Existing stored rates are retained when a download fails, so warnings
  must not be interpreted as proof that all pricing is current.

For manual incremental runs, omit `--force`; `--recheck-days` defaults to seven.
A manual `--limit N` reports the deferred backlog and checks the oldest lists
first within each priority. `--fresh-pdfs` is required to bypass the default
24-hour disk cache. `--dry-run` still downloads/caches files, but does not write
the database or perform cleanup; without a database baseline it cannot identify
which PDFs are actually new or changed.

## Conservative cleanup

Cleanup is opt-in for manual runs and enabled in the daily runner:

1. A complete catalog discovery marks missing lists inactive immediately, hiding
   them from the shared app-facing view. An empty catalog aborts without writes.
2. After a successful full sync **with no errors or warnings**, inactive lists
   unseen for 30 days are deleted, including their equipment rows.
3. Agreement records/rates are deleted only when no retained equipment rows
   reference them and they have not been checked for 30 days.
4. Only managed `dpl-*` / `agreement-*` PDF files and SHA-256 sidecars older than
   30 days in `jobs/usfs-dispatch/data/cache/` are removed. Recent files, unrelated
   files and symlinks are left alone. Old active PDFs can be downloaded again.

Cleanup rejects filtered, capped, metadata-only, incremental-only, and dry runs.
Errors or warnings skip all cleanup, retaining last-known data/files for recovery.
Inactive geographic-area and dispatch-center metadata is retained. There are no
schema migrations or UI changes. Retention is configurable with `--retention-days`;
keep database backups before enabling deletion against production data.

## Targeted tests

```bash
~/.local/share/fireops/usfs-venv/bin/python -m pytest jobs/usfs-dispatch/tests -q
```
