import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {FleetSnapshot,Vehicle} from '@fireops/domain';
import {createOnlineFleetTransport,createOnlineFleetWrites,type PreparedFleetWrite} from './online-fleet-writes';
import {createOnlineFleetEditSession,restoreFleetAssignment} from './online-fleet-edit-session';

const scope={companyId:'company',userId:'user'};
const vehicle=():Vehicle=>({id:'vehicle',unit:'E1',type:'Engine',year:2024,make:'Ford',model:'F',vin:'',plate:'',notes:'Base',status:'Ready',createdAt:'2026-01-01'});
const snapshot=(vehicles=[vehicle()]):FleetSnapshot=>({vehicles,issues:[],crew:[],activities:[]});
const wire=(value:FleetSnapshot):FleetSnapshot=>JSON.parse(JSON.stringify(value));
function fixture(){
  let id=0;const writer=createOnlineFleetWrites({...scope,wire,id:()=>`operation-${++id}`});const before=snapshot();writer.issue('vehicles',before.vehicles[0],1);
  const after={...before,vehicles:[{...before.vehicles[0],notes:'Mine'}]};return {writer,before,after};
}
const receipt=(version=2)=>[{collection:'vehicles',event:'update',recordId:'vehicle',version}];
afterEach(()=>vi.useRealTimers());

describe('online-only fleet write provenance',()=>{
  it('retains the displayed base revision despite a newer same-user/server read',()=>{
    const f=fixture();f.writer.issue('vehicles',{...vehicle(),notes:'Other device'},4);
    expect(f.writer.prepare(f.after,f.before).changes).toEqual([{collection:'vehicles',event:'update',recordId:'vehicle',expectedVersion:1,data:f.after.vehicles[0]}]);
  });
  it('never deletes a newly discovered record missing from the original UI snapshot',()=>{
    const f=fixture();f.writer.issue('vehicles',{...vehicle(),id:'remote-insert'},1);
    expect(f.writer.prepare(f.after,f.before).changes.map(change=>change.recordId)).toEqual(['vehicle']);
  });
  it('does not turn an old edit into an insert after a remote deletion/recreation',()=>{
    const f=fixture();f.writer.issue('vehicles',{...vehicle(),notes:'Recreated'},8);
    expect(f.writer.prepare(f.after,f.before).changes[0]).toMatchObject({event:'update',expectedVersion:1});
    expect(f.writer.prepare(snapshot([]),f.before).changes[0]).toMatchObject({event:'delete',expectedVersion:1});
  });
  it('keeps old revision tokens even when a row changes back to identical values',()=>{
    const f=fixture();f.writer.issue('vehicles',vehicle(),3);expect(f.writer.prepare(f.after,f.before).changes[0].expectedVersion).toBe(1);
  });
  it('rejects borrowed, modified and unsafe read bases',()=>{
    const f=fixture();expect(()=>f.writer.prepare(f.after,structuredClone(f.before))).toThrow('stale');
    f.before.vehicles[0].unit='Mutated';expect(()=>f.writer.prepare(f.after,f.before)).toThrow('stale');
    expect(()=>f.writer.issue('vehicles',vehicle(),Number.MAX_SAFE_INTEGER+1)).toThrow('stale');
  });
  it('keeps operation ID, JSON and expected revisions immutable across failed/uncertain retries',()=>{
    const f=fixture();const request=f.writer.prepare(f.after,f.before);f.after.vehicles[0].notes='Unsent edit';
    const retried=f.writer.prepare(f.after,f.before);expect(retried).toBe(request);expect(request.changes[0]).toMatchObject({expectedVersion:1,data:{notes:'Mine'}});
    expect(Object.isFrozen(request.changes[0].data)).toBe(true);
    expect(()=>f.writer.acknowledge(request,receipt())).toThrow('Displayed values changed');
    expect(()=>f.writer.prepare(f.after,{...f.before})).toThrow('different base');
  });
  it('promotes only acknowledged view records for a subsequent explicit edit',()=>{
    const f=fixture();const request=f.writer.prepare(f.after,f.before);f.writer.acknowledge(request,receipt(2));
    const next={...f.after,vehicles:[{...f.after.vehicles[0],unit:'E2'}]};expect(f.writer.prepare(next,f.after).changes[0].expectedVersion).toBe(2);
  });
  it('does not echo records already persisted by a separate privileged RPC',()=>{
    const f=fixture();const invited={id:'crew',name:'Crew',email:'crew@example.com',phone:'',status:'Invited' as const,role:'shop_tech' as const};
    f.writer.issue('crew',invited,1);const next={...f.after,crew:[invited]};expect(f.writer.prepare(next,f.before).changes).toHaveLength(1);
    expect(f.writer.prepare(f.before,f.before).changes).toEqual([]);
  });
  it('uses insert semantics only for genuinely new local records',()=>{
    const f=fixture();const next={...f.before,vehicles:[...f.before.vehicles,{...vehicle(),id:'new'}]};
    expect(f.writer.prepare(next,f.before).changes).toEqual([{collection:'vehicles',event:'insert',recordId:'new',data:next.vehicles[1]}]);
  });
  it.each([[],[...receipt(),...receipt()],receipt(1),[{...receipt()[0],recordId:'other'}],[{...receipt()[0],event:'insert'}],[{...receipt()[0],version:NaN}]])('rejects incomplete, mismatched and duplicate acknowledgment %j',value=>{
    const f=fixture();expect(()=>f.writer.acknowledge(f.writer.prepare(f.after,f.before),value)).toThrow('acknowledgment');
  });
  it('rejects another workspace’s prepared request and base references',()=>{
    const f=fixture();const other=createOnlineFleetWrites({...scope,userId:'other',wire,id:()=> 'other'});
    expect(()=>other.acknowledge(f.writer.prepare(f.after,f.before),receipt())).toThrow('another workspace');
    expect(()=>other.prepare(f.after,f.before)).toThrow('stale');
  });
});

function transportFixture(){
  const result={data:receipt(),error:null as null|{code:string;message:string}};
  const builder={setHeader:vi.fn().mockReturnThis(),abortSignal:vi.fn().mockImplementation(async()=>result)};
  const client={auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:'user'},access_token:'bound-token'}},error:null})},rpc:vi.fn((_name:string,_args:unknown)=>builder)};
  const mode={current:true};const send=createOnlineFleetTransport(client as unknown as SupabaseClient,scope,()=>mode.current,30);
  const f=fixture();const request=f.writer.prepare(f.after,f.before);return {client,builder,mode,send,request,result};
}
describe('online authenticated idempotent batch transport',()=>{
  it('uses a stable operation ID, captured CAS payload and account-bound bearer token',async()=>{
    const f=transportFixture();await f.send(f.request);
    expect(f.client.rpc).toHaveBeenCalledWith('apply_fleet_changes_once',{target_company_id:'company',operation_id:'operation-1',changes:f.request.changes});
    expect(f.builder.setHeader).toHaveBeenCalledWith('Authorization','Bearer bound-token');expect(f.builder.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });
  it('retries uncertain delivery using the same endpoint, identity and request',async()=>{
    const f=transportFixture();f.builder.abortSignal.mockRejectedValueOnce(new Error('Network lost'));await expect(f.send(f.request)).rejects.toThrow('Network lost');await f.send(f.request);
    expect(f.client.rpc.mock.calls.map(call=>call[0])).toEqual(['apply_fleet_changes_once','apply_fleet_changes_once']);
    expect(f.client.rpc.mock.calls[0][1]).toEqual(f.client.rpc.mock.calls[1][1]);
  });
  it('falls back only for definitively missing bridge RPC, retaining the legacy endpoint on retry',async()=>{
    const f=transportFixture();f.builder.abortSignal.mockResolvedValueOnce({data:null,error:{code:'PGRST202',message:'Missing function'}}).mockRejectedValueOnce(new Error('Network lost'));
    await expect(f.send(f.request)).rejects.toThrow('Network lost');await f.send(f.request);
    expect(f.client.rpc.mock.calls.map(call=>call[0])).toEqual(['apply_fleet_changes_once','apply_fleet_changes','apply_fleet_changes']);
    expect(f.client.rpc.mock.calls[1][1]).toEqual(f.client.rpc.mock.calls[2][1]);
  });
  it.each(['42501','PT409','42P01','42883'])('never bypasses structured %s errors through another mutation endpoint',async code=>{
    const f=transportFixture();f.result.error={code,message:'Denied'};await expect(f.send(f.request)).rejects.toThrow();expect(f.client.rpc).toHaveBeenCalledTimes(1);
  });
  it('does not send a foreign scope or restored replacement account',async()=>{
    const f=transportFixture();await expect(f.send({...f.request,userId:'other'} as PreparedFleetWrite)).rejects.toThrow('workspace changed');
    f.client.auth.getSession.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'wrong'}},error:null});await expect(f.send(f.request)).rejects.toThrow('original account');expect(f.client.rpc).not.toHaveBeenCalled();
  });
  it('rechecks workspace identity after asynchronous session restoration and delivery',async()=>{
    const f=transportFixture();f.client.auth.getSession.mockImplementation(async()=>{f.mode.current=false;return {data:{session:{user:{id:'user'},access_token:'old'}},error:null}});
    await expect(f.send(f.request)).rejects.toThrow('workspace changed');expect(f.client.rpc).not.toHaveBeenCalled();
    const next=transportFixture();next.builder.abortSignal.mockImplementation(async()=>{next.mode.current=false;return next.result});await expect(next.send(next.request)).rejects.toThrow('workspace changed');
  });
  it('bounds a stalled SDK restore without sending a late write',async()=>{
    vi.useFakeTimers();const f=transportFixture();let resolve!:(value:unknown)=>void;
    f.client.auth.getSession.mockReturnValue(new Promise(yes=>{resolve=yes}));const rejected=expect(f.send(f.request)).rejects.toThrow('may have completed');
    await vi.advanceTimersByTimeAsync(31);await rejected;resolve({data:{session:{user:{id:'user'},access_token:'late'}},error:null});await Promise.resolve();expect(f.client.rpc).not.toHaveBeenCalled();
  });
});

describe('memory-only web edit gate, not offline storage',()=>{
  it('captures one original base and freezes collection membership before debounce',()=>{
    const session=createOnlineFleetEditSession();const before=snapshot();const after=snapshot([{...vehicle(),notes:'Typed'}]);
    expect(session.begin(before)).toBe(true);expect(session.begin(snapshot())).toBe(false);
    const request=session.capture(after);after.vehicles.push({...vehicle(),id:'late'});
    expect(session.capture(snapshot())).toBe(request);expect(request.before).toBe(before);expect(request.after.vehicles.map(row=>row.id)).toEqual(['vehicle']);
  });
  it('buffers server edits and deletions without erasing pending or failed local work',async()=>{
    const session=createOnlineFleetEditSession();const base=snapshot();session.begin(base);const draft=session.capture(snapshot([{...vehicle(),notes:'Typed'}]));
    session.buffer({collection:'vehicles',event:'upsert',record:{...vehicle(),notes:'Remote'},sequence:1});session.buffer({collection:'vehicles',event:'delete',id:'vehicle',sequence:2});
    session.buffer({collection:'vehicles',event:'upsert',record:vehicle(),sequence:0});
    await expect(session.run(async()=>{throw new Error('Offline')})).rejects.toThrow('Offline');expect(session.pending).toBe(true);expect(session.capture(snapshot())).toBe(draft);
    const retry=vi.fn().mockResolvedValue(undefined);await session.run(retry);expect(retry).toHaveBeenCalledWith(draft);
    expect(session.finish()).toEqual([{collection:'vehicles',event:'delete',id:'vehicle',sequence:2}]);expect(session.pending).toBe(false);
  });
  it('coalesces concurrent retries rather than dispatching a second request',async()=>{
    const session=createOnlineFleetEditSession();session.begin(snapshot());session.capture(snapshot());let finish!:()=>void;const send=vi.fn(()=>new Promise<void>(yes=>{finish=yes}));
    const first=session.run(send);expect(session.run(send)).toBe(first);await Promise.resolve();finish();await first;expect(send).toHaveBeenCalledTimes(1);
  });
  it('passes server changes through immediately when no local save is pending',()=>{
    expect(createOnlineFleetEditSession().buffer({collection:'vehicles',event:'delete',id:'vehicle',sequence:1})).toBe(false);
  });
});

describe('safe assignment undo',()=>{
  it('preserves independent fields changed by mobile sync after the original assignment',()=>{
    const previous=vehicle();const applied={...previous,status:'Assigned' as const,assignedTo:'crew'};const current={...applied,notes:'Mobile edit',unit:'Updated unit',documents:[{id:'document',name:'Other file',file:{name:'file.pdf',type:'application/pdf',dataUrl:'',path:'new/file'}}]};
    expect(restoreFleetAssignment(current,previous,applied)).toEqual({...current,status:'Ready',assignedTo:undefined,assignedFire:undefined});
  });
  it('rejects undo after another assignment/status edit or deletion/recreation ID mismatch',()=>{
    const previous=vehicle();const applied={...previous,status:'Assigned' as const,assignedTo:'crew'};
    expect(restoreFleetAssignment({...applied,assignedTo:'other'},previous,applied)).toBeNull();expect(restoreFleetAssignment({...applied,id:'other'},previous,applied)).toBeNull();
  });
});
