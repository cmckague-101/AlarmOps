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

Latest implementation commits:

- `94f44e7` — provider-owned attachment inspection, exact-byte repair and guarded cleanup.
- `e465acd` — durable attachment bytes, SHA-256, manifests and atomic outbox references.
- `d327255` — verified bulk fleet download and resumable inventory catch-up.
- `5bf58ab` — older-build history recovery without replaying completed business changes.
- `dd61e78` — web/mobile retained device-history inspection.
- `83a5788` — atomic server backup of device rebase history.

**Uncommitted implementation draft:** `packages/domain/src/attachment-upload.ts`.
It is newly written, untracked, **unwired and untested**. It defines tentative manifest/reservation/upload-receipt types and validators with a proposed `fleet-sync-files` bucket and stable company/user/attachment path. It is not exported from the domain index. Review/change it rather than assuming its contract is final. No reservation RPC, new bucket, verifier endpoint or remote upload flow has been implemented for it yet.

Last verified implementation checks (before that draft): **244 targeted mobile tests**, mobile typecheck, whitespace checks. Earlier bulk-download slice also passed **107 embedded PostgreSQL/grant tests**. Real Supabase, device and multi-session validation remains outstanding.

## What currently works

- Installed iOS/Android owners/admins can save downloaded vehicle/issue **scalar details** offline. Repeated saves are durable dependent operations; independent changes are rebased over verified canonical data, conflicts require explicit per-field rebase/review.
- Fields: vehicle `unit,type,year,make,model,vin,plate,notes`; issue `title,description,priority`.
- Scoped SQLite outbox, stable per-user device IDs, verified raw-record cache, foreground/reconnect/manual worker, durable delivery/review recovery, retained-work sign-out guard, notices and `/sync-status`.
- Backend revision fingerprints, idempotent receipts, audited three-way merge/conflicts and owner/admin review. Both clients have online review/history inspectors. Web online writers preserve captured revisions and immutable retry intent.
- Opt-in bulk vehicle/issue inventory downloads with resumable pages, tombstones and coverage. Dataset fingerprint fences every page against changes (including behind-cursor inserts and ABA); not a timestamp/sequence high-water mark. Bounded full scans, not an optimized delta feed or background-service promise.
- Older completed device rebase history can be backed up only when the original server submission/hash exists. Unknown submissions are never replayed.

## Attachment foundation: implemented, but NOT business file sync

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

The provider reuses its existing outbox session (no competing `activate()` handles). Inspection hides scoped metadata after account/role changes. Restore accepts **only original bytes**, preserving metadata and references; old final bytes are removed only after a matching partial exists. Picker/confirmation responses are fenced against route/account changes. No new business attachment picker or upload action is enabled. Existing connected file editors remain unchanged.

**Bytes are not encrypted by this foundation. Sensitive-file intake remains disabled.** SDK-compatible `expo-crypto ~57.0.3` was added for SHA-256 and is lazily loaded; installed custom native builds need the matching module for hashing. The repository audit returned 35 advisories (7 moderate, 25 high, 3 critical); no `expo-crypto` advisory entry was returned. No broad audit fix was applied.

## Immediate next work

Implement remote attachment ownership and byte receipts, then dedicated business-reference adapters:

1. Immutable, idempotent upload reservation scoped to authenticated actor/company/record and retained manifest. Stable object ID/path; reject different content/provenance on retry. Validate current permissions, quotas and target availability without changing the business record.
2. Private immutable upload storage and RLS. Consider a separate bucket so legacy `fleet-files` cleanup cannot delete staged/reviewed objects. Deny unsafe overwrite/deletion; do not assume a successful SDK upload or client-supplied metadata proves hash/ownership.
3. Server-side actual-byte size/SHA-256 verification and immutable receipt, linked to the owned object/version. Recheck current access when issuing/replaying proof. Server/service keys must never reach clients. Bound stream reads; authenticate before privileged operations. Handle replacement/deletion and role-revocation races.
4. Native stable retries: distinguish never sent, uncertain upload, verified uploaded bytes, awaiting attachment/review and fully reconciled business reference. Persist acknowledgments before cleanup. Preserve original IDs/payloads through restart/account changes.
5. Dedicated record mutation/review adapter and explicit safe reference release. **Uploaded is not attached or synced.** Retain losing/conflicting file candidates and any still-referenced bytes; no blind orphan deletion.
6. Encryption/retention/access-revocation policy before sensitive workflows or broad rollout.

Inspect existing policies/functions before implementing:

- `apps/mobile/src/lib/fleet-files.ts` (current online upload/open/delete behavior).
- `supabase/functions/delete-fleet-files/index.ts` (privileged cleanup; currently hardcoded legacy `fleet-files`).
- Existing `storage.objects` policies in migrations.
- `supabase/tests/fixtures/fleet-sync-harness.mjs` and `fleet-sync.sql`. Embedded fixture currently has auth/company/fleet boundaries, **not a Storage service implementation**. New Storage policies need explicit relevant fixtures and real target-Supabase validation.

Suggested implementation slices: backend reservation/RLS tests → trusted byte verifier and recovery tests → native receipt persistence/transport → business-reference/review adapter. Keep incomplete adapters disabled. The tentative domain draft is a starting point, not a security-reviewed implementation.

## Validation commands

Examples; choose only tests relevant to each slice:

```sh
npm run typecheck --workspace @fireops/mobile
npm run typecheck --workspace @fireops/domain
npm run test --workspace @fireops/mobile -- src/lib/offline-attachment-vault.test.ts src/lib/offline-attachment-files-native.test.ts src/lib/offline-attachment-controller.test.ts src/lib/offline-attachment-drafts.test.tsx src/lib/offline-outbox.test.ts src/lib/offline-sync-worker.test.ts src/lib/offline-sync-sign-out.test.ts
node --test supabase/tests/fleet-sync-device-history.test.mjs supabase/tests/data-api-grants.test.mjs
git diff --check
```

Native tests use Node `node:sqlite` (Node 22.13+). Database tests use local dev-only PGlite, not deployed Supabase. Do not substitute passing single-backend tests for real RLS/multi-session/storage validation.

## Deployment and remaining scope

All pending forward sync migrations are listed in order in `docs/mobile-offline-sync.md`, currently `20261109000100` through `20261116000100`. **None was applied by this assistant.** Do not reset production. Test target compatibility/permissions/concurrency and installed-device offline → restart → reconnect → review before rollout.

All-feature offline remains unfinished. Beyond attachments: remaining workflows and permission/invariant-aware adapters (assignments/status, inspections, crew/qualifications, notes, documents, communications, training, inventory, tasks/preferences, financials, settings/integrations), their catch-up contracts, encryption/retention, recovery/compatibility/performance hardening, real validation and rollout preparation.

## Unrelated pre-existing changes: leave untouched

- Deleted `INCIDENT QUALIFICATION CARD.png`.
- Modified `jobs/usfs-dispatch/viprRun.sh`.
- Modified `supabase/.temp/{gotrue-version,rest-version,storage-migration,storage-version}`.
- Untracked `jobs/usfs-dispatch/__pycache__/`.

Do not erase, restore, commit or include those in implementation commits. Keep the uncommitted upload-contract draft separate from this unrelated list: it is intentional in-progress implementation work to continue.
