import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createVoicePlayback} from './voicePlayback';
let contexts:FakeContext[];
let gesture:boolean;
class FakeSource {
 buffer:unknown;onended:(()=>void)|null=null;
 connect=vi.fn();disconnect=vi.fn();stop=vi.fn();
 start=vi.fn(()=>{queueMicrotask(()=>this.onended?.())});
}
class FakeContext {
 state='suspended';destination={};sources:FakeSource[]=[];
 resume=vi.fn(()=>{if(!gesture)return Promise.reject(new Error('NotAllowedError'));this.state='running';return Promise.resolve();});
 close=vi.fn(async()=>{this.state='closed';});
 decodeAudioData=vi.fn(async(_bytes:ArrayBuffer)=>({decoded:true}));
 createBufferSource(){const source=new FakeSource();this.sources.push(source);return source;}
 constructor(){contexts.push(this);}
}
beforeEach(()=>{contexts=[];gesture=true;vi.stubGlobal('AudioContext',FakeContext);});
afterEach(()=>vi.unstubAllGlobals());
it('unlocks output inside Talk and reuses it for replies after the gesture expires',async()=>{
 const controller=new AbortController();const playback=createVoicePlayback(controller.signal);
 expect(contexts[0].resume).toHaveBeenCalledOnce();gesture=false;
 await playback.play(new Blob(['reply one']));await playback.play(new Blob(['reply two']));
 expect(contexts).toHaveLength(1);expect(contexts[0].sources).toHaveLength(2);
 expect(contexts[0].sources.every(source=>source.start.mock.calls.length===1)).toBe(true);
 expect(contexts[0].resume).toHaveBeenCalledOnce();controller.abort();expect(contexts[0].close).toHaveBeenCalledOnce();
});
it('End stops a currently playing reply and releases the context',async()=>{
 const controller=new AbortController();const playback=createVoicePlayback(controller.signal);
 // Keep playback active until End rather than completing on its own.
 vi.spyOn(contexts[0],'createBufferSource').mockImplementation(()=>{
  const source=new FakeSource();source.start.mockImplementation(()=>{});contexts[0].sources.push(source);return source;
 });
 const pending=playback.play(new Blob(['reply']));
 for(let i=0;i<12;i++)await Promise.resolve();controller.abort();
 await expect(pending).rejects.toMatchObject({name:'AbortError'});
 expect(contexts[0].sources[0].stop).toHaveBeenCalledOnce();expect(contexts[0].close).toHaveBeenCalledOnce();
 expect(contexts[0].sources[0].disconnect).toHaveBeenCalledOnce();
});
it('End during decoding never starts late audio',async()=>{
 const controller=new AbortController();const playback=createVoicePlayback(controller.signal);
 let decode!:(value:{decoded:boolean})=>void;contexts[0].decodeAudioData.mockImplementation(()=>new Promise(resolve=>{decode=resolve}));
 const pending=playback.play(new Blob(['reply']));
 for(let i=0;i<12;i++)await Promise.resolve();controller.abort();
 await expect(pending).rejects.toMatchObject({name:'AbortError'});decode({decoded:true});
 for(let i=0;i<5;i++)await Promise.resolve();expect(contexts[0].sources).toHaveLength(0);
});
it('End before the first reply safely closes output; the next session creates a new context',async()=>{
 const controller=new AbortController();const playback=createVoicePlayback(controller.signal);controller.abort();
 await expect(playback.play(new Blob(['reply']))).rejects.toMatchObject({name:'AbortError'});
 expect(contexts[0].close).toHaveBeenCalledOnce();
 const nextController=new AbortController();const next=createVoicePlayback(nextController.signal);await next.play(new Blob(['new reply']));
 expect(contexts).toHaveLength(2);nextController.abort();
});
it('propagates decoding failure so the existing device fallback can handle it',async()=>{
 const controller=new AbortController();const playback=createVoicePlayback(controller.signal);
 contexts[0].decodeAudioData.mockRejectedValue(new Error('Invalid audio'));
 await expect(playback.play(new Blob(['bad audio']))).rejects.toThrow('Invalid audio');controller.abort();
});
