# Mobile offline editing and conflict resolution

Status: shared merge contracts, the durable native outbox, fleet server safeguards, verified merge/conflict submission, and guarded review/approval endpoints are implemented. Dashboard conflict Alerts and online review screens are wired on web and mobile. Native session-scoped workers, durable acknowledgment/review recovery, and sync status notices are connected. Verified raw-record storage, normalized native fleet reads with pending overlays, and a provider-owned atomic detail-edit boundary are implemented. Native legacy writes have pending-work/stale-read guards. Web online fleet saves now retain captured revisions and immutable retry requests without overwriting pending local work from realtime. Installed-app owners/admins can now save downloaded vehicle/issue scalar details offline through the dedicated saved-detail editor. Repeated scalar saves are durably chained; only verified independent continuations upload automatically. Blocked later edits have explicit per-field local rebase review; device-reported rebase history is backed up atomically with their submissions. All other workflows remain online-only. Web remains online-only. This is the first enabled adapter, not all-feature offline mode. The new migrations and client changes have not been deployed as part of this implementation.

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

Installed-app managers opt in from **Saved changes & sync → Download / refresh all vehicle and issue details**. Consent states that full raw vehicle/issue records are stored, not attachment bytes or other workflows. SQLite v6 atomically commits each page, snapshot membership, cursor and coverage counts. Completed coverage requires every page, matching live/deleted counts and no previously verified IDs missing from the authoritative inventory; absent IDs are not fabricated into tombstones. Cached newer revisions always win; same-revision inconsistent data is rejected. Partial scans and their exact cursor survive restart. Scan generations fence cancellation/restart races and account changes. Permission denial invalidates unavailable canonical cache, not saved operations, projections of pending intent or immutable history.

Once opted in, foreground/reconnect/manual runs discover new records as well as refresh existing records and process proven deletions. Scan churn gets two automatic restarts, with a 100-page (2,500 tracked-record) pass limit; unfinished progress continues on later foreground runs. This is a correctness-first bounded **full inventory scan**, not an optimized delta feed or promised background service. Every page recomputes a company-scoped fingerprint; large/high-churn companies need performance validation and may remain partial until a stable interval. Stopping company-wide catch-up keeps downloaded records and saved work; ordinary per-record refresh remains available.

Status separates saved-live-record counts, partial/complete tracked-record coverage (including deletion proofs), last completed scan's server request time, and download errors. A completed scan describes a verified inventory snapshot, not a promise that no newer edits exist. Bulk download completion is not outbox completion or all-feature offline availability. Roles/account changes hide scoped cache/coverage; late pages cannot cross sessions or replace newer generations. No web offline feature, unverified HTTP fallback, server deployment, app launch or visual testing was added.

Tests cover real SQLite page rollback, count validation, stale-cache/deletion rules, v5 upgrade preserving existing confirmations, close/reopen cursor resumption, cancellation/demotion, bounded churn retries, explicit opt-in, account isolation, RPC bearer binding, backend scope/RLS/integrity checks and cursor invalidation after concurrent logical changes. Validation: **213 native tests**, mobile typecheck, **107 embedded PostgreSQL/grant tests**, and whitespace checks passed. Actual target-Supabase multi-session and installed-device UI/performance checks remain required.

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

Apply any earlier pending project migrations as well; do not reset production. Verify role-creation/ownership privileges, backfill timing, RLS and multi-session locking on the target Supabase PostgreSQL version as described above. These migrations are intentionally not auto-applied by either client.

Review UI and the native saved-detail editor report setup pending against an old database; existing online editors remain available. After the migrations and a successful per-record verified download, only the installed-app manager scalar editor can save offline. Attachment persistence, catch-up for remaining workflows, sensitive-data protection and remaining workflow adapters are incomplete. Opt-in vehicle/issue inventory catch-up is implemented; optimized delta feeds and large-company performance validation remain pending. Guarded older-build history backup is implemented; missing original server submissions still require explicit investigation. Repeated scalar edits and explicit dependent-edit rebase are enabled only through the limited native adapter. No production sample conflicts are inserted. Deployment is not an announcement that all-feature offline mode is complete.

### Mutation inventory checkpoint

Only installed-app owner/admin scalar vehicle/issue updates through `/saved-details` are enabled in client code. The inventory below covers remaining adapters or expanded coverage of these entry points. Paths are under `apps/mobile/src/` unless noted.

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
- Add durable attachment bytes/manifests and remaining workflow/dependency adapters. Verified vehicle/issue bulk downloads and bounded reconnect inventory catch-up are implemented; other domains still need their own authorization-aware download/catch-up contracts. Online device-history inspection is available on both clients; guarded older-build history backup is implemented. Repeated scalar saves, independent materialization and explicit local rebase are implemented; never replace an uncertain delivered operation or automatically resend discarded review values.
- Add durable app-managed attachment files/manifests and restart/cleanup recovery tests.
- Add server-authorized synchronization and migrate writers before enabling individual feature adapters.
- Extend existing sync notices, owner/admin Alerts and conflict review/approval to remaining adapters with workflow-appropriate permissions/privacy.

The banner now distinguishes the limited downloaded scalar editor from read-only workflows. Unsupported offline HTTP mutations remain blocked. No operation is presented as saved before durable persistence, and none as synced before authoritative reconciliation. Web remains online-only.

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
