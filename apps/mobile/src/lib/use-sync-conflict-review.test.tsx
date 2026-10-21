import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {decisionFixture,reviewCandidate,reviewCompany,reviewEntity,reviewFixture,reviewUser} from '../../../../packages/domain/test-fixtures/sync-review';

const mocks=vi.hoisted(()=>{
  const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),range:vi.fn()};
  return {query,client:{from:vi.fn(()=>query),rpc:vi.fn()},session:{} as Record<string,unknown>,offline:false};
});
vi.mock('react-native',()=>({AppState:{currentState:'active',addEventListener:vi.fn(()=>({remove:vi.fn()}))}}));
vi.mock('expo-router',()=>({useFocusEffect:vi.fn()}));
vi.mock('./supabase',()=>({supabase:mocks.client}));
vi.mock('./fleet-store',()=>({createFleetId:()=> 'request-native'}));
vi.mock('../providers/session-provider',()=>({useSession:()=>mocks.session}));
vi.mock('../providers/network-provider',()=>({isOffline:()=>mocks.offline,useNetworkStatus:()=>({isOffline:mocks.offline})}));
import {useSyncConflictReview} from './use-sync-conflict-review';
function session(role='owner',demoMode=false,sessionId=reviewUser){return {demoMode,session:{user:{id:sessionId}},access:{status:'ready',value:{kind:'member',company:{id:reviewCompany},user:{id:reviewUser,role}}}}}
function renderHook(){let result!:ReturnType<typeof useSyncConflictReview>;function Probe(){result=useSyncConflictReview();return null}renderToStaticMarkup(<Probe/>);return result}
beforeEach(()=>{
  vi.clearAllMocks();mocks.offline=false;mocks.session=session();
  mocks.query.range.mockResolvedValue({data:[],error:null});
  mocks.client.rpc.mockImplementation(async(name)=>({data:name==='get_fleet_sync_review'?reviewFixture():decisionFixture(),error:null}));
});
describe('mobile conflict review adapter (no native UI)',()=>{
  it.each(['fire_fighter','shop_tech'])('does not access conflict data for %s',async(role)=>{
    mocks.session=session(role);const {controller,allowed}=renderHook();controller.start();await controller.refreshGroups();await controller.openReview({entityType:'vehicle',entityId:reviewEntity});
    expect(allowed).toBe(false);expect(mocks.client.from).not.toHaveBeenCalled();expect(mocks.client.rpc).not.toHaveBeenCalled();
  });
  it('does not contact services in demo mode or during a session/account mismatch',async()=>{
    for(const identity of [session('owner',true),session('owner',false,'other-user')]){
      mocks.session=identity;const {controller,allowed}=renderHook();controller.start();await controller.refreshGroups();expect(allowed).toBe(false);
    }
    expect(mocks.client.from).not.toHaveBeenCalled();expect(mocks.client.rpc).not.toHaveBeenCalled();
  });
  it('scopes native queries/RPCs correctly and sends only the six supported approval fields',async()=>{
    const {controller,allowed}=renderHook();expect(allowed).toBe(true);controller.start();await controller.refreshGroups();
    expect(mocks.query.eq).toHaveBeenCalledWith('company_id',reviewCompany);expect(mocks.query.eq).toHaveBeenCalledWith('state','pending');
    await controller.openReview({entityType:'vehicle',entityId:reviewEntity});
    expect(mocks.client.rpc).toHaveBeenCalledWith('get_fleet_sync_review',{target_company_id:reviewCompany,entity_type:'vehicle',record_id:reviewEntity});
    controller.choose('notes',reviewCandidate);await controller.approve();
    expect(mocks.client.rpc).toHaveBeenCalledWith('approve_fleet_sync_review',{request:{requestId:'request-native',companyId:reviewCompany,entityType:'vehicle',entityId:reviewEntity,reviewToken:'review-token',choices:{notes:reviewCandidate}}});
    expect(controller.getSnapshot().decision?.kind).toBe('resolved');
  });
  it('checks connection again at approval time rather than queueing a stale offline approval',async()=>{
    const {controller}=renderHook();controller.start();await controller.openReview({entityType:'vehicle',entityId:reviewEntity});controller.choose('notes',reviewCandidate);
    mocks.offline=true;await controller.approve();
    expect(mocks.client.rpc).not.toHaveBeenCalledWith('approve_fleet_sync_review',expect.anything());expect(controller.getSnapshot().approval).toBe('idle');
    expect(controller.getSnapshot().reviewError).toContain('No approval was sent');
  });
  it('treats undeployed migrations as unavailable without crashing the rest of the app',async()=>{
    mocks.query.range.mockResolvedValue({data:null,error:{code:'42P01'}});const {controller}=renderHook();controller.start();await controller.refreshGroups();
    expect(controller.getSnapshot().status).toBe('unavailable');expect(controller.getSnapshot().listError).toContain('pending sync migrations');
  });
});
