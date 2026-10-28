import {readFileSync} from 'node:fs';

export const migration = name => readFileSync(new URL(`../../migrations/${name}.sql`, import.meta.url), 'utf8');

/** Actual fleet policies/functions with only Supabase auth/company boundaries stubbed. */
export async function loadFleetSyncSchema(db, beforeSafeguards = async () => {}) {
  await db.exec(readFileSync(new URL('./fleet-sync.sql', import.meta.url), 'utf8'));
  const normalized = migration('202508250005_normalized_fleet_records');
  await db.exec(normalized.slice(0, normalized.indexOf('-- Copy existing snapshots once.')));
  const hardening = migration('202508260002_p1_hardening');
  await db.exec(hardening.slice(hardening.indexOf('-- Fold scoped admin access'), hardening.indexOf('create or replace function public.company_crew_seats_used')));
  await db.exec(hardening.slice(hardening.indexOf('create or replace function public.enforce_member_issue_changes'), hardening.indexOf('-- Apply one client snapshot delta')));
  const roles = migration('20261013000100_company_user_roles');
  await db.exec(roles.slice(roles.indexOf('create or replace function public.is_company_owner'), roles.indexOf('-- Billing remains restricted')));
  await db.exec(migration('20261016000100_firefighter_vehicle_action_permissions'));
  await db.exec('grant select on public.profiles, public.companies, public.company_members to authenticated');
  await db.exec(migration('202509040001_fleet_conflict_http_status'));
  await beforeSafeguards();
  await db.exec(migration('20261109000100_fleet_sync_safeguards'));
  await db.exec(migration('20261110000100_fleet_sync_conflicts'));
  await db.exec(migration('20261111000100_fleet_sync_review'));
  await db.exec(migration('20261112000100_fleet_sync_record_read'));
  await db.exec(migration('20261113000100_fleet_sync_device_history'));
  await db.exec(migration('20261114000100_fleet_sync_history_reads'));
  await db.exec(migration('20261115000100_fleet_sync_history_recovery'));
  await db.exec(migration('20261116000100_fleet_sync_download'));
  await db.exec(`create trigger sync_test_side_effect after insert or update or delete on public.fleet_vehicles
    for each row execute function public.sync_test_effect()`);
}

/** Fleet sync schema plus the Storage metadata fixture and attachment uploads. */
export async function loadFleetSyncAttachmentSchema(db) {
  await loadFleetSyncSchema(db);
  await db.exec(readFileSync(new URL('./storage.sql', import.meta.url), 'utf8'));
  await db.exec(migration('20261117000100_fleet_sync_attachment_uploads'));
  await db.exec(migration('20261118000100_fleet_sync_attachment_verification'));
  await db.exec(migration('20261119000100_fleet_sync_document_attach'));
  await db.exec(migration('20261120000100_fleet_sync_attachment_release'));
  await db.exec(migration('20261121000100_fleet_sync_vehicle_file_slots'));
  await db.exec(migration('20261122000100_fleet_sync_status_assignments'));
  await db.exec(migration('20261123000100_fleet_sync_member_actions'));
  await db.exec(migration('20261124000100_fleet_sync_inspections'));
  await db.exec(migration('20261125000100_fleet_sync_shop_tech_photos'));
  await db.exec(migration('20261126000100_fleet_sync_issue_create'));
  await db.exec(migration('20261202000100_fleet_sync_storage_cleanup_fences'));
  await db.exec(migration('20261213000100_fleet_sync_issue_status_with_note'));
  await db.exec(migration('20261214000100_fleet_sync_vehicle_create'));
  await db.exec(migration('20261222000100_fleet_sync_submitter_conflicts'));
}

/** Fleet sync schema plus the real user-owned tables and the user sync commands. */
export async function loadUserSyncSchema(db, beforeTaskIdentities = async () => {}) {
  await loadFleetSyncSchema(db);
  await db.exec(migration('20261107000100_personal_tasks'));
  const availability = migration('20260912000200_crew_availability');
  await db.exec(availability.slice(0, availability.indexOf('alter publication supabase_realtime')));
  await db.exec(migration('20261108000100_dashboard_preferences'));
  await db.exec(migration('20261127000100_user_sync_commands'));
  await db.exec(migration('20261128000100_user_sync_availability_cas'));
  await beforeTaskIdentities();
  await db.exec(migration('20261129000100_personal_task_identities'));
  await db.exec(migration('20261130000100_online_dashboard_preferences'));
  await db.exec(migration('20261201000100_online_crew_availability'));
  await db.exec(migration('20261206000100_user_sync_snapshot'));
}

/** User sync schema plus the real Crew Chat and notification inbox tables/policies, then read markers. */
export async function loadReadMarkerSchema(db) {
  await loadUserSyncSchema(db);
  const communications = migration('202508280001_company_communications');
  await db.exec(communications.slice(0, communications.indexOf('do $$')));
  const crewChat = migration('20260918000100_crew_chat_access_and_notifications');
  await db.exec(crewChat.slice(0, crewChat.indexOf('-- Notify every other company member')));
  const inbox = migration('20260909000100_notification_inbox_and_delivery');
  await db.exec(inbox.slice(inbox.indexOf('create table public.user_notifications'), inbox.indexOf('create table public.push_notification_jobs')));
  await db.exec('alter table public.user_notifications enable row level security');
  await db.exec(inbox.slice(inbox.indexOf('create policy "users read own notifications"'), inbox.indexOf('revoke all on public.notification_preferences')));
  await db.exec('grant select on public.user_notifications to authenticated; grant update (read_at) on public.user_notifications to authenticated');
  await db.exec(migration('20261203000100_user_sync_read_markers'));
}

/** Read-marker schema plus offline Crew Chat replies. */
export async function loadCrewChatReplySchema(db) {
  await loadReadMarkerSchema(db);
  await db.exec(migration('20261204000100_user_sync_crew_chat_replies'));
}

/** Crew Chat reply schema plus the real vehicle notes table/policies and offline note creation. */
export async function loadVehicleNoteSchema(db) {
  await loadCrewChatReplySchema(db);
  await db.exec(migration('20261014000100_vehicle_notes'));
  await db.exec(migration('20261205000100_user_sync_vehicle_notes'));
}

/** Vehicle-note schema plus the real inventory tables/policies and offline gear checkout. */
export async function loadInventorySchema(db) {
  await loadVehicleNoteSchema(db);
  // Realtime publication stub: the inventory migrations add their tables to it.
  await db.exec('create publication supabase_realtime');
  await db.exec(migration('202509020001_company_inventory'));
  await db.exec(migration('20260914000100_inventory_checkouts'));
  const consolidated = migration('20260926000100_consolidate_permissive_rls_policies');
  await db.exec(consolidated.slice(consolidated.indexOf('drop policy if exists "owners read inventory"'), consolidated.indexOf('-- Qualification cards')));
  await db.exec(migration('20261207000100_inventory_checkout_offline'));
}

/** Inventory schema plus the real training tables/policies and offline sign-ups. */
export async function loadTrainingSchema(db) {
  await loadInventorySchema(db);
  await db.exec(migration('202509010001_company_training'));
  await db.exec(migration('20261208000100_user_sync_training_signups'));
}

/** Training schema plus the real payroll form table/trigger/policies and offline drafts/submission. */
export async function loadPayrollSchema(db) {
  await loadTrainingSchema(db);
  // Notification delivery is out of scope here; record calls instead.
  await db.exec(`create table public.test_notifications (company_id uuid, user_id uuid, title text);
    create function public.create_user_notification(target_company_id uuid, target_user_id uuid, actor_id uuid, a text, b text, c uuid, title text, d text, e text, f text, g text)
    returns void language sql security definer set search_path = '' as $$ insert into public.test_notifications values (target_company_id, target_user_id, title) $$`);
  await db.exec(migration('20261022000100_digital_payroll_forms'));
  await db.exec(migration('20261024000100_delete_draft_payroll_forms'));
  await db.exec(migration('20261025000100_managers_delete_payroll_forms'));
  const attachments = migration('20261028000100_payroll_form_attachments');
  await db.exec(attachments.slice(0, attachments.indexOf('-- Once submitted')));
  const rejection = migration('20261101000100_payroll_rejection_and_payment');
  await db.exec(rejection.slice(0, rejection.indexOf('drop policy if exists "uploaders remove own payroll files"')));
  await db.exec(migration('20261209000100_user_sync_payroll_forms'));
}

/** Payroll schema plus the real invoice form/customer tables and offline drafts/submission. */
export async function loadInvoiceSchema(db) {
  await loadPayrollSchema(db);
  const invoices = migration('20261104000100_invoice_submissions');
  await db.exec(invoices.slice(0, invoices.indexOf('insert into storage.buckets')) + invoices.slice(invoices.indexOf('create or replace function public.notify_submitted_invoice')));
  await db.exec(migration('20261210000100_user_sync_invoice_forms'));
}

/** Invoice schema plus the Storage metadata fixture, the real receipt table/bucket policies and offline receipt creation. */
export async function loadReceiptSchema(db) {
  await loadInvoiceSchema(db);
  await db.exec(readFileSync(new URL('./storage.sql', import.meta.url), 'utf8'));
  await db.exec(migration('20260907000100_company_receipts'));
  await db.exec(migration('20260908000100_owner_manage_company_receipts'));
  await db.exec(migration('20260912000100_quick_action_documents'));
  await db.exec(migration('20261211000100_fix_storage_file_retention_policies'));
  await db.exec(migration('20261212000100_user_sync_receipts'));
}

/** Receipt schema plus the real feedback and notification preference tables/policies, then their offline commands. */
export async function loadFeedbackSchema(db) {
  await loadReceiptSchema(db);
  await db.exec('alter table public.companies add column name text, add column company_code text, add column owner_user_id uuid; alter table public.profiles add column email text');
  await db.exec(migration('20261102000100_app_feedback'));
  await db.exec(migration('20261103000100_route_app_feedback'));
  const inbox = migration('20260909000100_notification_inbox_and_delivery');
  await db.exec(inbox.slice(inbox.indexOf('create table public.notification_preferences'), inbox.indexOf('create table public.user_notifications')));
  await db.exec('alter table public.notification_preferences enable row level security');
  await db.exec(inbox.slice(inbox.indexOf('create policy "users read own notification preferences"'), inbox.indexOf('create policy "users read own notifications"')));
  await db.exec('grant select, insert, update on public.notification_preferences to authenticated');
  await db.exec(migration('20261215000100_user_sync_feedback_and_preferences'));
}

/** Feedback schema plus verified company-list downloads. */
export async function loadCompanySnapshotSchema(db) {
  await loadFeedbackSchema(db);
  await db.exec(migration('20261216000100_company_sync_snapshots'));
}

/** Company download schema plus offline thread, training and inventory item creation. */
export async function loadManagerCreateSchema(db) {
  await loadCompanySnapshotSchema(db);
  await db.exec(migration('20261019000100_manager_communication_controls'));
  await db.exec(migration('20261217000100_user_sync_manager_creates'));
}

/** Manager-create schema plus the real company documents and fleet-files policies, then offline document creation. */
export async function loadCompanyDocumentSchema(db) {
  await loadManagerCreateSchema(db);
  await db.exec(migration('202508310001_company_documents'));
  const fleet = migration('202508240002_fleet_state');
  await db.exec(fleet.slice(fleet.indexOf("insert into storage.buckets"), fleet.indexOf('create policy "uploaders delete own fleet files"')));
  await db.exec(migration('20261218000100_user_sync_company_documents'));
}

/** Company document schema plus guarded offline edits and deletes. */
export async function loadGuardedEditSchema(db) {
  await loadCompanyDocumentSchema(db);
  await db.exec(migration('20261219000100_user_sync_guarded_edits'));
}

/** Guarded edit schema plus offline removal of vehicle inspections and documents. */
export async function loadVehicleEntrySchema(db) {
  await loadGuardedEditSchema(db);
  await db.exec(migration('20261220000100_user_sync_vehicle_entries'));
}

/** Vehicle entry schema plus the real self-service qualification functions and offline qualification commands. */
export async function loadCrewQualificationSchema(db) {
  await loadVehicleEntrySchema(db);
  for (const name of ['20260919000100_self_service_crew_credentials', '20260920000100_self_service_crew_experience', '20260921000100_self_service_qualification_updates',
    '20260922000100_self_service_annual_qualification_record', '20260924000100_self_service_qualification_deletes', '20261003000100_photo_only_license_credentials'])
    await db.exec(migration(name));
  await db.exec(migration('20261221000100_user_sync_crew_qualifications'));
}

/** Manager-create schema plus private Crew Chat threads. */
export async function loadPrivateCrewChatSchema(db) {
  await loadManagerCreateSchema(db);
  await db.exec(migration('20261224000100_private_crew_chat'));
}
