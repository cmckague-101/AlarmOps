# Database regression checks

## Fleet sync safeguards

```sh
npm run test:db-sync
```

Runs embedded PostgreSQL (PGlite, a development-only dependency) against
`20261109000100_fleet_sync_safeguards.sql`,
`20261110000100_fleet_sync_conflicts.sql`,
`20261111000100_fleet_sync_review.sql`,
`20261112000100_fleet_sync_record_read.sql`,
`20261113000100_fleet_sync_device_history.sql`,
`20261114000100_fleet_sync_history_reads.sql`,
`20261115000100_fleet_sync_history_recovery.sql`, and
`20261116000100_fleet_sync_download.sql`, a minimal auth/company fixture, and
production fleet RLS policies/functions. Checks real grants, RLS, triggers,
transaction rollback, revision fingerprints/tombstones, idempotent receipts,
verified field merges, persistent conflict/provenance records, guarded approvals,
immutable decision history, per-submitter outcomes, dependency acceptance, and
authoritative record/tombstone reads for native reconciliation, and atomic backup
of device-reported rebase versions/choices (including discarded local values).
Device history is not canonical provenance or manager approval. History tests
cover identity/dependency checks, original provenance, exact replay, scoped
read-only audit access, permission revocation, and business/history rollback.
History inspection tests cover scoped summaries/details, retained deleted-record
reports, manager demotion and keyset pagination including tied timestamps and
newer insertions between pages. Full snapshots are fetched one report at a time.
Older-build recovery requires an existing matching submission/hash and never
replays an unknown business operation. Tests verify unchanged newer/deleted
records, pending-review deduplication, actor checks and exact cached retries.
Bulk inventory tests verify raw records/tombstones, same-snapshot scope and
fingerprints, missing/hidden/untracked row denial, entity/tenant isolation,
bounded pagination and invalidation after behind-cursor inserts or ABA edits.
The fingerprint is not a timestamp/sequence high-water mark; real overlapping
transaction/commit-order tests still require separate target-database sessions.

The SQL merge and domain unit tests share
`packages/domain/test-fixtures/offline-sync-merge.json` at the repository root.
The conflict endpoint is currently manager-only and supports vehicle/issue scalar
detail updates, not general fleet command replay. Review/approval supports only
those detail fields; deleted records cannot be restored through this adapter.
The review suite covers stale tokens/new candidates, competing reviewers,
idempotent retries, partial outcomes, outcome privacy, and final-step rollback.
Actual multi-session interleavings still require a target-database test.
No Supabase credentials, application server, or UI are needed.

This is not the full Supabase migration chain or target-version validation.
PGlite uses a single backend and cannot prove multi-session lock/deadlock behavior.
Before deployment, verify the role-creation/ownership migration and concurrent
same-key/competing-write requests against the target Supabase PostgreSQL version.
See `docs/mobile-offline-sync.md` at the repository root for rollout and scope.

## Data API grant regression checks

Run from the repository root:

```sh
npm run test:db-grants
```

These dependency-free static checks model explicit table/column grants with no
Supabase default privileges. They check the original migration path separately
from the forward repair, preserve client restrictions, and require each new table
migration to declare access intent (GRANT or REVOKE) and enable RLS.

This is not a PostgreSQL parser or an RLS integration test. It does not verify live
permissions, role inheritance, function execution privileges, or row policies.

## Deploying the repair

Apply `20261105000100_explicit_data_api_grants.sql` through the project's normal
Supabase migration process. Updated historical migrations support fresh databases;
the new migration supplies missing grants on already-deployed databases. Do not
reset a production database to apply these changes.

After deployment, smoke-test account/company loading, crew invitation/removal,
communication-thread deletion, and Motive access on web/mobile as applicable.
