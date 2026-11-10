import {beforeEach,describe,expect,it,vi} from 'vitest';
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../../packages/domain/test-fixtures/hook-runtime');return createHookRuntime()});
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),...runtime.hooks}));
vi.mock('react-native',()=>({AccessibilityInfo:{},Alert:{alert:vi.fn()},Platform:{OS:'ios'},Pressable:'Pressable',ScrollView:'ScrollView',StyleSheet:{create:(value:unknown)=>value},Text:'Text',View:'View',useWindowDimensions:()=>({width:390,fontScale:1})}));
const router=vi.hoisted(()=>({push:vi.fn()}));
vi.mock('expo-router',()=>({Redirect:'Redirect',Stack:{Screen:'StackScreen'},useRouter:()=>router}));
const session=vi.hoisted(()=>({role:'owner'}));
vi.mock('@/providers/session-provider',()=>({useSession:()=>({session:{},demoMode:false,access:{status:'ready',value:{kind:'member',company:{id:'company'},user:{id:'user',role:session.role}}}})}));
vi.mock('@/components/accent-tile',()=>({AccentRail:'AccentRail',pressedTileStyle:()=>null,useReduceMotion:()=>false,withAlpha:(color:string)=>color}));
vi.mock('@/components/app-symbol',()=>({AppSymbol:'AppSymbol'}));
vi.mock('@/components/section-screen',()=>({SectionScreen:'SectionScreen'}));
vi.mock('@/components/vipr-intelligence-icon',()=>({ViprIntelligenceIcon:'ViprIntelligenceIcon'}));
// quick-actions.tsx imports its siblings by relative path, so mock those too.
vi.mock('../components/vipr-intelligence-icon',()=>({ViprIntelligenceIcon:'ViprIntelligenceIcon'}));
vi.mock('../components/app-symbol',()=>({AppSymbol:'AppSymbol'}));
vi.mock('../components/accent-tile',()=>({AccentRail:'AccentRail',pressedTileStyle:()=>null,useReduceMotion:()=>false,withAlpha:(color:string)=>color}));
vi.mock('@/lib/use-availability',()=>({useAvailability:()=>({statuses:{},loading:false,error:''})}));
vi.mock('@/lib/use-task-count',()=>({useTaskCount:()=>null}));
const preferences=vi.hoisted(()=>({hidden:new Set<string>()}));
vi.mock('@/lib/use-dashboard-preferences',()=>({useDashboardPreferences:()=>({visible:(item:string)=>!preferences.hidden.has(item)})}));
vi.mock('@/theme',()=>({useFireOpsTheme:()=>({green:'#26765A',warning:'#B7791F',danger:'#C0392B'})}));
import ViprIntelligenceScreen from '../app/vipr-intelligence';
import {QuickActions} from '../components/quick-actions';

type Node={type:unknown;key?:unknown;props:Record<string,unknown>};
function nodes(value:unknown):Node[]{
  if(Array.isArray(value))return value.flatMap(nodes);
  if(!value||typeof value!=='object'||!('props' in value))return [];
  const node=value as Node;return [node,...nodes(node.props.children)];
}
const render=(component:()=>unknown)=>{const frame=runtime.frame();runtime.enter(frame);return component()};
const buttons=(tree:unknown)=>nodes(tree).filter(node=>node.type==='Pressable');
const texts=(tree:unknown)=>nodes(tree).filter(node=>node.type==='Text').map(node=>node.props.children);
beforeEach(()=>{vi.clearAllMocks();session.role='owner';preferences.hidden.clear()});

describe('VIPR Intelligence screen',()=>{
  it('lists Send to VIPR and VIPR DPLs for owners and admins and opens the existing routes',()=>{
    for(const role of ['owner','admin']){
      session.role=role;
      const entries=buttons(render(ViprIntelligenceScreen));
      expect(entries.map(entry=>entry.props.accessibilityLabel)).toEqual(['Send to VIPR','VIPR DPLs']);
      (entries[0].props.onPress as ()=>void)();(entries[1].props.onPress as ()=>void)();
      expect(router.push).toHaveBeenNthCalledWith(1,'/send-to-vipr');
      expect(router.push).toHaveBeenNthCalledWith(2,'/dispatch-lists');
      router.push.mockClear();
    }
  });
  it('hides Send to VIPR from crew roles and keeps VIPR DPLs',()=>{
    for(const role of ['fire_fighter','shop_tech','accounting','resource_boss']){
      session.role=role;
      expect(buttons(render(ViprIntelligenceScreen)).map(entry=>entry.props.accessibilityLabel)).toEqual(['VIPR DPLs']);
    }
  });
});

describe('mobile Quick Actions',()=>{
  it('adds VIPR Intelligence after Payroll for every role and opens the hub',()=>{
    for(const role of ['owner','fire_fighter']){
      session.role=role;
      const tree=render(QuickActions);
      const labels=texts(tree).filter(text=>['Payroll','VIPR Intelligence','Invoices'].includes(String(text)));
      expect(labels).toEqual(['Payroll','VIPR Intelligence','Invoices']);
    }
    const vipr=buttons(render(QuickActions)).find(button=>nodes(button).some(node=>node.props.children==='VIPR Intelligence'))!;
    (vipr.props.onPress as ()=>void)();
    expect(router.push).toHaveBeenCalledWith('/vipr-intelligence');
  });
  it('does not keep the section on screen by itself when every other action is hidden',()=>{
    session.role='fire_fighter';
    for(const item of ['availability','payroll','invoices'])preferences.hidden.add(item);
    expect(render(QuickActions)).toBeNull();
  });
});
