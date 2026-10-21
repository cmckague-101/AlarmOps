# Mobile offline editing and conflict resolution

Status: agreed product requirements and implementation plan; not implemented by this document.

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
