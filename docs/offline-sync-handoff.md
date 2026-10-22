# Offline sync implementation handoff

## Start here

Read `AGENTS.md`, then this file and `docs/mobile-offline-sync.md` completely. The latter is the detailed design, implementation history, coverage inventory and rollout checklist. Inspect current Git status before editing. This handoff was prepared when switching from pi to Claude Code; do not assume conversation history transfers automatically.

## User request and non-negotiable constraints

Continue toward safe **all-feature mobile-only offline editing**, in tested, committed slices. After each logical slice, commit and move to the next step. **Do not push Git, deploy Edge Functions, apply Supabase migrations, or reset any database.** The user will push/deploy at the end.

- Web stays **online-only**. Web changes support online write safety and conflict/history inspection, not browser offline queues or replay.
- Offline use requires previous authentication and verified downloaded data.
- Preserve original intent, authorship, reported device time/connectivity, server receipt times, discarded versions and immutable decisions.
- Never call on-device save, uploaded bytes, pending review and business-record synchronization the same thing.
- Never replay an unknown completed operation, mutate an attempted request, silently resubmit rejected values, fabricate deletion from permission denial, or downgrade newer canonical data.
- Do not launch the app, web server, or visual tests. User tests UI. Run targeted tests/typechecks only.
- Preserve unrelated working-tree changes listed below. Stage explicit implementation paths; do not use blanket `git add .`.

## Exact checkpoint

Latest implementation commits (newest first):

- `0fb0b86` — vehicle documents bounded to the 8 MiB `fleet-files` limit (SQL, domain, UI).
- `a8bc612` — native vehicle-document UI in the saved-detail editor; provider wiring of uploads/attach on the existing session.
- `5b06006` — SQLite v9 immutable vehicle-document intents, attach runner, discard protection.
- `8b61de2` — server vehicle-document adapter (`20261119000100`, `attach-fleet-sync-document`).
- `dac7f6d` — SQLite v8 upload progress, uploader and account-bound transport.
- `c7eb542` — trusted byte verifier (`20261118000100`, `verify-fleet-sync-attachment`).
- `c84a8e3` — upload reservations, private `fleet-sync-files` bucket and Storage RLS (`20261117000100`); the former untracked `attachment-upload.ts` draft is now reviewed, tested and exported.
- Earlier: `94f44e7`, `e465acd`, `d327255`, `5bf58ab`, `dd61e78`, `83a5788`.

There is no uncommitted implementation work. Last verified: **120 embedded PostgreSQL sync tests + 5 grant checks**, **171 targeted mobile tests**, domain attachment tests, Edge Function logic specs (Vitest, since Deno is not installed here), mobile/domain typechecks and whitespace checks. Real Supabase Storage/Edge Function, device and multi-session validation remains outstanding.

## What currently works

- Installed iOS/Android owners/admins can save downloaded vehicle/issue **scalar details** offline. Repeated saves are durable dependent operations; independent changes are rebased over verified canonical data, conflicts require explicit per-field rebase/review.
- Fields: vehicle `unit,type,year,make,model,vin,plate,notes`, six file slots, `status/assignedTo/assignedFire` (invariant group); issue `title,description,priority`, `status/resolvedAt` (group) and append-only `updates`. Crew (fire_fighter/shop_tech) can claim/release vehicles, clear their own fire and add notes to issues they reported; crew resolve/reopen and fire assignment still need a connection.
- Scoped SQLite outbox, stable per-user device IDs, verified raw-record cache, foreground/reconnect/manual worker, durable delivery/review recovery, retained-work sign-out guard, notices and `/sync-status`.
- Backend revision fingerprints, idempotent receipts, audited three-way merge/conflicts and owner/admin review. Both clients have online review/history inspectors. Web online writers preserve captured revisions and immutable retry intent.
- Opt-in bulk vehicle/issue inventory downloads with resumable pages, tombstones and coverage. Dataset fingerprint fences every page against changes (including behind-cursor inserts and ABA); not a timestamp/sequence high-water mark. Bounded full scans, not an optimized delta feed or background-service promise.
- Older completed device rebase history can be backed up only when the original server submission/hash exists. Unknown submissions are never replayed.

## Attachment foundation (local) — now extended by remote upload and vehicle-document adapters

Key files:

- `apps/mobile/src/lib/offline-attachment-types.ts`
- `apps/mobile/src/lib/offline-attachment-vault.ts`
- `apps/mobile/src/lib/offline-attachment-files-native.ts`
- `apps/mobile/src/lib/offline-attachment-controller.ts`
- `apps/mobile/src/lib/offline-attachment-actions.ts`
- `apps/mobile/src/components/offline-attachment-drafts.tsx`
- `apps/mobile/src/providers/offline-sync-provider.tsx`
- `apps/mobile/src/lib/offline-outbox.ts` — schema currently **v7**.

SQLite reserves immutable scoped metadata before copying bytes. Native files use opaque UUID paths under document storage, not picker cache/remote URLs. Bounded copying, exact size/SHA-256 and partial-file promotion precede readiness acknowledgment. Recovery handles picker loss, interrupted copies/moves/SQLite acknowledgment, missing/corrupt files and interrupted discard. Limits: 10 MiB/file, 100 MiB retained bytes/user across companies.

Atomic operation/reference/projection binding requires ready same-account/company/record manifests. Referenced files cannot be discarded, including after a business outcome; no safe bound-file release exists yet. The generic scalar worker blocks attachment-bearing operations so it cannot silently upload scalar fields and drop files. All non-discarded manifests count as retained work; sign-out counts are work items, not solely operations.

The provider reuses its existing outbox session (no competing `activate()` handles). Inspection hides scoped metadata after account/role changes. Restore accepts **only original bytes**, preserving metadata and references; old final bytes are removed only after a matching partial exists. Picker/confirmation responses are fenced against route/account changes. The only enabled business attachment flow is **Add vehicle document** in the vehicle saved-detail editor (verified upload → proven `fleet-files` copy → appended document via `apply_fleet_changes`). All other file editors remain online-only and unchanged.

**Bytes are not encrypted by this foundation. Sensitive-file intake remains disabled.** SDK-compatible `expo-crypto ~57.0.3` was added for SHA-256 and is lazily loaded; installed custom native builds need the matching module for hashing. The repository audit returned 35 advisories (7 moderate, 25 high, 3 critical); no `expo-crypto` advisory entry was returned. No broad audit fix was applied.

## Immediate next work

Remote attachment ownership, byte receipts and the first business-reference adapter (one appended **vehicle document**) are implemented end to end; see the attachment sections of `docs/mobile-offline-sync.md`. Remaining attachment work:

1. Real Supabase validation: Storage API insert/select under the new RLS (including any implicit RETURNING), `upsert:false` duplicate errors, authenticated object reads (404 vs 400), `remove`, Edge Function wall-clock vs the 10-minute verification lease, and `auth.uid()` evaluation in `fleet_sync_attachment_uploader_allowed` (it sets `request.jwt.claim.sub` locally).
2. Vehicle single-slot files (photo/contract/VIPR/registration/insurance/DOT) are implemented through the verified detail-update path (`20261121000100`, `copy-fleet-sync-attachment`). Offline inspections with proven photos (owners/admins and shop techs) are implemented (`20261124000100`, `20261125000100`). Remaining: inspection edits/deletes, issue files (no issue file field exists), replace/remove vehicle documents.
3. Retention policy is decided and implemented (see "Attachment retention and release policy" in `docs/mobile-offline-sync.md`): staging deleted after applied, explicit user release otherwise, device copy auto-removed after a confirmed attach.
4. Device copies are **not encrypted by FireOps**; that is accepted only for non-sensitive vehicle documents. App-level encryption is required before crew, qualifications, payroll, receipts or invoices accept offline files.

Beyond attachments: remaining workflow adapters listed below.

## Validation commands

Examples; choose only tests relevant to each slice:

```sh
npm run typecheck --workspace @fireops/mobile
npm run typecheck --workspace @fireops/domain
npm run test --workspace @fireops/mobile -- src/lib/offline-attachment-vault.test.ts src/lib/offline-attachment-files-native.test.ts src/lib/offline-attachment-controller.test.ts src/lib/offline-attachment-drafts.test.tsx src/lib/offline-outbox.test.ts src/lib/offline-sync-worker.test.ts src/lib/offline-sync-sign-out.test.ts src/lib/offline-attachment-upload.test.ts
node --test supabase/tests/fleet-sync-attachment-uploads.test.mjs supabase/tests/fleet-sync-document-attach.test.mjs supabase/tests/data-api-grants.test.mjs
(cd packages/domain && npx vitest run --root ../../supabase/functions/verify-fleet-sync-attachment && npx vitest run --root ../../supabase/functions/attach-fleet-sync-document)
git diff --check
```

Native tests use Node `node:sqlite` (Node 22.13+). Database tests use local dev-only PGlite, not deployed Supabase. Do not substitute passing single-backend tests for real RLS/multi-session/storage validation.

## Deployment and remaining scope

All pending forward sync migrations are listed in order in `docs/mobile-offline-sync.md`, currently `20261109000100` through `20261127000100`, plus the `verify-fleet-sync-attachment`, `attach-fleet-sync-document`, `release-fleet-sync-attachment` and `copy-fleet-sync-attachment` Edge Functions. Note: undeployed migrations `20261110000100`/`20261111000100`/`20261117000100` were edited in place during development. **None was applied by this assistant.** Do not reset production. Test target compatibility/permissions/concurrency and installed-device offline → restart → reconnect → review before rollout.

All-feature offline remains unfinished. Beyond attachments: remaining workflows and permission/invariant-aware adapters (assignments/status, inspections, crew/qualifications, notes, documents, communications, training, inventory, tasks/preferences, financials, settings/integrations), their catch-up contracts, encryption/retention, recovery/compatibility/performance hardening, real validation and rollout preparation.

## Unrelated pre-existing changes: leave untouched

- Deleted `INCIDENT QUALIFICATION CARD.png`.
- Modified `jobs/usfs-dispatch/viprRun.sh`.
- Modified `supabase/.temp/{gotrue-version,rest-version,storage-migration,storage-version}`.
- Untracked `jobs/usfs-dispatch/__pycache__/`.

Do not erase, restore, commit or include those in implementation commits.
