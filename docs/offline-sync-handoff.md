# Offline sync implementation handoff

## Start here

Read `AGENTS.md`, this file and `docs/mobile-offline-sync.md` completely. Inspect actual Git status/log/diffs before editing; do not assume another agent's conversation history or an older milestone describes current code. Stop other agents before concurrent edits.

## User request and constraints

Continue toward safe **all-feature mobile-only offline editing**, in tested, committed slices. Commit each logical slice and continue. **Do not push Git, deploy Edge Functions, apply Supabase migrations or reset databases.** User handles deployment later.

- Web stays **online-only**; web changes support safe online writes and online conflict/history review, not browser offline replay.
- Offline use requires previous authentication and relevant verified downloads. Never promote HTTP/display cache to a verified fleet base.
- Preserve original intent/authorship, reported device time/connectivity, separate server times, discarded values and immutable decisions.
- Distinguish local save, uploaded bytes, record attachment, pending review and business synchronization.
- Never replay unknown completed work, mutate attempted requests, silently resend rejected values, infer deletion from denied access or downgrade newer canonical data.
- No app/UI launch, web server or visual testing. Run targeted tests/typechecks; user tests UI.
- Preserve unrelated changes below. Stage explicit paths, not `git add .`.

## Current inspected checkpoint

Claude's latest commit when continuation began was `1594bb8` (`refactor(sync): register user sync commands per entity type`). No unfinished implementation was present. Earlier lists ending at vehicle documents are historical, not current capability.

Continuation fixes:

- `12615dd`: transactionally sequence repeated/concurrent user commands; retain exact operation identity, payload, provenance and stored dependencies after uncertain local acknowledgment; freeze input before asynchronous device lookup. Scalar rebase safeguards remain unchanged.
- Native user-owned hook hardening: account/company/ABA callback fences, canonical setting acknowledgment recovery, bounded account-bound POST refresh, stable task UI retry IDs and frozen availability retry bases. Own-user native writes now queue durably online too, so reconnect cannot bypass pending commands. 65 targeted mobile tests and mobile typecheck passed; consult Git log for this slice's commit.
- Forward migration `20261128000100_user_sync_availability_cas.sql`: replace availability's read-before-unconditional-write with conditional mutations, preserving helper ownership/ACLs/RLS and the existing RPC/receipt contract. Old non-null bases cannot recreate removed rows. Also repair missing registry RLS; the undeployed `20261127000100` creation was corrected in place so new registries start protected. No client access is added. Consult Git log for this slice's commit.

Latest focused validation: 83 mobile tests (outbox/native storage/user commands), mobile/domain typechecks; 9 user-command embedded PostgreSQL tests plus 5 grant checks include the full 18-case availability matrix, deterministic read/write interleaving, private executor checks and forward registry RLS repair. Prior baseline checks also passed 40 mobile attachment/status/user-command tests and 5 user-command database tests. These are selected checks, **not a full audit or production validation**.

SQLite outbox schema is **v10**. Pending forward sync migrations run from `20261109000100` through `20261128000100`, plus earlier project prerequisites. None was applied by this continuation. Claude edited some undeployed earlier migrations in place; inspect the design document and actual migration chain rather than assuming only append-only changes occurred historically.

## Implemented adapters (code, not deployed)

- Owner/admin verified vehicle/issue details; repeated saves, independent continuation materialization and explicit per-field local rebase.
- Vehicle status/assignment/fire invariant group; issue resolve/reopen and append-only notes.
- Firefighter/shop-tech own vehicle claim/release/fire-clear and own reported-issue notes. Crew resolve/reopen and live fire selection still need a connection.
- Verified vehicle documents and six single file slots (photo, contract, VIPR, registration, insurance, DOT); owner/admin/shop-tech append-only inspections with proven photos. Inspection edits/deletes and document replacement/removal remain unsupported offline.
- Owner/admin/shop-tech new issue reports; firefighters cannot report issues under existing policy.
- Private personal-task create/complete (owner/admin/shop-tech), own availability and own dashboard layout commands. Tasks are not exposed to manager review. Own settings use dedicated command semantics, not fleet scalar merges.
- Scoped durable outbox, stable device IDs, verified vehicle/issue cache, opt-in bounded inventory catch-up, foreground/reconnect/manual worker, retained-work sign-out protection and truthful sync notices.
- Server fingerprints/revisions/idempotent receipts, merge/conflict storage, guarded owner/admin decisions and device-history backup/inspection. Both clients have online review/history; web fleet writers retain captured revisions and immutable online retries.

Chronological sections in the design document describe earlier milestones; later adapters supersede their older “not enabled” claims. **All-feature offline is unfinished.**

## Architectural boundaries

- Reuse provider-owned scoped outbox session; do not introduce competing `activate()` handles.
- Fleet bases are raw account-bound POST canonical records, never normalized/display/GET fallback records. Revisions compare with `BigInt`.
- Persist acknowledgment before completion. Reconcile canonically without replaying completed business work; historical receipt snapshots must not replace newer state.
- Fleet continuation rebase preserves original intent/history and never implicitly resubmits rejected parent values. User commands sequence atomically without changing their payloads or attempted wire requests.
- Non-bypass `fireops_sync_writer` inherits authenticated permissions, owns wrappers but no fleet business tables. Preserve RLS/invariants and recheck current authorization.
- Inventory fingerprints fence pages against all revision/deletion changes, including ABA and behind-cursor inserts. Current catch-up is bounded full scans, not optimized deltas or guaranteed background execution.

## Attachment integrity and retention

- Reserve intent before bounded private-file copy. Opaque scoped UUID paths; picker/source URIs are not retained. Readiness requires exact length/SHA-256 and durable promotion.
- Limits: 10 MiB/local file, 100 MiB/user across companies; business vehicle copies respect legacy `fleet-files` 8 MiB limit.
- Separate `fleet-sync-files` staging bucket, authenticated immutable reservations, service byte verification and proven canonical `fleet-files` copies. Upload receipt is not business synchronization.
- Binding, operation and projection commit atomically. Pending references protect bytes; final settlement/release requires the appropriate outcome and canonical proof.
- Applied staging objects are cleaned after canonical copy/reference proof; rejected/unattached uploads require explicit release. Device copies are removed only after confirmed canonical attachment; metadata/audit remains. Nothing expires silently.
- Device copies are **not app-encrypted**. Existing policy allows only non-sensitive vehicle files. Sensitive crew/qualification/payroll/receipt/invoice file intake requires encryption first.

## Immediate safety follow-ups before expanding scope

Source inspection identified additional areas needing focused regression tests/fixes; do not assume the latest adapters are production-ready:

1. User-owned hook scope/retry/settings acknowledgment gaps are fixed (see checkpoint). Remaining: a complete authorized task inventory/download/catch-up contract; its list still uses existing GET/cache reads, not a verified domain inventory. Do not mistake per-command reconciliation for full-domain coverage.
2. Task identity lifetime: completed tasks are physically deleted; new operation IDs must not allow an old task UUID to be recreated. Add durable identity/tombstone handling without widening task privacy or inventing missing historical data.
3. Online user-setting writers still need a complete stale-write/partial-update audit (especially whole-layout preference upserts). The new availability CAS protects queued native mutations against online writers; it does not migrate every online writer to CAS.
4. Audit Storage cleanup/retry races and legacy deletion paths. In particular, cached verifier mismatch outcomes and completed/expired leases must never authorize a late path-only removal of replacement bytes. Review reference retention for conflict/history files; do not rely only on Edge wall-clock assumptions.
5. Real Supabase Storage/RLS/Edge Function and multi-session validation: actual insert/select/duplicate upload semantics, authenticated reads, remove/copy, object replacement, lease timing, `auth.uid()` in uploader permission checks, complete migration chain and role/grant compatibility. PGlite does not implement the Storage service or separate concurrent sessions.

## Remaining feature scope

Complete authorization-aware download/catch-up and explicit adapters for crew/qualifications/roles/invitations, notes/types/templates, communications/read markers, company/stored documents, training/enrollment, inventory adjustments, notifications/preferences/tokens, financials, settings/feedback/integrations and remaining fleet mutations. Remote actions remain pending intentions until authorized online execution; never fabricate sends/payments/seat reservations/external success. Sensitive-file encryption/retention, compatibility/recovery/performance and installed-device offline → restart → reconnect → review testing remain rollout blockers.

## Targeted validation examples

```sh
npm run typecheck --workspace @fireops/mobile
npm run typecheck --workspace @fireops/domain
npm run test --workspace @fireops/mobile -- src/lib/offline-user-sync.test.ts src/lib/offline-outbox.test.ts src/lib/offline-outbox-native.test.ts
node --test supabase/tests/user-sync-commands.test.mjs supabase/tests/data-api-grants.test.mjs
git diff --check
```

Choose only suites relevant to each slice. Native SQLite tests need Node 22.13+. Database tests use dev-only PGlite fixtures. Edge logic specs run with Vitest (Deno was unavailable); see corresponding sections of the design document. No passing local suite substitutes for real Supabase or installed-device validation. Do not reset storage/databases to recover unsynced work.

## Unrelated pre-existing changes: leave untouched

- Deleted `INCIDENT QUALIFICATION CARD.png`.
- Modified `jobs/usfs-dispatch/viprRun.sh`.
- Modified `supabase/.temp/{gotrue-version,rest-version,storage-migration,storage-version}`.
- Untracked `jobs/usfs-dispatch/__pycache__/`.

Do not erase, restore, commit or include these in implementation commits.
