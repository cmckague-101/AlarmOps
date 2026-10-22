import {describe,expect,it,vi} from 'vitest';
import {createDeviceHistoryClient,decodeDeviceHistoryReport,deviceHistoryFields,deviceHistoryValueText} from './sync-device-history';
import {createSyncReviewClient} from './sync-review-client';
import {historyReport,historySummary,historyTarget} from '../test-fixtures/sync-device-history';
import {reviewCompany,reviewUser,reviewFixture} from '../test-fixtures/sync-review';
const scope={companyId:reviewCompany,userId:reviewUser};
function setup(){const transport={list:vi.fn().mockResolvedValue({items:[historySummary()],nextCursor:null}),report:vi.fn().mockResolvedValue(historyReport())};const client=createDeviceHistoryClient(scope,transport);client.start();client.target(historyTarget);return {client,transport}}
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise(yes=>{resolve=yes});return {promise,resolve}}
describe('online-only scoped device history',()=>{
  it('shows original/local/downloaded/submitted values without interpreting device choices as shared outcomes',async()=>{
    const f=setup();await f.client.list();await f.client.inspect(f.client.getSnapshot().items[0]);const report=f.client.getSnapshot().report!;
    expect(deviceHistoryFields(report.deviceHistory[0])).toEqual([{field:'notes',choice:'current',before:{present:true,value:'Local parent view'},saved:{present:true,value:'Discarded saved value'},downloaded:{present:true,value:'Downloaded value'},submitted:{present:true,value:'Downloaded value'}}]);
  });
  it('distinguishes absent, null, empty text and numeric/string values',()=>{
    expect(deviceHistoryValueText({present:false})).toBe('Not present');expect(deviceHistoryValueText({present:true,value:null})).toBe('Null');expect(deviceHistoryValueText({present:true,value:''})).toBe('Empty text');expect(deviceHistoryValueText({present:true,value:2024})).toBe('2024');expect(deviceHistoryValueText({present:true,value:'2024'})).toBe('"2024"');
  });
  it('rejects wrong company, record, actor, metadata and snapshot identity',()=>{
    for(const change of [(r:any)=>r.companyId='other',(r:any)=>r.entityId='other',(r:any)=>r.actorUserId='other',(r:any)=>r.receivedAt='invalid',(r:any)=>r.deviceHistory[0].before.provenance.userId='other',(r:any)=>r.deviceHistory[0].before.mutation.base.id='other',(r:any)=>r.deviceHistory[0].reason='approved']){
      const report=historyReport();change(report);expect(()=>decodeDeviceHistoryReport(report,reviewCompany,historyTarget,historySummary())).toThrow();
    }
  });
  it('ignores late lists after target replacement or account disposal',async()=>{
    const f=setup();const response=deferred();f.transport.list.mockReturnValueOnce(response.promise);const running=f.client.list();f.client.target({...historyTarget,entityId:'another'});response.resolve({items:[historySummary()],nextCursor:null});await running;expect(f.client.getSnapshot().items).toEqual([]);
    f.client.target(historyTarget);await f.client.list();f.client.stop();expect(f.client.getSnapshot().items).toEqual([]);expect(f.client.getSnapshot().report).toBeNull();
  });
  it('ignores a late detail after another record is opened',async()=>{
    const f=setup();await f.client.list();const response=deferred();f.transport.report.mockReturnValueOnce(response.promise);const running=f.client.inspect(f.client.getSnapshot().items[0]);f.client.target({...historyTarget,entityId:'other'});response.resolve(historyReport());await running;expect(f.client.getSnapshot().report).toBeNull();
  });
  it('clears all displayed history after permission denial',async()=>{
    const f=setup();await f.client.list();await f.client.inspect(f.client.getSnapshot().items[0]);f.transport.report.mockRejectedValue({code:'42501'});await f.client.inspect(f.client.getSnapshot().items[0]);expect(f.client.getSnapshot()).toMatchObject({report:null,items:[],loaded:false});expect(f.client.getSnapshot().reportError).toContain('manager access');
  });
  it('treats missing history migrations separately from conflict review',async()=>{
    const f=setup();f.transport.list.mockRejectedValue({code:'PGRST202'});await f.client.list();expect(f.client.getSnapshot().error).toContain('pending database migrations');
  });
  it('does nothing for a disabled account',async()=>{
    const f=setup();const disabled=createDeviceHistoryClient(null,f.transport);disabled.start();disabled.target(historyTarget);await disabled.list();expect(f.transport.list).not.toHaveBeenCalled();
  });
  it('validates cursor binding and never silently accepts repeated pages',async()=>{
    const f=setup();const items=Array.from({length:20},(_,i)=>({...historySummary(),operationId:`operation-${i}`}));const cursor={receivedAt:items[19].receivedAt,actorUserId:items[19].actorUserId,operationId:items[19].operationId};f.transport.list.mockResolvedValue({items,nextCursor:cursor});await f.client.list();await f.client.list(true);expect(f.transport.list).toHaveBeenLastCalledWith(reviewCompany,historyTarget,cursor);expect(f.client.getSnapshot().items).toEqual([]);expect(f.client.getSnapshot().error).not.toBe('');
  });
  it('keeps history inspection independent from approval choices and review refreshes',async()=>{
    const f=setup();const controller=createSyncReviewClient(scope,{list:vi.fn().mockResolvedValue([]),review:vi.fn().mockResolvedValue(reviewFixture()),approve:vi.fn(),history:f.transport},()=> 'request');controller.start();await controller.openReview(historyTarget);const choices={...controller.getSnapshot().choices};await controller.history.list();await controller.history.inspect(controller.history.getSnapshot().items[0]);expect(controller.getSnapshot().choices).toEqual(choices);expect(controller.getSnapshot().approval).toBe('idle');controller.closeReview();expect(controller.history.getSnapshot().report).toBeNull();controller.stop();
  });
});
