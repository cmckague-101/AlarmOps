import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {after, before, beforeEach, test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {loadFleetSyncSchema} from './fixtures/fleet-sync-harness.mjs';

const db = new PGlite();
const company = '10000000-0000-4000-8000-000000000001';
const otherCompany = '10000000-0000-4000-8000-000000000002';
const owner = '20000000-0000-4000-8000-000000000001';
const admin = '20000000-0000-4000-8000-000000000002';
const crew = '20000000-0000-4000-8000-000000000003';
const outsider = '20000000-0000-4000-8000-000000000004';
const recordId = '30000000-0000-4000-8000-000000000001';
const base = {id: recordId, unit: 'Engine 1', status: 'Ready', notes: 'Original', vin: 'VIN-1'};
const present = value => ({present: true, value});
const absent = {present: false};
const savedAt = '2026-01-01T12:00:00.000Z';
const parityCases = JSON.parse(readFileSync(new URL('../../packages/domain/test-fixtures/offline-sync-merge.json', import.meta.url), 'utf8'));

async function row(sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function asActor(actor, task, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)", [actor ?? '', role]);
    await db.exec(`set local role ${role}`);
    const result = await task();
    await db.exec('commit');
    return result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
function operation(patch, {actor = owner, device = 'device-1', connectivity = 'offline', original = base, version = '1', entity = 'vehicle'} = {}) {
  return {
    schemaVersion: 1, operationId: randomUUID(), companyId: company, entityType: entity, entityId: recordId,
    provenance: {userId: actor, deviceId: device, savedAt, connectivity}, dependsOn: [],
    mutation: {kind: 'update', baseRevision: version, base: original, patch},
  };
}
async function sync(op, actor = owner) {
  return asActor(actor, async () => (await row('select public.sync_fleet_update($1::jsonb) result', [JSON.stringify(op)])).result);
}
async function online(data, version = 1, actor = owner, collection = 'vehicles') {
  return asActor(actor, () => db.query('select public.apply_fleet_changes($1,$2::jsonb)', [company, JSON.stringify([
    {collection, recordId, event: 'update', expectedVersion: version, data},
  ])]));
}
async function conflict(id) { return row('select * from public.fleet_sync_conflicts where id=$1', [id]); }
async function stats() {
  return row(`select (select count(*)::int from public.fleet_sync_submissions) submissions,
    (select count(*)::int from public.fleet_sync_conflicts) conflicts,
    (select count(*)::int from public.fleet_sync_revisions) revisions,
    (select count(*)::int from public.sync_test_effects) effects`);
}

before(async () => { await loadFleetSyncSchema(db); });
beforeEach(async () => {
  await db.exec('truncate public.companies cascade; truncate public.profiles cascade; truncate public.sync_test_effects');
  await db.query('insert into public.companies values ($1),($2)', [company, otherCompany]);
  await db.query('insert into public.profiles values ($1,$2),($3,$4),($5,$6),($7,$8)', [owner,'Owner',admin,'Admin',crew,'Crew',outsider,'Other owner']);
  await db.query('insert into public.company_members values ($1,$2,$3),($1,$4,$5),($1,$6,$7),($8,$9,$3)', [company,owner,'owner',admin,'admin',crew,'fire_fighter',otherCompany,outsider]);
  await asActor(owner, () => db.query('select public.apply_fleet_changes($1,$2::jsonb)', [company, JSON.stringify([
    {collection: 'vehicles', recordId, event: 'insert', data: base},
  ])]));
});
after(async () => { await db.close(); });

for (const fixture of parityCases) test(`SQL/client merge parity: ${fixture.name}`, async () => {
  const result = await row('select public.merge_fleet_sync_fields($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) result', [
    JSON.stringify(fixture.base), fixture.current === null ? null : JSON.stringify(fixture.current), JSON.stringify(fixture.patch), JSON.stringify(fixture.groups ?? []),
  ]);
  assert.deepEqual(result.result, fixture.expected);
});

test('verified independent edits merge with current shared data and return a canonical receipt', async () => {
  await online({...base, unit: 'Online name'});
  const op = operation({notes: present('Offline report')});
  const result = await sync(op);
  assert.equal(result.kind, 'applied');
  assert.equal(result.revision, '3');
  assert.deepEqual(result.record, {...base, unit: 'Online name', notes: 'Offline report'});
  assert.ok(Number.isFinite(Date.parse(result.receivedAt)));
  assert.deepEqual(await sync(op), result);
  assert.deepEqual(await stats(), {submissions: 1, conflicts: 0, revisions: 3, effects: 3});
  const submission = await row('select actor_user_id,actor_name,connectivity,device_id,applied_revision from public.fleet_sync_submissions');
  assert.deepEqual(submission, {actor_user_id: owner, actor_name: 'Owner', connectivity: 'offline', device_id: 'device-1', applied_revision: 3});
});

test('conflicts preserve all three versions and do not apply even independent parts of the operation', async () => {
  await online({...base, unit: 'Online name'}, 1, admin);
  const op = operation({unit: present('Offline name'), notes: present('Unapplied independent note')});
  const result = await sync(op);
  assert.equal(result.kind, 'awaiting_review');
  const candidate = await conflict(result.conflictId);
  assert.deepEqual(candidate.base_record, base);
  assert.deepEqual(candidate.current_record, {...base, unit: 'Online name'});
  assert.deepEqual(candidate.proposed_record, {...base, unit: 'Offline name', notes: 'Unapplied independent note'});
  assert.equal(candidate.reason, 'fields');
  assert.equal(candidate.current_revision, 2);
  assert.deepEqual(candidate.field_conflicts.map(field => field.field), ['unit']);
  assert.equal(candidate.provenance.userId, owner);
  assert.equal(candidate.provenance.actorName, 'Owner');
  assert.equal(candidate.provenance.connectivity, 'offline');
  assert.equal(candidate.current_provenance.unit.userId, admin);
  assert.equal(candidate.current_provenance.unit.actorName, 'Admin');
  assert.equal(candidate.current_provenance.unit.connectivity, 'unknown'); // no invented online label for legacy writers
  assert.equal(candidate.current_provenance.notes.userId, owner); // not attributed to the last row editor
  assert.equal(candidate.state, 'pending');
  assert.deepEqual((await row('select data from public.fleet_vehicles')).data, {...base, unit: 'Online name'});
  assert.deepEqual(await sync(op), result);
  assert.deepEqual(await stats(), {submissions: 1, conflicts: 1, revisions: 2, effects: 2});
});

test('every competing proposal is retained, including separate devices for the same user', async () => {
  await online({...base, notes: 'Online note'});
  const first = await sync(operation({notes: present('Device one')}, {device: 'one'}));
  const second = await sync(operation({notes: present('Device two')}, {device: 'two'}));
  const third = await sync(operation({notes: present('Admin proposal')}, {actor: admin}), admin);
  assert.equal(new Set([first.conflictId, second.conflictId, third.conflictId]).size, 3);
  assert.deepEqual((await db.query('select proposed_record from public.fleet_sync_conflicts order by received_at')).rows.map(item => item.proposed_record.notes), ['Device one','Device two','Admin proposal']);
  assert.equal((await stats()).revisions, 2);
});

test('applied offline provenance survives later conflict capture; no-op submissions do not steal authorship', async () => {
  const first = await sync(operation({notes: present('Offline accepted')}, {actor: admin, device: 'admin-device'}), admin);
  assert.equal(first.kind, 'applied');
  await sync(operation({notes: present('Offline accepted')}, {device: 'noop-device', connectivity: 'online'}));
  const pending = await sync(operation({notes: present('Other value')}));
  const candidate = await conflict(pending.conflictId);
  assert.equal(candidate.current_provenance.notes.userId, admin);
  assert.equal(candidate.current_provenance.notes.actorName, 'Admin');
  assert.equal(candidate.current_provenance.notes.connectivity, 'offline');
  assert.equal(candidate.current_provenance.notes.deviceId, 'admin-device');
  assert.equal(Date.parse(candidate.current_provenance.notes.savedAt), Date.parse(savedAt));
  assert.equal((await stats()).revisions, 2);
});

test('identical and redundant outcomes acknowledge without a write or spurious conflict', async () => {
  await online({...base, notes: 'Already changed'});
  const equal = await sync(operation({notes: present('Already changed')}));
  const redundant = await sync(operation({notes: present(base.notes)}));
  assert.equal(equal.kind, 'applied');
  assert.equal(redundant.kind, 'applied');
  assert.equal(redundant.record.notes, 'Already changed');
  assert.equal(equal.revision, '2');
  assert.deepEqual(await stats(), {submissions: 2, conflicts: 0, revisions: 2, effects: 2});
});

test('optional removals persist, and required fields cannot be removed', async () => {
  const result = await sync(operation({notes: absent, vin: absent}));
  assert.equal(result.kind, 'applied');
  assert.deepEqual(result.record, {id: recordId, unit: 'Engine 1', status: 'Ready'});
  await assert.rejects(sync(operation({unit: absent})), /Required detail field/);
});

test('forged bases, wrong versions and mismatched identities never create conflicts or receipts', async () => {
  await assert.rejects(sync(operation({notes: present('New')}, {original: {...base, notes: 'Forged'}})), /Base snapshot does not match/);
  await assert.rejects(sync(operation({notes: present('New')}, {version: '99'})), /Base revision is unavailable/);
  const wrongId = operation({notes: present('New')});
  wrongId.mutation.base = {...base, id: randomUUID()};
  await assert.rejects(sync(wrongId), /Base record identity mismatch/);
  assert.deepEqual(await stats(), {submissions: 0, conflicts: 0, revisions: 1, effects: 1});
});

test('deleted and recreated records require review and are never silently restored or modified', async () => {
  await asActor(owner, () => db.query('select public.apply_fleet_changes($1,$2::jsonb)', [company, JSON.stringify([
    {collection: 'vehicles', recordId, event: 'delete', expectedVersion: 1},
  ])]));
  const deleted = await sync(operation({notes: present('Edit deleted')}));
  const deletion = await conflict(deleted.conflictId);
  assert.equal(deletion.reason, 'deleted');
  assert.equal(deletion.current_record, null);
  assert.equal(deletion.current_revision, 2);
  assert.equal((await row('select count(*)::int count from public.fleet_vehicles')).count, 0);
  await asActor(owner, () => db.query('select public.apply_fleet_changes($1,$2::jsonb)', [company, JSON.stringify([
    {collection: 'vehicles', recordId, event: 'insert', data: base},
  ])]));
  const recreated = await sync(operation({notes: present('Edit old lifecycle')}));
  assert.equal((await conflict(recreated.conflictId)).reason, 'recreated');
  assert.deepEqual((await row('select data from public.fleet_vehicles')).data, base);
});

test('the issue detail adapter merges scalar details without allowing status/author changes', async () => {
  const issue = {id: recordId, vehicleId: recordId, title: 'Issue', description: 'Old', priority: 'Medium', status: 'Open', createdById: owner, updates: []};
  await asActor(owner, () => db.query('select public.apply_fleet_changes($1,$2::jsonb)', [company, JSON.stringify([
    {collection: 'issues', recordId, event: 'insert', data: issue},
  ])]));
  await online({...issue, title: 'Online title'}, 1, owner, 'issues');
  const result = await sync(operation({description: present('Offline description'), priority: present('High')}, {entity: 'issue', original: issue}));
  assert.equal(result.kind, 'applied');
  assert.equal(result.record.title, 'Online title');
  assert.equal(result.record.description, 'Offline description');
  await assert.rejects(sync(operation({createdById: present(admin)}, {entity: 'issue', original: issue})), /different sync adapter/);
  await assert.rejects(sync(operation({status: present('Resolved')}, {entity: 'issue', original: issue})), /different sync adapter/);
});

test('known operation IDs reject different work and cached results still require current manager access', async () => {
  const op = operation({notes: present('Applied')});
  await sync(op);
  await assert.rejects(sync({...op, mutation: {...op.mutation, patch: {notes: present('Different')}}}), /reused for different work/);
  await db.query('update public.company_members set role=$1 where company_id=$2 and user_id=$3', ['fire_fighter',company,owner]);
  await assert.rejects(sync(op), error => error.code === '42501');
});

test('only current company managers may submit; spoofed identities are rejected', async () => {
  for (const actor of [crew, outsider, null]) await assert.rejects(sync(operation({notes: present('Unauthorized')}, {actor}), actor), error => error.code === '42501');
  await assert.rejects(sync(operation({notes: present('Spoofed')}, {actor: admin})), /misattributed sync provenance/);
  const crossCompany = operation({notes: present('Other company')});
  crossCompany.companyId = otherCompany;
  await assert.rejects(sync(crossCompany), error => error.code === '42501');
  assert.equal((await stats()).submissions, 0);
});

test('conflict reads are manager/company scoped and clients cannot forge or resolve them directly', async () => {
  await online({...base, notes: 'Online'});
  const pending = await sync(operation({notes: present('Offline')}));
  for (const actor of [owner, admin]) {
    const rows = await asActor(actor, () => db.query('select id from public.fleet_sync_conflicts'));
    assert.deepEqual(rows.rows, [{id: pending.conflictId}]);
  }
  for (const actor of [crew, outsider]) assert.deepEqual((await asActor(actor, () => db.query('select id from public.fleet_sync_conflicts'))).rows, []);
  for (const sql of [
    'select * from public.fleet_sync_submissions',
    "update public.fleet_sync_conflicts set state='resolved'",
    'delete from public.fleet_sync_conflicts',
    'insert into public.fleet_sync_conflicts default values',
    "select public.merge_fleet_sync_fields('{}','{}','{}')",
  ]) await assert.rejects(asActor(owner, () => db.exec(sql)), error => error.code === '42501');
  await assert.rejects(asActor(null, () => db.query('select public.sync_fleet_update($1::jsonb)', [JSON.stringify(operation({}))]), 'anon'), error => error.code === '42501');
});

test('dependencies must refer to applied operations by this user in this company', async () => {
  const parent = operation({notes: present('Parent')});
  const accepted = await sync(parent);
  const child = operation({notes: present('Child')}, {version: accepted.revision, original: accepted.record});
  child.dependsOn = [parent.operationId];
  assert.equal((await sync(child)).kind, 'applied');
  const missing = operation({notes: present('Missing')}); missing.dependsOn = [randomUUID()];
  await assert.rejects(sync(missing), /dependency has not been applied/);
  const crossUser = operation({notes: present('Other user')}, {actor: admin}); crossUser.dependsOn = [parent.operationId];
  await assert.rejects(sync(crossUser, admin), /dependency has not been applied/);
});

test('submission storage failure rolls back merged changes, history and trigger side effects', async () => {
  await db.exec(`create function public.fail_submission_test() returns trigger language plpgsql as $$
    begin raise exception 'submission unavailable'; end; $$;
    create trigger fail_submission before insert on public.fleet_sync_submissions for each row execute function public.fail_submission_test()`);
  try {
    await assert.rejects(sync(operation({notes: present('Not committed')})), /submission unavailable/);
    assert.deepEqual((await row('select data from public.fleet_vehicles')).data, base);
    assert.deepEqual(await stats(), {submissions: 0, conflicts: 0, revisions: 1, effects: 1});
    await online({...base, notes: 'Online'});
    await assert.rejects(sync(operation({notes: present('Not registered')})), /submission unavailable/);
    assert.equal((await stats()).conflicts, 0); // no orphan candidate
  } finally {
    await db.exec('drop trigger fail_submission on public.fleet_sync_submissions; drop function public.fail_submission_test()');
  }
});

test('baseline provenance remains explicitly unknown and stored author names survive profile renames', async () => {
  // Model a legacy baseline instead of pretending the migration time is an edit time.
  await db.exec("update public.fleet_sync_revisions set origin='baseline', actor_user_id=null where version=1");
  await sync(operation({notes: present('Accepted')}, {actor: admin}), admin);
  await db.query('update public.profiles set full_name=$1 where user_id=$2', ['Renamed admin', admin]);
  const pending = await sync(operation({notes: present('Competing')}));
  const saved = await conflict(pending.conflictId);
  assert.equal(saved.current_provenance.notes.actorName, 'Admin');
  assert.equal(saved.current_provenance.unit.origin, 'baseline');
  assert.equal(saved.current_provenance.unit.userId, null);
  assert.equal(saved.current_provenance.unit.serverRecordedAt, null);
  assert.equal(saved.current_provenance.unit.connectivity, 'unknown');
});

test('a dependency awaiting review is not accepted as applied', async () => {
  await online({...base, notes: 'Online'});
  const parent = operation({notes: present('Await review')});
  assert.equal((await sync(parent)).kind, 'awaiting_review');
  const child = operation({unit: present('Dependent')});
  child.dependsOn = [parent.operationId];
  await assert.rejects(sync(child), /dependency has not been applied/);
  assert.equal((await stats()).submissions, 1);
});

test('SQL merge rejects invalid records, marker shapes and policies', async () => {
  for (const [original, current, patch, groups] of [
    [[], {}, {}, []], [{}, [], {}, []], [{}, {}, [], []],
    [{}, {}, {a: {present: true}}, []], [{}, {}, {a: {present: false, value: null}}, []],
    [{}, {}, {a: {present: true, value: 1, extra: true}}, []],
    [{}, {}, {}, {}], [{}, {}, {}, [true]], [{}, {}, {}, [[1]]],
  ]) {
    await assert.rejects(db.query('select public.merge_fleet_sync_fields($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb)',
      [JSON.stringify(original), JSON.stringify(current), JSON.stringify(patch), JSON.stringify(groups)]), error => error.code === '22023');
  }
});

test('company deletion removes submissions/conflicts without breaking deferred references', async () => {
  await online({...base, notes: 'Online'});
  await sync(operation({notes: present('Offline')}));
  await db.query('delete from public.companies where id=$1', [company]);
  assert.equal((await stats()).submissions, 0);
  assert.equal((await stats()).conflicts, 0);
  assert.equal((await stats()).revisions, 0);
});

test('adapter rejects unsupported fields, invalid presence/value shapes and untrusted metadata', async () => {
  for (const patch of [
    {status: present('Assigned')}, {assignedTo: present(owner)}, {photo: present({path: 'fake'})}, {id: present(randomUUID())},
    {notes: {present: true}}, {notes: {present: false, value: null}}, {notes: {present: 'true', value: 'bad'}},
    {year: present(2026.5)}, {year: present('2026')}, {notes: present(null)}, {unit: present(' ')},
  ]) await assert.rejects(sync(operation(patch)), error => error.code === '22023');
  const invalids = [
    {...operation({}), schemaVersion: 2}, {...operation({}), unknown: 'ignored metadata'},
    {...operation({}), entityType: 'crew'}, {...operation({}), dependsOn: ['invalid', 'invalid']},
  ];
  const time = operation({}); time.provenance.savedAt = 'infinity'; invalids.push(time);
  const marker = operation({}); marker.provenance.connectivity = 'maybe'; invalids.push(marker);
  const mutate = operation({}); mutate.mutation.kind = 'delete'; invalids.push(mutate);
  for (const op of invalids) await assert.rejects(sync(op), error => error.code === '22023');
  assert.deepEqual(await stats(), {submissions: 0, conflicts: 0, revisions: 1, effects: 1});
});
