import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SyncOperation,SyncRecord} from '@fireops/domain';
import type {CachedOfflineRecord,OfflineOutboxSession,OutboxEntry} from './offline-outbox';
import {bindOfflineFleet,createFleetEditGate,getOfflineFleet,guardOfflineFleetWrite,projectOfflineFleet,refreshOfflineFleet,subscribeOfflineFleet,type FleetModelRecord,type OfflineFleetModel} from './offline-fleet-model';

const scope={userId:'user',companyId:'company'};
const target={entityType:'vehicle' as const,entityId:'vehicle'};
const raw={id:'vehicle',unit:'E1',notes:'base',status:'Ready',documents:[{id:'doc',file:{name:'Insurance',path:'company/file'}}]};
const cached=(revision='1',record:SyncRecord|null=raw):CachedOfflineRecord=>({...target,revision,record,verifiedAt:'2026-01-01T00:00:00Z'});
const remote=(revision='1',record:SyncRecord|null=raw):FleetModelRecord=>({...target,revision,record});
function entry(id='op',sequence=1,values:Partial<OutboxEntry>={}):OutboxEntry{
  const operation:SyncOperation={schemaVersion:1,operationId:id,companyId:scope.companyId,...target,provenance:{userId:scope.userId,deviceId:'device',savedAt:'2026-01-01T00:00:00Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'update',baseRevision:'1',base:raw,patch:{notes:{present:true,value:'mine'}}}};
  return {sequence,operation,projection:{...raw,notes:'mine'},status:'pending',attempts:0,error:null,receipt:null,delivery:null,reviewOutcome:null,noticeDismissed:false,...values};
}
const model=(values:Partial<OfflineFleetModel>={}):OfflineFleetModel=>({scope,records:[cached()],entries:[],offline:true,loaded:true,...values});
const cleanups:(()=>void)[]=[];afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup()});

describe('scoped fleet display projection',()=>{
  it('restores verified raw records without the HTTP cache and leaves raw bases untouched',()=>{
    const local=model({entries:[entry()]});const result=projectOfflineFleet([],local);
    expect(result.records[0].record).toEqual({...raw,notes:'mine'});expect(result.pending['vehicle:vehicle']).toContain('Saved on device');
    expect(local.records[0].record).toEqual(raw);expect(entry().operation.mutation).toMatchObject({base:raw});
  });
  it('overlays changed fields only, preserving newer unrelated online fields and documents',()=>{
    const current={...raw,unit:'New unit',status:'Out of service',documents:[{id:'new-doc'}]};
    const result=projectOfflineFleet([remote('4',current)],model({entries:[entry()]}));
    expect(result.records[0]).toMatchObject({revision:'4',record:{...current,notes:'mine'}});
  });
  it('keeps monotonic cached revisions even when HTTP fallback or realtime is older',()=>{
    const result=projectOfflineFleet([remote('2')],model({records:[cached('9007199254740993',{...raw,notes:'Newest'})]}));
    expect(result.records[0]).toMatchObject({revision:'9007199254740993',record:{notes:'Newest'}});
  });
  it('prefers live higher revisions over older downloads, including a recreated lifecycle',()=>{
    const result=projectOfflineFleet([remote('4',{...raw,unit:'Recreated'})],model({records:[cached('3',null)]}));
    expect(result.records[0].record).toMatchObject({unit:'Recreated'});
  });
  it('keeps proven deletion separate from a pending local proposal',()=>{
    const local=model({records:[cached('3',null)],entries:[entry()]});
    const result=projectOfflineFleet([remote()],local);
    expect(result.records[0].record).toMatchObject({notes:'mine'});expect(result.pending['vehicle:vehicle']).toContain('shared record deleted');
    expect(projectOfflineFleet([remote()],{...local,entries:[]}).records[0].record).toBeNull();
  });
  it('does not resurrect a cached row after a realtime removal while waiting for proof',()=>{
    const removed=new Map([['vehicle:vehicle','1']]);
    expect(projectOfflineFleet([],model(),removed).records).toEqual([]);
    expect(projectOfflineFleet([],model({entries:[entry()]}),removed).pending['vehicle:vehicle']).toContain('shared record deleted');
    expect(projectOfflineFleet([],model({records:[cached('3')]}),removed).records[0].record).toEqual(raw);
  });
  it('composes newer pending edits without erasing them with an older acknowledgment',()=>{
    const newer=entry('newer',2,{operation:{...entry().operation,operationId:'newer',mutation:{kind:'update',baseRevision:'1',base:raw,patch:{unit:{present:true,value:'Local unit'}}}}});
    const result=projectOfflineFleet([],model({records:[cached('3',{...raw,notes:'Confirmed'})],entries:[newer,entry('older',1,{status:'synced'})]}));
    expect(result.records[0].record).toMatchObject({notes:'Confirmed',unit:'Local unit'});
  });
  it.each(['synced','not_selected'] as const)('removes %s overlays without replaying their discarded values',status=>{
    expect(projectOfflineFleet([],model({entries:[entry('op',1,{status})]}))).toMatchObject({records:[{record:raw}],pending:{}});
  });
  it('removes discarded review values even while canonical refresh is pending',()=>{
    const reviewed=entry('op',1,{status:'awaiting_review',reviewOutcome:{kind:'reviewed',operationId:'op',conflictId:'conflict',decisionId:'decision',decidedAt:'2026-01-01',revision:'2',outcome:'not_selected',keptFields:[],discardedFields:['notes']}});
    const result=projectOfflineFleet([],model({entries:[reviewed]}));expect(result.records[0].record).toEqual(raw);expect(result.pending['vehicle:vehicle']).toContain('another version');
  });
  it('ignores other accounts/companies and never previews unsupported status mutations',()=>{
    const original=entry().operation;
    const foreign=entry('foreign',1,{operation:{...original,companyId:'foreign'}});
    const wrongUser=entry('wrong',1,{operation:{...original,provenance:{...original.provenance,userId:'other'}}});
    const unsupported=entry('unsupported',1,{operation:{...original,mutation:{kind:'update',baseRevision:'1',base:raw,patch:{status:{present:true,value:'Assigned'}}}}});
    expect(projectOfflineFleet([],model({entries:[foreign,wrongUser]})).pending).toEqual({});
    expect(projectOfflineFleet([],model({entries:[unsupported]})).records[0].record).toEqual(raw);
  });
});

describe('legacy write versus durable enqueue reservations',()=>{
  const fixture=()=>{const list=vi.fn().mockResolvedValue([]);const mode={active:true};const gate=createFleetEditGate({list} as unknown as OfflineOutboxSession,()=>mode.active);return {gate,list,mode}};
  it('reserves all targets synchronously, allowing identical-intent reentry only',()=>{
    const {gate}=fixture();const release=gate.acquire([target],'save');const duplicate=gate.acquire([target],'save');
    expect(()=>gate.acquire([target],'other')).toThrow('progress');release();release();expect(()=>gate.acquire([target],'other')).toThrow('progress');duplicate();gate.acquire([target],'other')();
  });
  it('holds legacy reservations across SQL reads and rejects conflicting local enqueue',async()=>{
    const {gate}=fixture();const pending=gate.legacy([target],'legacy');expect(()=>gate.acquire([target],'detail')).toThrow('progress');
    const release=await pending;expect(()=>gate.acquire([target],'detail')).toThrow('progress');release();gate.acquire([target],'detail')();
  });
  it('rejects unresolved work and releases the lock on storage errors',async()=>{
    const {gate,list}=fixture();list.mockResolvedValue([entry()]);await expect(gate.legacy([target],'legacy')).rejects.toThrow('must sync');
    gate.acquire([target],'detail')();list.mockRejectedValue(new Error('disk full'));await expect(gate.legacy([target],'legacy')).rejects.toThrow('disk full');gate.acquire([target],'detail')();
  });
  it('blocks vehicle deletion/actions when an omitted linked issue has a pending edit',async()=>{
    const {gate,list}=fixture();const issue=entry('issue',1,{operation:{...entry().operation,entityType:'issue',entityId:'issue',mutation:{kind:'update',baseRevision:'1',base:{id:'issue',vehicleId:'vehicle'},patch:{title:{present:true,value:'Mine'}}}}});
    list.mockResolvedValue([issue]);await expect(gate.legacy([target],'delete')).rejects.toThrow('must sync');
  });
  it('checks account validity again after the asynchronous SQL read',async()=>{
    const {gate,list,mode}=fixture();list.mockImplementation(async()=>{mode.active=false;return []});await expect(gate.legacy([target],'legacy')).rejects.toThrow('account changed');
  });
});

describe('provider-owned fleet bridge',()=>{
  function bind(local=model()){
    const mode={current:true,visible:true};const legacy=vi.fn().mockResolvedValue(()=>{});const refresh=vi.fn();
    const handle=bindOfflineFleet({model:local,current:()=>mode.current,visible:()=>mode.visible,legacy,refresh});cleanups.push(()=>handle.dispose());return {handle,mode,legacy,refresh};
  }
  it('hides old scopes immediately, including role/access invalidation',()=>{
    const f=bind();expect(getOfflineFleet(scope)).not.toBeNull();expect(getOfflineFleet({...scope,userId:'other'})).toBeNull();
    f.mode.visible=false;expect(getOfflineFleet(scope)).toBeNull();f.mode.visible=true;f.mode.current=false;expect(getOfflineFleet(scope)).toBeNull();
  });
  it('fences old cleanup and late publications after replacement',()=>{
    const old=bind();const next=model({scope:{...scope,userId:'new'}});const current=bind(next);
    old.handle.dispose();old.handle.publish(model());expect(getOfflineFleet(next.scope)).toBe(next);expect(getOfflineFleet(scope)).toBeNull();current.handle.dispose();
  });
  it('notifies normalized read subscribers and routes refresh without a second session',()=>{
    const listener=vi.fn();cleanups.push(subscribeOfflineFleet(listener));const f=bind();const next=model({records:[cached('3')]});f.handle.publish(next);refreshOfflineFleet();
    expect(listener).toHaveBeenCalledTimes(2);expect(getOfflineFleet(scope)).toBe(next);expect(f.refresh).toHaveBeenCalledOnce();
  });
  it('blocks writes using a still-displayed proposal even if SQL already settled it',async()=>{
    const f=bind(model({entries:[entry()]}));await expect(guardOfflineFleetWrite(scope,[target],'legacy')).rejects.toThrow('must sync');expect(f.legacy).not.toHaveBeenCalled();
    f.handle.publish(model());const release=await guardOfflineFleetWrite(scope,[target],'legacy');release();expect(f.legacy).toHaveBeenCalledOnce();
  });
  it('keeps write guards active after demotion while hiding manager-only cached records',async()=>{
    const f=bind();f.mode.visible=false;await guardOfflineFleetWrite(scope,[target],'legacy');expect(f.legacy).toHaveBeenCalledOnce();
    await expect(guardOfflineFleetWrite({...scope,userId:'other'},[target],'legacy')).rejects.toThrow('account changed');
  });
});
