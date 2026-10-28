import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {afterEach,describe,expect,it,vi} from 'vitest';
import * as bridge from './offline-fleet-model';
import type {OfflineFleetModel} from './offline-fleet-model';
import type {OutboxEntry} from './offline-outbox';

// Evaluate production repository with injected SDK/hooks; no React Native runtime, server or UI.
const javascript=ts.transpileModule(readFileSync(new URL('./fleet-store.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const scope={userId:'user',companyId:'company'};
const raw={id:'vehicle',unit:'E1',type:'Engine',notes:'base',status:'Ready'};
const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const dispose of cleanups.splice(0).reverse())dispose()});
const pending:OutboxEntry={sequence:1,status:'pending',attempts:0,error:null,receipt:null,delivery:null,reviewOutcome:null,noticeDismissed:false,projection:{...raw,notes:'mine'},operation:{schemaVersion:1,operationId:'op',companyId:scope.companyId,entityType:'vehicle',entityId:raw.id,provenance:{userId:scope.userId,deviceId:'device',savedAt:'2026-01-01',connectivity:'offline'},dependsOn:[],mutation:{kind:'update',baseRevision:'1',base:raw,patch:{notes:{present:true,value:'mine'}}}}};
function model(entries:OutboxEntry[]=[],revision='1',record=raw):OfflineFleetModel{return {scope,loaded:true,offline:true,records:[{entityType:'vehicle',entityId:raw.id,revision,record,verifiedAt:'2026-01-01'}],entries}}
function setup(local?:OfflineFleetModel){
  const identity={userId:'user',role:'owner'};const mode={failed:false};const rows:Record<string,{record_id:string;data:unknown;version:number}[]>={fleet_vehicles:[{record_id:raw.id,data:raw,version:1}],fleet_issues:[],fleet_crew:[],fleet_activities:[]};
  const callbacks:{table:string;callback:(payload:unknown)=>void}[]=[];
  const result={data:[] as unknown[],error:null as null|{code?:string;message:string}};
  const client={
    from:vi.fn((table:string)=>{const query={select:()=>query,eq:()=>query,order:async()=>mode.failed?{data:null,error:{message:'Network unavailable'}}:{data:rows[table],error:null}};return query}),
    functions:{invoke:vi.fn().mockResolvedValue({data:{connected:false},error:null})},
    auth:{getSession:vi.fn(async()=>({data:{session:{user:{id:identity.userId},access_token:`token-${identity.userId}`}},error:null}))},
    rpc:vi.fn((_name:string,_args:unknown)=>{const promise=Promise.resolve(result);return Object.assign(promise,{setHeader:vi.fn((_name:string,_value:string)=>promise)})}),
    channel:vi.fn(()=>{const channel={on:(_event:string,filter:{table:string},callback:(payload:unknown)=>void)=>{callbacks.push({table:filter.table,callback});return channel},subscribe:()=>{}};return channel}),removeChannel:vi.fn(),
  };
  const legacy=vi.fn().mockResolvedValue(()=>{});const refresh=vi.fn();
  const binding=local?bridge.bindOfflineFleet({model:local,current:()=>true,visible:()=>true,legacy,refresh}):null;if(binding)cleanups.push(()=>binding.dispose());
  const exports={} as typeof import('./fleet-store');
  const require=(name:string)=>{
    if(name==='react')return {useEffect:(effect:()=>void)=>effect(),useSyncExternalStore:(_subscribe:unknown,getSnapshot:()=>unknown)=>getSnapshot()};
    if(name==='@/lib/supabase')return {supabase:client,isDemoActive:()=>false};
    if(name==='./app-resume')return {onAppResume:()=>()=>{},refreshOnRejoin:()=>()=>{}};
    if(name==='@/providers/session-provider')return {useSession:()=>({session:{user:{id:identity.userId}},access:{status:'ready',value:{kind:'member',company:{id:scope.companyId},user:{id:identity.userId,role:identity.role}}}})};
    if(name==='./offline-fleet-model')return {...bridge,subscribeOfflineFleet:(listener:()=>void)=>{const dispose=bridge.subscribeOfflineFleet(listener);cleanups.push(dispose);return dispose}};
    throw new Error(`Unexpected runtime dependency: ${name}`);
  };
  new Function('require','exports',javascript)(require,exports);
  const snapshot=()=>exports.useFleetVehicles(scope.companyId);
  const event=(version:number,data:unknown=raw)=>callbacks.findLast(item=>item.table==='fleet_vehicles')!.callback({eventType:'UPDATE',new:{record_id:raw.id,data,version}});
  return {api:exports,client,result,rows,mode,identity,binding,legacy,refresh,callbacks,snapshot,event};
}

describe('native fleet repository with scoped sync display layer',()=>{
  it('normalizes verified records and pending field overlays without mutating HTTP/server bases',async()=>{
    const f=setup(model([pending],'3',{...raw,unit:'Fresh unit'}));f.snapshot();await f.api.refreshFleet();
    expect(f.snapshot().vehicles[0]).toMatchObject({name:'Fresh unit',notes:'mine',source:{unit:'Fresh unit',notes:'mine'}});
    expect(f.snapshot().pendingDetails?.['vehicle:vehicle']).toContain('Saved on device');expect(f.rows.fleet_vehicles[0].data).toEqual(raw);
    expect(()=>f.api.fleetReadVersion(f.snapshot().vehicles[0],'vehicles')).toThrow('Unconfirmed');
  });
  it('uses legacy wire JSON for display without feeding undefined values into pending merges',async()=>{
    const f=setup(model([pending]));f.snapshot();await f.api.refreshFleet();
    f.event(2,{...raw,assignedTo:undefined,assignedFire:undefined});
    expect(f.snapshot().vehicles[0].source).toEqual({...raw,notes:'mine'});
  });
  it('restores raw cached reads during offline restart even if all HTTP cache queries fail',async()=>{
    const f=setup(model([pending]));f.mode.failed=true;f.snapshot();await f.api.refreshFleet();
    expect(f.snapshot()).toMatchObject({loading:false,error:null,vehicles:[{notes:'mine'}]});
  });
  it('blocks legacy writes from still-displayed pending snapshots before issuing an RPC',async()=>{
    const f=setup(model([pending]));f.snapshot();await f.api.refreshFleet();
    await expect(f.api.saveFleetRecord('vehicles',raw)).rejects.toThrow('must sync');expect(f.client.rpc).not.toHaveBeenCalled();
  });
  it('retains pending-read guards after review settles, until canonical data and online revisions agree',async()=>{
    const f=setup(model([pending]));f.snapshot();await f.api.refreshFleet();const old=f.snapshot().vehicles[0];
    const canonical={...raw,notes:'Manager choice'};f.binding!.publish(model([],'4',canonical));
    await expect(f.api.updateFleetVehicle(old,{status:'Out of service'},{id:'user',name:'Owner'} as never,{action:'Status',detail:'Change'})).rejects.toThrow('Unconfirmed');
    expect(()=>f.api.fleetReadVersion(f.snapshot().vehicles[0],'vehicles')).toThrow('Refresh');
    f.event(4,canonical);const current=f.snapshot().vehicles[0];expect(f.api.fleetReadVersion(current,'vehicles')).toBe(4);
    f.result.data=[{collection:'vehicles',event:'update',recordId:raw.id,version:5}];
    await f.api.updateFleetVehicle(current,{status:'Out of service'},{id:'user',name:'Owner'} as never,{action:'Status',detail:'Change'});
    expect(f.client.rpc.mock.calls[0][1]).toMatchObject({changes:[{expectedVersion:4,data:{notes:'Manager choice',status:'Out of service'}},expect.anything()]});
    expect(f.client.rpc.mock.results[0].value.setHeader).toHaveBeenCalledWith('Authorization','Bearer token-user');
  });
  it('uses captured form versions rather than a newer realtime token',async()=>{
    const f=setup();f.snapshot();await f.api.refreshFleet();f.event(4,{...raw,notes:'Other editor'});
    f.result.error={code:'PT409',message:'conflict'};
    await expect(f.api.saveFleetRecord('vehicles',{...raw,unit:'My unit'},{version:1,...scope})).rejects.toThrow('reopen the editor');
    expect(f.client.rpc.mock.calls[0][1]).toMatchObject({changes:[{expectedVersion:1}]});
  });
  it('clears same-company account snapshots and fences old realtime channels and captured forms',async()=>{
    const f=setup();f.snapshot();await f.api.refreshFleet();const old=f.snapshot().vehicles[0];const previous=f.callbacks[0].callback;
    f.identity.userId='other';f.rows.fleet_vehicles=[{record_id:raw.id,data:{...raw,notes:'Other account'},version:2}];
    f.snapshot();await f.api.refreshFleet();previous({eventType:'UPDATE',new:{record_id:raw.id,data:{...raw,notes:'late old response'},version:50}});
    expect(f.snapshot().vehicles[0].notes).toBe('Other account');
    await expect(f.api.saveFleetRecord('vehicles',raw,{version:1,...scope})).rejects.toThrow('account changed');
    expect(()=>f.api.fleetReadVersion(old,'vehicles')).toThrow('old-account');
  });
  it('rejects a replacement SDK identity before sending a legacy fleet RPC',async()=>{
    const f=setup();f.snapshot();await f.api.refreshFleet();
    f.client.auth.getSession.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'wrong-token'}},error:null});
    await expect(f.api.saveFleetRecord('vehicles',raw,{version:1,...scope})).rejects.toThrow('account changed');expect(f.client.rpc).not.toHaveBeenCalled();
  });
  it('does not confirm a failed vehicle update merely because that vehicle already exists',async()=>{
    const f=setup();f.snapshot();await f.api.refreshFleet();f.result.error={message:'Network request failed'};
    const before=f.client.from.mock.calls.length;
    await expect(f.api.saveFleetVehicleRecord(raw,{id:'user',name:'Owner'} as never,true,{version:1,...scope})).rejects.toThrow('Network request failed');
    expect(f.client.from.mock.calls.length).toBe(before);
  });
});
