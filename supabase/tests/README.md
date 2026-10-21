# Database regression checks

## Fleet sync safeguards

```sh
npm run test:db-sync
```

Runs embedded PostgreSQL (PGlite, a development-only dependency) against
`20261109000100_fleet_sync_safeguards.sql`, a minimal auth/company fixture, and
production fleet RLS policies/functions. Checks real grants, RLS, triggers,
transaction rollback, revision fingerprints/tombstones, and idempotent receipts.
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
