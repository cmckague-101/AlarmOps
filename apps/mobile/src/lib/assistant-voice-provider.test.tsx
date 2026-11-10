import {beforeEach,it,expect,vi} from 'vitest';
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../../packages/domain/test-fixtures/hook-runtime');return createHookRuntime()});
const mocks=vi.hoisted(()=>({listen:vi.fn(),release:vi.fn(),background:null as null|((state:string)=>void),member:true}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),...runtime.hooks}));
vi.mock('react-native',()=>({AppState:{addEventListener:(_name:string,callback:(state:string)=>void)=>{mocks.background=callback;return {remove:()=>{mocks.background=null}};}}}));
vi.mock('@/lib/assistant-voice-session',()=>({listenOnce:mocks.listen,speakText:vi.fn(),releaseVoiceAudio:mocks.release,finishListening:vi.fn()}));
vi.mock('@/lib/assistant-client',()=>({loadAssistantEnabled:async()=>true,loadAssistantVoiceEnabled:async()=>true,askAssistant:vi.fn()}));
vi.mock('@/lib/assistant-conversation-store',()=>({loadAssistantChats:async()=>({threads:[],activeId:null}),saveAssistantChats:vi.fn()}));
vi.mock('@/lib/receipts-store',()=>({loadReceiptAutofillEnabled:async()=>false}));
vi.mock('@/providers/network-provider',()=>({useNetworkStatus:()=>({isOffline:false})}));
vi.mock('@/providers/session-provider',()=>({useSession:()=>({access:{value:mocks.member?{kind:'member',company:{id:'c'},user:{id:'u',role:'owner'}}:null}})}));
// Relative imports in the provider refer to these same modules.
vi.mock('../providers/network-provider',()=>({useNetworkStatus:()=>({isOffline:false})}));
vi.mock('../providers/session-provider',()=>({useSession:()=>({access:{value:mocks.member?{kind:'member',company:{id:'c'},user:{id:'u',role:'owner'}}:null}})}));
import {AssistantProvider} from '../providers/assistant-provider';
let frame:ReturnType<typeof runtime.frame>;
function render(){runtime.enter(frame);return AssistantProvider({children:null}).props.value;}
function effects(){for(const index of frame.effects){const slot=frame.slots[index];slot.cleanup?.();slot.cleanup=slot.effect?.()||undefined;}frame.effects.clear();}
async function ready(){render();effects();for(let i=0;i<10;i++)await Promise.resolve();return render();}
beforeEach(()=>{frame=runtime.frame();mocks.member=true;vi.clearAllMocks();mocks.release.mockResolvedValue(undefined);mocks.listen.mockImplementation((signal:AbortSignal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('ended')))));});
for(const action of ['background','close','sign-out'] as const)it(`stops voice on ${action} and does not restart`,async()=>{
 let value=await ready();value.setOpen(true);value=render();
 const pending=value.talk();for(let i=0;i<10;i++)await Promise.resolve();
 const signal=mocks.listen.mock.calls[0][0] as AbortSignal;
 if(action==='background')mocks.background!('background');
 else if(action==='close')value.setOpen(false);
 else {mocks.member=false;render();effects();}
 await pending;expect(signal.aborted).toBe(true);expect(mocks.release).toHaveBeenCalled();expect(render().phase).toBe('idle');expect(mocks.listen).toHaveBeenCalledTimes(1);
});
