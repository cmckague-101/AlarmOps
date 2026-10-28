import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const editingSql=readFileSync(new URL('../migrations/20261228000100_personal_task_editing.sql',import.meta.url),'utf8');
test('task editing grants content columns only and checks eligible ownership before and after update',()=>{
  assert.match(editingSql,/grant update \(subject, description, due_date\) on public\.personal_tasks to authenticated/);
  assert.doesNotMatch(editingSql,/grant update on/);
  assert.match(editingSql,/for update to authenticated using/);
  assert.match(editingSql,/with check/);
  assert.equal([...editingSql.matchAll(/user_id = \(select auth\.uid\(\)\)/g)].length,4);
  assert.equal([...editingSql.matchAll(/m\.company_id = personal_tasks\.company_id/g)].length,2);
  assert.equal([...editingSql.matchAll(/m\.role in \('owner', 'admin', 'shop_tech'\)/g)].length,2);
});

// Static policy regression checks; these do not replace live PostgreSQL RLS tests.
const sql=readFileSync(new URL('../migrations/20261107000100_personal_tasks.sql',import.meta.url),'utf8');
test('tasks enable RLS and scope every operation to the current eligible member',()=>{
  assert.match(sql,/alter table public\.personal_tasks enable row level security/);
  const policies=[...sql.matchAll(/create policy[\s\S]+?;\n/g)].map(match=>match[0]);
  assert.equal(policies.length,3);
  for(const policy of policies){
    assert.match(policy,/user_id = \(select auth\.uid\(\)\)/);
    assert.match(policy,/m\.company_id = personal_tasks\.company_id/);
    assert.match(policy,/m\.user_id = \(select auth\.uid\(\)\)/);
    assert.match(policy,/m\.role in \('owner', 'admin', 'shop_tech'\)/);
  }
  for(const operation of ['select','insert','delete']) assert.ok(policies.some(policy=>policy.includes(`for ${operation} to authenticated`)));
  assert.doesNotMatch(sql,/has_system_admin_company_access|is_company_manager/);
});
test('tasks grant only the operations needed and have no completed history',()=>{
  assert.match(sql,/revoke all on public\.personal_tasks from anon, authenticated/);
  assert.match(sql,/grant select, insert, delete on public\.personal_tasks to authenticated/);
  assert.doesNotMatch(sql,/grant[^;]*update[^;]*to authenticated/);
  assert.match(sql,/due_date date not null/);
  assert.match(sql,/char_length\(trim\(subject\)\) between 1 and 200/);
  assert.doesNotMatch(sql,/completed_at|is_completed|status text/);
});
