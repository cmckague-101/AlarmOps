import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {reviewCompany,reviewUser,reviewFixture} from '../../../packages/domain/test-fixtures/sync-review';
import {historySummary,historyReport,historyTarget} from '../../../packages/domain/test-fixtures/sync-device-history';
const mocks=vi.hoisted(()=>({auth:{getSession:vi.fn()},rpc:vi.fn(),from:vi.fn(),setHeader:vi.fn()}));
vi.mock('./supabase',()=>({supabase:mocks}));
import {useSyncConflictReview} from './useSyncConflictReview';
function renderHook(){let result!:ReturnType<typeof useSyncConflictReview>;function Probe(){result=useSyncConflictReview(reviewCompany,reviewUser);return null}renderToStaticMarkup(<Probe/>);return result}
beforeEach(()=>{
  vi.clearAllMocks();mocks.auth.getSession.mockResolvedValue({data:{session:{user:{id:reviewUser},access_token:'web-bound-history'}},error:null});
  const query={select:()=>query,eq:()=>query,order:()=>query,range:async()=>({data:[],error:null})};mocks.from.mockReturnValue(query);
  mocks.rpc.mockImplementation((name)=>name==='get_fleet_sync_review'?Promise.resolve({data:reviewFixture(),error:null}):{setHeader:mocks.setHeader.mockImplementation(async()=>({data:name==='list_fleet_sync_device_history'?{items:[historySummary()],nextCursor:null}:historyReport(),error:null}))});
});
describe('web online-only history RPC adapter',()=>{
  it('binds current actor token to scoped list/detail POST RPCs',async()=>{
    const {controller}=renderHook();controller.start();await controller.openReview(historyTarget);await controller.history.list();await controller.history.inspect(controller.history.getSnapshot().items[0]);
    expect(mocks.setHeader).toHaveBeenCalledWith('Authorization','Bearer web-bound-history');expect(controller.history.getSnapshot().report?.actorUserId).toBe(reviewUser);expect(mocks.rpc).toHaveBeenCalledWith('list_fleet_sync_device_history',{target_company_id:reviewCompany,target_entity_type:'vehicle',target_record_id:historyTarget.entityId,history_cursor:null});controller.stop();
  });
  it('refuses another restored account before issuing history requests',async()=>{
    const {controller}=renderHook();controller.start();await controller.openReview(historyTarget);mocks.rpc.mockClear();mocks.auth.getSession.mockResolvedValue({data:{session:{user:{id:'other'},access_token:'other'}},error:null});await controller.history.list();expect(mocks.rpc).not.toHaveBeenCalled();expect(controller.history.getSnapshot().items).toEqual([]);controller.stop();
  });
});
