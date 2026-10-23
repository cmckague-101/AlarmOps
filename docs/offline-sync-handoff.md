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

- `20261201000100_online_crew_availability.sql`: actor/company/target-bound online value-CAS, immutable original-request/preimage receipts and full-roster POST reads. Rechecks current membership/manager/target authority even for cached replay. Shares native own-command CAS/target locks; forbids restoring a missing status from a non-null base. Legacy direct writes denied; updated clients required. 28 targeted DB/grant checks pass. Nothing deployed.
- Online availability clients (web + mobile online path) now use a shared domain controller over `get_crew_availability`/`set_crew_availability_once` with frozen requests, verified-only bases, original-request/read-only retries and scope fencing. `online-write.ts` factors out the account-bound RPC transport/timeout/write primitives, now also used by dashboard writes. Mobile own availability stays on the outbox. Consult Git log for this slice's commit.

- `721b2f4` / `20261130000100_online_dashboard_preferences.sql`: atomic per-key online preference writes, private immutable original-request/preimage receipts and uncached canonical reads. Direct whole-layout table mutations are denied; both native/online helpers accept only known boolean/null changes. 27 database/grant checks pass. This requires updated online RPC clients before rollout; never fall back to old upserts.
- Online dashboard clients are now wired on web and mobile fallback: account-bound POSTs, frozen in-memory request/receipt proof, explicit original-choice/read-only retries, scope/ABA fencing and page-exit warnings. No browser persistence or reconnect replay. Native own writes still use the outbox; native typed validation and cached/verified-receipt offline display remain supported. Latest checks: 15 domain + 70 mobile + 15 web tests, all three typechecks and 28 database/grant/structural checks. The undeployed `20261130000100` migration also now fences legacy writers with parent-before-child table locks before ACL changes; this needs real-session contention validation. Consult Git log for the client slice's commit.

- `12615dd`: transactionally sequence repeated/concurrent user commands; retain exact operation identity, payload, provenance and stored dependencies after uncertain local acknowledgment; freeze input before asynchronous device lookup. Scalar rebase safeguards remain unchanged.
- Forward migration `20261129000100_personal_task_identities.sql`: private UUID-only task retirement for every writer, receipt-target backfill/retirement, ownership immutability and current task-role enforcement for canonical reads/cached receipts. Exact replay cannot recreate completed tasks; native identity collisions block without changing IDs. No private task content or tenant/author metadata is retained in the UUID set. Consult Git log for this slice's commit.
- `19e2b88` — native user-owned hook hardening: account/company/ABA callback fences, canonical setting acknowledgment recovery, bounded account-bound POST refresh, stable task UI retry IDs and frozen availability retry bases. Own-user native writes now queue durably online too, so reconnect cannot bypass pending commands. 65 targeted mobile tests and mobile typecheck passed; consult Git log for this slice's commit.
- Forward migration `20261128000100_user_sync_availability_cas.sql`: replace availability's read-before-unconditional-write with conditional mutations, preserving helper ownership/ACLs/RLS and the existing RPC/receipt contract. Old non-null bases cannot recreate removed rows. Also repair missing registry RLS; the undeployed `20261127000100` creation was corrected in place so new registries start protected. No client access is added. Consult Git log for this slice's commit.

Prior focused validation: 66 mobile tests (user hooks/commands, worker and transport), mobile typecheck; 15 user-command embedded PostgreSQL tests plus 5 grant checks, including identity retirement/backfill/rollback/role revocation, the full 18-case availability matrix, deterministic read/write interleaving and registry RLS repair. Earlier continuation passed 83 outbox/native/user-command tests and mobile/domain typechecks. Prior baseline checks also passed 40 mobile attachment/status/user-command tests and 5 user-command database tests. These are selected checks, **not a full audit or production validation**.

SQLite outbox schema is **v11**. Pending forward sync migrations run from `20261109000100` through `20261214000100`, plus earlier project prerequisites. None was applied by this continuation. Claude edited some undeployed earlier migrations in place; inspect the design document and actual migration chain rather than assuming only append-only changes occurred historically.

## Implemented adapters (code, not deployed)

- Owner/admin verified vehicle/issue details; repeated saves, independent continuation materialization and explicit per-field local rebase.
- Vehicle status/assignment/fire invariant group; issue resolve/reopen and append-only notes.
- Firefighter/shop-tech own vehicle claim/release/fire-clear and own reported-issue notes. Crew resolve/reopen works offline together with a note (`20261213000100`). Live fire selection still needs a connection.
- Verified vehicle documents and six single file slots (photo, contract, VIPR, registration, insurance, DOT); owner/admin/shop-tech append-only inspections with proven photos. Inspection edits/deletes and document replacement/removal remain unsupported offline.
- Owner/admin/shop-tech new issue reports; firefighters cannot report issues under existing policy.
- Owner/admin new vehicles (`20261214000100`; Ready/Out of service, no photo or files until created).
- Private personal-task create/complete (owner/admin/shop-tech), own availability and own dashboard layout commands. Offline notification reads and Crew Chat seen markers (`20261203000100`, forward-only, own rows; seen markers stop at the newest displayed server timestamp). Offline Crew Chat replies (`20261204000100`, one insert per client UUID, deleted threads reported as not posted). Offline vehicle note creation (`20261205000100`; edits/deletes stay online). Offline crew gear checkout (`20261207000100`; decided policy: shortfalls are rejected and kept on the device; also fixes online checkout broken by the role rename). Offline training sign-up/cancel (`20261208000100`; decided policy: full classes are rejected and kept on the device). Offline payroll draft saves and submission (`20261209000100`; per-field merge on the creator's own form, native form screen wired; attachments, delete, approval and payment stay online). Offline invoice draft saves and submission (`20261210000100`, same pattern, native screens wired; adds `customer_deleted` and `incomplete` refusals). Offline receipt creation (`20261212000100` plus native file keeping/upload; device uploads into its own `receipt-files` folder, then the command creates the receipt only for that exact path and size; edits/deletes stay online). `20261211000100` fixes an existing bug that let uploaders delete files behind saved receipts, invoice/payroll documents and submitted payroll forms. Tasks are not exposed to manager review. Own settings use dedicated command semantics, not fleet scalar merges.
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
- Device copies are **not app-encrypted**. Decided 2026-10-23: receipts, payroll and invoices do not need app-level encryption. Crew/qualification file intake still needs a separate decision.

## Immediate safety follow-ups before expanding scope

Source inspection identified additional areas needing focused regression tests/fixes; do not assume the latest adapters are production-ready:

1. User-owned hook scope/retry/settings acknowledgment gaps are fixed (see checkpoint). The verified user snapshot (`20261206000100`, SQLite v11) now backs the native Tasks list and offline own availability/dashboard display. Remaining: complete authorized user-domain snapshots/download/catch-up, including tasks and settings/global cross-company delivery. Task lists and native setting restart display still use existing GET/cache data (or verified retained setting receipts), not a complete verified domain inventory. Do not mistake per-command reconciliation for full-domain coverage.
2. Task UUID retirement/current-role enforcement is implemented by `20261129000100` (see checkpoint). The UUID-only set deliberately survives company/profile deletion; it has no tenant, author, content or timestamps. Legacy deleted IDs absent from both current rows and receipts remain unknowable. Validate upgrade/concurrency on target Supabase; do not prune retirement IDs or reset storage to recover work.
3. Online dashboard whole-layout upserts are replaced and server-blocked by `20261130000100` plus the updated clients (see checkpoint). Online availability writers are now also on CAS (`20261201000100` + shared controller); no client writes `crew_availability` directly.
4. Storage cleanup fences are implemented by `20261202000100` plus updated Edge Functions (see design doc "Storage cleanup fences"). Verifier mismatch and copy-mismatch removals are re-authorized right before the path-only delete. Proven `sync-` copies are retained against legacy deletes. Remaining: a tiny copy-removal window (documented), plus real Storage `DELETE`/timing validation.
5. Real Supabase Storage/RLS/Edge Function and multi-session validation: actual insert/select/duplicate upload semantics, authenticated reads, remove/copy, object replacement, lease timing, `auth.uid()` in uploader permission checks, complete migration chain and role/grant compatibility. PGlite does not implement the Storage service or separate concurrent sessions.

## Remaining feature scope

Done since the last checkpoint (all through the user command registry): notification reads, Crew Chat seen markers and replies, and vehicle note creation. Deliberately not done: **document "viewed" markers**, because opening a company document needs an online signed URL, so an offline marker would never fire until offline document files exist. **Note edits/deletes, reply deletes and thread creation** also stay online-only (last-write-wins or manager-only today; they need revision tracking or review design first).

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
