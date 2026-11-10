import {beforeEach,it,expect,vi} from 'vitest';
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../../packages/domain/test-fixtures/hook-runtime');const {createRequire}=await import('node:module');const req=createRequire(import.meta.url);req.extensions['.png']=(module)=>{module.exports=1};return createHookRuntime()});
const state=vi.hoisted(()=>({voiceEnabled:false,offline:false,talk:vi.fn(),endVoice:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),...runtime.hooks}));
vi.mock('react-native',()=>({Animated:{Value:class{}},Alert:{},Easing:{},Image:'Image',KeyboardAvoidingView:'KeyboardAvoidingView',Modal:'Modal',Platform:{OS:'ios'},Pressable:'Pressable',ScrollView:'ScrollView',StyleSheet:{create:(value:unknown)=>value},Text:'Text',TextInput:'TextInput',View:'View',AccessibilityInfo:{}}));
vi.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({bottom:0})}));
vi.mock('expo-router',()=>({router:{push:vi.fn()}}));
vi.mock('@/components/app-symbol',()=>({AppSymbol:'AppSymbol'}));
vi.mock('@/providers/assistant-provider',()=>({useAssistant:()=>({enabled:true,voiceEnabled:state.voiceEnabled,offline:state.offline,talk:state.talk,endVoice:state.endVoice,phase:'idle',open:true,view:'chat',user:{id:'u',role:'owner'},messages:[],threads:[],input:'',setOpen:vi.fn(),send:vi.fn()})}));
vi.mock('@/theme',()=>({useFireOpsTheme:()=>({})}));
import {AssistantHost} from '../components/assistant-panel';
type Node={type:unknown;props:Record<string,any>};
function nodes(value:unknown):Node[]{if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object'||!('props' in value))return [];const node=value as Node;return [node,...nodes(node.props.children)];}
const render=()=>{runtime.enter(runtime.frame());return nodes(AssistantHost());};
beforeEach(()=>{state.voiceEnabled=false;state.offline=false;vi.clearAllMocks();});
it('iPhone hides Talk with voice disabled, even when chat is enabled',()=>{
 expect(render().find(node=>node.props.accessibilityLabel==='Talk to assistant')).toBeUndefined();
});
it('iPhone shows Talk only for the voice add-on and disables it offline',()=>{
 state.voiceEnabled=true;
 const mic=render().find(node=>node.props.accessibilityLabel==='Talk to assistant')!;mic.props.onPress();expect(state.talk).toHaveBeenCalled();
 state.offline=true;expect(render().find(node=>node.props.accessibilityLabel==='Talk to assistant')!.props.disabled).toBe(true);
});
