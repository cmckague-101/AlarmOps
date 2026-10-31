# FireOps release checklist

Run `./deploy.sh` from the repo root on this laptop. It walks through the steps below and asks before anything reaches production. Use `./deploy.sh --dry-run` first to see the commands without running them.

FireOps is live with real users. Never test by creating, editing, deleting or submitting real records unless you mean to keep them (or delete them right after).

## Order

Always in this order. New app code expects the new database columns and rules.

1. Checks
2. Database migrations
3. Web (push `main`, Vercel deploys)
4. Mobile builds (iOS, then Android)

## 1. Before you start

- [ ] On `main`, working tree clean, nothing on `origin/main` you haven't pulled.
- [ ] `./deploy.sh` checks pass: typecheck, all tests (including the `supabase/tests` database tests) and a web build. Don't skip these.
- [ ] Read the "Mobile changes" list the script prints. It becomes the App Store "What's new" draft in `builds/`.

## 2. Database migrations

- [ ] **Back up first:** Supabase dashboard → Database → Backups. Storage files are only in the dashboard backup.
- [ ] Review `npx supabase migration list --linked`: every local file should be applied or pending, in filename order.
- [ ] Review `npx supabase db push --linked --dry-run`. The pending list must be exactly the new files. If the CLI suggests `--include-all`, stop and find out why.
- [ ] Apply with `npx supabase db push --linked` (the script asks first).
- [ ] Reload the web app and confirm it still loads and signs in.

**If a migration fails:** `db push` applies each file in its own transaction, so a failed file changes nothing. Fix the file, then rerun. If an applied migration causes trouble, check `supabase/rollbacks/` for a matching rollback, or restore from the backup. Don't hand-edit production tables.

## 3. Web

- [ ] Push `main` (the script asks). Vercel deploys it automatically.
- [ ] Watch the deployment in the Vercel dashboard until it's "Ready".
- [ ] Hard-refresh the live site and spot-check the screens this release touched (see below).

## 4. Mobile

- [ ] Bump the version when asked. It must be higher than the last approved App Store version.
- [ ] Choose **EAS (Expo) cloud build** (simplest), or **local build** on this Mac (needs Xcode; Android needs Android Studio).
- [ ] iOS: when the build finishes processing in App Store Connect, install it from **TestFlight** and test on a real phone before submitting for review.
- [ ] Android: upload the build to a Play Console internal test track first, then promote it.
- [ ] Push notifications only work in real builds, never in Expo Go. Check them in TestFlight.

## Smoke tests for the current release

Database and web are already deployed (all migrations through `20270103000100` are applied, and `main` is pushed). What's left is mobile builds and checking on real devices.

Look but don't save unless noted. Use a throwaway test record where a step says so, and delete it afterwards.

**Invoices**
- [ ] List shows Unpaid / Overdue / Paid badges and the All / Unpaid / Paid filter.
- [ ] Test invoice: set a due date, submit, then as owner or accounting tap **Mark as paid**. It asks first, then shows "Paid" with who marked it. The submitter gets an "Invoice paid" notification (and a push on a real build). Delete is gone once paid. *This test invoice can't be deleted after it's paid. Use an obviously named test, or skip this step and wait for a real invoice.*
- [ ] Invoice Generator: "Bill from" is pre-filled, the customer picker works, line amounts show, and leaving and coming back keeps your work. **Add to Invoices** creates your invoice in progress (with the PDF attached on mobile). Delete it afterwards.

**Receipts**
- [ ] New receipt has a purchase date (defaults to today, no future dates). The list sorts by it and the timespan filter uses it.
- [ ] Offline on mobile (airplane mode): save a receipt, reconnect, and confirm it syncs with its purchase date.
- [ ] "Possible duplicate" shows on matching same-day amounts.

**Payroll**
- [ ] Mark as Paid asks first. Approved and paid forms have no Delete.
- [ ] Submitted forms hide 0-hour days behind "Show N days".

**People**
- [ ] Changing a crew member's role asks first. Cancel leaves it unchanged.
- [ ] Crew Availability shows status badges, the count and search. "Mark available/unavailable" asks first.
- [ ] Roster search and sort work.

**Fleet**
- [ ] Stale vehicles (no update in 24h+) show amber in the list and on the maps.
- [ ] A wrong-length VIN is refused with a clear message. Older vehicles can still be edited.

**General**
- [ ] Headers, the More tab tile size and the dashboard look right in light and dark mode.
- [ ] Notifications from deleted message threads no longer appear.

## After release

- [ ] Note the released version and date in the commit or tag: `git tag v<version> && git push origin v<version>`.
- [ ] Watch for user reports for a day before the next release.
