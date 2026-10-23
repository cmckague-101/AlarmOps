# Offline sync deployment runbook

Deploys the offline sync migrations (`20261109000100` … `20261221000100`, 43 files) and the Edge Functions they need to the linked production project (`pkfwlhtihudagxxyqyyg`). Nothing here was run by the implementation. The ordered list with per-migration notes is in `docs/mobile-offline-sync.md` → *Deployment checkpoint*.

Commands use `npx supabase` (no global CLI needed). Run them from the repository root.

## 0. Before the day

1. **Rehearse locally first** (Docker required; touches only your machine):
   ```sh
   npx supabase start
   npx supabase db reset          # LOCAL ONLY: rebuilds the local database from every migration
   npm run test:db-sync
   npx supabase stop
   ```
   `db reset` must finish without errors on the real Postgres version Supabase uses. Never run `db reset` with `--linked`.
2. **Plan a low-traffic window.** Two migrations change what old clients may do:
   - `20261130000100`: old dashboard-layout saves (whole-layout upserts) are denied.
   - `20261201000100`: old direct availability writes are denied.

   The web app in this repo already uses the new endpoints, so deploy it right after the database. Installed phones on older builds lose dashboard-layout and availability saving until they update. Plan the store builds (step 7) for the same day.
3. Make sure the repository is clean and the tests pass:
   ```sh
   git status
   npm run typecheck
   node --test supabase/tests/*.test.mjs
   ```

## 1. Log in and link

```sh
npx supabase login
npx supabase link --project-ref pkfwlhtihudagxxyqyyg
```

## 2. Back up production

1. **Dashboard:** Project → Database → Backups. Confirm a recent daily backup exists; take a manual one if your plan allows. If Point-in-Time Recovery is enabled, write down the exact time (UTC) just before step 4.
2. **Local dumps** (keep them **outside the repository**; they contain customer data):
   ```sh
   TS=$(date -u +%Y%m%dT%H%M%SZ); B=~/fireops-backups/$TS; mkdir -p "$B"
   npx supabase db dump --linked --role-only -f "$B/roles.sql"
   npx supabase db dump --linked -f "$B/schema.sql"
   npx supabase db dump --linked --data-only --use-copy -f "$B/data.sql"
   npx supabase db dump --linked --data-only --schema supabase_migrations -f "$B/migration-history.sql"
   ls -lh "$B"
   ```
   Check that every file is non-empty. Storage file bytes are not in these dumps. None of these migrations deletes storage objects, but the dashboard backup is the only copy of the files.

## 3. Check what is pending

```sh
npx supabase migration list --linked
```
- **Remote** must show nothing from `20261109000100` onwards. If any of those is already applied remotely, **stop**: some undeployed files were edited in place during implementation, so the remote copy may differ.
- Note any **earlier** local migrations that are not applied remotely. They are "earlier project prerequisites" and will be applied first, in order.

Then preview without changing anything:
```sh
npx supabase db push --linked --dry-run
```
The list must be exactly the pending files in timestamp order. If the CLI says local migrations are older than the last remote one and suggests `--include-all`, stop and check why before using it.

## 4. Apply the migrations

```sh
npx supabase db push --linked
```
Confirm the prompt. Each file runs in its own transaction. If one fails, the push stops there: earlier files stay applied and the failing one is rolled back. Do **not** edit or re-run applied files; fix forward with a new migration, or restore (see *Rollback*).

## 5. Deploy the Edge Functions (right after step 4)

They call functions added by the migrations, so deploy them immediately afterwards:
```sh
npx supabase functions deploy verify-fleet-sync-attachment
npx supabase functions deploy attach-fleet-sync-document
npx supabase functions deploy copy-fleet-sync-attachment
npx supabase functions deploy release-fleet-sync-attachment
npx supabase functions deploy delete-fleet-files
```
Only built-in secrets are used (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). If any of these functions was previously deployed with `--no-verify-jwt`, check in Dashboard → Edge Functions and keep the same setting.

## 6. Verify

```sh
npx supabase migration list --linked     # local and remote columns now match through 20261221000100
```
In Dashboard → SQL Editor (read-only checks):
```sql
select rolname, rolbypassrls from pg_roles where rolname = 'fireops_sync_writer';   -- 1 row, false
select count(*) from public.user_sync_commands;                                       -- 44
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in (
  'sync_user_command','get_user_sync_snapshot','get_company_sync_snapshot','sync_fleet_update',
  'sync_fleet_create','download_fleet_sync_page','user_sync_base_matches') order by 1;  -- 7 rows
select policyname from pg_policies where tablename = 'objects' and policyname like 'uploaders remove own %';  -- includes receipt, invoices and payroll
```
Then on the web app: sign in, toggle your availability, change a dashboard card, and open a vehicle. On a phone with the new build: run the offline → restart → reconnect → Saved changes & sync review.

## 7. Clients

- **Web:** deploy the current `main` build right after step 5.
- **Mobile:** queue store builds (the native offline database changed, so this cannot be an over-the-air update):
  ```sh
  npm run deploy:mobile:production -- --ios-version <expo.version>
  ```
  Consider requiring the update, because older builds can no longer save availability or the dashboard layout.

## Rollback

There are no down-migrations. In order of preference:
1. **Fix forward** with a new migration for a specific problem.
2. **Point-in-Time Recovery** (Dashboard → Database → Backups) to the time noted in step 2. This also undoes any data written since.
3. **Restore the dumps into a new project** to inspect or recover data:
   ```sh
   psql "$NEW_DB_URL" -f "$B/roles.sql"
   psql "$NEW_DB_URL" -f "$B/schema.sql"
   psql "$NEW_DB_URL" -f "$B/data.sql"
   ```
After a database rollback, redeploy the previous Edge Function versions and web build to match.
