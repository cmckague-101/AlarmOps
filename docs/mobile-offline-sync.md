# Mobile offline editing and conflict resolution

Status (current code, not deployed): native scoped outbox, verified fleet downloads, repeated edits/rebase, audited conflict review/history and retry-safe online fleet writers are implemented. Enabled native adapters include owner/admin vehicle/issue details, status/assignments, vehicle documents/file slots, crew vehicle claims/releases and own issue notes, owner/admin/shop-tech inspections with photos and new issue reports, plus private personal tasks, own availability and dashboard layout. Exact role/field restrictions appear in the corresponding sections below. Web remains online-only, with review/history support. All-feature offline remains incomplete; other domains, sensitive-file encryption, complete catch-up, compatibility/security hardening and real Supabase/device validation remain outstanding. No migrations or Edge Functions were deployed by this implementation.

Implementation sections below are chronological milestones. Earlier statements such as “not enabled,” older schema versions and historical test counts describe that milestone, not current capability. Read the later adapter sections and `docs/offline-sync-handoff.md` for the current continuation checkpoint.

## Scope

- Offline reading and editing are native mobile (iOS/Android) only. Do not add offline mode to web.
- Cover all mobile app features, not just field reports or draft forms. Deliver incrementally, with a coverage inventory so unsupported workflows are never silently presented as offline-capable.
- Users must previously authenticate online and download the relevant data. Unavailable records, files, maps, and external feeds cannot be fetched offline; show availability and freshness explicitly.
- Owner/admin conflict Alerts and resolution are available on both web and mobile.
- Merge independent field edits automatically. Overlapping, incompatible changes require owner/admin review. Related fields and business invariants can require review even when different field names changed.

## Existing foundation

Mobile already has SQLite response/access caching in `apps/mobile/src/lib/offline-cache.ts`, cached reads and network detection in `apps/mobile/src/providers/network-provider.tsx`, and a read-only offline banner in `apps/mobile/src/app/_layout.tsx`. This is a read fallback, not a durable write queue or a record-level synchronization engine.

Supabase remains authoritative. Existing realtime subscriptions supplement online refresh; they do not replace reconnect catch-up, deletion tracking, or concurrency control.

## User experience

Persist operation status across app restarts and expose a notice plus a detailed sync queue:

1. **Saved on device — waiting for connection** (with pending count).
2. **Syncing** while attempting delivery.
3. **Uploaded — awaiting owner/admin review** for conflicts; never label these edits applied or synced.
4. **Synced** only after server acknowledgment that the operation was applied.
5. **Reviewed — another version was kept** when the user's conflicting value was rejected.

Also show actionable blocked states for expired sessions, lost permissions, invalid requests, unavailable dependencies, storage failures, and failed file uploads. A successful subset must not hide unresolved operations. An offline edit counts as saved only after its local transaction commits.

Keep the user's pending overlay separate from the last acknowledged server state. Refreshes and realtime events must not erase pending work. Clearly distinguish a locally proposed assignment/approval/status from its confirmed shared value.

## Durable local model

Use SQLite for normalized records, acknowledged base revisions, pending edits, conflict receipts, sync checkpoints, and attachment manifests. Keep this separate from the existing HTTP response cache.

Each operation includes:

- Stable client-generated operation ID and entity ID; schema version.
- Company, user, and originating device scope.
- Explicit operation kind and typed payload, not arbitrary captured HTTP requests.
- Base record revision and original values for changed fields.
- Patch or business intent, dependencies, and local operation order.
- Device-reported edit time and connectivity state at save time (online/offline/unknown).
- Lifecycle status, retry metadata, and eventual server receipt/result.

Write the local projection and outbox entry atomically. Persist attachment bytes in app-managed storage before acknowledging a save; temporary picker URLs are insufficient. Retain files until acknowledged or explicitly discarded. Order dependent operations, including parent/child creation and file references. Do not replay side effects from an operation superseded by a later local edit.

Isolate data by account and company, including in-flight responses. Pause old-account workers during logout/account switching. Never silently discard unsynced work on logout; offer an explicit warning and account-bound retention/discard choice. Document local retention, encryption, and cleanup for sensitive crew/payroll data before enabling those workflows.

## Server synchronization contract

Implement authenticated, typed mutation endpoints/RPCs that:

1. Recheck current membership, role, row access, and business rules. Cached permissions are not authority.
2. Deduplicate by operation ID within authenticated account/company scope and return the original result for retries.
3. Compare revisions and base values under transactional concurrency control.
4. Apply safe changes, or durably register conflict candidates without overwriting the current shared values.
5. Commit revision changes, audit history, operation receipts, and notification/outbox intents atomically.

All writers must participate in revision tracking, including online mobile, web, integrations, and administrative jobs. Web stays online-only, but its writes still need concurrency checks so stale web forms cannot overwrite resolved data. Protect sensitive mutations from bypass through direct table writes.

Use server revisions, not client timestamps, to order authoritative changes. Preserve server receipt time separately from device-reported save time. Label the offline flag as the app's observed state, not independently verified fact.

Catch up through durable authorized checkpoints/change tracking with deletions (or complete reconciliations where appropriate). Do not rely on missed realtime events being replayed. Preserve pending overlays during catch-up. Resume on reconnect, foregrounding, and manual retry with backoff; background execution is best effort under OS restrictions.

## Conflict rules and review

Use a three-way comparison: acknowledged base, incoming proposal, and current server value. Identical outcomes are not conflicts. Merge independent changes only when domain invariants permit it; do not automatically apply nonconflicting parts of an indivisible business operation.

Conflicts include incompatible overlapping fields, edit-versus-delete, violated assignment/capacity constraints, and competing state transitions. Do not resurrect deleted records automatically. Create multiple independent reports rather than treating them as competing versions.

Create a persistent dashboard Alert for authorized owners/admins, grouped by conflicted record with an unresolved count. Tapping opens a shared review flow on web/mobile showing:

- Record identity and affected fields, with sufficient original/base context.
- Current shared values and all competing proposed values.
- Author of each relevant field change, device-reported save time, server receipt time, and observed offline/online/unknown state.
- A per-conflicting-field selection followed by explicit approval, including confirmation for destructive choices.

Do not attribute every field in the current record to its most recent editor; retain field-level provenance where needed. Avoid including sensitive values in alert previews or push payloads.

Approval is a server-authorized transaction that checks the reviewed revision/candidate set, validates the assembled result, applies selected values, and audits the approver and decision. A concurrent edit or new candidate invalidates stale approval and requires refreshed review. Two reviewers cannot resolve the same revision independently. Mobile can view downloaded conflict details offline; approval is confirmed only online against fresh server state.

Losing candidates are discarded from active data, not erased from audit history (subject to retention policy). Notify affected users of the decision and update their local projections on reconnect. Keep unresolved Alerts until resolution, independently of read/unread status.

## All-feature behavior

Every mobile workflow must receive an explicit adapter and offline acceptance test, including fleet, crew, qualifications, issues, inspections/templates, notes, communications, documents, training, inventory, availability, tasks, preferences, receipts, payroll, invoices, notifications, company/account settings, assignments, feedback, and integrations where exposed on mobile.

“All features” means users can preserve work and queue supported intentions, not perform remote effects without a connection:

- Invitations, membership changes, integrations, sends, and external service actions remain pending until reauthorized and executed online. New accounts cannot authenticate offline.
- Payroll/payment/approval transitions are pending requests, not confirmed financial actions. Do not imply that recording a payment state transfers money.
- Training seats, exclusive vehicle/crew assignments, and inventory constraints are checked against current server data. Failed requests remain visible for correction or review.
- Inventory uses explicit adjustments rather than stale absolute totals; absolute corrections have their own conflict semantics.
- Queue uploads/download requests appropriately; only previously downloaded file bytes are readable offline. Generated local PDFs/exports can use downloaded data and must identify stale inputs where relevant.
- External fire/map/integration data shows last-known freshness. Live remote results cannot be fabricated offline.
- Deletions use tombstones and dependency-aware processing. Remote file removal waits until related mutations are safely confirmed.
- Notifications and other external side effects must not be duplicated by queue retries; use durable server-side delivery intents and provider idempotency where available.

## Implementation sequence

1. Inventory every mobile read/write and external side effect; specify data boundaries, invariants, permissions, and offline semantics. Define account retention and sensitive-data storage policy.
2. Implement shared operation/conflict types and pure three-way merge rules, with focused unit tests.
3. Add server revisions, durable receipts, authorized sync endpoints, conflict storage, and audit/alert integration. Migrate online writers to the concurrency contract.
4. Add SQLite local records/outbox, attachment persistence, scoped worker lifecycle, restart recovery, catch-up, and sync notices.
5. Migrate mobile workflows in explicit batches, including dependent writes and attachments. Maintain the inventory until every feature has coverage.
6. Add dashboard conflict Alerts and review/approval on both web and mobile; add submitter outcome notices.
7. Validate security, failure recovery, and rollout/version compatibility before enabling offline writes broadly.

Do not replace the current read-only banner with a promise of offline editing before adapters actually persist the corresponding operations.

## Implementation progress

### Shared foundation (implemented)

`packages/domain/src/offline-sync.ts` exports operation/provenance/status contracts, explicit present/absent field values, `createSyncPatch`, and `mergeSyncUpdate`. Both clients can consume these through `@fireops/domain`; no native dependencies are introduced into web.

The merge compares base/current/proposed values, merges independent changes, preserves conflict context, distinguishes absent values from null, and refuses to resurrect deleted records. Optional invariant field groups require review for related changes. A conflicting operation returns no partially applicable record. Inputs are validated as JSON, outputs are detached copies, and comparisons do not depend on timestamps or object key order.

Nested arrays/objects are currently indivisible fields. Each feature adapter must define editable projections (and flatten independently editable nested fields where appropriate), invariant groups, and server-side domain validation. These helpers alone do not authenticate authors, verify client base snapshots, authorize mutations, persist multiple candidates, or prevent concurrent writes.

Focused tests live in `packages/domain/src/offline-sync.test.ts`. Run `npm run test --workspace @fireops/domain -- src/offline-sync.test.ts` and `npm run typecheck --workspace @fireops/domain`.

### Durable native outbox (implemented, not connected to features)

`apps/mobile/src/lib/offline-outbox.ts` provides an injectable SQLite store. `offline-outbox-native.ts` lazily opens a separate, versioned `fireops-sync.db` on iOS/Android and explicitly refuses web. The existing response-cache database is unchanged.

- Enqueue commits the operation, dependency links, and local projection in one transaction. Save failures roll back all three. Reusing an operation ID for different work is rejected; identical retries do not regress newer local data or acknowledged status.
- Every query includes user/company scope. Activating another scoped session or pausing invalidates old handles. In-flight operations check scope before returning and before transaction completion; work invalidated before commit is rolled back. Persisted work is retained, not deleted on a scope change.
- Claims respect explicit dependencies, same-record ordering, retry deadlines, and expiring upload leases. Persistent attempt numbers/tokens fence late and duplicate results. A terminated worker's lease can be reclaimed after expiry using the same operation ID for eventual server idempotency.
- Applied receipts, pending-review receipts, retry errors, and blocked states persist. Awaiting-review proposals stay local and are never labeled synced. An acknowledgment cannot overwrite a newer local projection.
- A projection with `operationId: null` is confirmed; a null record is a deletion, distinct from no projection being stored. This is a local projection/receipt layer, not yet the authoritative download/catch-up cache.

Tests use Node's real SQLite implementation (Node 22.13+), including file close/reopen, SQL-triggered write failures, account-switch races, and stale acknowledgments. Native entry-point tests mock only the native module boundary. Run `npm run test --workspace @fireops/mobile -- src/lib/offline-outbox.test.ts src/lib/offline-outbox-native.test.ts` and `npm run typecheck --workspace @fireops/mobile`.

This module remains the storage layer; native worker/session and review-result integration are added by the subsequent slice below. Feature save handlers were not connected at this storage milestone; the limited native scalar editor is connected below. Attachment persistence, dependent-edit rebasing, and retention are not implemented. Feature adapters must reconcile/rebase sequential edits against acknowledged revisions and avoid superseded external side effects before replay is enabled. Retention/encryption decisions must precede sensitive-data workflow integration.

### First fleet server safeguards (migration added, not deployed here)

`supabase/migrations/20261109000100_fleet_sync_safeguards.sql` adds:

- Private `fleet_sync_revisions` for vehicles, issues, crew, and activities. Each revision records a PostgreSQL-computed SHA-256 fingerprint (not row values), changed field names, server time, actor where known, and origin. Baseline entries preserve existing versions but do not invent historical authors or edit times.
- BEFORE/AFTER triggers that assign monotonic versions to every fleet writer, including old RPCs, direct writes, and integrations. Deletes leave fingerprint-free tombstones; recreations cannot reuse old revisions. AFTER capture avoids phantom history from UPSERT's INSERT path. Changing record/company identity in place is rejected. Parent-company deletion removes history instead of recreating it.
- Private `fleet_sync_receipts` and `apply_fleet_changes_once(company UUID, operation UUID, changes JSONB)`. The RPC returns the same successful fleet-batch result for an identical retry, rejects UUID reuse for different work, rechecks current company access before receipt replay, and transactionally commits the mutations, revision history, trigger side effects, and receipt together.
- A dedicated non-login/non-BYPASSRLS `fireops_sync_writer` role that inherits authenticated permissions, owns the wrapper function but no fleet tables, and has only SELECT/INSERT on receipts. The wrapper calls the existing security-invoker fleet RPC, preserving its RLS and member-change guards. Normal clients cannot forge/read receipts or read revision history. An advisory transaction lock serializes same-key submissions; receipts are scoped by actor/company/operation, not a hash alone.

This is a retry-safe versioned batch RPC, **not** the final offline operation endpoint. A stale batch still returns `PT409`; no conflict candidate is stored yet. Clients are not switched to the new RPC. Existing direct writers now advance revisions but must still be migrated to explicit expected-revision contracts before offline replay is enabled. Fingerprints establish a trusted baseline for a future server-side three-way merge; they do not grant access or validate fields by themselves. The bridge RPC does not yet accept device-reported offline provenance.

Apply the new migration through normal Supabase migration tooling (no database reset). It locks fleet tables during backfill/trigger installation, so schedule appropriately for the dataset. The migration runner needs permission to create a non-login role, grant authenticated membership, and transfer function ownership. Verify role/grant behavior on the target Supabase PostgreSQL version before rollout. History/receipt retention must remain compatible with supported offline durations; do not prune blindly.

`npm run test:db-sync` runs real embedded PostgreSQL role/RLS/trigger/transaction tests using PGlite and a minimal Supabase fixture plus the production fleet policies/functions. This covers replay, permission failures, rollback, service writes, tombstones, UPSERT, fingerprints, and company cascades. It does not replace a full migration-chain deployment test or a multi-session concurrency/deadlock test against the target database.

### Verified fleet detail updates and persistent conflicts (migration added)

`supabase/migrations/20261110000100_fleet_sync_conflicts.sql` adds `sync_fleet_update(operation JSONB)`, accepting the shared schema-version-1 `SyncOperation` shape. This first adapter supports **current owners/admins (including scoped system-admin company access), UPDATE only**:

- Vehicle fields: `unit`, `type`, `year`, `make`, `model`, `vin`, `plate`, `notes`.
- Issue fields: `title`, `description`, `priority`.
- Assignments/readiness/status transitions, files, inspections, crew, creates/deletes, and crew-role submissions are rejected until their dedicated adapters are implemented. This restriction is incremental rollout, not a reduction of the agreed all-feature scope.

The endpoint validates identity, reported provenance, field shapes/allowlists, dependencies and full **raw** base-row fingerprints before reconciliation. A normalized display projection is not a valid base. Operation/entity/dependency IDs must be UUIDs. Payloads are limited to 1 MiB; device IDs to 200 characters; dependency lists to 100 unique applied operations in the same actor/company scope. Required fields cannot be removed; optional VIN/plate/notes removals are explicit presence markers. Device save times are untrusted reported ISO timestamps, never revision ordering.

It serializes operation-ID retries and locks the current record. Independent edits merge, identical outcomes produce no-op acknowledgments, and incompatible overlaps store an entire pending operation rather than partially applying its independent fields. Verified deleted records and delete/re-create lifecycles always require review; they are never silently recreated or changed using an old lifecycle's base. Existing production RLS and mutation triggers remain in force through the non-bypass executor.

Private `fleet_sync_submissions` durably records request fingerprints, provenance, and `SyncServerReceipt` results. Applied mutations and their receipts are atomic. A no-op receipt never claims authorship of somebody else's revision. Replaying a receipt still requires current manager access. These per-update receipts are distinct from the earlier fleet-batch bridge receipts: adapters must choose one endpoint and must not fall back between endpoints after an uncertain response.

`fleet_sync_conflicts` retains every candidate with base/current/proposed snapshots, affected fields, pinned revisions, author name/ID, device-reported save time/connectivity, and server receipt time. Current shared field provenance is derived from each field's actual last revision, not the most recent row editor. Accepted sync submissions supply their saved offline metadata; legacy writes have **unknown** connectivity. Baseline entries do not invent original edit timestamps/authors. Stored snapshots preserve available author labels across subsequent profile renames.

Conflict rows are SELECT-only for currently authorized company managers on either client; direct insert/update/delete is denied. Candidate insertion and the submission receipt are linked by a deferred FK and commit together, so failures leave neither orphan candidates nor successful unacknowledged mutations. Snapshots contain potentially sensitive values: keep the tables scoped and define retention before broad workflow rollout.

`merge_fleet_sync_fields` is the SQL counterpart to the pure domain merge. Both consume `packages/domain/test-fixtures/offline-sync-merge.json` to check merge parity, including missing/null values, field groups and indivisible nested data. The new `supabase/tests/fleet-sync-conflicts.test.mjs` also tests real PostgreSQL authorization, forged bases, multiple candidates/devices, provenance, replay, deletions, and rollback.

Approval and decision handling are added by the subsequent review migration below. Dashboard Alerts/review UI are added by the subsequent client slice below; native workers are added below, while attachment persistence remains pending. Receipt snapshots are historical acknowledgments, not a replacement for ordered authoritative catch-up; client integration must not overwrite newer downloaded state with an old receipt. Apply this migration after `20261109000100_fleet_sync_safeguards.sql`, with the same role/ownership prerequisites and target-version/multi-session verification.

### Guarded review, approval and submitter outcomes (migration added)

`supabase/migrations/20261111000100_fleet_sync_review.sql` adds:

- `get_fleet_sync_review(company UUID, entity TEXT, record UUID)` for current company managers. It returns the **fresh** current record/revision and per-field provenance, all pending candidates, offered field values, and an opaque review token. A fresh lifecycle-change flag warns about deletions/re-creations that happened after the candidate was first captured.
- `approve_fleet_sync_review(request JSONB)` with exactly `requestId`, `companyId`, `entityType`, `entityId`, `reviewToken`, and `choices`. Each affected field must select `current` or an offered candidate UUID; arbitrary values, unrelated fields, or dropping independent pending changes by omission are rejected. Selected historical values are revalidated against the current scalar-detail adapter rules.
- `get_fleet_sync_outcome(company UUID, operation UUID)` for a submitter who still has company access. It returns only their decision metadata (`kept`, `partially_kept`, or `not_selected`, with kept/discarded field names), never another person's outcome or historical record values. Demoted-but-current members can learn their result without regaining manager data access; removed members cannot.

Approval recomputes the review token under a record-group advisory lock and live-row lock. A changed revision, new candidate, or another reviewer's completed decision causes `PT409` and requires refreshed review. The token is a concurrency guard, not proof someone viewed the UI. Submission and review acquire group locks **before** row locks; the old submission implementation is now private behind this locking wrapper. Cached approval retries require current manager access, are scoped by actor/company/request ID, and cannot repeat mutations, outcomes or side effects.

Approved fields are applied over the current record, not by replacing it with an old whole-record proposal. Unrelated online changes survive. Keeping current values can reject all proposals without rewriting data. Deleted records can currently only be kept deleted; restoration needs a dedicated create/restore adapter. A live recreated record can receive explicitly selected scalar details after fresh review, without replacing its other data.

`fleet_sync_decisions` is an append-only manager-scoped decision audit, separate from the existing summary-only company audit log. It preserves approver identity/name, reviewed candidate IDs/token, selections, field sources, before/after snapshots, timestamps, and the retry response. Every candidate remains stored; only its state becomes resolved. `fleet_sync_outcomes` retains per-submitter field outcomes. Both tables are SELECT-only to normal clients, with RLS; only the non-bypass executor can insert through the RPC. Losing values are discarded from active data, not deleted from audit history.

A completely kept proposal's delivery `result` becomes an applied receipt so existing dependency checks can accept that parent. Its original upload acknowledgment is retained immutably in the new `initial_result` column, along with its original author/provenance. Partial/rejected parents remain blocked and require explicit client rebase/correction. Approval does not attribute all accepted parents to the new revision: decision field-source records preserve the original selected offline author separately from the approving manager. Future conflict capture and review use this source-aware provenance.

Record mutation, revision history, decision, outcomes, delivery results and candidate closure are one transaction. Failures even at the final closure step roll back everything. Historical receipt/decision snapshots still must not replace newer authoritative client data; workers must catch up and rebase dependent operations deliberately.

Shared `FleetSyncReview`, request/decision/outcome types and `suggestSyncReviewChoices` live in `packages/domain/src/offline-sync.ts`. The helper only suggests matching independent values (or identical current outcomes); it never submits approval. Conflicting values and lifecycle changes remain unselected. Both web and mobile review screens can use it to prefill safe choices and require explicit decisions for the remainder. Partially kept work needs a truthful future notice such as “Reviewed — some changes were kept,” not a blanket “Synced.”

Tests: `supabase/tests/fleet-sync-review.test.mjs` covers stale/competing reviews, idempotency, final-step rollback, field selection, deletion safety, permissions, provenance and dependency outcomes. `packages/domain/src/offline-sync-review.test.ts` checks safe client defaults. PGlite still does not replace target-version, full-migration-chain or real multi-session lock/deadlock validation. Apply this migration after the two preceding fleet sync migrations, using the same role/ownership prerequisites.

The frontend review endpoints are now connected by the client slice below. Native workers and submitter outcome notices are added below; the remaining feature adapters are still pending.

### Dashboard Alerts and online review screens (implemented, not deployed)

- Web `apps/web/src/OwnerDashboard.tsx` and mobile `apps/mobile/src/components/owner-dashboard.tsx` include persistent manager-only data-conflict Alerts, grouped by record with the pending proposal count. Opening an Alert does not mark it resolved or read; it disappears only after a server decision closes those candidates.
- Web `SyncConflictReview.tsx` and native `/sync-conflict?entityType=vehicle|issue&entityId=<UUID>` show current and proposed field values, authors, reported connection state, device save time, server receipt/record time, device identity, original downloaded values, and lifecycle warnings. Times include the viewer's time zone. Missing/null/empty values are distinct. Current-record provenance can also identify the approving manager separately from the original offline author.
- Both clients use shared scoped state in `packages/domain/src/sync-review-client.ts`. It validates response identity and candidate/field references, suggests only safe independent defaults, requires every field selection and explicit UI confirmation, rejects stale review tokens, and presents per-proposal kept/partly kept/not-kept summaries.
- An uncertain approval freezes selections/navigation and offers a confirmation retry using the **same request ID and payload**. It never silently submits a replacement decision after a dropped response. Successful receipts are not written directly over active fleet data; native refreshes fleet data, while web uses its existing fleet subscriptions.
- Pending Alert queries page through all results. Because conflict tables are not yet published to Realtime, clients refresh on foreground/focus/reconnect, manual refresh, and a 30-second poll while active. A missing table/RPC (`42P01`, `42883`, `PGRST202`, `PGRST205`) produces an unobtrusive setup-pending message, not a dashboard crash or a fabricated “no conflicts” result. Permission/network errors remain distinct failures. Demo mode, nonmanager roles and native session/account mismatches do not issue review requests.
- Native review/approval RPCs explicitly require a connection; approval is not queued or confirmed offline. Already displayed in-memory review details may be read while disconnected, but fresh review/approval requires reconnection. At this review-screen milestone the offline banner was read-only; the later scalar-editor slice adds a narrowly scoped capability notice.

Tests include shared controller validation/pagination/scope/race/retry tests, web server-rendered markup unit tests (not visual tests), and native transport/authorization/offline guard tests without loading a native UI. The user still performs visual UI testing.

### Native worker, live reconciliation and sync notices (implemented, not deployed)

`OfflineSyncProvider` is mounted inside the native session provider. It activates one user/company-scoped SQLite session only after restored identity and downloaded company access agree. Demo mode, system-admin company selection without a selected company, native account mismatches and web do not start workers. Foreground/reconnect resumes recover interrupted attempts; backgrounding, offline transitions, sign-out and identity/company changes pause or stop delivery and fence late results. Active pending work is checked every 15 seconds; background execution is not promised.

`apps/mobile/src/lib/offline-sync-worker.ts` is a single-flight worker with bounded request timeouts, abort signals, durable retry backoff and stable server operation IDs. Restart/foreground recovery resets interrupted leases and old wall-clock retry deadlines without changing operation identity or losing acknowledgments. It never automatically sends unsupported commands, assignments, files, or edits needing dependency rebase. The current transport targets only the completed manager vehicle/issue scalar-update endpoint. Unauthorized/invalid work is preserved with an actionable blocked state, not discarded or overwritten.

The native outbox now migrates **v1 → v2** transactionally, preserving work and projections. It adds durable `delivery_json`, `review_outcome_json`, and completed-notice dismissal metadata. Delivery is persisted **before** verification. If the server accepted a change but catch-up failed, subsequent attempts skip re-upload and only retry the authoritative read. If even delivery persistence failed, retry uses the original operation ID so the server deduplicates the uncertain mutation. Storage failures never report a successful sync.

`supabase/migrations/20261112000100_fleet_sync_record_read.sql` adds `get_fleet_sync_record(company, entity, record)` for the current fleet adapter. It uses the same non-bypass executor and current manager checks, returning a raw record/revision or a ledger-proven tombstone. An absent/inaccessible row without a proven deletion is denied, never interpreted as a deletion. The transport uses an uncached POST RPC rather than the existing GET response-cache fallback, binds each call to that account's SDK session token, and checks identity/readiness again after asynchronous session restoration.

Applied upload receipts are not marked synced until the authoritative returned revision is at least the acknowledged revision. Canonical results update only the matching operation's local projection; newer pending overlays survive. This is **per-operation reconciliation**, not complete company-wide download/change-feed catch-up or the normalized offline read model. Those remain prerequisites for workflow rollout.

Awaiting-review operations poll only the submitting user's authenticated outcome endpoint. Outcomes are persisted before reconciliation. Kept proposals settle; partly kept/rejected proposals display truthful outcomes and are never automatically resubmitted. Dependent edits remain blocked pending explicit rebase. A verified review decision can still settle an operation after demotion: if current raw-record access is denied, remove the matching pending overlay rather than cache forbidden data or fabricate a deleted record. Original operation/proposal history is retained. Newer dependent overlays are never erased by their parent's outcome.

The root native sync notice and **More → Saved changes & sync** show saved-on-device, uploading/verification, awaiting-review, blocked, synced, partly-kept and not-selected states. Completed results persist until explicitly dismissed; dismissal hides notices, not operation history. The details screen can reveal completed device history. Account/company transitions hide the old scope immediately, and the UI distinguishes storage/loading errors from an empty queue.

Native sign-out checks unresolved work across **all companies for that user**. Users can stay signed in or explicitly keep account-bound device work and sign out; no queue is silently deleted. The warning states that work not uploaded has no server backup. If sync storage cannot be checked, users may explicitly sign out anyway rather than being forced to stay signed in. The guard rechecks restored identity before/after confirmation, pauses the worker during sign-out, and cannot log out or resume a replacement account. Web sign-out does not acquire offline storage behavior.

Focused tests cover real SQLite migration/restart/leases, staged acknowledgments, timeout/pause/account races, canonical revision/identity checks, review privacy/outcomes, unsupported/dependent operations, final storage failures, notices, sign-out retention and token-bound POST RPCs. The server suite verifies live revisions, deletion proof, role/company scope and unsupported-table denial. No native UI, application server or visual testing was launched.

**At this worker milestone, feature saves were not yet enabled.** Subsequent slices connect normalized reads and limited scalar saves below. Attachment bytes, full catch-up, sensitive-data encryption/retention and dependent-edit rebase remain pending. This must not be advertised as all-feature offline mode.

### Verified bases and atomic detail-edit boundary (implemented; UI connected below)

The native outbox now migrates **v1 → v2 → v3** transactionally. `offline_records` stores complete raw vehicle/issue records, decimal revisions, proven tombstones, and device-reported download time separately from projections and the HTTP cache. Every record query is account/company scoped. Revisions use integer comparison without JavaScript-number precision loss. Older downloads cannot replace newer data; different data for the same revision is rejected. `offline_devices` retains a stable per-account installation ID across companies/restarts, without sharing identifiers between accounts.

Canonical upload/review reconciliation commits the verified raw record and operation completion together. A failed raw-cache write rolls back completion; a historical result cannot downgrade a newer cached revision or its matching confirmed projection. Lost raw-record permission after a verified review removes the cached record, not the preserved operation history, and never invents a deletion.

`apps/mobile/src/lib/offline-detail-editor.ts` captures a private, detached verified base when preparing an editor. Online preparation uses the account-bound, uncached POST read RPC; offline preparation requires a previously verified live record. GET display normalization and cached HTTP responses are never treated as verified bases. Borrowed drafts, invalidated account/permission scope, unsupported fields, invalid values, deleted records and unchanged saves are rejected. It supports only the existing manager vehicle/issue scalar adapter. The later saved-detail screen is its first native UI caller.

The provider exposes this boundary through its existing active session, not another `activate()` handle. Saves enqueue a full raw base plus changed-field patch and local projection in one transaction, retaining stable operation ID, device identity, device save time and observed connection state on retries. Concurrent duplicate saves coalesce by operation identity. Independent edits to an already-pending record are rejected atomically until completion/review; dependency rebasing is deliberately not bypassed. A fresh explicit edit after rejection uses a new verified base and does not automatically resend the discarded proposal. Failure to refresh notices after a committed save does not misreport persistence as failed.

Foreground/reconnect/manual worker runs also refresh **previously cached raw records**, including when no upload remains. Permission failures remove unavailable bases; stale revisions cannot downgrade them. This is bounded to individually cached records, not full-company download coverage, a checkpointed change feed, or a normalized offline read model. Newly discovered records still need an explicit verified download before offline editing. No UI or existing online writer has been switched to these methods.

Targeted native checks: **95 tests** across outbox/native storage, worker, protocol, transport, sign-out and conflict-review hooks; mobile typecheck and diff whitespace checks. New coverage includes v1/v2 migration, 18-digit revision ordering, conflicting revision data, raw-cache/completion rollback, scoped device IDs, concurrent enqueue exclusion, same-intent retries, verified issue/vehicle patches, fresh edits after rejection, and real database file close/reopen followed by reconnect reconciliation. Server migrations are unchanged by this slice. No deployment or UI launch occurred.

### Normalized fleet reads, local previews and native write guards (implemented; saves still disabled)

`apps/mobile/src/lib/offline-fleet-model.ts` projects account/company-scoped verified vehicle/issue records into fleet reads. `fleet-store.ts` keeps its online snapshot/version maps separate from the displayed model. Cached canonical revisions beat stale HTTP fallback; newer online data beats older downloads. Pending scalar patches affect only their changed fields, preserving unrelated online fields and files. These displayed records are **never verified edit bases**. Manager-only cache access is hidden after account, company or role changes; fleet repository identity and realtime callback epochs now include account/role even within the same company.

Previously verified records and local proposals can appear after restart even when HTTP cache reads fail. Proven tombstones remove confirmed rows, but pending proposals remain separately labeled until review. An observed realtime deletion suppresses an older cached row while the live RPC obtains durable deletion proof; it is not written as a fabricated SQLite tombstone. Rejected/discarded proposal values are removed from the preview without deleting audit intent, and newer dependent overlays survive older completions. Fleet rows and detail screens display local proposal/review status, not an implied successful shared mutation.

The provider publishes raw records and pending entries from its existing session/worker. Legacy fleet refreshes, realtime changes and acknowledged native writes wake known-record reconciliation. Manager-cache records are not published by the worker after manager access is withdrawn. This remains reconciliation of previously verified records, not a complete company-wide download/change feed or attachment download inventory.

Native legacy fleet writes are guarded against both queued work and in-flight local enqueue. Per-record reservations cover the asynchronous pending-work check through the online request; duplicate identical enqueue attempts can reenter, but competing actions cannot. Linked issue edits conservatively block parent vehicle actions, including deletion even when a caller omitted the issue from its list. A still-displayed pending snapshot remains guarded even if SQL has just settled its operation. Storage initialization/failure is fail-closed for affected native fleet writes rather than bypassing pending-work checks.

Native vehicle/issue read objects retain private scope/revision/pending stamps. Legacy actions cannot reuse an unconfirmed preview, an old account's object, or a stale revision. Vehicle and issue detail forms capture their original revision/scope, rather than substituting a mutable current realtime token at save time. Captured expected revisions survive uploads and asynchronous queue checks. Online fleet RPCs bind the verified SDK user's bearer token; late responses cannot update another identity's repository. Failed vehicle **updates** no longer claim success merely because a verification query finds that the vehicle already exists.

The detail-edit boundary now reserves records before enqueue and publishes successful verified downloads through the worker. Verified downloads also race abort/timeouts explicitly, so a stuck session restoration cannot leave preparation waiting indefinitely. At this read-model milestone no screen/form called its offline methods; the later saved-detail slice connects them while preserving the unsupported-action request guard.

**Rollout blocker found (addressed by the following slice):** main web `App.tsx`/`FleetApp.tsx` had whole-snapshot/debounced saves that could take expected revisions from a newer mutable map after a form captured older values. That can overwrite newly synced fields even though revision triggers are active. Harden those online writers and their pending-versus-realtime behavior before enabling native detail-save UI. Web remains online-only; no web offline behavior was added.

Targeted checks: **132 native tests** (outbox/native storage, worker, protocol/transport, scoped read-model/gate, production fleet repository with injected SDK/hooks, sign-out, conflict-review hooks and inspection confirmation), plus mobile typecheck and diff whitespace checks. No UI/server launch, server migration change or deployment occurred.

### Online web writer safeguards (implemented; no web offline mode)

These changes protect mobile-synced fields from stale browser writes. **Offline editing remains mobile-only.** Web gets no SQLite/outbox, offline read cache, persistent retry queue, background replay or offline-save claim. Pending browser requests/drafts below are ordinary in-memory online form state, lost on page exit; navigation/sign-out and browser-unload warnings make that limitation explicit.

`apps/web/src/online-fleet-writes.ts` binds issued UI records to their original collection/identity/revision and wire values. `FleetApp.tsx` issues tokens for normalized initial reads and hydrated realtime rows. Whole-record mutations/deletes use the captured token, never the mutable latest version map. Unseen remote inserts are not inferred deletions; an old update never becomes an insert after deletion/recreation. Unknown, modified or foreign-scope bases fail closed. A role-only receipt no longer promotes an old whole crew object to a newer revision. Complete batch acknowledgments are validated before promoting matching submitted UI values.

Each online batch has immutable wire data, expected revisions and an operation UUID. It uses `apply_fleet_changes_once` when available, with the original actor's verified bearer token, scope checks and bounded request timeout. Only a definitive missing-function `PGRST202` can select the legacy `apply_fleet_changes` endpoint, before that endpoint has been attempted. Uncertain delivery never changes endpoints, operation identity or values. The legacy path remains protected by original CAS versions/IDs but cannot prove receipt-based replay after a lost response; it may require checking refreshed server data rather than receiving a successful retry. Permissions, stale writes, internal setup errors and timeouts do not trigger mutation fallback.

`online-fleet-edit-session.ts` preserves the first displayed base and captures the submitted snapshot **before** debounce. It does not read a newer `latestSnapshot` when a request/retry eventually executes. Concurrent retries share the same request. Further generic fleet edits wait until the current save finishes; failed/unconfirmed values remain on the open page and retries reuse the original snapshot. Incoming realtime rows/deletions are buffered, not copied over local work or echoed back to persistence, then applied after acknowledgment. Same-account updates from another device are no longer hidden as presumed local echoes. Component identity, async hydration, deletion markers and late acknowledgments are scope/version fenced.

Stale vehicle and issue forms keep entered values and reject submission instead of rebasing old values onto a newer live prop. Photo replacement rechecks its original vehicle after upload. Vehicle editing preserves unrelated inspections/custom documents. Assignment Undo merges only its status/assignment fields onto the current vehicle, preserving newer mobile notes/files, and refuses to undo a superseding assignment. Save status/toasts distinguish an online save in progress from confirmed completion. Discarding a page is explicit; no browser draft is represented as durable offline work.

File cleanup runs only after validated acknowledgment, excludes still-referenced paths, and no longer deletes another open editor's unused pending uploads. Failed, uncertain or invalid acknowledgments retain ownership of uploaded files. Completed cleanup failures do not turn committed business writes into failed saves.

Targeted validation: **76 web tests** covering pure plans/transport, actual production workspace/form/debounce callbacks with injected dependencies, and existing fleet contracts; web typecheck; **21 embedded PostgreSQL fleet batch/revision/RLS tests**; diff whitespace check. No UI/server launch or visual testing. Server migrations are unchanged and nothing was deployed. PGlite remains no substitute for target-Supabase migration and real multi-session validation.

This hardens the existing online fleet boundary; it does not complete every workflow's permission/invariant/attachment adapter or enable native saves by itself. Native vehicle/issue detail UI and per-record verified-download availability are added by the following slice.

### First native offline detail editor (client implemented; backend not deployed here)

Installed iOS/Android owners/admins now have **Download / edit saved details** on vehicle and issue detail screens. Opening it online downloads the complete raw record/revision through the verified POST read RPC and stores it in scoped SQLite, even if the user leaves without editing. Subsequent offline opens require that verified download; ordinary HTTP/display cache is not enough. Native Edit actions route to this editor while offline; existing full-feature online editors remain available while connected. Demo mode, web, nonmanager roles, mismatched sessions, unsupported targets and unavailable records do not expose an offline save form.

`/saved-details` exposes only the completed scalar adapter:

- Vehicle: unit, type, year, make, model, VIN, plate, notes.
- Issue: title, description, priority.

Files, photos, readiness/status, assignments, updates, inspections, creates/deletes and all remaining workflows stay online-only. The screen and banner say so explicitly. This advances the agreed all-feature rollout; it does not narrow its eventual scope or claim completion. The first UI version accepted one unresolved edit per record; the continuation slice below adds repeated saves. Different downloaded records can each have saved changes.

The form retains the original privately owned draft, raw field types and verified revision. It submits only explicit field changes, without defaulting missing/null fields or converting unchanged raw values into display-normalized values. No-op trimming and validation errors leave the form editable. Save calls the provider-owned durable boundary; only after SQLite enqueue resolves does it display **Saved on device**. Inputs then represent a labeled **submitted copy**, not current shared values. Sync/review status remains in the root notice and Saved changes & sync. Save failures retain original values/identity for safe retry; duplicate taps and late editor/scope results cannot create replacement saves or update another form.

If live verification fails but a verified download still exists, **Use verified download instead** allows explicit device-only work even when network detection reports online (for example, a server outage). Provenance still records the app's actual observed connection state, not a fabricated offline flag. No GET fallback becomes a verified base. A permission-denied read removes and republishes the unavailable cached base; downloaded-only preparation cannot bypass that removal. Missing database setup is explained and no unverified record becomes editable.

The offline banner advertises only the saved vehicle/issue detail editor when the current manager has verified records; otherwise it remains read-only. The HTTP mutation guard still rejects unsupported offline requests and now directs users to the limited editor rather than claiming all offline changes are forbidden. Storage/sign-out retention, account isolation, original operation IDs, authoritative refresh, independent-field merge, whole-operation conflicts and audited per-field review continue through the existing worker/server contracts.

Targeted checks: **159 native tests**, mobile typecheck and diff whitespace checks; **55 embedded PostgreSQL merge/conflict/review/read tests**. Coverage includes field inventory/normalization, no-op/invalid inputs, native-only/current-identity route guards, save feedback after commit, exact retry bodies, duplicate taps, late results, downloaded-only outage editing and permission-denied cache removal. The real SQLite close/reopen test now starts with the actual form adapter, restores its local preview without HTTP cache, reconnects, and verifies canonical refresh preserves unrelated shared fields. No UI/server launch, visual testing or deployment occurred.

#### Manual validation when backend/client are ready

1. Apply all pending migrations in order to a test environment and validate actual Supabase roles/RLS/concurrency before production rollout.
2. On installed mobile, sign in as owner/admin and open a vehicle/issue saved-detail editor online. Confirm verified revision/download metadata; return without saving to prove the download is retained.
3. Disconnect and restart. Open the downloaded editor, change supported details and save. Confirm local-preview labels and a waiting-to-sync notice, then restart again to verify retention. A never-downloaded record must remain unavailable.
4. Save repeated same-record edits, including a revert, and verify ordered recovery. Changed review outcomes/overlapping fields must require explicit rebase; other records remain independent. Unsupported actions still require a connection.
5. Edit independent fields from another online account, reconnect the phone in foreground, and confirm merge/canonical refresh. Repeat with overlapping fields; verify Alerts/review on web/mobile and truthful kept/partly-kept/not-selected outcomes with preserved audit values.
6. Check account/company switching, permission loss, retained-work sign-out warnings, server-outage downloaded-copy choice and failed-save retries. Never uninstall/clear app data to recover unsynced work.

### Repeated native scalar saves and verified continuation materialization

Native scalar editors now open over the latest canonical data plus local field overlays, and retain which earlier saved operation they follow. Each later save commits a new operation, dependency and projection atomically. Stale concurrent editors cannot branch around an intervening local save. Uploading, uncertain and review-pending operations remain immutable; later intent never replaces their request bytes or IDs.

SQLite migrates v3 → v4 without discarding operations, adding local continuation metadata and scoped `offline_rebase_history`. Waiting continuations are **not wire-ready verified bases** and cannot be claimed by the worker. Once an earlier operation is fully applied/kept and a canonical raw record exists, a three-way check compares the later edit's displayed base, its patch and that canonical record. Only independent/identical results produce a new verified wire base/patch, in the same transaction as rebase history. User save time/connectivity, operation ID, dependencies and original draft/audit values remain preserved. Even reverting an earlier offline edit back to the original value is a real sequential intent, not a redundant stale patch.

Rejected/partly-kept parents, overlapping newer fields, deletion and unavailable canonical data block the continuation for explicit rebase. Retry cannot bypass that decision. Other records keep syncing; newer local overlays survive older acknowledgments. Materialization never claims uploaded/synced work merely from a local merge. The server still validates the canonical fingerprint, current permissions, dependency receipt and live merge before accepting the materialized request.

Native tests include three offline saves/reverts followed by ordered reconnect, preservation of unrelated server changes, no claim before materialization, stale siblings, rejection/overlap blocking, transactional audit rollback and original-save retries after materialization. Explicit rebase UI is connected by the next slice below; no git/Supabase push or deployment occurred.

### Explicit local continuation review

Blocked never-uploaded continuations now expose **Review / rebase later edit** in native Saved changes & sync. Current owner/admin identity is required. The screen compares each changed field's local value when saved, saved proposal and current verified download, including distinct absent/null/empty/type displays. Every field requires an explicit downloaded-versus-saved selection, followed by confirmation. This is local preparation, **not server conflict approval**; server permissions and live conflicts are still checked on upload.

The scoped review object is privately owned and detached. SQLite rechecks the original unsent operation and exact canonical snapshot before committing; a newer record or different review requires refreshed choices. Only zero-attempt waiting drafts can change. An explicit decision starts from the canonical record, drops failed-parent dependencies and includes only selected child changes, never discarded parent values. Keeping all downloaded values produces a legitimate no-op request, not a fabricated synced/rejected result. Audit snapshots, dependency changes, operation and matching projection commit or roll back together. Original save provenance is retained, duplicate decisions are idempotent, and late scope results cannot update another screen.

All discarded local values and choices remain in scoped rebase history. Server backup of that device history is implemented by the subsequent slice below, before new history-bearing changes can be considered fully backed up. The ordinary server conflict/decision audit already remains immutable. Targeted native tests cover stale/borrowed reviews, all-field confirmation, storage rollback, failed-parent severance, exact retries and deleted-record denial. No deployment or UI launch occurred.

### Atomic server backup of device-reported history

`20261113000100_fleet_sync_device_history.sql` adds an append-only, manager/company-scoped `fleet_sync_device_history` audit and `sync_fleet_update_with_history`. The wrapper uses the existing non-bypass executor and record-group-before-operation lock ordering, verifies scope/author/record identity, known same-record parent submissions, preserved original provenance, coherent snapshot chains, automatic merge results or explicit per-field choices, and exact final submitted body. Request size and chain length are bounded. It then calls the existing verified scalar/RLS endpoint and records all before/after versions and discarded local values in the **same server transaction**. History failures roll back business changes, conflicts, receipts and trigger effects. Exact retries reuse the original audit; different history for an existing operation fails. Current manager permissions are required even for replay.

Original device save time/connectivity remain device-reported; local rebase `createdAt` is also device-reported. Audit receipt time and actor identity/name are recorded server-side. This history is **not** canonical revision provenance or a manager approval. Both review clients now call candidate bases the submitted verified base, rather than falsely claiming a rebased snapshot was the user's original local view. The following slice adds a dedicated online history inspector.

The native worker loads retained history before delivery and uses the atomic RPC whenever it exists. A ready continuation missing its history fails closed. Missing migration errors retain the original operation/history and show setup pending; there is no fallback that silently drops audit data. Only acknowledged submissions proceed to canonical reconciliation and synced/review states. This applies to newly delivered work. The older-build recovery slice below adds guarded backfill for completed development-build drafts. Do not treat those earlier test builds as a supported production rollout.

Targeted checks cover native transport/worker stable history retries and missing-history denial plus embedded PostgreSQL permissions, values, idempotency, conflicts, rejection of forged/mismatched reports and final audit-storage rollback. Full target-Supabase compatibility and multi-session validation remain required. No push, migration deployment or UI launch occurred.

### Online device-history inspection (web and mobile)

`20261114000100_fleet_sync_history_reads.sql` adds current-manager, RLS-enforced, security-invoker read RPCs. Record-scoped summaries use bounded 20-row keyset pages with server timestamp/actor/operation tie-breaking; complete snapshots are fetched only for one explicitly selected report. Reads remain available after record deletion, without recreating records or treating missing history as deletion proof. Report lookup binds company, entity, record, submitter and operation. Neither endpoint can write or approve anything.

Web Command Center includes a record picker and record-ID input (including deleted records). Native vehicle/issue details and retained sync-status entries link to the same review/history screen. History loads independently of pending conflicts, so completed or rejected work remains inspectable. Both clients show saved/discarded proposals, original local view, downloaded rebase base, resulting submission, explicit choices or independent merge, authenticated submitter/device, reported original-save/rebase times and separate server receipt time. Full device-reported snapshots are inspectable. Resulting submissions are explicitly **not** presented as confirmed shared outcomes, canonical field authorship or manager approval sources.

The shared inspector is online-only and memory-only, with separate list/detail epochs, cursor/scope validation and clearing on account/target disposal or permission failures. Authenticated POST RPCs bind the expected SDK account's bearer token; native rechecks connectivity after asynchronous session restoration. No HTTP fallback, offline history cache, queued history request, approval-source option or web offline capability was added. Missing migrations affect history inspection only, not existing review choices or immutable approval retries.

Targeted tests cover controller scope/lifecycle/races, source/value distinctions, XSS-safe web content, native content with stub components, actual hook transports, manager-only database reads, deleted-record retention and tied-timestamp pagination with newer concurrent insertions. Target-Supabase multi-session validation and user-run UI testing remain pending. No push or deployment occurred.

### Older-build history recovery

Native SQLite upgrades v4 → v5 without deleting records, operations, dependency history, devices or notices. Ready continuations now carry a durable history-backup confirmation flag. Previously completed or dismissed continuations conservatively start **backup pending**; their recorded business outcome is not changed. Unconfirmed history remains visible, cannot have its notice dismissed as complete, and counts as retained work in the cross-company sign-out guard. New deliveries record confirmation only after the atomic history endpoint acknowledges the exact operation/history; failed local confirmations remain safely retryable.

`20261115000100_fleet_sync_history_recovery.sql` adds `backfill_fleet_sync_device_history`. It requires the original submitter's current manager access, matching company/entity/record, an existing server submission, and its exact original request hash. Record-group/operation locks match existing ordering; a key-share row lock prevents receipt deletion between verification and cached replay. Only then does it call the existing atomic history wrapper, whose cached receipt path cannot apply the business operation again. Deleted records stay deleted; newer shared data and pending reviews remain unchanged. Unknown submissions, altered payloads or revoked access never trigger ordinary delivery, automatic rebasing or replacement intent.

Foreground/manual recovery uses that endpoint only for previously acknowledged/completed entries, at most 100 per pass. It never replaces their original wire payload, save provenance, receipt, canonical projection or review outcome. Individual missing/mismatched submissions retain their local history while other recoverable entries proceed; auth/setup/storage failures stop the pass. Confirmation is scoped, transactional and survives restart. Late responses after pause/account replacement cannot confirm another session's work. Missing server history/receipts require investigation or explicit future recovery tooling; **do not reset storage or silently resubmit completed work**. Supported downgrade to an older app is not promised: older clients must reject an unsupported database version.

Targeted tests include a real v4 database close/reopen/upgrade with dismissed completed history, exact retry after SQLite confirmation failure, source mismatch, late account switches, unavailable migrations/permissions, backend unknown-receipt denial, newer-record and deletion preservation, pending-review deduplication, and current-actor checks. Web stays online-only; its inspector automatically sees reports recovered on mobile. Validation: **196 native tests**, mobile typecheck, **100 embedded PostgreSQL/grant tests**, and whitespace checks passed. No push, deployment, app launch or visual testing occurred.

### Opt-in verified bulk downloads and reconnect catch-up

`20261116000100_fleet_sync_download.sql` adds manager-only authenticated POST inventory pages for **vehicles and issues only**. Current manager access, current raw rows, ledger fingerprints, proven tombstones, counts and the inventory token are evaluated in one SQL snapshot. Hidden/inconsistent/untracked live rows fail closed; an unavailable row is never reported as deleted. A SHA-256 fingerprint covers the latest per-record revisions/deletion states, not wall-clock timestamps or an allocating sequence. Subsequent pages require the same fingerprint; any committed insert/update/delete/recreation—including insertions behind the cursor and same-value ABA edits—forces restart. This avoids a transaction committing out of sequence being silently skipped. Crew/activity data is excluded.

*(Superseded 2026-10-23: the download is now automatic; see “Automatic background downloads”.)* Installed-app managers opted in from **Saved changes & sync → Download / refresh all vehicle and issue details**. Consent states that full raw vehicle/issue records are stored, not attachment bytes or other workflows. SQLite v6 atomically commits each page, snapshot membership, cursor and coverage counts. Completed coverage requires every page, matching live/deleted counts and no previously verified IDs missing from the authoritative inventory; absent IDs are not fabricated into tombstones. Cached newer revisions always win; same-revision inconsistent data is rejected. Partial scans and their exact cursor survive restart. Scan generations fence cancellation/restart races and account changes. Permission denial invalidates unavailable canonical cache, not saved operations, projections of pending intent or immutable history.

Once opted in, foreground/reconnect/manual runs discover new records as well as refresh existing records and process proven deletions. Scan churn gets two automatic restarts, with a 100-page (2,500 tracked-record) pass limit; unfinished progress continues on later foreground runs. This is a correctness-first bounded **full inventory scan**, not an optimized delta feed or promised background service. Every page recomputes a company-scoped fingerprint; large/high-churn companies need performance validation and may remain partial until a stable interval. Stopping company-wide catch-up keeps downloaded records and saved work; ordinary per-record refresh remains available.

Status separates saved-live-record counts, partial/complete tracked-record coverage (including deletion proofs), last completed scan's server request time, and download errors. A completed scan describes a verified inventory snapshot, not a promise that no newer edits exist. Bulk download completion is not outbox completion or all-feature offline availability. Roles/account changes hide scoped cache/coverage; late pages cannot cross sessions or replace newer generations. No web offline feature, unverified HTTP fallback, server deployment, app launch or visual testing was added.

Tests cover real SQLite page rollback, count validation, stale-cache/deletion rules, v5 upgrade preserving existing confirmations, close/reopen cursor resumption, cancellation/demotion, bounded churn retries, explicit opt-in, account isolation, RPC bearer binding, backend scope/RLS/integrity checks and cursor invalidation after concurrent logical changes. Validation: **213 native tests**, mobile typecheck, **107 embedded PostgreSQL/grant tests**, and whitespace checks passed. Actual target-Supabase multi-session and installed-device UI/performance checks remain required.

### Durable attachment storage foundation (not a file-upload adapter)

Native SQLite v7 adds scoped immutable attachment intents, explicit staging/ready/missing/discarding/discarded states and atomic operation references. Reservation is written **before** copying bytes. A 10 MiB per-file / 100 MiB per-user retained-byte limit is enforced transactionally across companies. Full save acknowledgment requires a private document-directory copy, exact byte length/SHA-256 verification, promotion from a partial file and a committed readiness record. Picker/cache/network URLs are never durable storage pointers; source URIs are not persisted. Original name, declared MIME type, save time/connectivity, device ID and actor/company/record identity remain in the manifest. MIME type is reported metadata, not content validation.

The vault serializes file work across replaced provider instances, checks current scope/manager capability around asynchronous work and recovers complete partial/final copies without the picker. Hash failures become missing/inconsistent work, never upload-ready data. It does not overwrite a corrupt final copy without explicit repair. Discard is journaled before deleting only opaque-ID managed files; interruptions resume cleanup and preserve the original picker file. Metadata survives discard. Bound files cannot be discarded: operation/projection/reference insertion is atomic, retries retain the exact reference list, and bindings require ready same-account/company/record manifests. Staged/missing/bound files remain retained work in the cross-company sign-out guard. Counts now represent retained work items, including files, not solely business operations.

No business attachment workflow is enabled by this foundation. The scalar worker explicitly blocks any attachment-bearing operation rather than uploading scalar fields while silently dropping files. All existing connected file editors remain unchanged. Verified remote-object ownership, upload/lost-response reconciliation, business-reference receipts, safe release of bound files and encryption/retention still need dedicated adapters. App-managed bytes are **not encrypted by this slice**; sensitive file workflows must not be enabled on that basis.

The native implementation uses SDK-compatible `expo-crypto ~57.0.3` for SHA-256, not custom cryptography. Installed custom native builds need the matching module before staging is enabled; crypto loading is lazy so an older binary cannot crash at provider import. During installation/audit, the repository reported 35 dependency advisories (7 moderate, 25 high, 3 critical); no `expo-crypto` advisory entry was returned. No unrelated/breaking audit fix was run. Broader dependency remediation remains a separate security task.

Tests use actual SQLite/files for close/reopen, picker loss, disk-full copy/metadata failures, promotion recovery, corruption, exact retries, atomic bindings, cleanup interruption, quotas, account replacement and v6 upgrades. Native API tests cover sandbox paths, byte hashing, local-only sources, managed-file borrowing refusal and web disablement. Validation: **231 native tests**, mobile typecheck and whitespace checks passed. No server migration, upload, deployment or visual testing occurred.

### Provider-owned attachment inspection and explicit repair

The existing native sync provider now owns the vault/controller through its **existing scoped outbox session**, not a competing `activate()` handle. Current account/company, manager role, foreground state and sign-out pause fence file work. Background, role/account changes and teardown clear published metadata and invalidate late acknowledgments; returning to the account resumes integrity checks and pending cleanup. Crypto remains lazily loaded, so ordinary scalar work does not require a crypto call when there are no retained file manifests.

Saved changes & sync lists retained attachment drafts only when present (or checking/error). It separates verified local copies, unconfirmed staging, unavailable/unverified bytes, pending cleanup and discarded metadata. Original reported time/connectivity/device, declared MIME, byte count, SHA-256 and operation bindings are inspectable. A root notice explicitly says these drafts have **no confirmed server backup or shared-record attachment**. Checks are not uploads. Sensitive-file intake remains disabled; existing file-edit/upload workflows remain online-only.

Explicit **Restore exact original bytes** uses a local picker with a current-scope guard after selection. Repair requires the original SHA-256 and byte length, preserves metadata/reference intent, marks verification pending before copying, and removes a corrupt final file only after a matching partial exists. Interrupted repair is recoverable from that partial. It can restore a referenced file without changing its operation or bytes' meaning. Different selected content never replaces the original intent. Unbound deletion requires explicit confirmation and a fresh reference check; bound files stay protected. Picker/dialog responses after an account/role/route change are ignored. No new business file selection, automatic upload, remote cleanup or file-reference mutation was enabled.

Tests exercise real-file repair (including interrupted repair and immutable bindings), controller availability/late-result fencing and picker/confirmation guards. Native content tests use stub components without mounting the app or launching UI. Validation: **244 native tests**, mobile typecheck and whitespace checks passed. Encryption, remote object verification, upload acknowledgment recovery, permission-aware attachment adapters and safe bound-file release remain pending. Nothing was pushed or deployed.

### Remote attachment upload reservations (migration added; no upload flow enabled)

`20261117000100_fleet_sync_attachment_uploads.sql` adds a separate private `fleet-sync-files` bucket (10 MiB; JPEG/PNG/WebP/GIF/PDF declared types) and private append-only `fleet_sync_attachment_uploads`. `reserve_fleet_sync_attachment(manifest)` accepts exactly the native retained-manifest shape, requires the authenticated actor to be the manifest user with **current** owner/admin access (rechecked on every replay) and a live target vehicle/issue visible to them now. A hidden or missing target is unavailability, never inferred deletion. The stable object path is `company/user/attachment`. Identical retries return the original reservation; any different bytes, name, provenance or target for that identity fails with `PT409`. A per-user cross-company limit (100 MiB / 500 unattached reservations) is serialized with an advisory lock; future attach adapters must release quota explicitly. Reserving never changes a business record.

Storage RLS allows INSERT only for the reserving user's exact unverified path while they currently manage the company, and SELECT only to that reserving manager. There is **no UPDATE or DELETE policy**, so clients cannot upsert-overwrite or remove reserved objects; legacy `delete-fleet-files` remains hardcoded to `fleet-files`. Reservation identity/manifest fields are trigger-protected; verification columns (`verified_object_id`, `verified_at`, `receipt`) have no client grants and can be set exactly once by a trusted service verifier (next slice). Reported storage metadata size and declared MIME type are **not byte proof or content validation**.

Shared `packages/domain/src/attachment-upload.ts` (now exported) validates manifests, reservations and receipts against the retained intent and classifies `reserved`, `stored_unverified`, `stored_size_mismatch` and `verified`. A verified receipt proves stored bytes only — **not** a business attachment, pending review or sync completion. Null/unsupported declared types cannot be reserved; their local drafts remain retained.

Tests: `supabase/tests/fleet-sync-attachment-uploads.test.mjs` uses a new minimal `fixtures/storage.sql` metadata boundary (storage.objects RLS only; no Storage API/byte transfer/upsert semantics) plus the production fleet fixture: idempotency, provenance mismatch, current role/company/target checks, shape validation, quota, exact-path inserts, overwrite/delete denial, demotion, private immutable rows and single-use receipts. Real Supabase Storage validation is still required.

### Trusted attachment byte verification (migration and Edge Function added; not deployed)

`20261118000100_fleet_sync_attachment_verification.sql` adds an append-only `fleet_sync_attachment_verifications` attempt log and three RPCs. `begin_fleet_sync_attachment_verification` runs with the **uploader's own JWT**, rechecks current owner/admin access and reservation ownership, and returns an existing receipt, `not_uploaded`, or a 10-minute lease bound to the current storage object ID. Only one active lease exists per attachment, and the replaced storage INSERT helper blocks re-upload while it is active. `complete_…` and `release_…` are **service-role only**: they recheck the uploader's current access (evaluated as that user), require the leased object still to be the stored object, and issue the immutable receipt only when the verifier's own observed size and SHA-256 equal the reservation. Mismatches never receive a receipt; the lease stays active until the verifier removes the object and releases it, so a late removal cannot delete a newer upload. Replaced/missing objects, expired leases and revoked access complete without a receipt. Exact retries return the recorded outcome and never re-decide it.

`supabase/functions/verify-fleet-sync-attachment` authenticates the bearer token, calls `begin` with the caller's JWT, streams the object with the service key (never sent to clients) through a hard byte bound (declared size; one extra byte means oversized and is not hashed), hashes with Web Crypto and records the observation. Mismatched objects are removed and the release records whether removal succeeded. A transient storage read failure leaves the lease to expire (re-check after ~10 minutes). Pure logic lives in `logic.ts`; `logic.spec.ts` runs under Vitest (`cd packages/domain && npx vitest run --root ../../supabase/functions/verify-fleet-sync-attachment`) because Deno is not installed here. Edge-function lease timing and Storage API behavior (404/400 on missing objects, `remove`) need real Supabase validation.

Embedded PostgreSQL tests extend `fleet-sync-attachment-uploads.test.mjs`: single receipt and replay, concurrent-lease denial, mismatch/removal/re-upload ordering, replaced object, demotion, expiry, service-only completion and append-only history. No native transport or business attachment is enabled yet.

### Native attachment byte upload and receipt persistence (library implemented; not enabled in UI)

Native SQLite migrates **v7 → v8**, adding scoped `offline_attachment_uploads` alongside, never inside, local readiness metadata. Stages: `reserved` (server knows the immutable intent), `uploading` (**persisted before bytes are sent**; a lost response is uncertain), `stored` (an object exists but is unverified), `verified` (the trusted verifier's receipt) and `blocked` (permission, conflicting identity, rejected declaration or unsupported declared type). Every saved reservation/receipt is re-decoded against the retained manifest; a changed server reservation is rejected, and only a matching receipt can mark bytes verified. Once a receipt is stored, later writes return it unchanged.

`offline-attachment-upload.ts` reserves, persists uncertainty, uploads the integrity-checked managed copy and asks the verifier. Retries always use the original attachment ID/path. After a lost response, a reservation showing a stored object skips re-sending bytes and only verifies. Verifier mismatch returns the draft to `reserved` for an upload of the original bytes; busy/expired verification stays `stored`. Pause/abort stops without recording failure. Per-attachment attempts are single-flight. `offline-attachment-upload-transport.ts` binds RPC/function calls to the verified local session token, rejects foreign account/company scope and changed device copies before sending, uploads with `upsert:false`, treats an existing object as `exists` (not proof) and surfaces structured verifier outcomes from HTTP errors. Storage RLS independently requires the caller's own reservation for that path.

**A verified upload is not attached or synced.** No operation, record, reference or file release changes. The uploader is not yet called by the provider/worker or any UI; it stays disabled until the business-reference/review adapter exists. Tests (`offline-attachment-upload.test.ts`, real SQLite/files) cover restart retention, pre-send uncertainty, lost responses, mismatch re-upload, blocking, forged/replaced receipts, changed reservations, pause, account isolation and transport binding. Updated v1–v7 upgrade tests expect v8.

### Vehicle document reference adapter for verified uploads (server; not deployed)

`20261119000100_fleet_sync_document_attach.sql` adds the first business-reference adapter: append exactly **one vehicle document** for a receipt-verified upload. Issues have no file field, so issue uploads can be byte-verified but not attached. Each attachment gets one immutable request (`schemaVersion`, `requestId`, scope, vehicle, attachment, document name, device-reported provenance); a different request for the same attachment, or a reused request ID, fails with `PT409`.

Flow (Edge Function `attach-fleet-sync-document`): `begin_fleet_sync_document_attach` (uploader JWT) validates current owner/admin access, receipt and target, and registers the request. The service function reads the verified sync object through a hard byte bound, checks it still matches the receipt, uploads it with `upsert:false` to deterministic legacy path `company/user/sync-<attachment>` in `fleet-files` (which existing web/mobile viewers already sign), and hashes any pre-existing destination instead of trusting it. `record_fleet_sync_document_copy` (service only) records the copy's storage object ID only when observed size/SHA-256 equal the receipt; mismatched deterministic copies are removed and retried. `complete_fleet_sync_document_attach` (uploader JWT) takes the record-group lock before the row lock, requires the proven copy object to still be stored, and appends `{id: attachmentId, name, file:{name,type,dataUrl:'',path}}` through `apply_fleet_changes` with the current version — existing RLS, member guards, revisions and side effects apply; concurrent unrelated edits/documents are preserved. The result (`applied` with revision/path, or `rejected` for `record_deleted`, `invalid_documents`, `document_id_conflict`) is stored once with the request and returned on every replay; deleted vehicles are never resurrected and the sync object stays retained. Applied references stop counting toward the unattached upload quota (quota helper now replaceable; the undeployed upload migration was adjusted to call it).

**Applied is a business document reference, not deletion of the sync object, review approval or a reason to release local bytes automatically.** Native wiring follows. Shared `createAttachmentDocumentRequest`/`decodeAttachmentDocumentResult` are in the domain module. Tests: `supabase/tests/fleet-sync-document-attach.test.mjs` (atomic append and replay without extra side effects, concurrent edits, quota release, request immutability, copy-proof mismatch/replacement, deleted record, demotion, service-only proof, append-only links) and `attach-fleet-sync-document/logic.spec.ts`.

### Native vehicle-document intents for verified bytes (library implemented; not enabled in UI)

SQLite migrates **v8 → v9**, adding scoped `offline_attachment_documents`. `requestAttachmentDocument` commits one immutable request per ready vehicle attachment (stable request ID, trimmed document name, the account's stable device ID, device-reported save time/connectivity); a different later request for the same file is refused. Stages: `pending` (saved on device, not yet confirmed), `blocked` (permission/conflict/invalid), and server-final `applied` or `rejected`. Results are decoded against the exact request (document ID and deterministic `sync-<attachment>` path) and are immutable once stored; forged or mismatched results leave the request pending.

`offline-attachment-documents.ts` uploads/verifies bytes first (via the uploader) and only then sends the unchanged request through the account-bound `attach-fleet-sync-document` transport. Busy/missing-copy/network outcomes keep the same request pending for retry; revoked access and server conflicts block. **Safe reference release:** local bytes with a pending or blocked document request cannot be discarded; after a server-final result, discarding remains an explicit user action and is never automatic. Applied documents do not delete local or remote sync bytes. Local vehicle data refreshes through existing canonical reconciliation; no local projection claims the document before the server result.

Still not enabled: no provider/worker scheduling, picker or UI calls these modules yet. Tests extend `offline-attachment-upload.test.ts` (immutable request, upload-before-attach ordering, restart retention, discard protection then explicit release, uncertain retries with one request body, blocking, forged results, server rejection retention, account isolation, token binding).

### Offline vehicle documents enabled in the native saved-detail editor (client; backend not deployed)

Installed-app owners/admins can now **Add vehicle document** from the vehicle saved-detail editor once the vehicle has a verified download. JPEG/PNG/WebP/GIF/PDF up to 8 MB — the legacy `fleet-files` limit enforced by SQL, domain and UI — (declared type/size preflight only; bytes are hashed by the vault and revalidated by the server). The chosen file gets stable attachment/request IDs, so a failed save retries the exact same document instead of creating a second one. Saving stages the bytes durably and commits the immutable document intent; only then does the screen say **Saved on device — waiting to upload and attach**. Picker responses after a route/account change are ignored.

The provider builds the uploader/document runner on its **existing scoped session** (no new `activate()`), binds them to the current account token, and runs them only while foreground, online, manager and not paused: after attachment recovery on resume, right after a save, and every 15 seconds while a document is pending. An applied result wakes ordinary canonical reconciliation so the vehicle's shared documents refresh; no local projection claims the document earlier. Saved changes & sync now separates server byte progress (reserved, upload unconfirmed, verification pending, verified — not yet attached, blocked) from the document outcome (waiting, blocked, attached at a revision, or not attached because the vehicle was deleted; files retained). Pending/blocked document files cannot be discarded; after a final result, discarding the device copy stays explicit.

Not included: vehicle photos/named file slots (contract, registration, insurance, DOT, VIPR), inspection photos, issue files (no issue file field), replacing/removing documents, and sensitive/crew/payroll files. **Device copies are not encrypted by FireOps.** Web remains online-only; web viewers sign the attached `fleet-files` path like any other vehicle document. Tests: controller document actions/sync fencing, picker preflight and stable retry IDs, and truthful drafts labels (static markup with stub components). No UI launch or visual test was run.

### Attachment retention and release policy (decided; server implemented)

Decisions (non-production project):

1. **Device encryption:** non-sensitive vehicle documents may use unencrypted app-managed device copies now. Decided 2026-10-23: receipts, payroll and invoices do **not** need app-level encryption. Crew and qualification files still need a decision before they accept offline files.
2. **Applied documents:** the service deletes the `fleet-sync-files` staging object once the document result is applied; the `fleet-files` copy is canonical. Reservation, receipt, request and release audit rows are kept.
3. **Unattached or rejected uploads:** released only by an **explicit user release**, which deletes the staging object and frees quota. Nothing expires silently.
4. **Device copy after attach:** removed automatically once the applied result is stored **and** a verified canonical vehicle record at or after that revision contains the document (metadata kept).

`20261120000100_fleet_sync_attachment_release.sql` adds append-only `fleet_sync_attachment_releases` (`applied` | `user_released`, requested time, Storage removal time). Removal is confirmed only when the Storage object is really gone. Triggers make a user-released upload permanently unable to start verification, receive a receipt or start a document request; the storage INSERT helper also refuses released paths. Quota excludes released and applied uploads. `request_fleet_sync_attachment_release` (uploader JWT, current manager) refuses while a document request is pending or a verification lease is active, returns `attached` for applied documents, and allows rejected/unattached uploads. Service-only `request_…_applied_release` requires an applied result; `confirm_…_release` records removal. Reservation JSON now includes `release`; the domain decoder accepts a receipt without an object only after release and reports stage `released`.

Edge Functions: `attach-fleet-sync-document` releases the staging copy after an applied result (fresh or replay); cleanup failure never changes the business response and is retried by later replays. New `release-fleet-sync-attachment` performs explicit user release and, for an applied document, retries its staging cleanup through the service path (after the caller's JWT proved current access). Tests: 3 new embedded PostgreSQL tests and Vitest specs for both functions.

### Native release and device-copy removal policy (implemented)

SQLite migrates **v9 → v10**, adding `remote_attempted`, `remote_release` (`pending` → `released` | `attached` | `none`) and `remote_release_error` to `offline_attachments`. The uploader marks an attempt **before** its first reserve request, so a lost reserve response is still released later. An explicit discard of an attempted upload queues the server release in the same transaction as the discard journal; never-uploaded drafts stay local-only and queue nothing. Pending releases survive restart, work offline (they run when online), count as retained work in the sign-out guard, and become final only on a server answer (`released`, `attached` for an applied document's canonical copy, or `none` when the server never had the reservation). Busy (`in_use`), revoked-access and network outcomes stay pending with an error.

After a document result is `applied`, the runner removes the device copy automatically only when a **verified cached vehicle record at or after the applied revision contains that document ID and path** (never by name). It then releases the staging copy through the same queue (the release function retries applied staging cleanup). Metadata, request, result and receipt remain. Pending/blocked document requests still protect their bytes. Saved changes & sync labels release state and the updated discard confirmation. The provider passes the vault discard to the runner and keeps the 15-second run while documents are pending, applied copies await confirmation, or releases are pending.

Tests (`offline-attachment-upload.test.ts`, real SQLite/files): queued release across restart, single delivery and immutability, local-only drafts, lost reserve response, busy/offline/not-found outcomes, auto-removal gated on revision/ID/path, and `documentConfirmedInRecord` rules.

### Single-slot vehicle files: server adapter (migration and Edge Function added; not deployed)

Vehicle `photo`, `contract`, `viprChecklist`, `registration`, `insurance` and `dotInspection` now travel through the **existing verified detail-update RPC** as ordinary indivisible fields. Three-way merge, whole-operation conflicts, owner/admin review on web and mobile, submitter outcomes, device history and older-build recovery therefore apply unchanged. An overlap (someone else replaced the same slot since the device's base) becomes a pending review candidate; nothing is overwritten. Clearing a slot is an ordinary optional-field removal. Replacing a slot never deletes the previous file.

The scalar allowlist/value checks were factored into one shared `validate_fleet_sync_detail_field(company, proposer, entity, record, field, slot, purpose)` used by submission and approval (edited in place in the undeployed `20261110000100`/`20261111000100`; behavior unchanged, all earlier tests pass). `20261121000100_fleet_sync_vehicle_file_slots.sql` replaces it so a slot value must be exactly `{name, type, dataUrl:'', path}` with `path = company/user/sync-<attachment>`, where that upload is receipt-verified, reserved **for this vehicle**, has the same name/declared type, and has a service-proven `fleet-files` copy whose storage object is still the proven one. Submitters may only propose their own uploads; approval revalidates the chosen candidate's copy at decision time (any current manager can read copy proofs for review).

`begin_fleet_sync_attachment_copy` (uploader JWT) registers the copy and returns either a copy plan or the server-built slot value; service-only `record_fleet_sync_attachment_copy` records the hash proof and queues a `copied` staging release (the fleet-files copy is canonical from then on). A verified upload has exactly one use: a vehicle document or a slot copy, never both. User-released uploads cannot be copied. New Edge Function `copy-fleet-sync-attachment` reuses the attach function's bounded copy-and-prove routine, then releases staging through the normal release path (cleanup failure never fails the result). Domain helpers: `vehicleFileSlots`, `vehicleSlotFileValue`, `decodeVehicleSlotCopy`.

Tests: `supabase/tests/fleet-sync-vehicle-file-slots.test.mjs` (apply and replay, old file retained, clearing, unproven/foreign/misbound/hand-written values, removed copies, issue rejection, overlap → review → approval with copy revalidation, single use, release, service-only immutable proof) and `copy-fleet-sync-attachment/logic.spec.ts`. Native wiring and UI follow.

### Single-slot vehicle files: native adapter (implemented; UI follows)

The native saved-detail editor's `save(draft, values, {remove, attachmentIds})` now saves slot replacements and clears through the same durable, verified-base path as scalar edits (stable operation ID, device provenance, continuations, exact retries including the same extras). A slot value must be the deterministic proven-copy value for a file bound in the same transaction (`vehicleSlotFileValue`); hand-written paths, unbound files and clearing non-slot fields are rejected. The adapter block, local rebase allowlist and editor allowlist include the six slots; pending slot changes are labeled but not overlaid onto displayed vehicles (no broken image before the copy exists).

The worker's new `prepareAttachments` hook runs before delivery (5-minute budget): `createSlotAttachmentPreparer` checks the saved operation proposes exactly the bound file's value, uploads/verifies bytes through the uploader, and asks `copy-fleet-sync-attachment` for the proven copy. Not-ready work stays `pending` with retry backoff; revoked access, conflicting use, unsupported files and mismatched operations block. The record change is never altered and is sent only after every copy is proven. Without the hook (older wiring), file-bearing work stays blocked on device as before.

After a final result, `createSlotAttachmentSettler` (run with attachment sync) releases file bindings. Files whose slot the server kept are unbound and their device copies removed only once a verified cached vehicle at/after the result revision holds the exact proposed value; files not kept (rejected/partly kept) are unbound but stay on the device for explicit discard. `releaseOperationAttachments` refuses non-final operations. Tests: `offline-attachment-slots.test.ts` (binding/validation, prepare-before-deliver ordering, pending/blocked preparation, confirmation gating, clearing, final-result rules).

### Single-slot vehicle files: UI (native editor; shared review text)

The native vehicle saved-detail editor now has a **Vehicle files** section for photo, contract, VIPR checklist, registration, insurance and DOT inspection: **Add/Replace…** (JPEG/PNG/WebP/GIF/PDF, 8 MB) and **Clear**. Each change stages the file durably, prepares a fresh verified draft and saves one slot change (`createVehicleSlotActions`); a failed save keeps the same file, draft and IDs for **Retry**, other slot changes wait, and **Cancel** leaves any staged file as an unbound draft the user can discard. Late picker results after a route/account change are ignored. The section says files are unencrypted device copies, may need owner/admin review if someone else changed the same slot, and that previous files are never deleted.

Shared `syncReviewFieldLabel`/`syncReviewValueText` (and device-history text) now label the six slots and show file values as name, declared type and storage path (noting server-verified device uploads) on **both web and mobile** review/history screens instead of raw JSON. Web stays online-only; no image previews were added to review. Tests: slot action exact retry/clear/fencing, review text; web review/history markup tests still pass. No UI launch or visual test was run.

### Status, assignments and issue updates: adapter (server and native logic; owners/admins)

Submission/approval now call replaceable hooks added in place to the undeployed `20261110000100`/`20261111000100` (defaults preserve behavior): `fleet_sync_merge_detail`, `validate_fleet_sync_record` (also run on review-assembled records) and `fleet_sync_detail_side_effects` (extra `apply_fleet_changes` entries in the same transaction). `20261122000100_fleet_sync_status_assignments.sql` replaces them and the shared field validator:

- **Vehicle** `status` (Ready/Assigned/Out of service, required), `assignedTo` (member UUID, removable), `assignedFire` (`{id,name,state}`, removable) form one **invariant group**: a concurrent change to any of them makes an overlapping proposal a whole-operation conflict for owner/admin review; independent fields still merge. Assembled records must satisfy *Assigned ⇔ assignee*, *fire ⇒ assignee*, and the assignee must be a **current company member** (also enforced when a reviewer picks sources per field). Applied status/assignment changes add one activity entry ("E1 status changed to …", device-reported save time/connectivity) in the same transaction; replays add none.
- **Issue** `status` (Open/Resolved) and `resolvedAt` form a group with *Resolved ⇔ resolvedAt*.
- **Issue `updates` is append-only:** a proposal must be new entries (1–20, own `createdById`, non-blank text ≤ 2000) prepended to the exact base list; the server prepends them to the *current* list, skipping ids already present, so concurrent notes never conflict or disappear. Notes are saved separately from other issue changes; reviewers cannot pick `updates` as a source.
- Firefighters/shop techs still need a connection for self-claim/release and notes: the record read/download/review endpoints are manager-only. The existing role trigger continues to guard every write path.

Client mirror in shared `packages/domain/src/fleet-sync-fields.ts` (`fleetSyncFields`, `fleetSyncFieldGroups`, `mergeFleetSyncDetail`, `appendIssueUpdates`, `fleetSyncRecordProblem`), now used by the adapter block, continuation materialization (which also gains the previously missing file slots), local rebase (re-appends saved notes onto current ones; rejects inconsistent per-field choices), the read-model overlay (status/assignment/notes preview; file slots still not overlaid) and the editor (value checks, removable `assignedTo`/`assignedFire`/`resolvedAt`, notes-only operations as the current user, record invariants). Tests: `fleet-sync-status-assignments.test.mjs` (7), `fleet-sync-fields.test.ts`, `offline-status-assignments.test.ts`; older tests that used `status` as their "unsupported field" example now use `inspections`.

### Status, assignments and issue updates: UI (native saved-detail editor)

The vehicle saved-detail editor adds **Status & assignment**: Mark Ready / Mark Out of Service (clearing assignee and fire), Assign to an active crew member (from the device's crew list; assigning needs it), Clear assignment, Clear fire assignment. Assigning a fire offline uses the last downloaded fire list (see Offline fire assignment). The issue editor adds **Updates & status**: Save update on device (appended note) and Resolve/Reopen (separate change). Each action prepares a fresh verified draft and saves one change through `createDetailChangeActions`, which builds the change once from that draft (so removals and note appends match its base) and **Retry** resends the identical values on the same draft; other actions wait, **Cancel** abandons the unsaved change. Labels say changes are saved on device, checked against current server state, and may need owner/admin review; notes never replace others. Online screens and their activity/notification behavior are unchanged; web stays online-only. No UI launch or visual test was run.

### Crew offline vehicle claims and issue notes: server (not deployed)

Submit/read access now goes through replaceable hooks added in place to the undeployed migrations (`fleet_sync_submitter_allowed`, `fleet_sync_reader_allowed`, `validate_fleet_sync_submitter_patch`; defaults stay owner/admin). The record read no longer takes a row lock (the record-group advisory lock already orders it), so readers who may not update a row can still read it. `20261123000100_fleet_sync_member_actions.sql` widens them for **fire_fighter and shop_tech** with a strict field allowlist:

- Vehicles: only `status`/`assignedTo`/`assignedFire`. The existing role trigger still decides each transition against the current row (claim a Ready unassigned vehicle, release one's own, change/clear one's own fire); anything else fails with `42501` and writes nothing.
- Issues: only append-only `updates`, and the member issue trigger still requires the reporter's own issue and exactly one own note per write. Crew resolve/reopen was online-only here; `20261213000100` adds it as a status change carrying one note (see below).
- Crew can read verified vehicles and the issues they reported; their inventory pages cover **vehicles only** (hidden issues are never reported as deleted or inconsistent). Conflict review, history inspection and approval remain owner/admin only; a crew member's overlapping claim becomes a review candidate and they read their outcome through the existing submitter endpoint. Activities from crew changes are attributed to them.

Tests: `supabase/tests/fleet-sync-member-actions.test.mjs` (read scope, claim/fire-clear/release, refused transitions with no partial writes, field allowlist, own-issue single notes with concurrent notes kept, review candidate + outcome). Client wiring follows.

### Crew offline vehicle claims and issue notes: client (native)

The provider now treats **fire_fighter/shop_tech** as sync roles for record refresh, the read model and the saved-detail editor (attachments, files and documents stay owner/admin). Issues cached under an earlier owner/admin role are hidden from crew unless they reported them, until the next refresh removes unreadable records. The editor takes `restrictFields` (crew: vehicle `status/assignedTo/assignedFire`, issue `updates`) and refuses claiming for anyone else before saving; the server and role triggers enforce the same. Inventory pages now carry `scope` (`all` | `vehicles`; older servers default to `all`); a vehicle-only crew inventory completes without treating cached issues as missing, and pages that mix in issues are rejected.

Crew screens: vehicle detail shows **Claim / release offline** (saved-detail editor with Claim this vehicle, Release this vehicle, Clear fire assignment); issue detail shows **Add notes offline** only on issues they reported (notes only; resolve/reopen needs a connection). Device edit history inspection stays owner/admin. Tests: crew restriction and vehicle-only completion in `offline-status-assignments.test.ts`, scope decoding in `offline-fleet-download.test.ts`. No UI launch or visual test was run.

### Offline vehicle inspections: server (not deployed)

`20261124000100_fleet_sync_inspections.sql` adds `inspections` to the vehicle adapter as an **append-only** list, like issue notes: a proposal must prepend exactly one new inspection to the exact base list, and the server prepends it to the *current* list, so concurrent inspections never conflict or disappear. Edits and deletions stay online-only, and reviewers cannot pick `inspections` as a source. Each entry is validated: own `inspectorId`, inspector name, incident text, ISO time, 1–100 uniquely identified items with valid kinds/results/defect notes, a result for pass/fail items and a photo for photo items. Every photo must be a **server-proven fleet-files copy for this vehicle**, using the shared `validate_fleet_sync_vehicle_file` check that file slots now also call. An applied inspection adds the same "inspection completed · N failed checks · incident" activity entry online saves add, plus device-reported provenance, in the same transaction. Shop techs may submit inspections (their role trigger still requires exactly one own inspection and nothing else); attachment uploads remain owner/admin, so shop-tech offline inspections cannot carry photos yet. Tests: `supabase/tests/fleet-sync-inspections.test.mjs`.

### Offline vehicle inspections: client (native)

Shared policy now includes `inspections` as an append-only vehicle field (exactly one new inspection per change; generic `addedListEntries`/`appendListEntries` also serve issue notes). Local rebase re-appends a saved inspection onto the current list; the read model does not overlay pending inspections (their photos may not be copied yet). The editor validates the new entry (own inspector, item results, required photos, every photo the proven-copy value of a bound file) and keeps inspections separate from other changes. Shop techs get `inspections` in their crew allowlist.

The worker preparer and settler now cover **inspection photos** as well as file slots: each bound file must appear exactly as its deterministic proven-copy value, every photo is uploaded/verified/copied before the inspection is sent, and a photo's device copy is removed only once a verified vehicle revision contains the identical inspection.

**Inspect vehicle** works offline in the installed app when the vehicle has a verified download: photos are staged on the device (owners/admins; shop-tech offline photos still need the attachment endpoints opened) and the inspection is saved through the verified editor, then synced with the same activity entry online saves create. Online inspections are unchanged. Photos uploaded online cannot be mixed into an offline submission. A failed offline save never committed anything, so resubmitting builds a fresh change. Tests: inspection binding/validation, prepare-before-deliver, confirmation-gated removal and mismatched-photo blocking in `offline-attachment-slots.test.ts`; append rules in `fleet-sync-fields.test.ts`. No UI launch or visual test was run.

### Shop-tech offline inspection photos

Attachment access (reserve, storage insert/read helpers, verification begin/complete, copy begin, explicit release) now goes through one replaceable `fleet_sync_attachment_user_allowed` hook added in place to the undeployed `20261117000100` and used by `20261118`–`20261121` (default owner/admin); uploaders can always read their own copy rows. `20261125000100_fleet_sync_shop_tech_photos.sql` widens it to **shop techs**. Their copies can be referenced only by their own inspections (per-proposer copy check plus the role trigger); vehicle documents, file slots and conflict review stay owner/admin, and firefighters still cannot upload sync files. The native provider enables the attachment controller for shop techs, so offline inspections can carry photos; the saved-detail editor still hides file slots/documents in crew mode. Tests extend `fleet-sync-inspections.test.mjs`.

### Offline issue reports: server (not deployed)

`20261126000100_fleet_sync_issue_create.sql` adds `sync_fleet_create(operation)`, an idempotent endpoint for **one new issue** (schema-version-1 `SyncOperation` with `mutation.kind = 'create'`, no dependencies). The full record is validated: reporter = caller, status Open, no notes yet, title/description non-blank, valid priority, ISO time, and a live vehicle in the company. It inserts through `apply_fleet_changes`, so the existing insert policy (owners/admins/shop techs) and member issue trigger still apply; firefighters are refused. An identity with any revision history (live or deleted) is refused with `23505`, so creates never overwrite or resurrect. Receipts are stored in `fleet_sync_submissions`; exact retries replay them and different work for the same operation ID is rejected. Tests: `supabase/tests/fleet-sync-issue-create.test.mjs`.

### Offline issue reports: client (native)

The adapter block now admits exactly one kind of create: a dependency-free **new issue**, delivered to `sync_fleet_create` by the account-bound transport (other creates stay online-only). The editor's `createIssue(record)` validates the report as the server does, refuses roles not allowed to report (crew: shop techs only, via the crew allowlist's `create` marker), and saves it durably with an exclusive record lock; retrying the identical record reuses its operation, while a changed record must start a new report. The read model previews a pending report as a labeled local proposal until a verified record exists, after which the shared record wins. **New issue** saves offline in the installed app (owners/admins and shop techs; firefighters cannot report issues at all), keeping the same report identity and time across retries. Adding notes to a just-reported issue needs its verified record (after sync). Tests: report validation/retry/sync in `offline-status-assignments.test.ts`, create routing in `offline-sync-transport.test.ts`, adapter rules in `offline-sync-protocol.test.ts`, preview in `offline-fleet-model.test.ts`. No UI launch or visual test was run.

### User-owned data: personal tasks, availability, dashboard layout (server; not deployed)

These tables have no fleet revision ledger and are private or self-service, so they use a separate **command** contract instead of field merges and manager review. `20261127000100_user_sync_commands.sql` adds `sync_user_command(operation)` for schema-version-1 operations with `mutation.kind = 'command'`, plus `get_user_sync_state(company, entityType, entityId)` for reconciliation. Receipts in private `user_sync_receipts` are idempotent per user/company/operation (different work for the same ID is rejected); revisions are the receipt sequence. A command whose dependencies this user has not applied is refused (`55000`), so a completion can never run before its create.

- `personal_task` — `task.create` (client UUID; subject/description/due date validated; an identity already used, including someone else's, is refused) and `task.complete` (deletes, as online; completing an absent task is a no-op). The existing RLS still limits tasks to their owner in owner/admin/shop-tech roles; reviewers never see them.
- `availability` — `availability.set {available, base}` for the caller only. Applied when the current value still equals the device's base; if someone (for example an owner) changed it since, the current value is **kept** and the receipt carries `keptCurrent`.
- `dashboard` — `dashboard.set {changes}` merges changed keys over the user's current layout (`null` removes a key); later arrival wins per key.

Tests: `supabase/tests/user-sync-commands.test.mjs` with a fixture loading the real tasks/availability/dashboard migrations (ordering via dependencies, idempotency, privacy and roles, kept availability, per-key merge, private receipts, forged provenance).

### User-owned data: client (native)

`offline-user-sync.ts` enqueues the user commands on the provider's existing scoped session (any current member; the server enforces task roles): `createTask` (client UUID), `completeTask` (depends on a still-unsynced create of the same task), `setAvailability(available, base)` (own only; `base` = the value shown) and `setDashboard(changes)`. The adapter block admits only these commands, the account-bound transport sends them to `sync_user_command` and reconciles through `get_user_sync_state`, and a kept availability shows **"Synced — a newer change by someone else was kept"**. Commands count as retained work in the sign-out guard like any saved change.

When the installed app is offline, **Tasks** saves new tasks and completions on the device and overlays them on the last downloaded list (with a "saved on this device" count; the list reloads once they sync). **Availability** saves your own selection offline (changing someone else's needs a connection), and **dashboard customization** saves layout toggles offline, both overlaid until synced. Native own-user writes now use the same durable command boundary online as well (see hook hardening below); web stays online-only. Tests: `offline-user-sync.test.ts` (ordering, worker delivery, kept label, overlays, adapter/transport routing). No UI launch or visual test was run.

### Ordered user commands and local acknowledgment recovery

Repeated availability/dashboard saves now append immutable commands instead of failing the outbox's same-record ordering guard. The opt-in command sequencing path selects and links the actual unresolved head **inside the enqueue transaction**, including concurrent callers. Scalar continuations still require their existing verified rebase path; this option cannot be used for scalar updates. Exact command retries retain the original stored dependencies and cannot rewrite an attempted request.

The user-command boundary freezes payloads, reported save time/connectivity and operation identity before asynchronous device lookup. A failed or uncertain local acknowledgment keeps that request for retry; concurrent identical saves coalesce. Only a successful durable acknowledgment permits a later intentional save to receive a new operation ID. Dependency/projection failures roll back together. Tests cover repeated toggles, independent layout changes, concurrent callers, lost acknowledgments after auto-linking, mutable caller input and SQL-triggered dependency failures. Web stays online-only; no server schema change is needed for this slice.

### Atomic availability compare-and-set

Forward migration `20261128000100_user_sync_availability_cas.sql` removes the read-before-unconditional-write race with existing online availability writers (which do not take user-command advisory locks). A non-null base uses a conditional `UPDATE`; a missing base uses `INSERT ... ON CONFLICT DO UPDATE ... WHERE` accepting only identical existing values. Changed values stay untouched, and a removed row is not recreated from an old non-null base. RPC names, original receipts, helper ownership, private execution permissions and RLS remain unchanged; neither client needs a new API or browser offline behavior.

Embedded PostgreSQL tests exercise all 18 missing/boolean base/current/desired combinations, a deterministic state-read/write interleaving that fails against the old helper, and executor/permission preservation. This is **not** real multi-session lock testing; target-Supabase validation remains required.

The grant audit also caught missing RLS on the global command registry. Its undeployed `20261127000100` creation now enables RLS with executor-only SELECT; `20261128000100` repairs earlier development registries as well. No client grants or registry write access are added. Tests cover the forward repair and denied authenticated reads. Nothing was deployed.

### User-owned hook isolation and canonical settings recovery

Native personal tasks, own availability and dashboard toggles use the durable user-command boundary both online and offline when scoped storage is available. Reconnecting cannot bypass an earlier queued create/change through legacy direct writes. Initializing/unavailable native storage fails closed rather than silently switching endpoints. Web remains online-only; mobile web/no-native-provider legacy paths remain online-only too. Changing another member's availability still needs a connection and binds the original actor's JWT.

Hook state and callbacks are fenced by opaque account/company generations, including A → B → A and the transition render before effect cleanup. Pending overlays filter actor/company; demo dashboards never consume real pending layouts. Old reads, errors and `finally` callbacks cannot publish into or unlock a replacement scope. Roster loads reject out-of-order responses.

Verified setting acknowledgments replace disappearing pending overlays immediately, including `keptCurrent` and null records. Subsequent bounded, uncached, account-bound `get_user_sync_state` POST reads can advance to newer shared values; historical receipts are not permanently painted over fresh server state. Upload receipts and proposed values never become canonical acknowledgments. Existing task-list GET fallback is still not a complete verified task inventory/catch-up contract.

Task UI retries retain their task UUID across failed local acknowledgment and connectivity changes. Availability retains its failed request/base, blocks changing an unconfirmed selection until retry and preserves rapid sequential reversals even before a render. Confirmed task completions remain hidden from stale list responses; new confirmed creations stay visible while list refresh is pending. Targeted checks: 65 mobile tests (20 production-hook/effect tests plus user-command, worker and transport suites), mobile typecheck, whitespace checks. Tests use an injected persistent hook-slot/effect harness, not mounted UI or visual tests. No deployment occurred.

### Private task identity retirement and current-role enforcement

Forward migration `20261129000100_personal_task_identities.sql` records **only opaque task UUIDs**, never task content, author/company links or fabricated creation/deletion times. It backfills current task IDs and successful task-command targets under task-then-receipt table locks. Already-deleted legacy IDs absent from both sources cannot be reconstructed; do not invent them or treat unsupported old builds as safely replayable.

All task inserts (including web, legacy online and service writes) reserve their UUID transactionally after normal RLS/constraints. Reusing a retired UUID fails with `23505` and rolls back the new row. Task identity/company/owner cannot be reassigned. Successful absent-task completion also retires its target through an atomic receipt trigger; this is not an assertion that the task existed. Exact original operation replay still returns its original receipt without recreating deleted work. The worker treats identity collisions as actionable blocked work, never automatic retries or replacement UUIDs.

The append-only, RLS-protected UUID set survives company/profile deletion without retaining any association to either. Clients cannot read or edit it; service role has read-only opaque IDs. Task content remains physically deleted on completion; existing private receipt retention is unchanged. Current task roles now constrain receipt access/creation too: revoked roles cannot bypass permission checks through cached replay or an absent-task completion, and canonical reads return permission denial rather than fabricated deletion.

Tests cover both reproduced resurrection bugs (fresh operation and legacy online insert), live/receipt backfill, missing-task completion, private minimal schema, ownership immutability, company deletion, permission revocation, RLS/receipt-failure rollback and exact retries. No migrations were applied to Supabase. Real multi-session migration/insert races remain a rollout check.

### Atomic online dashboard preference writes (server)

`20261130000100_online_dashboard_preferences.sql` adds account-bound `set_dashboard_preferences_once` and uncached `get_dashboard_preferences`. Explicit known boolean/null key changes merge atomically with the same helper and per-user lock as native queued commands. Current unrelated choices and legacy stored keys survive; new arbitrary keys/objects are rejected by both write paths.

Private immutable receipts preserve exact request/nonce, reported save time/connectivity, separate server time, previous values and original result. Exact replay returns that historical result without repeating the write; clients must subsequently read fresh state. Receipt insertion failure rolls back the preference mutation. Account/profile deletion purges private receipt history. The non-bypass executor owns functions, not the preference table; direct whole-layout INSERT/UPDATE/DELETE privileges are revoked from clients and service role, while own-user SELECT remains. No manager review access is introduced.

This is a **client-version rollout boundary**: old whole-layout clients must be replaced with the per-key RPC clients before enabling saves against this migration. Missing setup must never fall back to unsafe table upserts. Browser retries remain memory-only and explicit; no browser offline replay is authorized. Server validation: 28 embedded PostgreSQL/grant/structural checks, including mixed native/online changes, cached replay, private scope, typed patches, legacy-value retention, rollback and direct-write denial. Real multi-session validation and deployment remain outstanding.

### Online dashboard clients: immutable retries, canonical recovery, no browser replay

Web and mobile's online-only fallback now send **only explicitly changed keys** through `set_dashboard_preferences_once`. Shared domain code freezes nonce, actor, reported save time/connectivity and values before session restoration, binds every POST to the expected account's JWT, validates acknowledgment identity/choices and fetches current preferences separately. A lost mutation response retries the exact request; once acknowledgment is known, retry performs only canonical reads. Timeouts, SDK identity replacement, stale/foreign responses and A → B → A cannot publish another scope's data or replace an attempted request.

Requests and acknowledgment proof live **only in page memory**: no browser storage, outbox, background/reconnect delivery or offline-save claim. Unconfirmed choices block replacement toggles, show the original submitted choice and offer explicit **Retry original choice** / **Retry refresh**. Pending online work installs a before-unload warning. Missing setup never selects a legacy upsert endpoint. Demo behavior remains isolated; missing real identity/configuration cannot masquerade as a local successful save.

Installed native own-user writes continue through their durable scoped outbox. Native changes now validate the same known boolean/null key contract before enqueue. Existing read-cache warming/fallback remains for native offline restart display, never canonical proof; verified retained receipts can supply settings when that cache is missing. Complete durable verified user-domain snapshots/global cross-company delivery are still separate catch-up work.

Targeted checks: 15 domain, 70 mobile and 15 web unit tests; domain/mobile/web typechecks; 28 embedded PostgreSQL/grant/structural checks (including a parent-before-child migration lock-order check, not a real concurrent-session test). Hook/effect tests use a shared injected persistent-slot harness; markup tests are nonvisual. No UI/server launch, push, migration application or deployment occurred. Remaining online availability writer safety, attachment cleanup races and real multi-session/Storage validation are not completed by this slice.

### Online crew availability value-CAS (server)

`20261201000100_online_crew_availability.sql` adds scoped `set_crew_availability_once` and uncached full-roster `get_crew_availability`. Requests pin actor, company, target, boolean/null base, proposed value, nonce and reported time/connectivity. Current membership/manager authority and target membership are checked before cached replay and again around mutation. Own crew edits and owner/admin edits of current crew retain the existing RLS rules; the executor remains non-bypass and does not own the table.

Native own commands and online edits share the same conditional mutation and target-user lock. Only an explicitly missing base can insert; old non-null bases cannot recreate a removed status. Changed current values are kept with an immutable `kept_current` outcome, never silently resubmitted. This is **value-CAS**, not revision/ABA detection. Exact retry cannot reapply an old choice over a later change. Private receipts retain full original intent, previous status, original result and separate server time; audit failure rolls back the mutation. Permission loss is denial, not an empty roster/deletion.

Legacy direct INSERT/UPDATE/DELETE privileges are revoked, so updated clients are required at rollout. Parent-before-child migration locks quiesce old writers; target-session contention remains untested. Full-roster POST aggregation avoids treating a truncated GET list as proof of missing status. Targeted server validation: 28 embedded PostgreSQL/grant checks, including the 18-case base/value matrix, native/online interoperability, role/target revocation, rollback, replay, audit privacy and direct-write denial. Client wiring is described in the next section. Nothing deployed.

### Online crew availability clients

Web and the mobile online path now share `createAvailabilityController` (`packages/domain/src/online-availability.ts`) on top of the generic `online-write.ts` primitives that the dashboard writer now also uses. Each actor/company pair has one in-memory controller. Reads use the account-bound `get_crew_availability` POST, and edits use `set_crew_availability_once`. A request freezes the actor, company, target, displayed base and nonce. Only a verified roster can supply a base, so unverified cached rows are display-only. After a lost reply, only the original request can be retried. After an acknowledgment, retry only refreshes. A `kept_current` outcome shows a note and is never resubmitted. Old scopes are fenced, and permission denial clears the roster without implying deletion. Pending writes add a page-exit warning; there is no browser persistence or reconnect replay.

Mobile own availability still goes through the durable outbox (also online). Offline, the hook shows the account-bound GET read cache as "last known", never as a verified base. Editing others offline remains blocked. No client writes `crew_availability` directly any more. Targeted checks: 34 domain tests, 33 mobile hook/user-sync tests, 15 web dashboard tests, and domain/mobile/web typechecks. No UI launch, push or deployment.

### Storage cleanup fences (server and Edge Functions; not deployed)

Storage removal is path-only: a late `remove` deletes whatever object holds that path by then. `20261202000100_fleet_sync_storage_cleanup_fences.sql` adds a database check taken **immediately before** each cleanup removal that could race with new bytes:

- **Verifier mismatch:** service-only `authorize_fleet_sync_attachment_mismatch_removal(lease)` allows removal only while the mismatch lease is unreleased, has at least **5 minutes** left, and the leased object is still stored. Otherwise (`lease_ending`, `missing`, `replaced`, `released`) the verifier skips removal and releases with `removed=false`. The mismatched object then stays put, so the client's `upsert:false` re-upload sees `exists` and verification runs again under a fresh lease. While a lease is active, re-upload and new leases are refused, so the path still holds the leased object. A verifier that stalls past its lease can no longer delete bytes uploaded after it.
- **Mismatched fleet-files copies:** service-only `authorize_fleet_sync_copy_removal` locks the document link and slot-copy rows (serializing with the record RPCs). It refuses once any copy of the upload is proven, so a stalled mismatch handler cannot delete a canonical copy another invocation proved and applied.
- **Bounded removal:** the verifier and both copy functions remove through `removeStorageObject` (Storage `DELETE /object/{bucket}` with a 60-second abort), far inside the 5-minute margin.
- **Proven copies are retained:** a restrictive storage DELETE policy (`fleet_sync_copy_is_protected`) keeps proven `sync-<attachment>` copies from uploader/admin direct deletes. `delete-fleet-files` (service role, bypasses RLS) filters them with `fleet_sync_protected_copy_paths` and reports `{removed, retained}`. Records, conflict reviews and device history may reference these copies, so removing a document from a vehicle online leaves its sync copy in place. That is consistent with "nothing expires silently"; any future cleanup needs an explicit reference-aware design.

Unchanged and already safe: staging release removals (`release-fleet-sync-attachment`, applied cleanup) happen only after a release row makes the path permanently non-uploadable, or after a receipt exists (`can_upload` requires no receipt). A late removal there only hits the same bytes.

Residual risk: a tiny window remains between a copy-removal authorization and its Storage call, if another invocation copies, proves and applies in between. That requires a pre-existing bad object at the uploader's own `sync-` path plus concurrent replays. Lease-based fencing still assumes the Storage service finishes a request within minutes of accepting it. Real Storage `DELETE` semantics and timing need validation on Supabase. Tests: 6 new embedded PostgreSQL tests (`fleet-sync-storage-cleanup-fences.test.mjs`, including the stalled-verifier takeover and proven-copy retention), 54 related attachment/grant checks, and Vitest specs for verify/attach/copy/release logic.

### Offline read markers: server (not deployed)

`20261203000100_user_sync_read_markers.sql` registers two more user commands on the existing `sync_user_command` registry; no new endpoint. Both only touch the caller's own rows, only move forward, and are authorized by existing RLS through the non-bypass sync writer.

- `notification` / `notification.read` (empty payload): sets `read_at` at server receipt time if still unread. The device's own time stays in the receipt provenance. A missing, deleted or other user's notification is a no-op with a `null` record, never an error or a disclosure.
- `communication_read` / `communication.seen` (`{seenThrough}`): raises the caller's thread seen marker to `seenThrough`, the newest server timestamp (thread or reply `created_at`) the device actually displayed. The value is clamped to receipt time and never lowered. Replies posted while the device was offline therefore stay unread, unlike stamping the sync time. A deleted thread is a no-op; nothing is recreated.

Tests: `user-sync-read-markers.test.mjs` (5 embedded PostgreSQL tests on the real Crew Chat/inbox tables and policies via `loadReadMarkerSchema`: idempotent replay, foreign/missing rows, forward-only clamping, deleted threads, payload validation, executor privacy). Client wiring is described below.

### Offline read markers: client (native)

`offline-user-sync.ts` adds `markNotificationRead(id)` and `markThreadSeen(threadId, seenThrough)` on the existing scoped session. `seenThrough` must be a server timestamp string and is sent **verbatim**: `toISOString()` would truncate microseconds and leave the newest reply unread after sync. The provider publishes the current account's commands and overlays (`pendingNotificationReads`, `pendingThreadSeen`) through the bridge module (now `offline-chat-inbox.ts`) to the module-level inbox and Crew Chat stores, which use them only for the exact same company/user.

- **Inbox:** offline taps queue `notification.read` (optimistic, reverted with an error if the device save fails). Offline **Mark all read** queues only the downloaded notifications the device shows unread (at most the 100 loaded), never ones it has not seen. The badge and unread count subtract only those. Online behavior is unchanged.
- **Crew Chat:** offline, opening an unread thread queues `communication.seen` through the newest displayed thread/reply timestamp, and shows it **only after** the device save, so a failure cannot retrigger the screen's unread effect in a loop.
- **Overlays:** pending and synced markers keep overlaying a stale downloaded list (forward-only, so this is always safe); refused or discarded ones do not.

Each marker is its own outbox entry, so an offline "mark all" can add up to 100 entries (shown as `notification` in Saved changes & sync) and one completed notice. Tests: 2 new SQLite-backed command/overlay tests in `offline-user-sync.test.ts` and 5 store tests (`offline-chat-inbox-stores.test.ts`: account binding, no table writes offline, revert on save failure, verbatim microsecond markers, save-before-show). 81 targeted mobile tests and the mobile typecheck pass. Web is unchanged (online-only).

### Offline Crew Chat replies: server (not deployed)

`20261204000100_user_sync_crew_chat_replies.sql` registers `communication_reply` / `reply.create` (`{threadId, body}`, client UUID as the entity ID) on the user command registry. The reply is inserted under the existing RLS, attribution trigger (author and name from the caller's JWT) and notification trigger. The idempotent receipt makes the insert, and therefore its notifications (also keyed by reply ID), happen exactly once. `created_at` is server receipt time, so a reply appears where it actually joined the conversation; the device time stays in the receipt. The canonical record is visible only to its author.

A thread deleted before sync inserts nothing and returns `notApplied: 'thread_deleted'`; the text stays in the device outbox. To carry that reason, the undeployed dispatcher in `20261127000100` was edited in place to pass a whitelisted string `notApplied` from adapters into the receipt (existing adapters never set it). Reusing a reply ID with a different thread, body or author fails with `23505`; an exact replay returns the stored receipt. Unlike tasks, reply IDs have no retirement set, so a manager-deleted reply could be recreated only by a *new* operation reusing its ID. The client never does that: retries reuse the original operation.

Tests: `user-sync-crew-chat-replies.test.mjs` (4 embedded PostgreSQL tests: single attributed insert with replay counted by a stand-in trigger, deleted thread, identity reuse, payload/membership validation), plus the existing user-command, read-marker and grant suites.

### Offline Crew Chat replies: client (native)

The read-marker bridge is now `offline-chat-inbox.ts` (`OfflineChatInbox`) and also carries `postReply`, `newId` and `deviceReplies(entries)`. Offline, **Reply** and **Join conversation** in an open thread save `reply.create` on the scoped outbox. They require the downloaded thread and the exact account. The store keeps one client UUID per intended reply (account, thread and trimmed text) until the device save succeeds, so retrying a failed save cannot create a second reply. Nothing is inserted directly while offline.

The thread shows the device's replies after the downloaded ones until a refreshed thread contains them. Each is labeled *Saved on this device — posts when connected* or *action needed in Saved changes & sync*, and managers get no Delete button for them yet. Confirmed replies use the server `createdAt`. Seen markers are still computed from downloaded server timestamps only, so a device-clock reply time never advances them. A reply whose thread was deleted before sync is labeled *Not posted — the conversation was deleted before this reply synced* in Saved changes & sync; it never appears in a thread. Its text remains in the device outbox record but is not yet shown there.

Tests: 1 more SQLite-backed test (`offline-user-sync.test.ts`: validation, single delivery per ID, posted/deleted outcomes and label) and 2 more store tests (stable ID across a failed save, account/thread binding, no direct insert, overlay until downloaded, seen markers ignoring device times). 154 targeted mobile tests and the mobile typecheck pass. Web is unchanged (online-only).

### Offline vehicle notes: server (not deployed)

`20261205000100_user_sync_vehicle_notes.sql` registers `vehicle_note` / `note.create` (`{vehicleId, subject, body}`, client UUID) on the user command registry. It works like replies: one insert under the real notes RLS (owner/admin/shop-tech, rechecked through `can_access_vehicle_notes` on every delivery), attribution and notification triggers. The receipt makes the insert, and so its notifications, happen once; `created_at` is receipt time. A vehicle deleted before sync returns `notApplied: 'vehicle_deleted'` and creates nothing. Reusing an ID with different content or a different author fails with `23505`. **Editing and deleting notes stay online-only**: they are last-write-wins for every authorized user today and would need revision tracking before offline support.

Tests: `user-sync-vehicle-notes.test.mjs` (4 embedded PostgreSQL tests on the real notes migration: single attributed insert with replay, deleted vehicle, firefighter/outsider/demotion denial, identity reuse and validation).

### Offline vehicle notes: client (native)

`offline-user-sync.ts` adds `createVehicleNote` and `deviceVehicleNotes(entries, vehicleId)`. Replies and notes now share one `deviceCreates` helper for saved, action-needed and confirmed-until-downloaded records. Offline, **New note** on the vehicle notes screen (owner/admin/shop-tech) saves `note.create` with one client UUID per intended note (account, vehicle, subject and body) until the device save succeeds. The screen merges saved notes into the downloaded list, with a byline *Saved on this device — syncs when connected* or *action needed*. Edit and Delete are hidden for device notes and while offline, and editing an existing note offline is refused with "Editing notes requires a connection." A note whose vehicle was deleted before sync shows *Not saved — the vehicle was deleted before this note synced* in Saved changes & sync. Online saving, editing and deleting are unchanged.

Tests: 1 more SQLite-backed test in `offline-user-sync.test.ts` (validation, per-vehicle overlay, confirmed/deleted outcomes and label). 155 targeted mobile tests and the mobile typecheck pass. The screen wiring itself has no UI test (no app launch).

### Verified user-domain snapshot: server (not deployed)

`20261206000100_user_sync_snapshot.sql` adds `get_user_sync_snapshot(target_company_id)`, an account-bound POST read of the caller's own personal tasks, own availability (`null` when unset) and dashboard layout. It comes with `serverRequestAt` and `receiptWatermark`, the caller's highest `user_sync_receipts` sequence. Everything is read in **one statement**, so in one database snapshot. Devices show the snapshot, then their own receipts newer than the watermark, then pending commands.

A sequence number is assigned before its transaction commits, so a bare max could cover a receipt still committing. To prevent that, `sync_user_command` now takes a per-user advisory lock before its entity/operation locks. This was an in-place edit of the undeployed `20261127000100`; it serializes one user's commands, which are low-volume. The snapshot takes the same lock **shared**, so no command by that user is mid-commit while it reads.

Tasks follow the current task roles (owner/admin/shop-tech). Other roles get `tasks: null` ("not available"), never `[]`, so lost access is never read as deletions. More than 1000 tasks fails with `54000` rather than returning a truncated list. Membership is required. Online availability/dashboard writes have no device receipts; they simply appear in the next snapshot.

Tests: `user-sync-snapshot.test.mjs` (4 embedded PostgreSQL tests: own-data scoping across users/companies, watermark versus command receipts, role denial as `null`, membership, the 1000-task cap and a structural lock-order check; PGlite cannot run concurrent sessions). Existing user-sync suites and grant checks pass (53 tests).

### Verified user-domain snapshot: client (native tasks)

SQLite migrates **v10 → v11**, adding scoped `offline_user_snapshots`. `putUserSnapshot` decodes strictly against the exact account/company (`offline-user-snapshot.ts`). It never replaces a stored snapshot with one older in server time **or** receipt watermark. The provider's `createUserSnapshotSync` (same scoped session and account-bound transport, `get_user_sync_snapshot`) loads the saved download at start and refreshes single-flight, with a 15-second timeout, only when online and in the foreground. Refreshes happen at start, on reconnect/foreground, after this account's commands are confirmed, and on Retry. A failed refresh keeps the last download and reports why (too many tasks, access, server not updated).

**Tasks:** with a verified snapshot for this account, the list is the snapshot, then this device's applied receipts above its watermark (creates add, completions remove), then pending commands. Online and offline behave the same; the unverified HTTP read cache is no longer shown for tasks. Offline without a download, the screen says tasks have not been downloaded yet instead of showing a stale cached list. `tasks: null` reads as "not available for your current role", never as deletions. Online without a snapshot (old server, first run) the existing GET path remains. The Tasks screen shows when the copy was downloaded and that web changes appear after the next download.

**Own settings offline:** own availability and dashboard layout now also come from the verified download while offline. The value shown is the snapshot value, unless one of this device's applied receipts is above the watermark (the newest such receipt wins), with pending commands on top. Receipts the snapshot already covers can no longer override later web changes, which the older "latest receipt" display could. The cached roster and HTTP layout cache are no longer used for your own values offline when a download exists; other crew members' offline statuses remain display-only "last known". The Availability screen shows "*status* as of *download time*". Online behavior (verified roster, online layout reads) is unchanged. Two more hook tests cover covered/newer receipts, pending overlays and foreign-scope snapshots.

Tests: `offline-user-snapshot.test.ts` (3: strict decoding, monotonic per-scope storage across restart, single-flight refresh, failures keep the last download) and 1 new hook test (snapshot → newer receipts → pending, no HTTP list offline, foreign-scope snapshot ignored, role `null`). Two existing list-fencing hook tests now run online explicitly. Upgrade tests expect v11. 171 targeted mobile tests and the mobile typecheck pass.

### Gear checkout: role fix and offline command (server; not deployed)

**Decided policy (product owner):** an offline checkout that would exceed stock when it reaches the server is **rejected and kept on the device**. Stock is never exceeded and nothing is partially applied.

`20261207000100_inventory_checkout_offline.sql`:

- **Existing bug fixed:** `checkout_inventory_item` still required the retired `member` role (renamed to `fire_fighter` by `20261013000100`), so no one could check out. Crew roles `fire_fighter` and `shop_tech` can check out again, matching the apps (managers manage stock and check items in). The online error contract is otherwise unchanged.
- One security-definer `inventory_checkout_core` performs the stock check for the **current caller only** under the item row lock. The online function and the offline command both use it; clients cannot call it directly.
- Offline: `inventory_checkout` / `checkout.add` (`{quantity}`; entity ID = item ID, so one user's checkouts of an item apply in device order). A shortfall returns `notApplied: 'insufficient_stock'` and a deleted item `notApplied: 'item_deleted'`, both with nothing changed. The canonical record is `{id: itemId, checkedOut}` for the caller. Check-in remains an online owner/admin action.

Tests: `inventory-checkout-offline.test.mjs` (4 embedded PostgreSQL tests on the real inventory migrations, with a realtime publication stub in `loadInventorySchema`: online role fix, single apply with replay, competing checkouts never exceeding stock, deleted items, validation, manager/outsider denial and core privacy). The audit log, grants and user-sync suites pass.

### Gear checkout: client (native)

`offline-user-sync.ts` adds `checkOut(itemId, quantity)`; the outbox sequences one user's checkouts of an item in order. `pendingCheckouts(entries)` sums the unapplied quantities per item. Offline, the crew row on the Inventory screen saves the checkout on the device and shows *N saved on this device — checks out when connected if still in stock*. Those units are held back from the quantity the screen offers, but the server decides at arrival. Saved changes & sync labels rejections as *Not checked out — not enough stock was left when it synced* or *the item was deleted before it synced*; the request stays in the device outbox. Online checkout still calls the (now fixed) server function directly. Check-in and stock management stay online for owners/admins. The inventory list offline still comes from the earlier read cache (not a verified download). Web is unchanged; it benefits from the role fix.

Tests: 1 more SQLite-backed test in `offline-user-sync.test.ts` (validation, per-item ordering via dependencies, pending sums, shortfall/deleted outcomes and labels).

### Training sign-ups: server (not deployed)

**Decided policy (product owner):** a sign-up that reaches the server after the class filled is **rejected as full and kept on the device**. Capacity is never exceeded.

`20261208000100_user_sync_training_signups.sql` registers `training_signup` (entity ID = training ID, so one user's join/cancel for a training apply in order) with `signup.join` and `signup.cancel` (empty payloads). Join inserts through the existing trigger (capacity check under the training row lock, attributed name) and RLS. The adapter maps the trigger's "full" (`23514`) to `notApplied: 'course_full'` and a missing training to `notApplied: 'training_deleted'`, inside a subtransaction so nothing changes. The sync writer cannot take that row lock itself, because the training UPDATE policy is manager-only. Already signed up is a no-op. Cancel deletes only the caller's own sign-up. The canonical record is `{id: trainingId, signedUp}`. Training creation and edits stay online for managers.

Tests: `training-signups-offline.test.mjs` (3 embedded PostgreSQL tests on the real training migration: single attributed seat with replay, full class rejection with nothing changed, deleted training, cancel scope, validation and outsider denial).

### Training sign-ups: client (native)

`offline-user-sync.ts` adds `joinTraining`/`cancelTraining` (ordered per training by the outbox) and `pendingTrainingSignups(entries)`, the latest unapplied intent per training. Offline, the training detail button saves the change on the device. The screen reflects the saved intent with *Sign-up saved on this device — confirmed when connected if a seat is still open* or *Cancellation saved on this device — sent when connected*. Saved changes & sync labels rejections *Not signed up — the course was full when your sign-up arrived* or *the training was deleted*; the request stays in the device outbox. Online registration is unchanged. The training list offline still comes from the earlier read cache.

Tests: 1 more SQLite-backed test in `offline-user-sync.test.ts` (ordering, pending intent, full-class outcome and label). 159 targeted mobile tests and the mobile typecheck pass.

### Payroll forms: server (not deployed)

**Decided policy (product owner, 2026-10-23):** receipts, payroll and invoices **do not need app-level encryption** of device copies. They follow the same device-storage rules as vehicle files.

`20261209000100_user_sync_payroll_forms.sql` registers `payroll_form` (entity ID = form ID chosen on the device) with two commands:

- `form.save` `{engineNumber?, incidents?, rows?}` (at least one; `rows` = 21 validated days). It creates the caller's draft if it does not exist yet (name from the caller's profile), otherwise merges the given fields over the current form. Later arrival wins per field, because only the creator edits a draft or returned form. The attachment is never changed offline.
- `form.submit` `{}` sends a draft or returned form for approval through the existing protect trigger, which also notifies managers. An already submitted form is a no-op.

Nothing changes and the device keeps its edits when the form was already submitted (`notApplied: 'already_submitted'`), was deleted after this user's device saw it on the server (`form_deleted`; the adapter checks the caller's earlier receipts for this form, so it never recreates a deleted form), or another draft is already in progress (`other_draft`, from the one-draft-per-user index). A reused form ID owned by someone else is refused (`23505`). The protect trigger and RLS still enforce creator-only edits. Approve, reject, mark paid, delete and attachments stay online-only.

Tests: `payroll-forms-offline.test.mjs` (5 embedded PostgreSQL tests on the real payroll migrations: create and per-field merge with replay, submit with manager notification, revise-and-resend of a returned form, approved forms read only, deleted forms never recreated, second draft refused, payload validation, foreign identity and outsider denial).

### Payroll forms: client (native)

`offline-user-sync.ts` adds `savePayrollForm(formId, changes)` (only changed fields, validated like the server) and `submitPayrollForm(formId)`, ordered per form by the outbox. `devicePayrollForms(entries)` merges unsynced saves per form, and `overlayPayrollForms` shows them over the downloaded list. A form created on the device appears as a draft (or as pending once its submission is saved). `use-device-forms.ts` wires both payroll screens.

On the payroll form, edits made offline save on the device as per-field changes against the last sent copy. While that form still has unsynced device changes, edits keep using the device queue even after reconnecting, so an older queued value can never land after a newer online save. Submitting offline saves the submission behind those edits. Attachments and deleting need a connection and wait until device changes have synced. Manager approve/reject/paid stay online. Labels: *Saved on this device — syncs when connected*, *Submission saved on this device — sends when connected*, and in Saved changes & sync *Not saved — this payroll form was already submitted*, *…was deleted* or *another payroll form is already in progress*. Refused edits stay in the device outbox. The payroll list itself still comes from the online read (no verified payroll download yet).

Tests: 1 more SQLite-backed test in `offline-user-sync.test.ts` (validation, ordering, merged overlay for new and existing forms, refusal label with the edit retained). Mobile typecheck and 80 targeted mobile tests pass.

### Invoices: server (not deployed)

`20261210000100_user_sync_invoice_forms.sql` mirrors payroll for `invoice_form`: `form.save` `{invoiceNumber?, invoiceDate?, invoiceAmount?, customerId?}` (`''` clears the date or customer; amounts are non-negative with at most 2 decimals) creates the caller's draft if new or merges the given fields (later arrival wins per field), and `form.submit` `{}` submits it through the existing trigger, which notifies managers. Nothing changes, and the device keeps its intent, when the invoice was already submitted (`already_submitted`), was deleted after this user's device saw it (`form_deleted`), another draft is in progress (`other_draft`), the chosen customer was removed (`customer_deleted`), or a submission lacks number, date, positive amount or customer (`incomplete`). The invoice update policy hides submitted rows, so the writes re-check `status = 'draft'` instead of locking first. Deleting, attachments and customer management stay online.

Tests: `invoice-forms-offline.test.mjs` (4 embedded PostgreSQL tests on the real invoice migration: create/merge/replay/submit with notification, incomplete submit and removed customer, deleted invoice never recreated, second draft refused, validation, foreign identity and outsider denial).

### Invoices: client (native)

Same design as payroll: `saveInvoiceForm(formId, changes)` / `submitInvoiceForm(formId)`, `deviceInvoiceForms` and `overlayInvoiceForms`, wired into the Invoices list and invoice form through `useDeviceInvoices` (`use-device-forms.ts`, shared with payroll). The form keeps its existing required-field check before submitting. Edits queue on the device while offline or while the invoice still has unsynced device changes. Attachments and deleting need a connection. Customer management stays online, and the customer list offline is whatever the store last loaded. Extra labels: *Not saved — the chosen customer was removed* and *Not submitted — number, date, amount and customer are required*.

Tests: 1 more SQLite-backed test in `offline-user-sync.test.ts` (validation, ordering, overlay of a device-created submitted invoice, incomplete refusal label).

### Receipts: server (not deployed)

**Bug fixed (affects online use too):** the uploader delete policies on `receipt-files`, `invoices-files` and `payroll-files` compared the saved row's `storage_path` with that row's own `name` column instead of the object's name. So the "still referenced" check never matched, and crew could delete the files behind their saved receipts, invoice documents, payroll documents and submitted payroll forms. `20261211000100_fix_storage_file_retention_policies.sql` recreates the three policies with the same rules and the object name qualified. Test: `storage-file-retention.test.mjs` (4 cases; all fail without the fix). Owners' own delete policies are unchanged.

`20261212000100_user_sync_receipts.sql` registers `receipt` / `receipt.create` `{name, amountCents, fileName, mimeType, byteSize}` (entity ID = receipt ID chosen on the device). The device first uploads the file into the caller's own `receipt-files` folder at the fixed path `<company>/<user>/sync-<receipt id>`, under the same storage policies the online upload uses (own folder only, no overwrite). The command then creates the receipt for exactly that path through the existing attribution trigger and RLS, but only if the object exists (otherwise retryable error `55000`) and has the declared size (otherwise `notApplied: 'file_mismatch'`, nothing created). A reused receipt ID or path is refused (`23505`). No server-side hash check: trust is the same as the online flow, where the uploader writes its own folder directly. Edits and deletes stay online (owners).

Tests: `receipts-offline.test.mjs` (4 embedded PostgreSQL tests on the real receipt migrations and Storage metadata fixture: attributed create with replay and file retained, missing file and size mismatch, foreign folder and ID reuse, validation and outsider denial).

### Receipts: client (native)

Offline, **Add receipt** copies the picked photo or PDF into app storage (`offline-receipt-files.ts`, `Documents/fireops-offline-receipts-v1/<user>/<company>/<receipt id>`, not app-encrypted by decision) **before** saving the `receipt.create` command (`createReceipt` in `offline-user-sync.ts`; the receipt ID is chosen once per intended receipt). When connected, the native transport uploads that copy to `receipt-files` at `<company>/<user>/sync-<receipt id>` with `upsert: false`, treating "already exists" as a lost earlier response, and only then sends the command. Any other upload failure stops before the command and retries later. The device copy is removed once the receipt is created. It is kept if the server refuses the file (*Not saved — the uploaded receipt file did not match; the file is kept on this device*) or if the command stays blocked. The receipts list shows device receipts until the downloaded list includes them (*Saved on this device — uploads when connected*). They cannot be viewed or edited until synced. Online uploads are unchanged.

Known gaps: kept files are not cleaned up if their outbox entry is discarded, and there is no retry-with-new-file flow after a mismatch. Validate the Storage "already exists" response shape and `upsert: false` behavior on real Supabase.

Tests: 1 transport test (upload before command, path and content type, already-exists tolerated, refused receipt keeps its file, upload failure stops the command, no re-upload without a device copy) and 1 SQLite-backed command test (validation before keeping a file, payload, overlay, mismatch label). Mobile typecheck passes.

### Crew resolve/reopen with a note (not deployed)

`20261213000100_fleet_sync_issue_status_with_note.sql` lets an issue change carry `status` (and `resolvedAt`) **together with exactly one new own note**, which is what the member issue trigger already requires of crew online. The merge applies the status group, then appends the note. If the issue already has the proposed status (someone resolved/reopened it meanwhile), the current status and resolution time are kept and only the note is added, so the change never becomes a conflict. Crew may send status/resolvedAt only together with a note; the role trigger still limits them to issues they reported. Managers may use the same combined change. The function bodies are otherwise identical to `20261124000100`.

Client: `mergeFleetSyncDetail` (shared domain) mirrors this for local rebase; the editor accepts notes alone or one note with status/resolvedAt (removal of `resolvedAt` when reopening), crew allowlists include `status`/`resolvedAt`, and a crew status change without a note is refused locally. Crew issue screens show **Resolve with this note** / **Reopen with this note** (enabled once a note is typed). Manager screens are unchanged.

Tests: `fleet-sync-issue-status-notes.test.mjs` (4: resolve and reopen with notes, existing resolution kept with no conflict, refusals with nothing written, manager combined change); `fleet-sync-fields.test.ts` and `offline-status-assignments.test.ts` updated. 306 mobile offline tests, domain field tests and the related fleet database suites pass.

### Offline vehicle creation (not deployed)

`20261214000100_fleet_sync_vehicle_create.sql` extends the idempotent `sync_fleet_create` endpoint (issue reports, `20261126000100`) to **vehicles, owners/admins only** (as online). The new vehicle is fully validated: unit, type, make and model non-blank, 4-digit year, VIN/plate/notes strings, status **Ready or Out of service**, unassigned, and no photo, files, documents or inspections (their own adapters add those once it exists). It is inserted through `apply_fleet_changes` together with the same "*unit* added to fleet" activity the online form writes, plus device-reported provenance. An ID with any revision history or an existing vehicle/issue row is refused (`23505`), so a deleted vehicle is never recreated. Issue creation is unchanged apart from sharing the function.

Client: `detailEditor.createVehicle(record)` (one operation per new vehicle ID, retried identically; crew refused locally), the adapter block and read model accept vehicle creates (a device-created vehicle shows as a local proposal until synced), and **Add vehicle** saves on the device when offline. Offline it refuses a chosen photo (add it later through the vehicle files) and full-form edits of existing vehicles (use Edit saved details).

Tests: `fleet-sync-vehicle-create.test.mjs` (4: create with activity and replay, identity reuse and deleted-vehicle refusal, crew/outsider/invalid refusals, issue reports unchanged); 1 more client test in `offline-status-assignments.test.ts`; two older tests that used vehicle creates as the "unsupported" example now use activities. 307 mobile offline tests pass.

### Feedback and notification preferences (not deployed)

`20261215000100_user_sync_feedback_and_preferences.sql` registers two user commands. `feedback.send` `{category, message, source}` inserts one `app_feedback` row per device-chosen ID as the caller, through the existing insert policy, source-attribution trigger and owner notification. A reused ID is refused. A new policy lets only the sync writer read back the caller's own feedback for the receipt; ordinary clients still cannot. `preferences.set` `{changes}` (self only) merges boolean `pushEnabled`, `communicationReplies`, `documentAdded`, `trainingCreated` and `issueUpdates` per key over the caller's row, creating it with defaults if missing. Later arrival wins per key, like the dashboard layout.

Client: `sendFeedback` and `setNotificationPreferences` in `offline-user-sync.ts`, plus `pendingNotificationPreferences` for the overlay. Settings → **Send feedback** offline saves on the device ("Feedback saved — it will be sent when you are connected"), keeping one ID per intended message for retries. Notification toggles queue per key on the device while offline, or while earlier device preference changes are still unsynced, through the inbox bridge (`offline-chat-inbox.ts`), and the Settings screen shows the saved values. Online behavior is unchanged otherwise.

Tests: `feedback-preferences-offline.test.mjs` (3 embedded PostgreSQL tests on the real feedback and preference migrations); 1 more SQLite command test and 1 store test.

### Verified company-list downloads: server (not deployed)

`20261216000100_company_sync_snapshots.sql` adds `get_company_sync_snapshot(company, section)` for `inventory`, `training`, `payroll`, `invoices`, `receipts`, `crew_chat` (threads, replies, own seen markers; up to 10000 rows) and `notifications` (the caller's latest 500 notifications plus preferences, a bounded window like the online inbox). Each section is read in one statement (one database snapshot) under existing row-level security through the non-bypass sync writer, so each role gets exactly what it can read online: crew see their own payroll, invoices and receipts, and managers see the company's. It returns the same columns the mobile stores load online, plus the caller's user-receipt watermark taken under the shared per-user lock (as `get_user_sync_snapshot`), so every own command at or below the watermark is reflected. Training includes only the caller's own read markers. A section over 5000 rows is refused (`54000`), never truncated. Tests: `company-sync-snapshots.test.mjs` (4).

### Verified company-list downloads: client (native)

SQLite outbox **v12** adds `offline_company_snapshots` (one row per account, company and section, never replaced by an older download: server time and receipt watermark must not go backwards). `offline-company-snapshot.ts` decodes each section strictly: exact account, company, section, table names and the stores' exact column sets, at most 5000 rows. `createCompanySnapshotSync` loads saved sections on start and downloads all seven on reconnect, on foreground and after this account's commands are confirmed, keeping earlier sections when one fails. The provider publishes them through `offline-company-lists.ts`.

While **offline**, the inventory, training, payroll, invoice, receipt, Crew Chat and notification inbox stores read their rows from the verified download (the inbox applies the same crew filter and 100-item window as online and counts unread within the download) instead of cached HTTP responses (unchanged online). Each list shows *Offline — showing the list downloaded …*. `entriesAfterDownload` keeps this device's own commands that were applied after the download's watermark overlaid as saved on the device (refused ones are not), so a checkout, sign-up or form change that synced after the last download never disappears from the offline view. Downloads are display data only, never edit bases.

Tests: `offline-chat-inbox-stores.test.ts` (inbox and Crew Chat read downloads offline, live reads online) and `offline-company-snapshot.test.ts` (4: strict decoding, per-section monotonic storage across restarts and accounts, multi-section download with partial failure, watermark overlay). The outbox upgrade tests now expect v12. 313 mobile offline tests and the mobile typecheck pass.

### Offline thread, training and inventory item creation (not deployed)

`20261217000100_user_sync_manager_creates.sql` registers create-only user commands for owners/admins: `communication_thread`/`thread.create` `{subject, description}`, `training`/`training.create` `{courseCode, courseTitle, startsAt, location, instructor, capacity, courseInformation}` and `inventory_item`/`item.create` `{name, quantity}`. Each inserts once per device-chosen ID through the existing attribution triggers, insert policies and side effects (crew notifications), so crew are refused exactly as online. A reused ID is refused (`23505`). An inventory name already used in the company returns `notApplied: 'name_taken'` and adds nothing (*Not added — an item with this name already exists*). Edits, renames, stock changes, check-in and deletes stay online-only.

Client: `createThread`, `createTraining` and `createInventoryItem` (one ID per intended record via `useIntentId`) and `deviceThreads`/`deviceTrainings`/`deviceInventoryItems`. **New thread**, **Create training** and **Add item** save on the device when offline. Editing a training or renaming an item offline says it needs a connection. The Crew Chat, Training and Inventory lists show records created on this device until the list includes them (*Saved on this device — added when connected*). An offline-started thread opens once synced.

Tests: `manager-creates-offline.test.mjs` (3 embedded PostgreSQL tests on the real migrations, including the manager-only thread policy) and 1 more SQLite command test.

### Offline company documents (not deployed)

`20261218000100_user_sync_company_documents.sql` follows the offline receipt design for owners/admins. **Add document** offline keeps the picked file on the device (same app storage as receipts, not app-encrypted). When connected, the transport uploads it into the caller's own `fleet-files` folder at `<company>/<user>/doc-<document id>` with `upsert: false` (the `doc-` prefix stays clear of the protected `sync-` fleet copies), and only then sends `document.create` `{name, fileName, mimeType, byteSize}`. The server creates the document for exactly that path through the existing attribution trigger and owner insert policy, if the object exists (otherwise retryable `55000`) at the declared size (otherwise `notApplied: 'file_mismatch'`). Crew are refused (`42501`) and a reused ID is refused (`23505`). Files must be JPG, PNG, WebP, GIF or PDF, 8 MB or smaller, as for fleet files. Renaming, replacing files and deleting stay online. The Documents list shows documents added on this device until the list includes them.

Client: `offlineFileUploads` (in `offline-user-sync.ts`) maps both receipts and documents to their bucket and fixed path for the shared upload-before-command step in the transport, and `createCompanyDocument`/`deviceDocuments` handle the document side. Tests: `company-documents-offline.test.mjs` (2), 1 transport test and 1 SQLite command test. 317 mobile offline tests pass.

### Guarded offline edits and deletes: server (not deployed)

**Decided policy (product owner, 2026-10-23):** an offline edit or delete applies **only if nobody changed the record since the device downloaded it**. Otherwise the current server value is kept, nothing changes, and the device keeps its change and says so (`notApplied: 'changed_elsewhere'`). Payroll approve/reject/paid work the same way. Vehicle deletion and invitations stay **online-only**.

`20261219000100_user_sync_guarded_edits.sql` adds the commands. Every payload carries `base`: `{updatedAt}` as last seen, or, for receipts (no `updated_at` column), the seen `{name, amountCents, storagePath}`; or `{afterOperation}`, naming this user's own earlier command for the same record. `afterOperation` matches only if that command applied and the record still equals the state its receipt recorded, so a chain of offline edits on one record works without reading the server in between. `user_sync_base_matches` implements this once. An already deleted record is a no-op for deletes and `record_deleted` for edits.

- `training`: `training.update` (all fields), `training.delete`.
- `inventory_item`: `item.update` (`name` and/or `quantity`; below the units checked out returns `below_checked_out`; a taken name returns `name_taken`), `item.delete`. `inventory_return`/`return.checkin` `{userId, quantity}` checks against that borrower's checkout `updatedAt` under the item row lock that checkouts also take, then calls the existing `checkin_inventory_item`.
- `receipt`: `receipt.update` (`name`/`amountCents`), `receipt.delete` (the device removes the stored file afterwards, as online).
- `vehicle_note`: `note.update` (`subject`, `body`), `note.delete`.
- `communication_reply`/`reply.delete` (managers; replies are never edited).
- `payroll_review` (entity = form): `review.approve`, `review.reject {notes}`, `review.mark_paid`. Approve/reject need a pending form, and mark paid needs an approved one.

Permission checks run first (owners/admins, or vehicle-note access), so a refused role gets `42501` rather than a misleading "deleted". The existing triggers and RLS still apply. The training, inventory item, receipt, vehicle note and reply state functions now return any record the caller may read (no creator filter) and include `updatedAt` where the table has one. The original create adapters are renamed `*_create` and called by the new dispatch functions. Tests: `guarded-edits-offline.test.mjs` (4).

### Guarded offline edits and deletes: client (native)

`offline-user-sync.ts` adds `updateTraining`/`deleteTraining`, `updateInventoryItem`/`deleteInventoryItem`, `checkInInventory`, `updateReceipt`/`deleteReceipt`, `updateVehicleNote`/`deleteVehicleNote`, `deleteReply` and `reviewPayroll`. `editBase(entries, entity, id, seen, watermark)` picks the base: this user's latest own command for the record that the shown data does not include yet (unresolved, or applied after the shown download's watermark) as `afterOperation`, else the version shown. `pendingEdits` merges unsynced edits/deletes per record. `use-offline-edits.ts` shows them on top of the training, inventory, receipt and vehicle-note lists, hiding deleted rows and showing changed fields.

Wired screens: training edit (form) and delete (detail); inventory rename (form), stock edit, check-in and delete; receipt edit (form) and delete (list); vehicle note edit/delete; Crew Chat reply delete (hidden until synced); payroll approve/reject/mark paid. The payroll form shows *Approval saved on this device — applies when connected if the form is unchanged*. After an offline receipt delete applies, the transport removes the stored file, as online. Labels: *Not saved — someone changed this since you downloaded it; their version was kept*, *…this was deleted before your change arrived*, *…more units are checked out than the new quantity*. Online behavior is unchanged.

Tests: 1 more SQLite-backed test in `offline-user-sync.test.ts` (base selection and chaining, merged overlay, validation, refusal label, chaining after a download watermark).

### Offline fire assignment (native)

**Decided policy (2026-10-23):** offline, fires are assigned from the **last downloaded fire list**, labeled with its time. `offline-fire-list.ts` saves the public NIFC list (only `id`, `name`, `state`, at most 5000) to app storage whenever Operations or a vehicle loads it online, and decodes it strictly when read. The saved-detail **Status & assignment** panel now offers **Assign fire** (search by name or state) whenever the vehicle has an assignee; crew only see it on a vehicle assigned to them. It saves `assignedFire` through the existing verified vehicle adapter. The server and role triggers check it as for any status/assignment change (a concurrent change goes to owner/admin review). If no list was ever downloaded, the panel says to open Operations or a vehicle while online. No server change.

Tests: `offline-fire-list.test.ts` (2).

### Offline inspection deletes and vehicle document removal: server (not deployed)

Online, only failed inspections can be deleted (owners/admins), and documents are replaced through the full vehicle form. `20261220000100_user_sync_vehicle_entries.sql` adds owner/admin commands under the decided policy: `vehicle_inspection`/`inspection.delete` and `vehicle_document`/`document.remove`, each `{vehicleId, base: <entry as seen>}`. The entry is removed only if it still equals `base`; otherwise `changed_elsewhere` is returned and nothing changes. An entry already gone is a no-op. Entries others added meanwhile are kept. Only failed inspections can be deleted, as online, and the delete writes the same "failed inspection deleted" activity. Writes go through `apply_fleet_changes` under the vehicle's record-group lock (taken after the user-sync locks; fleet submissions never take user-sync locks, so no lock cycle), so revisions, RLS and role triggers stay authoritative. Replacing a document offline = removal plus the existing offline document attach. The removed file stays in storage. Tests: `vehicle-entries-offline.test.mjs` (3).

### Offline inspection deletes and vehicle document removal: client (native)

`deleteVehicleInspection(vehicleId, seen)` and `removeVehicleDocument(vehicleId, seen)` send the entry exactly as downloaded as the base. **Inspections** deletes a failed inspection offline and hides it until synced. The saved-detail editor's vehicle document panel can now **remove** a document, or **replace** one: choose the new file, pick which document it replaces, and the new document is saved on the device, then the old one's removal is queued. Each removal applies only if that document is unchanged. Binder documents with fixed IDs (contract, VIPR and the other file slots) are not listed; they already change offline through the file slots. Refusals use the shared *their version was kept* label. Tests: 1 more SQLite command test; 321 mobile offline tests and the mobile typecheck pass.

### Offline own qualification records, without files: server (not deployed)

Crew qualification files have **no device-storage decision yet**, so offline changes never add, change or remove an attachment. `20261221000100_user_sync_crew_qualifications.sql` adds commands that call the existing self-service functions (same validation as online):

- `crew_credential`: `credential.add`, `credential.update`, `credential.delete`.
- `crew_experience`: `experience.add`, `experience.update`, `experience.delete`.
- `annual_record`/`annual.set` (self only).

A new entry may not carry a file, and an edit must keep the entry's existing file exactly. License and DOT medical credentials need a photo, so they cannot be added offline. Edits and deletes apply only if the entry still equals the one seen (`changed_elsewhere` otherwise). Re-adding an identical entry is a no-op; a different entry with the same ID is refused (`23505`). Tests: `crew-qualifications-offline.test.mjs` (3).

### Offline own qualification records, without files: client (native)

`saveQualification`, `deleteQualification` and `setAnnualRecord` in `offline-user-sync.ts`, plus `overlayQualifications` (`useOwnQualifications`), which shows unsynced changes in save order on the Qualifications screens. Because the server compares entry values, a chained offline edit uses the shown (already edited) entry as its base. **Add/edit credential**, **incident experience** and **annual records** save on the device when offline. Choosing a new file offline is refused (*Attaching files needs a connection*), and licenses/DOT medical cards can't be added offline (photo required). An edit keeps the existing file. Deletes don't remove files offline. Tests: 1 more SQLite command/overlay test; 322 mobile offline tests pass.

### Automatic background downloads (native)

**Decided (product owner, 2026-10-23):** users should not have to download anything before going offline. The provider now starts the fleet download automatically once per account binding whenever the app is in the foreground and online. Managers get all vehicles and issues; firefighters and shop techs get vehicles, because their inventory scope excludes issues. `fleetRefreshMs` (15 minutes) makes later sync runs skip both the rescan and per-record refreshes while the last completed scan is newer than that, then rescan. **Stop** in Saved changes & sync pauses it until the next launch. The fire list used for offline fire assignment is also refreshed in the background, at most hourly. Company lists and own data were already automatic.

Vehicle and issue detail screens now show an **Offline changes** section at the bottom (above Delete vehicle) with plain wording: "Available offline · updated …" or "Not on this device yet. It downloads automatically while you are online.", plus **Edit offline** / **Device edit history** (owners/admins), **Claim / release offline** (crew vehicles) and **Notes and status offline** (crew, issues they reported). A crew member's own issue still needs to be opened once while online, because crew downloads cover vehicles only.

**Vehicle detail saves on the device directly (2026-10-24):** the vehicle detail screen's own status, crew assignment, Assign to me / Remove my assignment and fire controls now save through the verified detail editor whenever the device is offline, or online while it still has unsynced changes for that vehicle (the same `queued` rule as invoices and payroll). Changes are built by `offlineVehicleChange` in `lib/offline-vehicle-changes.ts`, shared with the saved-detail editor's `OfflineVehicleStatus`, so both paths clear assignment fields and return released vehicles to Ready identically. The fire picker uses the downloaded fire list when offline. The vehicle **Offline changes** section, **Edit offline** and **Claim / release offline** buttons are removed; owners/admins keep a small **Device edit history** link, and the header Edit still opens the saved-detail editor offline for details, files and documents. Photo changes and vehicle deletion still need a connection. The issue detail screen now works the same way: **Add update** and **Mark resolved / Reopen issue** (always with a note) save through the editor under the same rule, built by `offlineIssueChange` in `lib/offline-issue-changes.ts` and shared with `OfflineIssueUpdates`. Its Offline changes section, **Edit offline** and **Notes and status offline** buttons are removed; owners/admins keep a **Device edit history** link, and **Edit issue details** still opens the saved-detail editor offline. Crew can still only change issues they reported, which the editor and server enforce; a crew member's own issue must have been opened once online to be on the device.

### The person who made the change resolves conflicts (replaces owner/admin review)

**Decided (product owner, 2026-10-23):** owners and admins no longer approve offline changes. Everything downloads automatically. When a change made offline syncs and conflicts with someone else's change, or the server refuses it, **the person who made it is warned in a banner at the top of the app** and chooses **Submit again** or **Cancel change**. Nothing is overwritten automatically.

- **Fleet conflicts** (vehicle/issue fields someone else changed): `20261222000100_fleet_sync_submitter_conflicts.sql` adds `withdraw_my_fleet_sync_conflict(company, operation)`. It is submitter-only, runs under the record-group lock, and is idempotent. It closes the user's own pending conflict and records a `not_selected` outcome through the existing decision/outcome audit (decision `result.kind = 'withdrawn'`), so the device finishes the original change through the same verified outcome path a manager decision used. **Cancel** stops there. **Submit again** then saves the same field values as a new verified update from the current version (`resolveOfflineDecision`), re-appending notes/inspections onto the current list and keeping file bindings. It is checked like any change, so it can conflict again if someone edits in between. New narrow policies let the sync writer read, close and record only the caller's own conflict.
- **Refused or kept-current commands** (`notApplied` / `keptCurrent`): **Submit again** re-sends the same command (`userSync.resubmit`). Guarded edits are checked against the version the server reported when it refused them (`updatedAt`, receipt values, entry values or annual record), so they apply only if nothing changed since. **Cancel** clears the notice; nothing is sent. Refusals that cannot succeed again (deleted records, already submitted forms, another draft, file mismatch, incomplete invoice, taken name) offer only Cancel.
- `offlineSyncDecisions(state)` lists what needs a decision. The banner shows the first ("1 of N") with **Submit again / Cancel change / Details**, and Saved changes & sync shows both buttons on each affected row. Fleet conflicts need a connection to resolve.
- **Owner/admin review is removed:** the dashboard conflict alerts on mobile and web are gone, and the mobile conflict screen is now **Device edit history** only. The server review functions remain but are no longer used by the clients.

Tests: `fleet-sync-submitter-conflicts.test.mjs` (2), two worker tests (cancel through the verified outcome; submit again from the current version) and one command test (re-send with the reported version; cancel a final refusal).

### Deployment checkpoint (nothing deployed by this implementation)

You do not need to push the site or apply Supabase changes while implementation continues. When ready, use the normal forward migration process, in order:

1. `20261109000100_fleet_sync_safeguards.sql`
2. `20261110000100_fleet_sync_conflicts.sql`
3. `20261111000100_fleet_sync_review.sql`
4. `20261112000100_fleet_sync_record_read.sql`
5. `20261113000100_fleet_sync_device_history.sql`
6. `20261114000100_fleet_sync_history_reads.sql`
7. `20261115000100_fleet_sync_history_recovery.sql`
8. `20261116000100_fleet_sync_download.sql`
9. `20261117000100_fleet_sync_attachment_uploads.sql`
10. `20261118000100_fleet_sync_attachment_verification.sql` (deploy the `verify-fleet-sync-attachment` Edge Function with it)
11. `20261119000100_fleet_sync_document_attach.sql` (deploy the `attach-fleet-sync-document` Edge Function with it)
12. `20261120000100_fleet_sync_attachment_release.sql` (redeploy `attach-fleet-sync-document`; deploy `release-fleet-sync-attachment`)
13. `20261121000100_fleet_sync_vehicle_file_slots.sql` (deploy `copy-fleet-sync-attachment`)
14. `20261122000100_fleet_sync_status_assignments.sql`
15. `20261123000100_fleet_sync_member_actions.sql`
16. `20261124000100_fleet_sync_inspections.sql`
17. `20261125000100_fleet_sync_shop_tech_photos.sql`
18. `20261126000100_fleet_sync_issue_create.sql`
19. `20261127000100_user_sync_commands.sql`
20. `20261128000100_user_sync_availability_cas.sql`
21. `20261129000100_personal_task_identities.sql`
22. `20261130000100_online_dashboard_preferences.sql` (requires updated per-key online clients; do not retain legacy whole-layout upserts)
23. `20261201000100_online_crew_availability.sql` (requires updated online availability clients; legacy direct writes are denied)
24. `20261202000100_fleet_sync_storage_cleanup_fences.sql` (redeploy `verify-fleet-sync-attachment`, `attach-fleet-sync-document`, `copy-fleet-sync-attachment` and `delete-fleet-files` with it; the functions call its RPCs)
25. `20261203000100_user_sync_read_markers.sql`
26. `20261204000100_user_sync_crew_chat_replies.sql`
27. `20261205000100_user_sync_vehicle_notes.sql`
28. `20261206000100_user_sync_snapshot.sql`
29. `20261207000100_inventory_checkout_offline.sql` (also restores online crew checkout)
30. `20261208000100_user_sync_training_signups.sql`
31. `20261209000100_user_sync_payroll_forms.sql`
32. `20261210000100_user_sync_invoice_forms.sql`
33. `20261211000100_fix_storage_file_retention_policies.sql` (independent bug fix; safe to apply early)
34. `20261212000100_user_sync_receipts.sql`
35. `20261213000100_fleet_sync_issue_status_with_note.sql`
36. `20261214000100_fleet_sync_vehicle_create.sql`
37. `20261215000100_user_sync_feedback_and_preferences.sql`
38. `20261216000100_company_sync_snapshots.sql`
39. `20261217000100_user_sync_manager_creates.sql`
40. `20261218000100_user_sync_company_documents.sql`
41. `20261219000100_user_sync_guarded_edits.sql`
42. `20261220000100_user_sync_vehicle_entries.sql`
43. `20261221000100_user_sync_crew_qualifications.sql`
44. `20261222000100_fleet_sync_submitter_conflicts.sql`

Apply any earlier pending project migrations as well; do not reset production. Verify role-creation/ownership privileges, backfill timing, RLS and multi-session locking on the target Supabase PostgreSQL version as described above. These migrations are intentionally not auto-applied by either client.

Review UI and the native saved-detail editor report setup pending against an old database; existing online editors remain available. After migration and required verified downloads, the implemented installed-app adapters listed above can save offline. Catch-up for remaining workflows, sensitive-data protection and remaining workflow adapters are incomplete. Opt-in vehicle/issue inventory catch-up is implemented; optimized delta feeds and large-company performance validation remain pending. Guarded older-build history backup is implemented; missing original server submissions still require explicit investigation. Repeated scalar edits and explicit dependent-edit rebase are enabled only through the limited native adapter. No production sample conflicts are inserted. Deployment is not an announcement that all-feature offline mode is complete.

### Mutation inventory checkpoint

The inventory below lists subsystem boundaries, not a claim that every mutation remains unsupported. Completed adapters are described above; remaining mutations within each subsystem still require explicit coverage. Paths are under `apps/mobile/src/` unless noted.

| Workflow | Current write entry points | Required sync boundary |
| --- | --- | --- |
| Fleet details, assignments, issues, inspections | `lib/fleet-store.ts`; web `FleetApp.tsx`; legacy `apply_fleet_changes`; privileged functions/jobs | Atomic record/batch revisions; verified bases; independent-field merge; domain-invariant conflicts; all writer CAS migration |
| Crew details, roles, qualifications, invitations/removal | `lib/fleet-store.ts`, `lib/qualification-card-store.ts`, invite/remove Edge Functions | Typed privileged commands; role/seat checks; external mail only after acceptance; approval provenance |
| Vehicle notes, types, inspection templates | `lib/vehicle-notes-store.ts`, `lib/vehicle-type-store.ts`, `lib/inspection-template-store.ts` | Per-record revision/delete tracking; stable generated IDs; reference dependencies |
| Communications and read receipts | `lib/communications-store.ts` | Append messages independently; delete authorization; idempotent notifications and seen markers |
| Company and stored documents | `lib/documents-store.ts`, `lib/stored-documents-store.ts` | Durable files; record/file ordering; read receipts; versioned replacements |
| Training and enrollment | `lib/training-store.ts` | Versioned training fields; capacity-validated enrollment commands; notification deduplication |
| Inventory | `lib/inventory-store.ts` | Adjustment/checkin/checkout commands, not stale totals; current availability checks |
| Receipts, payroll, invoices/customers | `lib/receipts-store.ts`, `lib/payroll-store.ts`, `lib/invoice-store.ts` | Versioned drafts; attachment dependencies; validated financial/status transitions; sensitive-data retention |
| Availability, tasks, dashboard preferences | `lib/use-availability.ts`, `lib/use-personal-tasks.ts`, `lib/use-dashboard-preferences.ts` | User-scoped revisions; private task visibility must not be widened by manager conflict review |
| Notifications/preferences and device tokens | `lib/notification-inbox-store.ts`, `lib/notifications.ts` | Idempotent user-scoped markers/settings; device registration only online |
| Company/account settings, feedback, integrations | `providers/session-provider.tsx`, `app/settings.tsx`, Motive Edge Function | Server-authorized commands; no offline authentication/OAuth exchange or fabricated external success |
| File operations and local exports | `lib/fleet-files.ts`, `lib/payroll-files.ts`, `lib/invoice-files.ts`, form/export screens | Persist local bytes before enqueue; safe cleanup; downloaded inputs for local generation |
| External fire/maps/dispatch data | Operations screens and external feed clients | Previously downloaded data only; freshness/coverage labels; online refresh, no fake live data |

The table is an entry-point review, not a completed per-mutation acceptance inventory. Before enabling each adapter, enumerate its exact RPC/table/file side effects and add its permission, failure, and replay tests. Private workflows need an explicit review-authority design consistent with existing privacy policies before their conflicts are exposed to managers.

### Next implementation slices

- Expand verified download coverage/freshness and complete authorized company-wide catch-up; retain per-record availability and pending overlays. Native scalar saves now use the provider-owned session; do not create competing `activate()` handles.
- Add remaining workflow/dependency adapters; durable attachment bytes/manifests are implemented. Verified vehicle/issue bulk downloads and bounded reconnect inventory catch-up are implemented; other domains still need their own authorization-aware download/catch-up contracts. Online device-history inspection is available on both clients; guarded older-build history backup is implemented. Repeated scalar saves, independent materialization and explicit local rebase are implemented; never replace an uncertain delivered operation or automatically resend discarded review values.
- Harden and validate existing remote upload/ownership/reference receipts and cleanup against actual Supabase Storage before rollout. Provider-owned draft inspection, exact-byte repair, scoped release and guarded cleanup are implemented. App-level encryption remains required before enabling sensitive-file workflows.
- Add server-authorized synchronization and migrate writers before enabling individual feature adapters.
- Extend existing sync notices, owner/admin Alerts and conflict review/approval to remaining adapters with workflow-appropriate permissions/privacy.

The banner distinguishes supported downloaded-record adapters from workflows that still require a connection. Unsupported offline HTTP mutations remain blocked. No operation is presented as saved before durable persistence, and none as synced before authoritative reconciliation. Web remains online-only.

## Required targeted tests

- Independent edits merge; overlapping edits retain every candidate; equal-value edits do not conflict.
- Multiple offline editors, multiple devices for one user, and concurrent online edits retain correct provenance.
- Lost acknowledgment/retry, duplicate submissions, app termination, network flapping, and dependency failures do not lose or duplicate work.
- New edits during review and simultaneous approvals reject stale decisions.
- Deletions, capacity/assignment constraints, inventory adjustments, and multi-record invariants stay consistent.
- Revoked access, expired sessions, account/company switching, and direct mutation bypass cannot leak or apply unauthorized data.
- Attachment recovery, disk-full failures, cached file availability, incremental deletion catch-up, and schema upgrades preserve pending work.
- Notices accurately separate saved, applied, awaiting review, blocked, and rejected outcomes.

No application UI/server launch or visual testing is required during implementation unless requested; use targeted unit, database, and type checks. The user tests UI changes.
