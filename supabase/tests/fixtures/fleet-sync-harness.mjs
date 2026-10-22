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
  await db.exec(`create trigger sync_test_side_effect after insert or update or delete on public.fleet_vehicles
    for each row execute function public.sync_test_effect()`);
}
