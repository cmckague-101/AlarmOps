# VIPR weekly refresh, daily discovery

Run `bash jobs/usfs-dispatch/viprRun.sh` and supply the database URL and monitored
contact email. Restart an already-running loop after changing the script.

The runner uses `--weekly --fresh-pdfs --cleanup --retention-days 30`. Web and
mobile both read this same Supabase dataset; no UI changes are needed. Apply
`supabase/migrations/20261223000100_usfs_sync_warnings.sql` before running the
updated importer (adds `last_warning` to priority lists).

## Daily work, rolling seven-day coverage

Every run discovers the **entire published catalog**, so newly published lists
are found daily and missing lists are marked inactive immediately. PDF work is
split into independent buckets:

- **New or renamed lists:** process immediately, in addition to the normal quota.
  A first-ever import with no existing catalog can therefore be a large run.
- **Regular rotation/backfill:** baseline `ceil(total published lists / 7)`, oldest
  successful sync first. For 700 lists this starts at 100 lists per day.
- **Deadline catch-up:** expand the quota to include healthy lists whose previous
  successful sync will expire within the next day. After missed runs or clustered
  previous syncs, this can be substantially larger than the baseline. Pending
  never-successful lists retain backfill capacity even during deadline catch-up.
- **Retries:** separate budget `max(1, ceil(baseline / 4))`, oldest last attempt
  first. For 700 lists this permits up to 25 retries in addition to regular work.
  Persistent failures cannot consume the regular rotation quota.

Selected DPLs and their agreements are fetched fresh, with each distinct PDF
reused within the run. Pricing is checked even if its DPL content is unchanged.
An agreement 404 is stored in `last_warning`, separately from `last_error`.
Warning-only lists count as complete DPL refreshes and recheck missing agreements
on the normal weekly rotation, not the failure queue. This does not mean missing
pricing is current. Prior successful data/rates remain available where possible.
Existing partial records are retried and reclassified only after a fresh parse.

The baseline is **not a hard cap**: new lists, retries and deadline catch-up are
extra. PDF count is selected DPLs plus their distinct referenced agreements, not
equipment row count. Keep USDA's request interval enabled. Runs start roughly
every 24 hours; a run longer than 24 hours is followed by a 60-second pause.
The weekly deadline calculation assumes daily runs. This is a monitored target,
not a guarantee during upstream failures, missed runs or very long runtimes.

## Reading the output

- **Weekly plan:** baseline, selected rotation, deadline catch-up, new/renamed,
  retry budget, and deferred retry/rotation work. Deferred rotation is expected.
- **Weekly coverage before/after:** counts from the database for the current
  catalog. `current_7_days`, `overdue`, and `never_successful` partition the total.
  `never_checked` and `failed_or_partial` are additional overlapping indicators.
  A recent failed attempt does not count as a successful refresh. Neither does a
  list renamed since its last sync. Warning-only 404s count as successful DPL
  refreshes, not proof of current agreement pricing.
- **DPL / Agreement PDFs:** unique successfully parsed PDFs new to the database,
  changed in content, or unchanged, compared with stored SHA-256 hashes.
  These are content checks, not counts of equipment changes or proof every write
  succeeded. Check errors and coverage too.
- **PDF reads:** successful downloads versus cache reuses.
- **Equipment rows written:** rows replaced for successfully written lists,
  not the number of new PDFs or newly added equipment records.
- **Errors / warnings:** current pricing may be unavailable on USDA agreement
  404s. Existing stored rates are retained when a download fails; partial lists
  remain visible but must not be interpreted as fully current. Final error and
  warning summaries repeat every message with its DPL ID for easier diagnosis.

If coverage is incomplete, inspect the failure messages and next day's plan.
To force an exceptional full catch-up, use `--force --fresh-pdfs` **instead of**
`--weekly`. Weekly mode always uses seven days and fresh PDFs, and rejects force,
limit, filters, metadata-only, incremental-only and dry-run combinations.

Without `--weekly`, the existing incremental options still work:
`--recheck-days` defaults to seven; `--limit N` reports the deferred backlog;
`--fresh-pdfs` bypasses the default 24-hour disk cache. `--dry-run` downloads/caches
files but does not write the database or clean up; without a database baseline
it cannot identify which PDFs are actually new or changed.

## Conservative cleanup

Cleanup is opt-in for manual runs and enabled in the daily runner. It requires
successful **full catalog discovery**, not a refresh of every PDF that day:

1. Missing lists are marked inactive immediately, hiding them from the shared
   app-facing view. An empty catalog aborts without writes.
2. After selected work finishes **with no errors**, inactive lists
   unseen for 30 days are deleted, including their equipment rows.
3. Agreement records/rates are deleted only when no retained equipment rows
   reference them and they have not been checked for 30 days. Unprocessed active
   lists and retained inactive lists still protect their referenced agreements.
4. Only managed `dpl-*` / `agreement-*` PDF files and SHA-256 sidecars older than
   30 days in `jobs/usfs-dispatch/data/cache/` are removed. Recent files, unrelated
   files and symlinks are left alone. Old active PDFs can be downloaded again.

Cleanup allows weekly batches and manual capped runs but rejects filtered,
metadata-only, incremental-only and dry runs. Errors skip database cleanup;
confirmed agreement 404 warnings do not. Referenced agreements remain protected.
Inactive geographic-area and dispatch-center metadata is retained. Retention is
configurable with `--retention-days`; keep database backups before deletion.

## Targeted tests

```bash
~/.local/share/fireops/usfs-venv/bin/python -m pytest jobs/usfs-dispatch/tests -q
```
