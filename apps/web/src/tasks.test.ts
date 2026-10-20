import {describe,expect,it} from 'vitest';
import {canManagePersonalTasks,taskDraftError} from '@fireops/domain';

describe('personal task access',()=>{
  it('allows owners, admins, and techs but not firefighters',()=>{
    for(const role of ['owner','admin','shop_tech'] as const) expect(canManagePersonalTasks(role)).toBe(true);
    expect(canManagePersonalTasks('fire_fighter')).toBe(false);
  });
});
describe('personal task validation',()=>{
  const draft={subject:'Order parts',description:'Check truck inventory first',dueDate:'2026-11-10'};
  it('accepts tasks with a due date and optional description',()=>{
    expect(taskDraftError(draft)).toBeNull();
    expect(taskDraftError({...draft,description:''})).toBeNull();
  });
  it('requires a nonblank subject and enforces field limits',()=>{
    expect(taskDraftError({...draft,subject:'   '})).toBe('Enter a subject.');
    expect(taskDraftError({...draft,subject:'a'.repeat(201)})).not.toBeNull();
    expect(taskDraftError({...draft,description:'a'.repeat(5001)})).not.toBeNull();
    expect(taskDraftError({...draft,subject:'a'.repeat(200),description:'a'.repeat(5000)})).toBeNull();
  });
  it('requires a real calendar date without prohibiting overdue tasks',()=>{
    for(const dueDate of ['', '2026-02-29','2026-02-30','2026-13-01','11/10/2026']) expect(taskDraftError({...draft,dueDate})).not.toBeNull();
    expect(taskDraftError({...draft,dueDate:'2024-02-29'})).toBeNull();
  });
});
