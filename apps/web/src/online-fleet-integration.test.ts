import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';
import {normalizeVehicles,type FleetSnapshot,type Vehicle} from '@fireops/domain';
import {snapshotFilePaths,stripSignedFileUrls} from './FleetApp';
import {createOnlineFleetWrites,fleetRecordsEqual,type OnlineFleetResult,type PreparedFleetWrite} from './online-fleet-writes';

// Execute production callbacks with injected dependencies, not a mounted app or a web server.
const source=readFileSync(new URL('./FleetApp.tsx',import.meta.url),'utf8');
function callback(start:string,end:string,env:Record<string,unknown>,name:string){
  const chunk=source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
  const js=ts.transpileModule(chunk,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function(...Object.keys(env),`${js}\nreturn ${name};`)(...Object.values(env));
}
const vehicle=(id='vehicle'):Vehicle=>({id,unit:'E1',type:'Engine',year:2024,make:'Ford',model:'F',vin:'',plate:'',status:'Ready',notes:'Base',createdAt:'2026-01-01',photo:{name:'Old photo',type:'image/jpeg',dataUrl:'signed-old',path:'company/old'}});
const empty=():FleetSnapshot=>({vehicles:[],issues:[],crew:[],activities:[]});
function setup(){
  const before={...empty(),vehicles:[vehicle()]};const after={...before,vehicles:[{...before.vehicles[0],notes:'My edit',photo:{name:'New photo',type:'image/jpeg',dataUrl:'signed-new',path:'company/new'}}]};
  const writeModel=createOnlineFleetWrites({companyId:'company',userId:'user',wire:stripSignedFileUrls,id:()=> 'operation'});writeModel.issue('vehicles',before.vehicles[0],1);
  const persisted={current:stripSignedFileUrls(before)};const versions={current:{vehicles:new Map([['vehicle',1]]),issues:new Map(),crew:new Map(),activities:new Map()}};
  const deletedVersions={current:new Map<string,number>()};const remoteSequence={current:0};let remote:unknown[]=[];
  const setRemoteChanges=(update:(current:unknown[])=>unknown[])=>{remote=update(remote)};
  const patchPersisted=callback('  const patchPersisted=','  useEffect(()=>{\n    const client=supabase;',{
    useCallback:(fn:unknown)=>fn,versions,deletedVersions,persisted,writeModel,fleetRecordsEqual,
  },'patchPersisted') as (collection:keyof FleetSnapshot,event:'upsert'|'delete',id:string,record?:unknown,version?:number)=>boolean;
  const deliver=vi.fn(async(request:PreparedFleetWrite)=>request.changes.map(change=>({collection:change.collection,event:change.event,recordId:change.recordId,version:change.event==='delete'?change.expectedVersion!:(change.expectedVersion??0)+1})));
  const workspaceActive={current:true};const saveEpoch={current:0};const cleanupQueue={current:new Set<string>()};
  const pendingUploads={current:new Set(['company/new','company/other-editor'])};const committedUploads={current:new Set<string>()};const deleteFiles=vi.fn().mockResolvedValue(undefined);
  const save=callback('  const save=useCallback(async(data:FleetSnapshot,before:FleetSnapshot)=>','  const inviteCrew=useCallback(',{
    useCallback:(fn:unknown)=>fn,deliver,workspaceActive,saveEpoch,writeModel,patchPersisted,persisted,remoteSequence,setRemoteChanges,snapshotFilePaths,cleanupQueue,pendingUploads,committedUploads,deleteFiles,
  },'save') as (after:FleetSnapshot,before:FleetSnapshot)=>Promise<void>;
  return {save,before,after,writeModel,deliver,persisted,versions,deletedVersions,patchPersisted,workspaceActive,saveEpoch,pendingUploads,deleteFiles,remote:()=>remote,
    handler(hydrateFileUrls:(snapshot:FleetSnapshot)=>Promise<FleetSnapshot>){
      return callback('    const handleChange=async(','    let channel=client.channel(',{
        active:true,fleetEventSequence:0,patchPersisted,versions,deletedVersions,emptySnapshot:empty,hydrateFileUrls,normalizeVehicles,writeModel,remoteSequence,setRemoteChanges,
      },'({handleChange,setActive:(value)=>{active=value}})') as {handleChange:(collection:keyof FleetSnapshot,payload:unknown)=>Promise<void>;setActive:(value:boolean)=>void};
    },
  };
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return {promise,resolve}}

describe('production online workspace callbacks',()=>{
  it('uses captured reads and acknowledges before cleanup, retaining another editor’s uploads',async()=>{
    const f=setup();await f.save(f.after,f.before);
    expect(f.deliver.mock.calls[0][0].changes[0]).toMatchObject({event:'update',expectedVersion:1,data:{notes:'My edit',photo:{dataUrl:''}}});
    expect(f.deleteFiles).toHaveBeenCalledWith(['company/old']);expect(f.pendingUploads.current.has('company/other-editor')).toBe(true);
    expect(f.remote()).toMatchObject([{event:'upsert',record:{notes:'My edit'}}]);
    const next={...f.after,vehicles:[{...f.after.vehicles[0],notes:'Next explicit edit'}]};expect(f.writeModel.prepare(next,f.after).changes[0].expectedVersion).toBe(2);
  });
  it('preserves newer canonical rows that arrive before an older save acknowledgment',async()=>{
    const f=setup();const response=deferred<OnlineFleetResult[]>();f.deliver.mockReturnValue(response.promise);const saving=f.save(f.after,f.before);
    const current={...vehicle(),notes:'Mobile sync after my write'};f.patchPersisted('vehicles','upsert','vehicle',current,3);
    response.resolve([{collection:'vehicles',event:'update',recordId:'vehicle',version:2}]);await saving;
    expect(f.persisted.current.vehicles[0].notes).toBe('Mobile sync after my write');expect(f.remote()).toEqual([]);
  });
  it('neither deletes unseen remote inserts nor cleans files still referenced by them',async()=>{
    const f=setup();f.patchPersisted('vehicles','upsert','new-remote',vehicle('new-remote'),1);await f.save(f.after,f.before);
    expect(f.deliver.mock.calls[0][0].changes.map(change=>change.recordId)).toEqual(['vehicle']);
    expect(f.persisted.current.vehicles.some(row=>row.id==='new-remote')).toBe(true);expect(f.deleteFiles).not.toHaveBeenCalled();
  });
  it('leaves local state and file ownership intact for incomplete/failed acknowledgments',async()=>{
    const f=setup();f.deliver.mockResolvedValue([]);await expect(f.save(f.after,f.before)).rejects.toThrow('acknowledgment');
    expect(f.persisted.current.vehicles[0].notes).toBe('Base');expect(f.deleteFiles).not.toHaveBeenCalled();expect(f.pendingUploads.current.has('company/new')).toBe(true);
  });
  it('fences late save responses after account/workspace invalidation',async()=>{
    const f=setup();const response=deferred<OnlineFleetResult[]>();f.deliver.mockReturnValue(response.promise);const saving=f.save(f.after,f.before);f.saveEpoch.current++;
    response.resolve([{collection:'vehicles',event:'update',recordId:'vehicle',version:2}]);await expect(saving).rejects.toThrow('workspace changed');
    expect(f.persisted.current.vehicles[0].notes).toBe('Base');expect(f.remote()).toEqual([]);expect(f.deleteFiles).not.toHaveBeenCalled();
  });
  it('publishes same-user device writes rather than hiding mobile sync as a local echo',async()=>{
    const f=setup();const handler=f.handler(async value=>structuredClone(value));const updated={...vehicle(),notes:'My phone saved this'};
    await handler.handleChange('vehicles',{eventType:'UPDATE',new:{record_id:'vehicle',data:updated,version:2,updated_by:'user'},old:{}});
    expect(f.remote()).toMatchObject([{event:'upsert',record:{notes:'My phone saved this'}}]);
    const view=(f.remote()[0] as {record:Vehicle}).record;const base={...empty(),vehicles:[view]};
    expect(f.writeModel.prepare({...base,vehicles:[{...view,unit:'Typed unit'}]},base).changes[0].expectedVersion).toBe(2);
  });
  it('ignores old hydration responses after deletion and after workspace cleanup',async()=>{
    const f=setup();const hydrated=deferred<FleetSnapshot>();const handler=f.handler(()=>hydrated.promise);
    const update=handler.handleChange('vehicles',{eventType:'UPDATE',new:{record_id:'vehicle',data:vehicle(),version:2,updated_by:'other'},old:{}});
    await handler.handleChange('vehicles',{eventType:'DELETE',old:{record_id:'vehicle',version:2},new:{}});
    hydrated.resolve({...empty(),vehicles:[vehicle()]});await update;expect(f.remote()).toMatchObject([{event:'delete',id:'vehicle'}]);
    handler.setActive(false);await handler.handleChange('vehicles',{eventType:'UPDATE',new:{record_id:'vehicle',data:vehicle(),version:10},old:{}});
    expect(f.persisted.current.vehicles).toEqual([]);
  });
  it('never stamps an old crew object with a newer role-only receipt',async()=>{
    const patchPersisted=vi.fn();const role=callback('  const updateCrewRole=useCallback(','  const updateCrewDetails=useCallback(',{
      useCallback:(fn:unknown)=>fn,supabase:{},requestCrewRoleUpdate:async()=>({role:'admin',version:2}),companyId:'company',patchPersisted,
    },'updateCrewRole') as (member:unknown,role:string)=>Promise<unknown>;
    expect(await role({id:'crew',name:'Old name',role:'shop_tech'},'admin')).toEqual({id:'crew',name:'Old name',role:'admin'});expect(patchPersisted).not.toHaveBeenCalled();
  });
});
