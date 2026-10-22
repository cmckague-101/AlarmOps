import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {SyncOperation} from '@fireops/domain';
import {createNativeSyncTransport} from './offline-sync-transport';
const scope={userId:'user-1',companyId:'company-1'};
const operation:SyncOperation={schemaVersion:1,operationId:'op-1',companyId:scope.companyId,entityType:'vehicle',entityId:'vehicle-1',provenance:{userId:scope.userId,deviceId:'device',savedAt:'2026-01-01T00:00:00Z',connectivity:'offline'},dependsOn:[],mutation:{kind:'update',baseRevision:'1',base:{id:'vehicle-1'},patch:{notes:{present:true,value:'Note'}}}};
function setup(){
  const builder={setHeader:vi.fn().mockReturnThis(),abortSignal:vi.fn().mockResolvedValue({data:{ok:true},error:null})};
  const client={auth:{getSession:vi.fn().mockResolvedValue({data:{session:{user:{id:scope.userId},access_token:'bound-user-token'}},error:null})},rpc:vi.fn(()=>builder)};
  const mode={ready:true};const transport=createNativeSyncTransport(client as unknown as SupabaseClient,scope,()=>mode.ready);
  return {builder,client,mode,transport,signal:new AbortController().signal};
}
describe('authenticated native sync RPC transport',()=>{
  it('uses RPCs (not cacheable GETs), the correct scope, an explicit user token and abort signal',async()=>{
    const f=setup();await f.transport.deliver(operation,f.signal);await f.transport.canonical(operation,f.signal);await f.transport.outcome(operation,f.signal);await f.transport.readRecord({entityType:'vehicle',entityId:'vehicle-1'},f.signal);
    expect(f.client.rpc).toHaveBeenCalledWith('sync_fleet_update',{operation});
    expect(f.client.rpc).toHaveBeenCalledWith('get_fleet_sync_record',{target_company_id:scope.companyId,entity_type:'vehicle',record_id:'vehicle-1'});
    expect(f.client.rpc).toHaveBeenCalledWith('get_fleet_sync_outcome',{target_company_id:scope.companyId,operation_id:'op-1'});
    expect(f.builder.setHeader).toHaveBeenCalledWith('Authorization','Bearer bound-user-token');expect(f.builder.abortSignal).toHaveBeenCalledWith(f.signal);
  });
  it('sends device history with the atomic RPC and never falls back when its migration is missing',async()=>{
    const f=setup();const history=[{before:operation,after:operation,reason:'automatic_independent',createdAt:'2026-01-01T00:01:00Z'}];const error={code:'PGRST202',message:'Missing history function'};
    f.builder.abortSignal.mockResolvedValue({data:null,error});await expect(f.transport.deliver(operation,f.signal,history)).rejects.toBe(error);
    expect(f.client.rpc).toHaveBeenCalledExactlyOnceWith('sync_fleet_update_with_history',{operation,device_history:history});expect(f.builder.setHeader).toHaveBeenCalledWith('Authorization','Bearer bound-user-token');
  });
  it('uses recovery-only RPC without falling back to business delivery',async()=>{
    const f=setup();const history=[{before:operation,after:operation,reason:'automatic_independent',createdAt:'2026-01-01T00:01:00Z'}];const error={code:'55000',message:'Original submission unavailable'};
    f.builder.abortSignal.mockResolvedValue({data:null,error});await expect(f.transport.backfillHistory!(operation,f.signal,history)).rejects.toBe(error);
    expect(f.client.rpc).toHaveBeenCalledExactlyOnceWith('backfill_fleet_sync_device_history',{operation,device_history:history});expect(f.builder.setHeader).toHaveBeenCalledWith('Authorization','Bearer bound-user-token');
  });
  it('rejects other users/companies before issuing an RPC',async()=>{
    const f=setup();for(const foreign of [{...operation,companyId:'other'},{...operation,provenance:{...operation.provenance,userId:'other'}}]){
      for(const method of [f.transport.deliver,f.transport.canonical,f.transport.outcome])await expect(Promise.resolve().then(()=>method(foreign,f.signal))).rejects.toMatchObject({code:'42501'});
    }
    expect(f.client.rpc).not.toHaveBeenCalled();
  });
  it('does not send when the restored SDK session belongs to another account',async()=>{
    const f=setup();f.client.auth.getSession.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'wrong'}},error:null});
    await expect(f.transport.deliver(operation,f.signal)).rejects.toMatchObject({code:'401'});
    await expect(f.transport.readRecord(operation,f.signal)).rejects.toMatchObject({code:'401'});expect(f.client.rpc).not.toHaveBeenCalled();
  });
  it('checks pause/abort again after asynchronous session restoration',async()=>{
    const f=setup();f.client.auth.getSession.mockImplementation(async()=>{f.mode.ready=false;return {data:{session:{user:{id:scope.userId},access_token:'bound'}},error:null}});
    await expect(f.transport.deliver(operation,f.signal)).rejects.toMatchObject({code:'SYNC_PAUSED'});expect(f.client.rpc).not.toHaveBeenCalled();
    const aborted=new AbortController();aborted.abort();await expect(f.transport.canonical(operation,aborted.signal)).rejects.toMatchObject({code:'SYNC_PAUSED'});
  });
  it('preserves structured permission/setup errors for the worker',async()=>{
    const f=setup();const error={code:'PGRST202',message:'Missing function'};f.builder.abortSignal.mockResolvedValue({data:null,error});
    await expect(f.transport.canonical(operation,f.signal)).rejects.toBe(error);
  });
});
