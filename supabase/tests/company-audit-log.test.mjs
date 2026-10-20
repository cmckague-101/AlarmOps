import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

// Static security/coverage checks; these do not replace a PostgreSQL integration run.
const sql=readFileSync(new URL('../migrations/20261106000100_company_audit_log.sql',import.meta.url),'utf8');

test('audit log is append-only for clients and scoped to company managers and 30 days',()=>{
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/revoke all on public\.company_audit_log from public, anon, authenticated/i);
  assert.match(sql,/grant select on public\.company_audit_log to authenticated/i);
  assert.doesNotMatch(sql,/grant (?:all|insert|update|delete)[^;]*to authenticated/i);
  assert.match(sql,/created_at >= now\(\) - interval '30 days'\s+and public\.is_company_owner\(company_id, \(select auth\.uid\(\)\)\)/);
  assert.match(sql,/revoke all on function public\.capture_company_audit_log\(\) from public, anon, authenticated/i);
});

test('audit descriptions preserve actor names without storing full row snapshots',()=>{
  assert.match(sql,/actor uuid := auth\.uid\(\)/);
  assert.match(sql,/select nullif\(full_name, ''\) into actor_label from public\.profiles/);
  assert.match(sql,/actor_name text not null/);
  assert.doesNotMatch(sql,/actor_user_id uuid references/i); // deleted accounts must not erase history
  const table=sql.slice(sql.indexOf('create table'),sql.indexOf('create index'));
  assert.doesNotMatch(table,/jsonb|before_data|after_data/);
  assert.match(sql,/before_data = after_data then return null/);
  assert.match(sql,/'updated_at','updated_by','version','created_at'/);
  assert.match(sql,/array\['role','status'\]/);
});

test('tracks key company workflows but not read receipts or derived feeds',()=>{
  const tracked=sql.slice(sql.indexOf('for entry in select'));
  for(const table of ['companies','company_members','fleet_vehicles','fleet_issues','fleet_crew',
    'communication_threads','communication_replies','company_documents','company_trainings',
    'company_training_signups','company_inventory_items','company_inventory_checkouts',
    'company_vehicle_types','company_vehicle_inspection_items','company_receipts',
    'invoice_forms','payroll_forms','crew_availability','qualification_card_requests','vehicle_notes']){
    assert.ok(tracked.includes(`('${table}',`),table);
  }
  for(const table of ['communication_reads','company_document_reads','company_training_reads','fleet_activities','push_notification_jobs']){
    assert.ok(!tracked.includes(`('${table}',`),table);
  }
  assert.match(tracked,/after insert or update or delete/);
});

test('forwarded actor identity is trusted only for service-role requests',()=>{
  assert.match(sql,/if actor is null and auth\.role\(\) = 'service_role' then\s+actor :=[^;]*x-fireops-actor-id/);
  for(const name of ['invite-company-member','remove-company-member']){
    const source=readFileSync(new URL(`../functions/${name}/index.ts`,import.meta.url),'utf8');
    const verification=source.indexOf('if (userError || !actor)');
    const forwarding=source.indexOf("'x-fireops-actor-id': actor.id");
    assert.ok(verification>0&&forwarding>verification,name);
  }
});
