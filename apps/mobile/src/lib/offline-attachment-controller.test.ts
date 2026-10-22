import {describe,expect,it,vi} from 'vitest';
import type {OfflineOutboxSession} from './offline-outbox';
import type {OfflineAttachmentVault} from './offline-attachment-vault';
import type {OfflineAttachment} from './offline-attachment-types';
import {createOfflineAttachmentController} from './offline-attachment-controller';
import {createAttachmentDraftActions,createVehicleDocumentActions,vehicleDocumentPickError} from './offline-attachment-actions';
const id='40000000-0000-4000-8000-000000000001';
const scope={userId:'20000000-0000-4000-8000-000000000001',companyId:'10000000-0000-4000-8000-000000000001'};
const asset:OfflineAttachment={...scope,attachmentId:id,entityType:'vehicle',entityId:'30000000-0000-4000-8000-000000000001',name:'file.png',mimeType:'image/png',byteSize:5,sha256:'a'.repeat(64),deviceId:'phone',savedAt:'2026-01-01T00:00:00Z',connectivity:'offline',state:'ready',error:null};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return {promise,resolve}}
function fixture(){
  const session={scope,listAttachments:vi.fn().mockResolvedValue([asset]),listAttachmentReferences:vi.fn().mockResolvedValue([{attachmentId:id,operationId:'operation'}]),listAttachmentUploads:vi.fn().mockResolvedValue([]),listAttachmentDocuments:vi.fn().mockResolvedValue([])};
  const vault={recover:vi.fn().mockResolvedValue(undefined),stage:vi.fn().mockResolvedValue(asset),repair:vi.fn().mockResolvedValue(asset),discard:vi.fn().mockResolvedValue(undefined),dispose:vi.fn()};const mode={allowed:true};
  const controller=createOfflineAttachmentController({session:session as unknown as OfflineOutboxSession,vault:vault as unknown as OfflineAttachmentVault,canAccess:()=>mode.allowed});return {controller,session,vault,mode};
}
describe('provider-owned attachment recovery controller',()=>{
  it('recovers before publishing availability and derives immutable-operation bindings',async()=>{
    const f=fixture();await f.controller.resume();expect(f.vault.recover).toHaveBeenCalledOnce();expect(f.controller.getSnapshot()).toMatchObject({checked:true,checking:false,items:[{attachmentId:id,operationIds:['operation']}]});expect(f.controller.scope).toEqual(scope);
  });
  it('clears private values on pause and ignores old recovery results',async()=>{
    const f=fixture();await f.controller.resume();const slow=deferred<void>();f.vault.recover.mockReturnValueOnce(slow.promise);const running=f.controller.recover();f.controller.pause();slow.resolve();await running;expect(f.controller.getSnapshot()).toMatchObject({items:[],checked:false,checking:false});
  });
  it('does not acknowledge stage before durable vault completion',async()=>{
    const f=fixture();await f.controller.resume();const slow=deferred<OfflineAttachment>();f.vault.stage.mockReturnValueOnce(slow.promise);let finished=false;
    const running=f.controller.stage({attachmentId:id,entityType:asset.entityType,entityId:asset.entityId,uri:'file:///picker',name:asset.name,mimeType:asset.mimeType}).then(()=>{finished=true});expect(f.controller.getSnapshot().busyId).toBe(id);expect(finished).toBe(false);slow.resolve(asset);await running;expect(finished).toBe(true);expect(f.controller.getSnapshot().checked).toBe(true);
  });
  it('rejects late action acknowledgment after account/role pause',async()=>{
    const f=fixture();await f.controller.resume();const slow=deferred<OfflineAttachment>();f.vault.repair.mockReturnValueOnce(slow.promise);const running=f.controller.repair(id,'file:///original');f.mode.allowed=false;f.controller.pause();slow.resolve(asset);await expect(running).rejects.toThrow('account changed');expect(f.controller.getSnapshot().items).toEqual([]);
  });
  it('surfaces failed cleanup without claiming manifest availability was verified',async()=>{
    const f=fixture();await f.controller.resume();f.vault.discard.mockRejectedValueOnce(new Error('Saved changes still reference this file.'));await expect(f.controller.discard(id)).rejects.toThrow('still reference');expect(f.controller.getSnapshot()).toMatchObject({checked:false,busyId:null,error:expect.stringContaining('still reference')});expect(f.controller.getSnapshot().items).toHaveLength(1);
  });
  it('does not read or act without current scope access and disposes the old vault',async()=>{
    const f=fixture();f.mode.allowed=false;await f.controller.resume();expect(f.vault.recover).not.toHaveBeenCalled();await expect(f.controller.discard(id)).rejects.toThrow('permissions changed');f.controller.stop();expect(f.vault.dispose).toHaveBeenCalledOnce();expect(f.controller.getSnapshot().items).toEqual([]);
  });
});
describe('attachment picker/confirmation epoch guards',()=>{
  it('does not restore a file selected after the account changed',async()=>{
    const f=fixture();let current=true;const pick=deferred<string|null>();const actions=createAttachmentDraftActions({controller:f.controller,isCurrent:()=>current,pickOriginal:()=>pick.promise,confirmDiscard:async()=>true});const running=actions.repair(id);current=false;pick.resolve('file:///other-account-selection');await running;expect(f.vault.repair).not.toHaveBeenCalled();
  });
  it('requires explicit confirmation and refuses late account-switched discard',async()=>{
    const f=fixture();await f.controller.resume();let current=true;const confirm=deferred<boolean>();const actions=createAttachmentDraftActions({controller:f.controller,isCurrent:()=>current,pickOriginal:async()=>null,confirmDiscard:()=>confirm.promise});const running=actions.discard(id);expect(f.vault.discard).not.toHaveBeenCalled();current=false;confirm.resolve(true);await running;expect(f.vault.discard).not.toHaveBeenCalled();
  });
  it('cancelled picker/confirmation never calls the vault',async()=>{
    const f=fixture();const actions=createAttachmentDraftActions({controller:f.controller,isCurrent:()=>true,pickOriginal:async()=>null,confirmDiscard:async()=>false});await actions.repair(id);await actions.discard(id);expect(f.vault.repair).not.toHaveBeenCalled();expect(f.vault.discard).not.toHaveBeenCalled();
  });
});
describe('vehicle document actions',()=>{
  const input={attachmentId:id,requestId:'60000000-0000-4000-8000-000000000001',entityId:asset.entityId,uri:'file:///picker',name:asset.name,mimeType:asset.mimeType,documentName:'Registration'};
  function withDocuments(){
    const f=fixture();const session=f.session as typeof f.session & {requestAttachmentDocument:ReturnType<typeof vi.fn>};session.requestAttachmentDocument=vi.fn().mockResolvedValue({attachmentId:id});
    const documents={run:vi.fn().mockResolvedValue([{attachmentId:id,stage:'applied'}])};const changed=vi.fn();
    const controller=createOfflineAttachmentController({session:session as unknown as OfflineOutboxSession,vault:f.vault as unknown as OfflineAttachmentVault,canAccess:()=>f.mode.allowed,documents:documents as never,changed});
    return {...f,session,controller,documents,changed};
  }
  it('stages bytes then saves the intent with the staged provenance',async()=>{
    const f=withDocuments();await f.controller.resume();await f.controller.saveVehicleDocument(input);
    expect(f.vault.stage).toHaveBeenCalledWith({attachmentId:id,entityType:'vehicle',entityId:asset.entityId,uri:'file:///picker',name:asset.name,mimeType:asset.mimeType});
    expect(f.session.requestAttachmentDocument).toHaveBeenCalledWith(id,{requestId:input.requestId,documentName:'Registration',savedAt:asset.savedAt,connectivity:'offline'});
    await expect(fixture().controller.saveVehicleDocument(input)).rejects.toThrow(/unavailable/);
  });
  it('syncs saved documents, refreshes rows and reports applied changes; late results after pause are ignored',async()=>{
    const f=withDocuments();await f.controller.resume();await f.controller.sync(new AbortController().signal);expect(f.documents.run).toHaveBeenCalledOnce();expect(f.changed).toHaveBeenCalledOnce();expect(f.controller.getSnapshot().syncing).toBe(false);
    const slow=deferred<unknown[]>();f.documents.run.mockReturnValueOnce(slow.promise);const running=f.controller.sync(new AbortController().signal);f.controller.pause();slow.resolve([{stage:'applied'}]);await running;expect(f.changed).toHaveBeenCalledOnce();expect(f.controller.getSnapshot().items).toEqual([]);
  });
});
describe('vehicle document picker actions',()=>{
  const pdf={uri:'file:///picked.pdf',name:'Registration.pdf',mimeType:'application/pdf',size:1000};
  it('preflights declared type and size without trusting them as content validation',()=>{
    expect(vehicleDocumentPickError(pdf)).toBeNull();expect(vehicleDocumentPickError({...pdf,size:null})).toBeNull();
    expect(vehicleDocumentPickError({...pdf,mimeType:'text/html'})).toMatch(/JPEG/);expect(vehicleDocumentPickError({...pdf,mimeType:null})).toMatch(/JPEG/);expect(vehicleDocumentPickError({...pdf,size:10*1024*1024+1})).toMatch(/10 MB/);
  });
  it('reuses the same attachment/request IDs when a save is retried',async()=>{
    const controller={saveVehicleDocument:vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue({})};let n=0;
    const actions=createVehicleDocumentActions({controller,isCurrent:()=>true,pick:async()=>pdf,createId:()=>`id-${++n}`});
    await expect(actions.save('vehicle','Doc')).rejects.toThrow(/Choose a file/);await actions.choose();
    await expect(actions.save('vehicle','Registration')).rejects.toThrow('disk full');expect(await actions.save('vehicle','Registration')).toBe(true);
    expect(controller.saveVehicleDocument.mock.calls[0][0]).toEqual(controller.saveVehicleDocument.mock.calls[1][0]);expect(controller.saveVehicleDocument.mock.calls[0][0]).toMatchObject({attachmentId:'id-1',requestId:'id-2',entityId:'vehicle',uri:pdf.uri,mimeType:'application/pdf'});
  });
  it('ignores picker results after a route/account change and rejects unsupported files',async()=>{
    const controller={saveVehicleDocument:vi.fn()};const live={value:true};
    const actions=createVehicleDocumentActions({controller,isCurrent:()=>live.value,pick:async()=>{live.value=false;return pdf},createId:()=>'id'});
    expect(await actions.choose()).toBeNull();await expect(actions.save('vehicle','x')).rejects.toThrow(/Choose a file/);
    const other=createVehicleDocumentActions({controller,isCurrent:()=>true,pick:async()=>({...pdf,mimeType:'application/zip'}),createId:()=>'id'});await expect(other.choose()).rejects.toThrow(/JPEG/);expect(controller.saveVehicleDocument).not.toHaveBeenCalled();
  });
});
