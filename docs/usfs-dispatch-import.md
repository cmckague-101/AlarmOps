# USFS dispatch data import

FireOps reads scheduled USDA Forest Service VIPR dispatch-list data from Supabase. Web and mobile clients never download or parse source PDFs.

## Data shown

Dispatch results expose only:

- rank;
- company name;
- equipment location;
- VIN;
- CAFS;
- VIN-matched daily rate from the agreement Schedule of Items.

Contact information is not collected or stored. Agreement PIID and CLIN remain internal import keys. A rate is matched only when the dispatch row and agreement belong to the same PIID and have the same normalized equipment identifier. Award PDFs may label that identifier `VIN`, `Serial Number`, or `Unique ID`; DPL PDFs place all forms in their VIN column. Only items with `Status Awarded` (or legacy items without a status) are imported. Conflicting rates for one identifier are marked ambiguous rather than guessed.

## Schedule and reliability

`.github/workflows/sync-usfs-dispatch.yml` runs Mondays at 09:00 UTC in `new-only` mode (`--incremental-only`). USDA list names carry a revision date, so a republished list appears with a new ID or name and is processed as new; unchanged complete lists are skipped and lists no longer published are marked inactive. Do not also run the systemd/cron runner. Set repository secrets `FS_USER_AGENT` and either `SUPABASE_DB_URL` or `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

Manual runs offer three modes:

- `new-only`: same as the schedule.
- `refresh`: new lists first, then rechecks lists older than 28 days up to `limit` (default 200), and runs cleanup. Use occasionally to catch PDFs replaced without a name change and to delete long-inactive data.
- `full`: `--force --fresh-pdfs --cleanup`, reprocessing every list. Allowed up to 6 hours; other modes are capped at 90 minutes to stay within the private-repo Actions allowance (2,000 minutes/month).

Incremental mode discovers the full catalog, then processes lists in this order: new or metadata-changed, partial or failed, then pending, then (without `--incremental-only`) complete lists due for recheck.

List states are `pending`, `complete`, `partial`, or `failed`. Partial and failed lists retry on later runs. A confirmed USDA agreement-PDF 404 is stored as a warning on a complete DPL, with affected rates exposed as `not_found`; it does not consume a retry slot forever. Other upstream, network, and parser errors remain retryable. Unexpected empty parser output fails without replacing existing rows. Agreement rates are normalized and joined at read time, preventing copied rates from becoming stale.

Run initial backfill locally in controlled batches without `--incremental-only`:

```bash
python jobs/usfs-dispatch/sync_supabase.py --limit 50
```

Run complete-list reconciliation manually when needed:

```bash
python jobs/usfs-dispatch/sync_supabase.py --limit 50 --recheck-days 30
```

USDA metadata exposes IDs and names, not a dependable content-modified timestamp. Incremental mode detects new IDs and changed names; silent replacement of a PDF under the same metadata requires reconciliation.

## Setup

Apply `supabase/migrations/20261031000100_usfs_dispatch_data.sql`. Add repository secrets:

- `SUPABASE_DB_URL`: server-side Supabase Postgres session/pooler URL;
- `FS_USER_AGENT`: `FireOps/<version> (<monitored email>)`.

Never expose either value to web or mobile clients.

Run parser tests:

```bash
python -m pip install -r jobs/usfs-dispatch/requirements.txt
pytest jobs/usfs-dispatch/tests
```

Safe targeted network test without database writes:

```bash
FS_USER_AGENT='FireOps/dev (ops@example.com)' \
python jobs/usfs-dispatch/sync_supabase.py \
  --dry-run --area-id 2 --center-id 14 --file-id 13105
```

Manual initial backfills should use small `--limit` values. GitHub workflow failure indicates at least one list or agreement was incomplete and needs review. Manual workflow runs reconcile eligible complete lists by default; select `incremental_only` to reproduce scheduled behavior.

## Source notice

> Source: USDA Forest Service VIPR public dispatch and agreement records. Updated on a scheduled basis. FireOps is not affiliated with or endorsed by USDA or the Forest Service. Verify procurement information against the official source.

Before production use, manually review current USDA and VIPR access terms and request a preferred feed or written approval for sustained commercial collection. Honor rate limits, `Retry-After`, access denials, takedown requests, and future `robots.txt` changes. Do not bypass technical controls or publish source PDFs.
