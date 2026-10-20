# Data API grant regression checks

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
