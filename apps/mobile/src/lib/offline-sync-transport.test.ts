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
  it('uses account-bound POST inventory pages without HTTP-cache fallback',async()=>{
    const f=setup();const progress={snapshotToken:'a'.repeat(64),cursor:{entityType:'vehicle' as const,entityId:'30000000-0000-4000-8000-000000000001'}};
    await f.transport.downloadPage!(progress,f.signal);expect(f.client.rpc).toHaveBeenCalledExactlyOnceWith('download_fleet_sync_page',{target_company_id:scope.companyId,expected_snapshot:progress.snapshotToken,record_cursor:progress.cursor});expect(f.builder.setHeader).toHaveBeenCalledWith('Authorization','Bearer bound-user-token');
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
  it('routes new issue reports to the create endpoint',async()=>{
    const f=setup();const create:SyncOperation={...operation,entityType:'issue',mutation:{kind:'create',record:{id:'vehicle-1'}}};
    await f.transport.deliver(create,f.signal);expect(f.client.rpc).toHaveBeenCalledWith('sync_fleet_create',{operation:create});
  });
  it('uploads a kept receipt file into the caller folder before creating the receipt, then removes the device copy',async()=>{
    const f=setup();const files={read:vi.fn().mockResolvedValue(new ArrayBuffer(4)),remove:vi.fn(),keep:vi.fn(),uri:vi.fn()};
    const upload=vi.fn().mockResolvedValue({data:{},error:null});const storage={from:vi.fn(()=>({upload}))};
    const transport=createNativeSyncTransport({...f.client,storage} as unknown as SupabaseClient,scope,()=>f.mode.ready,files);
    const receipt:SyncOperation={...operation,entityType:'receipt',entityId:'receipt-1',mutation:{kind:'command',command:'receipt.create',payload:{name:'Fuel',amountCents:100,fileName:'a.jpg',mimeType:'image/jpeg',byteSize:4}}};
    f.builder.abortSignal.mockResolvedValue({data:{kind:'applied',revision:'1',record:{id:'receipt-1'}},error:null});
    await transport.deliver(receipt,f.signal);
    expect(storage.from).toHaveBeenCalledWith('receipt-files');expect(upload).toHaveBeenCalledWith('company-1/user-1/sync-receipt-1',expect.any(ArrayBuffer),{contentType:'image/jpeg',upsert:false});
    expect(f.client.rpc).toHaveBeenCalledWith('sync_user_command',{operation:receipt});expect(upload.mock.invocationCallOrder[0]).toBeLessThan(f.client.rpc.mock.invocationCallOrder[0]);
    expect(files.remove).toHaveBeenCalledWith('receipt-1');
    // A lost upload response retries as "already exists"; a refused receipt keeps its file.
    upload.mockResolvedValue({data:null,error:{message:'The resource already exists',statusCode:'409'}});files.remove.mockClear();
    f.builder.abortSignal.mockResolvedValue({data:{kind:'applied',revision:'2',record:null,notApplied:'file_mismatch'},error:null});
    await transport.deliver(receipt,f.signal);expect(files.remove).not.toHaveBeenCalled();
    // Other upload failures stop before the command.
    upload.mockResolvedValue({data:null,error:{message:'Network request failed'}});const calls=f.client.rpc.mock.calls.length;
    await expect(transport.deliver(receipt,f.signal)).rejects.toMatchObject({message:'Network request failed'});expect(f.client.rpc.mock.calls.length).toBe(calls);
    // Without a device copy (already removed), only the command is sent.
    files.read.mockResolvedValue(null);upload.mockClear();f.builder.abortSignal.mockResolvedValue({data:{kind:'applied',revision:'1',record:{id:'receipt-1'}},error:null});
    await transport.deliver(receipt,f.signal);expect(upload).not.toHaveBeenCalled();
  });
});
