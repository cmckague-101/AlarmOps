import {beforeEach,describe,expect,it,vi} from 'vitest';
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../../packages/domain/test-fixtures/hook-runtime');return createHookRuntime()});
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),...runtime.hooks}));
vi.mock('react-native',()=>({Alert:{alert:vi.fn()},Image:'Image',Platform:{OS:'ios'},Pressable:'Pressable',RefreshControl:'RefreshControl',ScrollView:'ScrollView',StyleSheet:{create:(value:unknown)=>value,hairlineWidth:1},Text:'Text',TextInput:'TextInput',View:'View',useWindowDimensions:()=>({width:390,fontScale:1})}));
vi.mock('react-native-safe-area-context',()=>({SafeAreaView:'SafeAreaView'}));
vi.mock('expo-router',()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock('@/providers/session-provider',()=>({useSession:()=>({demoMode:false,signOut:vi.fn(),access:{status:'ready',value:{kind:'member',company:{id:'company'},user:{id:'user',name:'Owner',role:'owner'}}}})}));
vi.mock('@/components/app-symbol',()=>({AppSymbol:'AppSymbol'}));
vi.mock('@/components/filter-select',()=>({FilterSelect:'FilterSelect'}));
vi.mock('@/components/hero-title',()=>({HeroTitle:'HeroTitle'}));
vi.mock('@/components/section-screen',()=>({SectionScreen:'SectionScreen'}));
vi.mock('@/components/accent-tile',()=>({AccentRail:'AccentRail',pressedTileStyle:()=>null,useReduceMotion:()=>false,withAlpha:(color:string)=>color}));
vi.mock('@/components/quick-actions',()=>({quickActionItems:()=>[]}));
vi.mock('@/lib/use-fleet-file-url',()=>({useFleetFileUrl:()=>null}));
vi.mock('@/lib/use-task-count',()=>({useTaskCount:()=>null}));
vi.mock('@/lib/documents-store',()=>({useCompanyDocuments:()=>({documents:[]})}));
vi.mock('@/lib/training-store',()=>({useTrainings:()=>({trainings:[]})}));
vi.mock('@/lib/qualification-card-store',()=>({usePendingQualificationCardCount:()=>0}));
vi.mock('@/lib/use-dashboard-preferences',()=>({useDashboardPreferences:()=>({visible:()=>true})}));
const fleet=vi.hoisted(()=>({vehicles:[] as {id:string;name:string;type:string;status:string;nextOilChangeDue?:string}[]}));
vi.mock('@/lib/fleet-store',()=>({refreshFleet:vi.fn(),useFleetVehicles:()=>({vehicles:fleet.vehicles,issues:[],crew:[],loading:false,refreshing:false,error:null,pendingDetails:{}})}));
vi.mock('@/theme',()=>({useFireOpsTheme:()=>new Proxy({},{get:(_target,key)=>`theme.${String(key)}`})}));
import FleetScreen from '../app/(tabs)/fleet';
import More from '../app/(tabs)/more';

type Node={type:unknown;props:Record<string,unknown>};
function nodes(value:unknown):Node[]{
  if(Array.isArray(value))return value.flatMap(nodes);
  if(!value||typeof value!=='object'||!('props' in value))return [];
  const node=value as Node;return [node,...nodes(node.props.children)];
}
const render=(component:()=>unknown)=>{const frame=runtime.frame();runtime.enter(frame);return component()};
const stat=(tree:unknown,label:string)=>nodes(tree).find(node=>node.type==='View'&&typeof node.props.accessibilityLabel==='string'&&(node.props.accessibilityLabel as string).endsWith(label));
beforeEach(()=>{fleet.vehicles=[]});

describe('mobile Fleet header',()=>{
  it('has no Total, Ready, or Needs attention summary cards (removed to match the client sandbox)',()=>{
    fleet.vehicles=[
      {id:'1',name:'Engine 1',type:'Engine',status:'Ready'},
      {id:'2',name:'Engine 2',type:'Engine',status:'Ready',nextOilChangeDue:'2000-01-01'},
    ];
    const tree=render(FleetScreen);
    expect(stat(tree,'total vehicles')).toBeUndefined();
    expect(stat(tree,'ready')).toBeUndefined();
    expect(stat(tree,'need attention')).toBeUndefined();
  });
});

describe('mobile More screen',()=>{
  it('is titled Tools and follows the web sidebar order: Travel, News Feed, Roster',()=>{
    const tree=render(More) as Node;
    expect(tree.props.title).toBe('Tools');
    const tiles=nodes(tree).filter(node=>node.type==='Pressable'&&typeof node.props.accessibilityLabel==='string');
    expect(tiles.slice(0,3).map(tile=>tile.props.accessibilityLabel)).toEqual(['Travel','News Feed','Roster']);
  });
});
