import {beforeEach,describe,expect,it,vi} from 'vitest';
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../../packages/domain/test-fixtures/hook-runtime');return createHookRuntime()});
const state=vi.hoisted(()=>({role:'owner',pathname:'/',width:390,height:844,params:{} as Record<string,string|undefined>,ops:{refreshIncidents:()=>undefined}}));
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),...runtime.hooks}));
vi.mock('react-native',()=>({Platform:{OS:'ios'},Pressable:'Pressable',RefreshControl:'RefreshControl',ScrollView:'ScrollView',StyleSheet:{create:(value:unknown)=>value,hairlineWidth:1},Text:'Text',View:'View',useWindowDimensions:()=>({width:state.width,height:state.height})}));
vi.mock('react-native-safe-area-context',()=>({SafeAreaView:'SafeAreaView'}));
vi.mock('expo-router',()=>({Redirect:'Redirect',Tabs:Object.assign(function Tabs(){return null},{Screen:'TabsScreen'}),usePathname:()=>state.pathname,useRouter:()=>({push:vi.fn(),setParams:vi.fn()}),useLocalSearchParams:()=>state.params}));
vi.mock('@/providers/session-provider',()=>({useSession:()=>({session:{},demoMode:false,access:{status:'ready',value:{kind:'member',company:{id:'company'},user:{id:'user',name:'Alex Rivera',role:state.role}}}})}));
vi.mock('@/components/app-header-brand',()=>({AppHeaderBrand:'AppHeaderBrand'}));
vi.mock('@/components/app-symbol',()=>({AppSymbol:'AppSymbol'}));
vi.mock('@/components/assistant-panel',()=>({AssistantHost:'AssistantHost'}));
vi.mock('@/components/resources-icon',()=>({ResourcesIcon:'ResourcesIcon'}));
vi.mock('@/components/quick-actions',()=>({QuickActions:'QuickActions'}));
vi.mock('@/components/national-fire-activity',()=>({NationalFireActivitySection:'NationalFireActivitySection'}));
vi.mock('@/components/operations-map',()=>({OperationsMap:'OperationsMap',useOperationsMap:()=>state.ops}));
vi.mock('@/components/owner-dashboard',()=>({OwnerDashboard:'OwnerDashboard'}));
vi.mock('@/components/dashboard-customization',()=>({CustomizeDashboardButton:'CustomizeDashboardButton'}));
// No @ alias in vitest: route the real landscape rule through the mock.
vi.mock('@/lib/operations-layout',()=>import('./operations-layout'));
vi.mock('@/lib/use-dashboard-preferences',()=>({useDashboardPreferences:()=>({visible:()=>true})}));
vi.mock('@/lib/inventory-store',()=>({useInventory:()=>({items:[]})}));
vi.mock('@/lib/fleet-store',()=>({refreshFleet:vi.fn(),useFleetVehicles:()=>({vehicles:[],issues:[],crew:[],activities:[],loading:false,refreshing:false,error:null})}));
vi.mock('@/lib/notification-inbox-store',()=>({markInboxNotificationRead:vi.fn(),refreshNotificationInbox:vi.fn(),useNotificationInbox:()=>({notifications:[],unreadCount:3,refreshing:false})}));
vi.mock('@/lib/time-of-day-greeting',()=>({getTimeOfDayGreeting:()=>'Good Morning'}));
vi.mock('@/lib/payroll-store',()=>({usePayroll:()=>({forms:[],refreshing:false})}));
vi.mock('@/lib/communications-store',()=>({useCommunications:()=>({threads:[]})}));
vi.mock('@/lib/documents-store',()=>({useCompanyDocuments:()=>({documents:[]})}));
vi.mock('@/lib/training-store',()=>({useTrainings:()=>({trainings:[]})}));
vi.mock('@/theme',()=>({useFireOpsTheme:()=>new Proxy({},{get:(_target,key)=>`theme.${String(key)}`})}));
import TabLayout from '../app/(tabs)/_layout';
import OperationsScreen from '../app/(tabs)/index';
import OperationsRedirect from '../app/(tabs)/operations';
import {isOperationsLandscape} from './operations-layout';

type Node={type:unknown;props:Record<string,unknown>};
function nodes(value:unknown):Node[]{
  if(Array.isArray(value))return value.flatMap(nodes);
  if(!value||typeof value!=='object'||!('props' in value))return [];
  const node=value as Node;return [node,...nodes(node.props.children)];
}
const render=(component:()=>unknown)=>{const frame=runtime.frame();runtime.enter(frame);return component()};
const screens=()=>nodes(render(TabLayout)).filter(node=>node.type==='TabsScreen');
const screen=(name:string)=>screens().find(node=>node.props.name===name)?.props.options as Record<string,unknown>;
const tabsOptions=()=>(nodes(render(TabLayout)).find(node=>typeof node.type==='function')!.props.screenOptions as ()=>Record<string,unknown>)();
beforeEach(()=>{state.role='owner';state.pathname='/';state.width=390;state.height=844;state.params={}});

describe('Operations tab (Dashboard and Operations combined)',()=>{
  it('makes the first tab Operations with the flame icon and the notifications badge',()=>{
    const index=screen('index');
    expect(index.title).toBe('Operations');
    expect(index.tabBarBadge).toBe(3);
    const icon=(index.tabBarIcon as (props:{color:string})=>Node)({color:'red'});
    expect(icon.props.name).toEqual({ios:'flame.fill',android:'local_fire_department'});
    expect(screens().map(node=>(node.props.options as {title?:string}).title)).not.toContain('Dashboard');
  });
  it('hides the old operations tab but keeps its route',()=>{
    expect(screen('operations')).toEqual({href:null});
    expect(screens().filter(node=>(node.props.options as {href?:unknown}).href!==null).map(node=>node.props.name)).toEqual(['index','fleet','communications','more']);
  });
  it('labels the fleet route Resources and uses the Resources outline mark',()=>{
    const fleet=screen('fleet');
    expect(fleet.title).toBe('Resources');
    const icon=(fleet.tabBarIcon as (props:{color:string;size:number})=>Node)({color:'red',size:24});
    expect(icon.type).toBe('ResourcesIcon');
    expect(icon.props).toMatchObject({color:'red',size:24});
  });
  it('redirects /operations to the Operations tab and keeps the incident or vehicle to focus',()=>{
    state.params={incidentId:'fire-1'};
    expect((render(OperationsRedirect) as Node).props.href).toEqual({pathname:'/(tabs)',params:{incidentId:'fire-1'}});
    state.params={vehicleId:'truck-7'};
    expect((render(OperationsRedirect) as Node).props.href).toEqual({pathname:'/(tabs)',params:{vehicleId:'truck-7'}});
    state.params={};
    expect((render(OperationsRedirect) as Node).props.href).toEqual({pathname:'/(tabs)',params:{}});
  });
  it('shows the full-screen map only on Operations with a phone held sideways',()=>{
    expect(isOperationsLandscape(844,390)).toBe(true);
    expect(isOperationsLandscape(390,844)).toBe(false);
    expect(isOperationsLandscape(1180,820)).toBe(false); // iPad landscape keeps the page
    state.width=844;state.height=390;
    expect(tabsOptions()).toMatchObject({headerShown:false,tabBarStyle:{display:'none'}});
    state.pathname='/fleet';
    expect(tabsOptions().headerShown).toBe(true);
    state.pathname='/';state.width=390;state.height=844;
    expect(tabsOptions().headerShown).toBe(true);
  });
});

describe('Operations screen',()=>{
  it('gives managers the Command Center with one Operations map',()=>{
    for(const role of ['owner','admin']){
      state.role=role;
      const tree=render(OperationsScreen) as Node;
      expect(tree.type).toBe('OwnerDashboard');
      const map=tree.props.incidentMap as Node;
      expect(map.type).toBe('OperationsMap');
      expect(map.props).toMatchObject({ops:state.ops,landscape:false});
      expect(tree.props.onRefresh).toBe(state.ops.refreshIncidents);
    }
  });
  it.each(['fire_fighter','shop_tech','accounting','resource_boss'])('puts one Operations map above the %s dashboard',role=>{
    state.role=role;
    const all=nodes(render(OperationsScreen));
    const maps=all.filter(node=>node.type==='OperationsMap');
    expect(maps).toHaveLength(1);
    expect(maps[0].props.landscape).toBe(false);
    expect(all.indexOf(maps[0])).toBeLessThan(all.findIndex(node=>node.type==='QuickActions'));
  });
  it('shows only the map, full screen, when the phone is sideways',()=>{
    state.width=844;state.height=390;
    for(const role of ['owner','fire_fighter']){
      state.role=role;
      const all=nodes(render(OperationsScreen));
      expect(all.filter(node=>node.type==='OperationsMap').map(node=>node.props.landscape)).toEqual([true]);
      expect(all.some(node=>node.type==='OwnerDashboard'||node.type==='QuickActions')).toBe(false);
    }
  });
});
