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

Contact information is not collected or stored. Agreement PIID and CLIN remain internal import keys. A rate is matched only when the dispatch row and agreement belong to the same PIID and have the same normalized VIN. Conflicting rates for one VIN are marked ambiguous rather than guessed.

## Schedule and reliability

`.github/workflows/sync-usfs-dispatch.yml` runs daily at 10:17 UTC. New, incomplete, and failed lists run first through normal catalog ordering. Complete lists become eligible for reconciliation every seven days. Each scheduled run is capped at ten lists to limit upstream load; remaining work stays eligible for later runs.

List states are `pending`, `complete`, `partial`, or `failed`. Partial and failed lists retry on later runs. Unexpected empty parser output fails without replacing existing rows. Agreement rates are normalized and joined at read time, preventing copied rates from becoming stale.

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

Manual initial backfills should use small `--limit` values. GitHub workflow failure indicates at least one list or agreement was incomplete and needs review.

## Source notice

> Source: USDA Forest Service VIPR public dispatch and agreement records. Updated on a scheduled basis. FireOps is not affiliated with or endorsed by USDA or the Forest Service. Verify procurement information against the official source.

Before production use, manually review current USDA and VIPR access terms and request a preferred feed or written approval for sustained commercial collection. Honor rate limits, `Retry-After`, access denials, takedown requests, and future `robots.txt` changes. Do not bypass technical controls or publish source PDFs.
