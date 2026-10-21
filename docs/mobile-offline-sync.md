# Mobile offline editing and conflict resolution

Status: shared merge contracts, the durable native outbox, fleet server safeguards, verified merge/conflict submission, and guarded review/approval endpoints are implemented. Dashboard conflict Alerts and online review screens are wired on web and mobile. Native session-scoped workers, durable acknowledgment/review recovery, and sync status notices are connected. Feature-level offline writes are not enabled yet. The new migrations and client changes have not been deployed as part of this implementation.

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

This module remains the storage layer; native worker/session and review-result integration are added by the subsequent slice below. Feature save handlers do not enqueue work yet. Attachment persistence, dependent-edit rebasing, and retention are not implemented. Feature adapters must reconcile/rebase sequential edits against acknowledged revisions and avoid superseded external side effects before replay is enabled. Retention/encryption decisions must precede sensitive-data workflow integration.

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
- Native review/approval RPCs explicitly require a connection; approval is not queued or confirmed offline. Already displayed in-memory review details may be read while disconnected, but fresh review/approval requires reconnection. The existing offline read-only banner remains accurate.

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

**Still not enabled:** feature save handlers do not enqueue, attachment bytes are not persisted, normalized/raw downloaded bases and full catch-up are not connected to offline editing, and sensitive-data encryption/retention plus dependent-edit rebase require implementation. Existing mobile mutations and the global offline banner therefore remain read-only. This slice must not be advertised as all-feature offline mode.

### Deployment checkpoint (nothing deployed by this implementation)

You do not need to push the site or apply Supabase changes while implementation continues. When ready, use the normal forward migration process, in order:

1. `20261109000100_fleet_sync_safeguards.sql`
2. `20261110000100_fleet_sync_conflicts.sql`
3. `20261111000100_fleet_sync_review.sql`
4. `20261112000100_fleet_sync_record_read.sql`

Apply any earlier pending project migrations as well; do not reset production. Verify role-creation/ownership privileges, backfill timing, RLS and multi-session locking on the target Supabase PostgreSQL version as described above. These migrations are intentionally not auto-applied by either client.

The new review UI can run against the old database and will show setup pending until the migrations are applied. No production sample conflicts are inserted, and mobile editing will still be read-only offline after deploying this slice: the worker and notices are connected, but save handlers, attachment persistence, raw-base/normalized read models and full catch-up are not. Deploying these review screens is not an announcement that all-feature offline mode is complete.

### Mutation inventory checkpoint

All paths below still need feature-level offline adapters; no offline write workflow is enabled by this checkpoint. Paths are under `apps/mobile/src/` unless noted.

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

- Connect raw downloaded bases, normalized reads and save handlers to the durable native queue for completed adapters, preserving local overlays and truthful per-workflow availability. Expose enqueue through the active provider-owned session; do not create competing `activate()` handles per save. Enforce monotonic downloaded revisions independently of historical receipt snapshots. Then enable and test those workflows end-to-end.
- Add durable app-managed attachment files/manifests and restart/cleanup recovery tests.
- Add server-authorized synchronization and migrate writers before enabling individual feature adapters.
- Add user sync notices, owner/admin Alerts, and conflict review/approval on both clients.

The existing read-only offline banner and request guard remain unchanged intentionally: no operation is presented as saved offline before durable persistence and server reconciliation exist.

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
