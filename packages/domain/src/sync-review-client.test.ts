import {describe,expect,it,vi} from 'vitest';
import {createSyncReviewClient,decodeFleetSyncReview,isSyncReviewUnavailable,syncReviewCanApprove,syncReviewLocked,syncReviewSetupMessage,syncReviewValueText} from './sync-review-client';
import {decisionFixture,reviewCandidate,reviewCompany,reviewEntity,reviewFixture,reviewUser} from '../test-fixtures/sync-review';

const target={entityType:'vehicle' as const,entityId:reviewEntity};
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function setup(){
  const transport={list:vi.fn().mockResolvedValue([]),review:vi.fn().mockResolvedValue(reviewFixture()),approve:vi.fn().mockResolvedValue(decisionFixture())};
  const id=vi.fn(()=> 'request-1');
  const client=createSyncReviewClient({companyId:reviewCompany,userId:reviewUser},transport,id);client.start();
  return {client,transport,id};
}
async function ready(){const fixture=setup();await fixture.client.openReview(target);return fixture}
const alert=(id='conflict-1',record=reviewEntity)=>({id,company_id:reviewCompany,entity_type:'vehicle',record_id:record,received_at:'2026-01-01T12:00:00Z'});

describe('scoped online conflict review controller',()=>{
  it('does not call backend services for disabled/demo/nonmanager scopes',async()=>{
    const transport={list:vi.fn(),review:vi.fn(),approve:vi.fn()};const client=createSyncReviewClient(null,transport,()=> 'id');client.start();
    await client.openReview(target);await client.approve();await client.refreshGroups();
    expect(client.getSnapshot().status).toBe('disabled');expect(transport.list).not.toHaveBeenCalled();expect(transport.review).not.toHaveBeenCalled();expect(transport.approve).not.toHaveBeenCalled();
  });
  it('groups all pending candidates by record and paginates rather than silently truncating',async()=>{
    const {client,transport}=setup();
    transport.list.mockImplementation(async(_company,offset)=>offset===0?Array.from({length:200},(_,index)=>alert(`candidate-${index}`)):[alert('last'),alert('other','other-record')]);
    await client.refreshGroups();
    expect(client.getSnapshot().groups).toMatchObject([{entityId:reviewEntity,count:201},{entityId:'other-record',count:1}]);
    expect(transport.list).toHaveBeenCalledWith(reviewCompany,200,200);
  });
  it('handles missing tables/RPCs as setup pending without masking real permission errors',async()=>{
    const {client,transport}=setup();transport.list.mockRejectedValue({code:'PGRST205'});await client.refreshGroups();
    expect(client.getSnapshot()).toMatchObject({status:'unavailable',groups:[],listError:syncReviewSetupMessage});
    transport.list.mockRejectedValue({code:'42501'});await client.refreshGroups();expect(client.getSnapshot().status).toBe('error');
    transport.review.mockRejectedValue({code:'PGRST202'});await client.openReview(target);expect(client.getSnapshot().reviewError).toBe(syncReviewSetupMessage);
    expect(isSyncReviewUnavailable({code:'42501'})).toBe(false);
  });
  it('treats pending conflicts as persistent alerts, not read notifications',async()=>{
    const {client,transport}=setup();transport.list.mockResolvedValue([alert()]);await client.refreshGroups();await client.openReview(target);
    expect(client.getSnapshot().groups).toHaveLength(1);client.closeReview();expect(client.getSnapshot().groups).toHaveLength(1);expect(transport.approve).not.toHaveBeenCalled();
  });
  it('refuses alert data from another company and ignores duplicates from moving pages',async()=>{
    const {client,transport}=setup();transport.list.mockResolvedValue([alert(),alert()]);await client.refreshGroups();expect(client.getSnapshot().groups[0].count).toBe(1);
    transport.list.mockResolvedValue([{...alert(),company_id:'other-company'}]);await client.refreshGroups();expect(client.getSnapshot()).toMatchObject({groups:[],status:'error'});
  });
  it('ignores responses after scope disposal and out-of-order review loads',async()=>{
    const {client,transport}=setup();const old=deferred<unknown>();transport.review.mockReturnValueOnce(old.promise);
    const pending=client.openReview(target);await client.openReview(target);old.resolve({...reviewFixture(),reviewToken:'obsolete'});await pending;
    expect(client.getSnapshot().review?.reviewToken).toBe('review-token');
    const late=deferred<unknown>();transport.review.mockReturnValueOnce(late.promise);const leaving=client.openReview(target);client.stop();late.resolve(reviewFixture());await leaving;
    expect(client.getSnapshot().review).toBeNull();
  });
  it('requires an offered selection for every field and never submits author IDs',async()=>{
    const {client,transport,id}=await ready();expect(syncReviewCanApprove(client.getSnapshot())).toBe(false);await client.approve();expect(transport.approve).not.toHaveBeenCalled();
    client.choose('notes','not-offered');client.choose('toString','current');expect(client.getSnapshot().choices).toEqual({});
    client.choose('notes',reviewCandidate);expect(syncReviewCanApprove(client.getSnapshot())).toBe(true);await client.approve();
    expect(id).toHaveBeenCalledTimes(1);expect(transport.approve.mock.calls[0][0]).toEqual({requestId:'request-1',companyId:reviewCompany,entityType:'vehicle',entityId:reviewEntity,reviewToken:'review-token',choices:{notes:reviewCandidate}});
    expect(client.getSnapshot().decision?.kind).toBe('resolved');
  });
  it('freezes edits/back/refresh during uncertain approval and retries the identical request ID',async()=>{
    const {client,transport,id}=await ready();client.choose('notes',reviewCandidate);transport.approve.mockRejectedValueOnce(new Error('Response lost'));
    await client.approve();const first=transport.approve.mock.calls[0][0];expect(client.getSnapshot().approval).toBe('uncertain');expect(syncReviewLocked(client.getSnapshot())).toBe(true);
    client.choose('notes','current');expect(client.getSnapshot().choices.notes).toBe(reviewCandidate);expect(client.closeReview()).toBe(false);
    await client.openReview(target);expect(transport.review).toHaveBeenCalledTimes(1);await client.approve();
    expect(transport.approve.mock.calls[1][0]).toEqual(first);expect(id).toHaveBeenCalledTimes(1);expect(client.getSnapshot().decision).not.toBeNull();
  });
  it('does not send two approvals for double clicks and can resume confirmation after lifecycle pause',async()=>{
    const {client,transport,id}=await ready();const response=deferred<unknown>();transport.approve.mockReturnValueOnce(response.promise);client.choose('notes',reviewCandidate);
    const pending=client.approve();await client.approve();expect(transport.approve).toHaveBeenCalledTimes(1);
    client.stop();client.start();expect(client.getSnapshot().approval).toBe('uncertain');response.resolve(decisionFixture());await pending;
    expect(client.getSnapshot().decision).toBeNull();await client.approve();expect(id).toHaveBeenCalledTimes(1);expect(client.getSnapshot().decision).not.toBeNull();
  });
  it('clears stale choices and requires a new review after a competing change',async()=>{
    const {client,transport}=await ready();client.choose('notes',reviewCandidate);transport.approve.mockRejectedValueOnce({code:'PT409'});await client.approve();
    expect(client.getSnapshot()).toMatchObject({review:null,choices:{},approval:'idle'});expect(client.getSnapshot().reviewError).toMatch(/Refresh/);expect(syncReviewCanApprove(client.getSnapshot())).toBe(false);
    await client.openReview(target);expect(client.getSnapshot().choices).toEqual({});
  });
  it('knows that initial permission/validation/offline failures did not approve, but preserves already uncertain requests',async()=>{
    const {client,transport,id}=await ready();client.choose('notes',reviewCandidate);transport.approve.mockRejectedValueOnce({code:'OFFLINE'});await client.approve();
    expect(client.getSnapshot()).toMatchObject({approval:'idle',review:null});
    await client.openReview(target);client.choose('notes',reviewCandidate);transport.approve.mockRejectedValueOnce(new Error('Lost response'));await client.approve();
    transport.approve.mockRejectedValueOnce({code:'OFFLINE'});await client.approve();expect(client.getSnapshot().approval).toBe('uncertain');expect(id).toHaveBeenCalledTimes(2);
  });
  it('does not treat a malformed or unrelated success receipt as confirmed approval',async()=>{
    const {client,transport}=await ready();client.choose('notes',reviewCandidate);transport.approve.mockResolvedValueOnce({...decisionFixture(),outcomes:[]});await client.approve();
    expect(client.getSnapshot()).toMatchObject({approval:'uncertain',decision:null});await client.approve();expect(client.getSnapshot().decision).not.toBeNull();
  });
  it('rejects broken review scope, missing fields, option values and author metadata before rendering',()=>{
    const original=reviewFixture();expect(decodeFleetSyncReview(original,reviewCompany,target)).toEqual(original);
    const variants=[{...original,companyId:'other'}, {...original,currentRecord:{...original.currentRecord,id:'other'}}, {...original,fields:{}},
      {...original,fields:{notes:{...original.fields.notes,options:[{...original.fields.notes.options[0],value:{present:true,value:'Forged'}}]}}},
      {...original,candidates:[{...original.candidates[0],provenance:{...original.candidates[0].provenance,connectivity:'maybe'}}]}];
    for(const value of variants)expect(()=>decodeFleetSyncReview(value,reviewCompany,target)).toThrow();
  });
  it('copies account/company scope and discards reviews closed before their response arrives',async()=>{
    const scope={companyId:reviewCompany,userId:reviewUser};const response=deferred<unknown>();
    const transport={list:vi.fn().mockResolvedValue([]),review:vi.fn(()=>response.promise),approve:vi.fn()};
    const client=createSyncReviewClient(scope,transport,()=> 'request');scope.companyId='mutated';client.start();
    const loading=client.openReview(target);expect(client.closeReview()).toBe(true);response.resolve(reviewFixture());await loading;
    expect(transport.review).toHaveBeenCalledWith(reviewCompany,target);expect(client.getSnapshot()).toMatchObject({target:null,review:null});
  });
  it('asks for a client update rather than displaying unsupported field workflows',async()=>{
    const {client,transport}=setup();const review=reviewFixture();transport.review.mockResolvedValue({...review,fields:{status:review.fields.notes}});await client.openReview(target);
    expect(client.getSnapshot().review).toBeNull();expect(client.getSnapshot().reviewError).toContain('newer app version');
  });
  it('uses distinct labels for absence, null, empty text, false and zero',()=>{
    expect(syncReviewValueText({present:false})).toMatch(/removed/);expect(syncReviewValueText({present:true,value:null})).toMatch(/null/);
    expect(syncReviewValueText({present:true,value:''})).toBe('Empty text');expect(syncReviewValueText({present:true,value:false})).toBe('false');expect(syncReviewValueText({present:true,value:0})).toBe('0');
  });
});
describe('vehicle file review text',()=>{
  it('labels slots and shows files by name, type and storage path',async()=>{
    const {syncReviewFieldLabel,syncReviewValueText,syncReviewFileText}=await import('./sync-review-client');
    expect(syncReviewFieldLabel('dotInspection')).toBe('DOT inspection');
    const text=syncReviewValueText({present:true,value:{name:'Front.jpg',type:'image/jpeg',dataUrl:'',path:'c/u/sync-a'}});
    expect(text).toContain('File: Front.jpg (image/jpeg)');expect(text).toContain('Stored at: c/u/sync-a');expect(text).toContain('verified by the server');
    expect(syncReviewFileText({name:'x'})).toBeNull();expect(syncReviewValueText({present:false})).toBe('Not set (removed)');
  });
});
