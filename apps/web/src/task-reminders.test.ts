import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {FireOpsUser} from '@fireops/domain';
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../packages/domain/test-fixtures/hook-runtime');return createHookRuntime()});
vi.mock('react',()=>runtime.hooks);
const mocks=vi.hoisted(()=>({rpc:vi.fn(),execute:vi.fn(),from:vi.fn(),channel:vi.fn(),removeChannel:vi.fn()}));
vi.mock('./supabase',()=>({supabase:mocks}));
import {usePersonalTasks} from './usePersonalTasks';
import {useDashboardInbox} from './useDashboardInbox';
const cleanups:(()=>void)[]=[];
function hook<T>(fn:()=>T){
  const frame=runtime.frame();
  cleanups.push(()=>{for(const slot of frame.slots)slot.cleanup?.()});
  return {render(){runtime.enter(frame);return fn()},effects(){for(const index of [...frame.effects]){frame.effects.delete(index);const slot=frame.slots[index];slot.cleanup?.();slot.cleanup=slot.effect?.()??undefined}}};
}
async function flush(){for(let i=0;i<20;i++)await Promise.resolve()}
const company='company',user='owner';
const draft={subject:'Order filters',description:'Two boxes',dueDate:'2027-01-05'};
beforeEach(()=>{
  vi.clearAllMocks();mocks.rpc.mockResolvedValue({error:null});mocks.execute.mockResolvedValue({data:[],error:null});
  mocks.from.mockImplementation(table=>{
    const request={table,action:'select',filters:[] as unknown[],values:undefined as unknown};
    const query={select(){return query},order(){return query},limit(){return query},single(){return query},eq(...args:unknown[]){request.filters.push(args);return query},in(...args:unknown[]){request.filters.push(args);return query},
      update(values:unknown){request.action='update';request.values=values;return query},insert(values:unknown){request.action='insert';request.values=values;return query},
      then(yes:(value:unknown)=>unknown,no:(reason:unknown)=>unknown){return Promise.resolve().then(()=>mocks.execute(request)).then(yes,no)}};
    return query;
  });
  mocks.channel.mockImplementation(()=>{const channel={on(){return channel},subscribe(){return channel}};return channel});
});
afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup()});

describe('task reminder registration',()=>{
  it('registers local IANA timezone for the exact task owner/company',async()=>{
    const f=hook(()=>usePersonalTasks(company,user));f.render();f.effects();await flush();
    expect(mocks.rpc).toHaveBeenCalledWith('set_task_reminder_timezone',{target_company_id:company,target_user_id:user,timezone_name:Intl.DateTimeFormat().resolvedOptions().timeZone});
    expect(f.render().error).toBe('');
  });
  it('reports setup failure and retries registration without blocking task reads',async()=>{
    mocks.rpc.mockResolvedValueOnce({error:{message:'Unavailable'}});
    const f=hook(()=>usePersonalTasks(company,user));f.render();f.effects();await flush();
    expect(f.render().error).toContain('reminders could not be configured');
    f.render().retry();f.render();f.effects();await flush();
    expect(f.render().error).toBe('');expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it('edits existing task content without inserting a duplicate',async()=>{
    const f=hook(()=>usePersonalTasks(company,user));const value=f.render();
    expect(await value.save(draft,'task-id')).toBe(true);
    expect(mocks.execute).toHaveBeenCalledWith({table:'personal_tasks',action:'update',values:{subject:draft.subject,description:draft.description,due_date:draft.dueDate},filters:[['id','task-id'],['company_id',company],['user_id',user]]});
  });
});

describe('web task reminder inbox',()=>{
  it('hides reminders immediately on account switch and fences old responses/read handlers',async()=>{
    let resolve!:(result:unknown)=>void;
    const pending=new Promise(result=>{resolve=result});
    mocks.execute.mockReturnValueOnce(pending).mockResolvedValue({data:[],error:null});
    let who=user;
    const f=hook(()=>useDashboardInbox(company,{id:who,role:'owner'} as FireOpsUser));
    const old=f.render();f.effects();await flush();
    who='replacement';expect(f.render().notifications).toBeNull();f.effects();await flush();
    resolve({data:[{id:'private',event_type:'task_due',path:'/tasks',title:'Private task',body:'',read_at:null,created_at:''}],error:null});await flush();
    expect(f.render().notifications).toEqual([]);
    mocks.from.mockClear();await old.markRead('private');expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each(['owner','admin','shop_tech'] as const)('shows %s reminders and routes to Task List',async role=>{
    mocks.execute.mockResolvedValue({data:[{id:'notice',event_type:'task_due',path:'/tasks',title:'Task due today',body:'Review task',read_at:null,created_at:'2027-01-05T17:00:00Z'}],error:null});
    const f=hook(()=>useDashboardInbox(company,{id:user,role} as FireOpsUser));f.render();f.effects();await flush();
    expect(f.render().notifications?.[0]).toMatchObject({id:'notice',source:'tasks',unread:true});
    expect(mocks.execute.mock.calls[0][0].filters).toContainEqual(['event_type',expect.arrayContaining(['task_due'])]);
    await f.render().markRead('notice');expect(f.render().notifications?.[0].unread).toBe(false);
  });
});
