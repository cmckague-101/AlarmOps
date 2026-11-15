import {beforeEach,it,expect,vi} from 'vitest';
const runtime=await vi.hoisted(async()=>{const {createHookRuntime}=await import('../../../../packages/domain/test-fixtures/hook-runtime');return createHookRuntime()});
const mocks=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn(),navigate:vi.fn(),play:vi.fn(),prepare:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),...runtime.hooks}));
vi.mock('../supabase',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
vi.mock('../useDialogA11y',()=>({useDialogA11y:()=>({ref:{current:null},titleId:'assistant'})}));
vi.mock('./voiceTalk',async original=>({...await original<typeof import('./voiceTalk')>(),listenOnce:mocks.listen}));
vi.mock('./voicePlayback',()=>({createVoicePlayback:mocks.prepare}));
import AssistantPanel from '../AssistantPanel';
import type {FireOpsUser} from '@fireops/domain';
type Node={type:unknown;props:Record<string,any>};
function nodes(value:unknown):Node[]{
 if(Array.isArray(value))return value.flatMap(nodes);
 if(!value||typeof value!=='object'||!('props' in value))return [];
 const node=value as Node;
 // Expand the sheet's render prop without running its dialog hook.
 const children=typeof node.props.children==='function'?node.props.children('title'):node.props.children;
 return [node,...nodes(children)];
}
const user={id:'u1',role:'owner'} as FireOpsUser;
let frame:ReturnType<typeof runtime.frame>;
const render=(voiceEnabled=true)=>{runtime.enter(frame);return nodes(AssistantPanel({companyId:'c1',user,autofillEnabled:false,voiceEnabled,onNavigate:mocks.navigate,onDraft:vi.fn()}));};
const button=(tree:Node[],label:string)=>tree.find(node=>node.props['aria-label']===label)!;
beforeEach(()=>{
 vi.clearAllMocks();frame=runtime.frame();mocks.prepare.mockImplementation(()=>({play:mocks.play}));mocks.play.mockResolvedValue(undefined);
 vi.stubGlobal('navigator',{onLine:true});vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{},removeItem:()=>{}});
 vi.stubGlobal('window',{speechSynthesis:{cancel:vi.fn(),speak:vi.fn()}});
 vi.stubGlobal('Audio',class {onended=()=>{};onerror=()=>{};src='';pause(){} play(){queueMicrotask(()=>this.onended());return Promise.resolve();}});
});
it('hides the microphone with the add-on off',()=>{
 button(render(false),'Open FireOps Assistant').props.onClick();
 expect(button(render(false),'Start voice chat')).toBeUndefined();
});
it('runs STT, normal chat with visible transcript, TTS, then listens again; End cancels',async()=>{
 mocks.listen.mockResolvedValueOnce({audio:new Blob(['voice'],{type:'audio/webm'}),duration:2}).mockImplementation((signal:AbortSignal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('ended')))));
 mocks.invoke.mockImplementation(async(name,options)=>{
  if(name==='assistant-chat')return {data:{text:'There are two units.',navigate:'fleet'},error:null};
  return {data:options.body instanceof FormData?{text:'How many units?'}:new Blob(['audio'],{type:'audio/mpeg'}),error:null};
 });
 button(render(),'Open FireOps Assistant').props.onClick();
 button(render(),'Start voice chat').props.onClick();
 for(let i=0;i<30;i++)await Promise.resolve();
 expect(mocks.invoke.mock.calls.map(call=>call[0])).toEqual(['assistant-voice','assistant-chat','assistant-voice']);
 expect(mocks.invoke.mock.calls[1][1].body.messages).toEqual([{role:'user',content:'How many units?'}]);
 expect(mocks.invoke.mock.calls[2][1].body).toMatchObject({companyId:'c1',kind:'tts',text:'There are two units.'});
 expect(mocks.listen).toHaveBeenCalledTimes(2);
 expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.listen.mock.invocationCallOrder[0]);
 expect(mocks.play).toHaveBeenCalledWith(expect.any(Blob));
 let tree=render();
 expect(tree.some(node=>[node.props.children].flat().includes('How many units?'))).toBe(true);
 tree.find(node=>node.type==='button'&&node.props.className==='assistant-action')!.props.onClick();
 expect(mocks.navigate).toHaveBeenCalledWith('vehicles');
 tree=render();expect(tree.some(node=>node.props.className==='assistant-voice-dock')).toBe(true);
 expect(mocks.listen.mock.calls[1][0].aborted).toBe(false);
 tree.find(node=>node.type==='button'&&node.props.children==='End')!.props.onClick();
 expect(mocks.listen.mock.calls[1][0].aborted).toBe(true);
});
it('shows offline feedback without starting capture',()=>{
 vi.stubGlobal('navigator',{onLine:false});
 button(render(),'FireOps Assistant (needs a network connection)').props.onClick();
 button(render(),'Start voice chat').props.onClick();
 expect(mocks.listen).not.toHaveBeenCalled();
 expect(render().some(node=>node.props.role==='alert'&&/network/.test(node.props.children))).toBe(true);
});
it('keeps text chat available after microphone denial',async()=>{
 mocks.listen.mockRejectedValue(new Error('Microphone access is required for voice. You can still type.'));
 button(render(),'Open FireOps Assistant').props.onClick();button(render(),'Start voice chat').props.onClick();
 for(let i=0;i<10;i++)await Promise.resolve();
 const tree=render();expect(tree.some(node=>node.props.role==='alert'&&/Microphone/.test(node.props.children))).toBe(true);
 expect(button(tree,'Message the FireOps Assistant').props.disabled).toBe(false);
});

it('shows when browser speech replaces AI playback',async()=>{
 mocks.listen.mockResolvedValueOnce({audio:new Blob(['voice'],{type:'audio/webm'}),duration:2}).mockImplementation((signal:AbortSignal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('ended')))));
 mocks.invoke.mockImplementation(async(name,options)=>({data:name==='assistant-chat'?{text:'Two units.'}:options.body instanceof FormData?{text:'How many?'}:new Blob(['ai audio']),error:null}));
 mocks.play.mockRejectedValue(new Error('Decode failed'));
 vi.stubGlobal('SpeechSynthesisUtterance',class{});
 vi.stubGlobal('window',{speechSynthesis:{speak:vi.fn(utterance=>queueMicrotask(()=>utterance.onend())),cancel:vi.fn()}});
 button(render(),'Open FireOps Assistant').props.onClick();button(render(),'Start voice chat').props.onClick();
 for(let i=0;i<40;i++)await Promise.resolve();
 const tree=render();expect(tree.some(node=>node.props.role==='status'&&/Using your browser/.test(String(node.props.children)))).toBe(true);
 tree.find(node=>node.type==='button'&&node.props.children==='End')!.props.onClick();
});
