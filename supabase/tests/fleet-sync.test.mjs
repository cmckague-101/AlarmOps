import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

// Real embedded PostgreSQL, including roles, RLS, triggers and transactions.
// Minimal auth/company fixtures, not the complete Supabase migration chain.
const migration = name => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');
const db = new PGlite();
const company = '10000000-0000-4000-8000-000000000001';
const otherCompany = '10000000-0000-4000-8000-000000000002';
const owner = '20000000-0000-4000-8000-000000000001';
const member = '20000000-0000-4000-8000-000000000002';
const outsider = '20000000-0000-4000-8000-000000000003';
const recordId = '30000000-0000-4000-8000-000000000001';
let baseline;

const data = (extra = {}) => ({id: recordId, name: 'Engine 1', status: 'Ready', ...extra});
const insert = (extra = {}) => ({collection: 'vehicles', event: 'insert', recordId, data: data(), ...extra});
const update = (expectedVersion, extra = {}) => ({collection: 'vehicles', event: 'update', recordId, expectedVersion, data: data(extra)});
const remove = expectedVersion => ({collection: 'vehicles', event: 'delete', recordId, expectedVersion});
async function scalar(sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function seed() {
  await db.query('insert into public.companies values ($1), ($2)', [company, otherCompany]);
  await db.query('insert into public.profiles values ($1, $2), ($3, $4), ($5, $6)', [owner, 'Owner', member, 'Crew', outsider, 'Other owner']);
  await db.query('insert into public.company_members values ($1,$2,$3), ($1,$4,$5), ($6,$7,$3)', [company, owner, 'owner', member, 'fire_fighter', otherCompany, outsider]);
}
async function asActor(user, task, role = 'authenticated', headers = {}) {
  assert.ok(['authenticated','anon','service_role'].includes(role));
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.headers', $3, true)", [user ?? '', role, JSON.stringify(headers)]);
    await db.exec(`set local role ${role}`);
    const result = await task();
    await db.exec('commit');
    return result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
async function apply(changes, operationId = randomUUID(), actor = owner, target = company) {
  return asActor(actor, async () => (await scalar(
    'select public.apply_fleet_changes_once($1::uuid, $2::uuid, $3::jsonb) result', [target, operationId, JSON.stringify(changes)],
  )).result);
}
async function counts() {
  return scalar(`select (select count(*)::int from public.fleet_sync_receipts) receipts,
    (select count(*)::int from public.fleet_sync_revisions) revisions,
    (select count(*)::int from public.fleet_vehicles) vehicles,
    (select count(*)::int from public.sync_test_effects) effects`);
}

before(async () => {
  await db.exec(readFileSync(new URL('./fixtures/fleet-sync.sql', import.meta.url), 'utf8'));
  const normalized = migration('202508250005_normalized_fleet_records');
  await db.exec(normalized.slice(0, normalized.indexOf('-- Copy existing snapshots once.')));
  // Use real production fleet policies/guards, including current role permissions.
  const hardening = migration('202508260002_p1_hardening');
  await db.exec(hardening.slice(hardening.indexOf('-- Fold scoped admin access'), hardening.indexOf('create or replace function public.company_crew_seats_used')));
  await db.exec(hardening.slice(hardening.indexOf('create or replace function public.enforce_member_issue_changes'), hardening.indexOf('-- Apply one client snapshot delta')));
  const roles = migration('20261013000100_company_user_roles');
  await db.exec(roles.slice(roles.indexOf('create or replace function public.is_company_owner'), roles.indexOf('-- Billing remains restricted')));
  await db.exec(migration('20261016000100_firefighter_vehicle_action_permissions'));
  await db.exec('grant select on public.profiles, public.companies, public.company_members to authenticated');
  await db.exec(migration('202509040001_fleet_conflict_http_status'));
  await seed();
  await db.query('insert into public.fleet_vehicles(company_id,record_id,data,version,updated_by) values ($1,$2,$3::jsonb,7,$4)', [company, recordId, JSON.stringify(data()), owner]);
  await db.exec(migration('20261109000100_fleet_sync_safeguards'));
  baseline = await scalar('select version, origin, actor_user_id, changed_fields, octet_length(data_sha256) hash_length from public.fleet_sync_revisions');
  await db.exec(`create trigger sync_test_side_effect after insert or update or delete on public.fleet_vehicles
    for each row execute function public.sync_test_effect()`);
});
beforeEach(async () => {
  await db.exec('truncate public.companies cascade; truncate public.profiles cascade; truncate public.sync_test_effects');
  await seed();
});
after(async () => { await db.close(); });

test('migration backfills actual existing versions without inventing an original author', () => {
  assert.equal(baseline.version, 7);
  assert.equal(baseline.origin, 'baseline');
  assert.equal(baseline.actor_user_id, null);
  assert.equal(baseline.hash_length, 32);
  assert.deepEqual(baseline.changed_fields, ['id','name','status']);
});

test('identical retries return the original receipt without repeating writes or side effects', async () => {
  const operationId = randomUUID();
  const result = await apply([insert()], operationId);
  assert.deepEqual(result, [{collection: 'vehicles', recordId, event: 'insert', version: 1}]);
  assert.deepEqual(await apply([insert()], operationId), result);
  assert.deepEqual(await counts(), {receipts: 1, revisions: 1, vehicles: 1, effects: 1});
  await assert.rejects(apply([update(1, {name: 'different work'})], operationId), /reused for different work/);
  assert.deepEqual(await counts(), {receipts: 1, revisions: 1, vehicles: 1, effects: 1});
});

test('JSON key order does not change operation identity', async () => {
  const operationId = randomUUID();
  const change = insert();
  const expected = await apply([change], operationId);
  const reordered = Object.fromEntries(Object.entries(change).reverse());
  reordered.data = Object.fromEntries(Object.entries(change.data).reverse());
  assert.deepEqual(await apply([reordered], operationId), expected);
  assert.equal((await counts()).effects, 1);
});

test('update/delete retries do not increment revisions or repeat deletion effects', async () => {
  await apply([insert()]);
  const updateId = randomUUID();
  const result = await apply([update(1, {name: 'Updated'})], updateId);
  assert.equal(result[0].version, 2);
  assert.deepEqual(await apply([update(1, {name: 'Updated'})], updateId), result);
  const deleteId = randomUUID();
  const deleted = await apply([remove(2)], deleteId);
  assert.deepEqual(await apply([remove(2)], deleteId), deleted);
  assert.deepEqual(await counts(), {receipts: 3, revisions: 3, vehicles: 0, effects: 3});
  const rows = (await db.query('select version, deleted, data_sha256 from public.fleet_sync_revisions order by version')).rows;
  assert.deepEqual(rows.map(row => [row.version, row.deleted]), [[1,false],[2,false],[3,true]]);
  assert.equal(rows[2].data_sha256, null);
});

test('stale versions fail atomically without storing a success receipt', async () => {
  await apply([insert()]);
  await apply([update(1, {name: 'Newer'})]);
  await assert.rejects(apply([update(1, {name: 'Stale'})]), error => error.code === 'PT409');
  assert.deepEqual(await counts(), {receipts: 2, revisions: 2, vehicles: 1, effects: 2});
  assert.equal((await scalar('select data from public.fleet_vehicles')).data.name, 'Newer');
});

test('a failing batch rolls back its records, revision history, receipt and side effects', async () => {
  const operationId = randomUUID();
  await assert.rejects(apply([insert(), update(999, {name: 'Invalid'})], operationId), error => error.code === 'PT409');
  assert.deepEqual(await counts(), {receipts: 0, revisions: 0, vehicles: 0, effects: 0});
  await apply([insert()], operationId); // the failed attempt did not consume the ID
  assert.deepEqual(await counts(), {receipts: 1, revisions: 1, vehicles: 1, effects: 1});
});

test('failure to persist the receipt also rolls back mutations and side effects', async () => {
  await db.exec(`create function public.fail_test_receipt() returns trigger language plpgsql as $$
    begin raise exception 'receipt storage failed'; end; $$;
    create trigger fail_receipt before insert on public.fleet_sync_receipts for each row execute function public.fail_test_receipt()`);
  try {
    await assert.rejects(apply([insert()]), /receipt storage failed/);
    assert.deepEqual(await counts(), {receipts: 0, revisions: 0, vehicles: 0, effects: 0});
  } finally {
    await db.exec('drop trigger fail_receipt on public.fleet_sync_receipts; drop function public.fail_test_receipt()');
  }
});

test('the same operation UUID in another authorized scope is independent', async () => {
  const operationId = randomUUID();
  await apply([insert()], operationId);
  await apply([insert()], operationId, outsider, otherCompany);
  assert.deepEqual(await counts(), {receipts: 2, revisions: 2, vehicles: 2, effects: 2});
});

test('every writer participates, even direct writes through the old RPC or integration role', async () => {
  await asActor(owner, () => db.query('select public.apply_fleet_changes($1,$2::jsonb)', [company, JSON.stringify([insert()])]));
  await asActor(null, () => db.query(
    'update public.fleet_vehicles set data = $1::jsonb, version = 9999 where company_id = $2 and record_id = $3',
    [JSON.stringify(data({name: 'Integration'})), company, recordId],
  ), 'service_role', {'x-fireops-actor-id': owner});
  assert.equal((await scalar('select version from public.fleet_vehicles')).version, 2);
  const history = (await db.query('select version, changed_fields, origin, actor_user_id from public.fleet_sync_revisions order by version')).rows;
  assert.deepEqual(history[1], {version: 2, changed_fields: ['name'], origin: 'service_role', actor_user_id: owner});
  await assert.rejects(apply([update(1)]), error => error.code === 'PT409');
});

test('delete and re-create cannot reuse an old revision (ABA protection)', async () => {
  await apply([insert()]);
  await apply([remove(1)]);
  assert.equal((await apply([insert()]))[0].version, 3);
  await assert.rejects(apply([update(1, {name: 'Old edit'})]), error => error.code === 'PT409');
  assert.deepEqual((await db.query('select version from public.fleet_sync_revisions order by version')).rows.map(row => row.version), [1,2,3]);
});

test('UPSERT captures only the final update, not a phantom insert', async () => {
  await apply([insert()]);
  await asActor(owner, () => db.query(
    `insert into public.fleet_vehicles(company_id,record_id,data,version,updated_by) values ($1,$2,$3::jsonb,888,$4)
     on conflict(company_id, record_id) do update set data=excluded.data, version=excluded.version, updated_by=excluded.updated_by`,
    [company, recordId, JSON.stringify(data({name: 'Upsert'})), owner],
  ));
  assert.equal((await scalar('select version from public.fleet_vehicles')).version, 2);
  assert.equal((await counts()).revisions, 2);
  assert.deepEqual((await scalar('select changed_fields from public.fleet_sync_revisions where version = 2')).changed_fields, ['name']);
});

test('fingerprints are computed by PostgreSQL from actual data; removed and null fields differ', async () => {
  await apply([insert({data: data({nullable: null})})]);
  const fingerprint = await scalar(`select data_sha256 = sha256(convert_to($1::jsonb::text,'UTF8')) matches
    from public.fleet_sync_revisions where version=1`, [JSON.stringify(data({nullable: null}))]);
  assert.equal(fingerprint.matches, true);
  await apply([update(1)]);
  assert.deepEqual((await scalar('select changed_fields from public.fleet_sync_revisions where version=2')).changed_fields, ['nullable']);
});

test('all four fleet collections receive revision triggers and fingerprints', async () => {
  for (const collection of ['vehicles','issues','crew','activities']) await apply([insert({collection})]);
  assert.deepEqual((await db.query('select collection from public.fleet_sync_revisions order by collection')).rows.map(row => row.collection), ['activities','crew','issues','vehicles']);
});

test('RPC owner is non-login/non-bypass, inherits authenticated, and owns no fleet tables', async () => {
  const role = await scalar(`select rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname='fireops_sync_writer'`);
  assert.deepEqual(role, {rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false});
  assert.equal((await scalar("select pg_has_role('fireops_sync_writer','authenticated','USAGE') inherits")).inherits, true);
  assert.equal((await scalar("select pg_has_role('authenticated','fireops_sync_writer','MEMBER') inherits")).inherits, false);
  assert.equal((await scalar("select count(*)::int count from pg_tables where schemaname='public' and tableowner='fireops_sync_writer'")).count, 0);
  assert.equal((await scalar("select has_schema_privilege('fireops_sync_writer','public','CREATE') allowed")).allowed, false);
  for (const privilege of ['UPDATE','DELETE']) {
    assert.equal((await scalar('select has_table_privilege($1,$2,$3) allowed', ['fireops_sync_writer','public.fleet_sync_receipts',privilege])).allowed, false);
  }
});

test('authenticated callers cannot forge/read receipts or read revision history', async () => {
  await apply([insert()]);
  for (const sql of [
    'select * from public.fleet_sync_receipts', 'select * from public.fleet_sync_revisions',
    `insert into public.fleet_sync_receipts(company_id,actor_user_id,operation_id,request_sha256,result)
      values ('${company}','${owner}','${randomUUID()}',decode(repeat('00',32),'hex'),'[]')`,
    'select public.assign_fleet_sync_revision()', 'select public.capture_fleet_sync_revision()',
  ]) await assert.rejects(asActor(owner, () => db.exec(sql)), error => error.code === '42501');
  await assert.rejects(asActor(null, () => db.query('select public.apply_fleet_changes_once($1,$2,$3::jsonb)', [company, randomUUID(), JSON.stringify([insert()])]), 'anon'), error => error.code === '42501');
});

test('RLS and role-specific trigger guards remain effective inside the receipt RPC', async () => {
  await assert.rejects(apply([insert()], randomUUID(), member), error => error.code === '42501');
  assert.deepEqual(await counts(), {receipts: 0, revisions: 0, vehicles: 0, effects: 0});
  await apply([insert()]);
  await assert.rejects(apply([update(1, {name: 'Not allowed'})], randomUUID(), member), error => error.code === '42501');
  const claimed = await apply([update(1, {status: 'Assigned', assignedTo: member})], randomUUID(), member);
  assert.equal(claimed[0].version, 2); // permitted crew action still works
  await assert.rejects(apply([remove(2)], randomUUID(), member), error => error.code === 'PT409');
  assert.equal((await counts()).receipts, 2);
});

test('company scope and current membership are checked even for receipt replay', async () => {
  const operationId = randomUUID();
  await apply([insert()], operationId);
  await assert.rejects(apply([insert()], operationId, outsider), error => error.code === '42501');
  await assert.rejects(apply([insert()], operationId, owner, otherCompany), error => error.code === '42501');
  await db.query('delete from public.company_members where company_id=$1 and user_id=$2', [company, owner]);
  await assert.rejects(apply([insert()], operationId), error => error.code === '42501');
  assert.deepEqual(await counts(), {receipts: 1, revisions: 1, vehicles: 1, effects: 1});
});

test('forwarded authors are ignored for authenticated requests', async () => {
  await asActor(owner, () => db.query('select public.apply_fleet_changes_once($1,$2,$3::jsonb)', [company, randomUUID(), JSON.stringify([insert()])]), 'authenticated', {'x-fireops-actor-id': outsider});
  assert.equal((await scalar('select actor_user_id from public.fleet_sync_revisions')).actor_user_id, owner);
});

test('record identity cannot be moved between companies', async () => {
  await apply([insert()]);
  await assert.rejects(db.query('update public.fleet_vehicles set company_id=$1 where company_id=$2', [otherCompany, company]), /Fleet identity cannot change/);
  assert.equal((await scalar('select company_id from public.fleet_vehicles')).company_id, company);
});

test('company deletion cascades history and receipts without resurrecting tombstones', async () => {
  await apply([insert()]);
  await db.query('delete from public.companies where id=$1', [company]);
  assert.equal((await counts()).receipts, 0);
  assert.equal((await counts()).revisions, 0);
  assert.equal((await counts()).vehicles, 0);
});

test('invalid or unauthenticated requests cannot write or reserve operation IDs', async () => {
  for (const changes of [null, {}, [], Array.from({length: 501}, () => insert())]) {
    await assert.rejects(apply(changes), error => error.code === '22023');
  }
  await assert.rejects(apply([insert()], null), error => error.code === '22023');
  await assert.rejects(apply([insert()], randomUUID(), null), error => error.code === '42501');
  assert.deepEqual(await counts(), {receipts: 0, revisions: 0, vehicles: 0, effects: 0});
});
