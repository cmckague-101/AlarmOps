import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import test from 'node:test';

// Static regression checks, not a PostgreSQL/RLS integration test. Model only
// explicit table/column ACLs, starting WITHOUT Supabase's old default grants.
const directory = new URL('../migrations/', import.meta.url);
const migrations = readdirSync(directory).filter(name => name.endsWith('.sql')).sort().map(name => ({
  name,
  sql: readFileSync(new URL(name, directory), 'utf8')
    .replace(/--[^\n]*/g, '')
    .replace(/\$\$[\s\S]*?\$\$/g, ''),
}));
const repair = migrations.find(migration => migration.name.endsWith('_explicit_data_api_grants.sql'));
const operations = ['select', 'insert', 'update', 'delete'];
const split = value => value.split(/,(?![^()]*\))/).map(part => part.trim());

function replay(files) {
  const acl = new Map();
  for (const {sql} of files) {
    const statements = /drop table\s+(?:if exists\s+)?public\.(\w+)[^;]*;|\b(grant|revoke)\s+([^;]+?)\s+on\s+(?:table\s+)?(public\.\w+(?:\s*,\s*public\.\w+)*)\s+(?:to|from)\s+([^;]+);/gi;
    for (const match of sql.matchAll(statements)) {
      if (match[1]) {
        for (const key of acl.keys()) if (key.startsWith(`${match[1]}:`)) acl.delete(key);
        continue;
      }
      const [, , action, privileges, tables, roles] = match;
      for (const table of split(tables)) for (const role of split(roles)) {
        const key = `${table.replace('public.', '')}:${role}`;
        const grants = acl.get(key) ?? new Set();
        for (const privilege of split(privileges)) {
          const [, operation, columns] = /^(\w+)(?:\s*\(([^)]+)\))?$/.exec(privilege);
          const names = operation === 'all' ? operations : [operation];
          for (const name of names) {
            const tokens = columns ? split(columns).map(column => `${name}:${column}`) : [name];
            if (action === 'grant') tokens.forEach(token => grants.add(token));
            else for (const token of grants) {
              if (tokens.includes(token) || (!columns && token.startsWith(`${name}:`))) grants.delete(token);
            }
          }
        }
        acl.set(key, grants);
      }
    }
  }
  return acl;
}

const required = {
  authenticated: {
    profiles: ['select', 'update:full_name', 'update:signature_data'],
    companies: ['select'], company_members: ['select'],
    push_tokens: ['select', 'delete'], communication_threads: ['select', 'insert', 'delete'],
  },
  service_role: {
    profiles: ['select'], companies: ['select'], system_admins: ['select'],
    system_admin_company_access: ['select'], company_members: ['select', 'insert', 'delete'],
    fleet_vehicles: ['select', 'update'], fleet_crew: ['select', 'insert', 'delete', 'update:updated_by'],
    fleet_state: ['select', 'update:updated_by'], fleet_issues: ['select', 'update:updated_by'],
    fleet_activities: ['select', 'update:updated_by'],
    push_tokens: ['select', 'update'],
    push_notification_jobs: ['select', 'insert', 'update'],
    push_notification_deliveries: ['select', 'insert', 'update'],
    company_motive_integrations: operations, company_motive_oauth_states: operations,
    company_motive_vehicle_mappings: operations,
  },
};

for (const [label, files] of [
  ['original migrations without repair', migrations.filter(file => file !== repair)],
  ['all migrations', migrations],
]) {
  test(`${label}: required client and Edge Function privileges are explicit`, () => {
    const acl = replay(files);
    for (const [role, tables] of Object.entries(required)) {
      for (const [table, privileges] of Object.entries(tables)) for (const privilege of privileges) {
        assert.ok(acl.get(`${table}:${role}`)?.has(privilege), `${role} needs ${privilege} on ${table}`);
      }
    }
  });
}

test('forward repair independently includes every missing grant', () => {
  assert.ok(repair);
  const acl = replay([repair]);
  for (const [role, tables] of Object.entries(required)) {
    for (const [table, privileges] of Object.entries(tables)) for (const privilege of privileges) {
      // These privileges were already explicit and must not be broadened by repair.
      if (['push_notification_jobs', 'push_notification_deliveries', 'company_motive_integrations',
        'company_motive_oauth_states', 'company_motive_vehicle_mappings'].includes(table)) continue;
      if (role === 'authenticated' && (privilege.startsWith('update:') ||
        (table === 'communication_threads' && privilege !== 'delete'))) continue;
      if (role === 'service_role' && table === 'push_tokens') continue;
      assert.ok(acl.get(`${table}:${role}`)?.has(privilege), `${role} needs ${privilege} on ${table}`);
    }
  }
  for (const key of acl.keys()) assert.ok(!key.endsWith(':anon') && !key.endsWith(':public'));
  assert.doesNotMatch(repair.sql, /\b(?:revoke|create policy|alter table|alter default privileges)\b/i);
});

test('client restrictions remain intact without inherited default grants', () => {
  const acl = replay(migrations);
  assert.ok(!acl.get('profiles:authenticated')?.has('update'), 'profile updates must stay column-scoped');
  for (const table of ['system_admins', 'system_admin_audit_log', 'system_admin_company_access',
    'company_motive_integrations', 'company_motive_oauth_states', 'company_motive_vehicle_mappings',
    'push_notification_jobs', 'push_notification_deliveries', 'usfs_sync_runs',
    'fleet_sync_revisions', 'fleet_sync_receipts', 'fleet_sync_submissions']) {
    assert.equal(acl.get(`${table}:authenticated`)?.size ?? 0, 0, `${table} must remain backend-only`);
  }
  for (const table of ['fleet_sync_conflicts', 'fleet_sync_decisions', 'fleet_sync_outcomes']) {
    assert.deepEqual([...(acl.get(`${table}:authenticated`) ?? [])].sort(), ['select'], `${table} is read-only to clients`);
  }
  for (const [key, privileges] of acl) {
    if (key.endsWith(':anon') || key.endsWith(':public')) assert.equal(privileges.size, 0, key);
  }
});

test('each table migration explicitly declares access intent and enables RLS', () => {
  for (const {name, sql} of migrations) {
    for (const [, table] of sql.matchAll(/create table\s+(?:if not exists\s+)?public\.(\w+)/gi)) {
      const access = new RegExp(`\\b(?:grant|revoke)\\s+[^;]+\\bon\\s+(?:table\\s+)?[^;]*\\bpublic\\.${table}\\b[^;]*\\b(?:to|from)\\b`, 'i');
      assert.match(sql, access, `${name}: declare grants or explicitly revoke access for ${table}`);
      assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${name}: enable RLS for ${table}`);
    }
  }
});
