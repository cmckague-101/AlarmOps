import {beforeEach,describe,expect,it,vi} from 'vitest';
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../../packages/domain/test-fixtures/hook-runtime');return createHookRuntime()});
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),...runtime.hooks}));
vi.mock('react-native',()=>({Alert:{alert:vi.fn()},KeyboardAvoidingView:'KeyboardAvoidingView',Platform:{OS:'ios'},Pressable:'Pressable',ScrollView:'ScrollView',StyleSheet:{create:(value:unknown)=>value},Text:'Text',View:'View'}));
vi.mock('expo-router',()=>({Redirect:'Redirect',Stack:{Screen:'StackScreen'}}));
vi.mock('@react-native-community/datetimepicker',()=>({default:'DateTimePicker'}));
vi.mock('react-native-safe-area-context',()=>({SafeAreaView:'SafeAreaView'}));
vi.mock('@/providers/session-provider',()=>({useSession:()=>({session:{},access:{status:'ready',value:{kind:'member',company:{id:'company'},user:{id:'user',role:'owner'}}}})}));
vi.mock('@/components/form-field',()=>({FormField:'FormField'}));
vi.mock('@/components/hero-title',()=>({HeroTitle:'HeroTitle'}));
vi.mock('@/theme',()=>({useFireOpsTheme:()=>({})}));
const mocks=vi.hoisted(()=>({save:vi.fn(),remove:vi.fn()}));
const tasks=[{id:'first',company_id:'company',user_id:'user',subject:'First task',description:'First details',due_date:'2027-01-05',created_at:''},{id:'second',company_id:'company',user_id:'user',subject:'Second task',description:'Second details',due_date:'2027-01-06',created_at:''}];
vi.mock('@/lib/use-personal-tasks',()=>({usePersonalTasks:()=>({tasks,save:mocks.save,remove:mocks.remove,loading:false,busy:false,error:'',connected:true,pendingCount:0,canEdit:()=>true,retry:vi.fn()})}));
import TasksScreen from '../app/tasks';

type Node={type:unknown;key?:unknown;props:Record<string,unknown>};
function nodes(value:unknown):Node[]{
  if(Array.isArray(value))return value.flatMap(nodes);
  if(!value||typeof value!=='object'||!('props' in value))return [];
  const node=value as Node;return [node,...nodes(node.props.children)];
}
function screen(){
  const frame=runtime.frame();
  const render=()=>{runtime.enter(frame);return TasksScreen()};
  return {render,press(tree:unknown,label:string){const button=nodes(tree).find(node=>node.type==='Pressable'&&(node.props.accessibilityLabel===label||nodes(node.props.children).some(child=>child.props.children===label)));expect(button).toBeDefined();(button!.props.onPress as ()=>void)()}};
}
beforeEach(()=>{vi.clearAllMocks();mocks.save.mockResolvedValue(true)});

describe('inline mobile task editing',()=>{
  it('expands the selected card instead of showing duplicate details above the list',()=>{
    const s=screen();s.press(s.render(),'Edit Second task');const tree=s.render();
    const cards=nodes(tree).filter(node=>node.type==='View'&&['first','second'].includes(String(node.key)));expect(cards).toHaveLength(2);
    expect(nodes(tree).filter(node=>node.type==='FormField'&&node.props.label==='Subject')).toHaveLength(1);
    expect(nodes(cards[0]).some(node=>node.type==='FormField')).toBe(false);
    expect(nodes(cards[1]).find(node=>node.type==='FormField'&&node.props.label==='Subject')?.props.value).toBe('Second task');
    expect(nodes(cards[1]).some(node=>node.props.children==='Second details')).toBe(false);
    s.press(tree,'Cancel');expect(nodes(s.render()).some(node=>node.type==='FormField')).toBe(false);
    expect(nodes(s.render()).some(node=>node.props.children==='Second details')).toBe(true);
  });
  it('saves edits to the existing task and collapses its card',async()=>{
    const s=screen();s.press(s.render(),'Edit Second task');s.press(s.render(),'Save task');await Promise.resolve();
    expect(mocks.save).toHaveBeenCalledWith({subject:'Second task',description:'Second details',dueDate:'2027-01-06'},'second');
    expect(nodes(s.render()).some(node=>node.type==='FormField')).toBe(false);
  });
  it('retains failed inline edits and leaves new-task creation above the list',async()=>{
    mocks.save.mockResolvedValue(false);const s=screen();s.press(s.render(),'Edit First task');s.press(s.render(),'Save task');await Promise.resolve();
    expect(nodes(s.render()).some(node=>node.type==='FormField')).toBe(true);
    s.press(s.render(),'Cancel');s.press(s.render(),'New task');const tree=s.render();
    expect(nodes(tree).filter(node=>node.type==='FormField'&&node.props.label==='Subject')).toHaveLength(1);
    expect(nodes(tree).filter(node=>node.type==='View'&&['first','second'].includes(String(node.key))).every(card=>!nodes(card).some(node=>node.type==='FormField'))).toBe(true);
  });
});
