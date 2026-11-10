import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('../supabase',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
import {listenOnce,speakText,transcribe} from './voiceTalk';
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('navigator',{onLine:true});});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('falls back to device speech on TTS service failure',async()=>{
 mocks.invoke.mockResolvedValue({error:{context:{json:async()=>({error:'Assistant voice could not respond.'})}}});
 const speak=vi.fn(utterance=>queueMicrotask(()=>utterance.onend()));
 vi.stubGlobal('window',{speechSynthesis:{speak,cancel:vi.fn()}});vi.stubGlobal('SpeechSynthesisUtterance',class{constructor(public text:string){} });
 await speakText('c','Hello',new AbortController().signal);expect(speak).toHaveBeenCalled();
});
it('honors server limits without falling back around the add-on or quota',async()=>{
 mocks.invoke.mockResolvedValue({error:{context:{json:async()=>({error:'Daily assistant voice limit reached. Try again tomorrow, or use text chat.'})}}});
 const speak=vi.fn();vi.stubGlobal('window',{speechSynthesis:{speak}});
 await expect(speakText('c','Hello',new AbortController().signal)).rejects.toThrow('Daily assistant voice limit');expect(speak).not.toHaveBeenCalled();
});
it('aborting a pending TTS request never starts playback or fallback',async()=>{
 const controller=new AbortController();mocks.invoke.mockImplementation(async()=>{controller.abort();return {data:new Blob(['audio']),error:null};});
 const speak=vi.fn();vi.stubGlobal('window',{speechSynthesis:{speak}});
 await expect(speakText('c','Hello',controller.signal)).rejects.toThrow();expect(speak).not.toHaveBeenCalled();
});
it('releases the mic when permission arrives after End',async()=>{
 let grant!:(stream:unknown)=>void;const stop=vi.fn();
 vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>new Promise(resolve=>{grant=resolve;})}});
 vi.stubGlobal('MediaRecorder',class{});vi.stubGlobal('AudioContext',class{});vi.stubGlobal('cancelAnimationFrame',vi.fn());
 const controller=new AbortController();const pending=listenOnce(controller.signal,()=>{});controller.abort();grant({getTracks:()=>[{stop}]});
 await expect(pending).rejects.toThrow();expect(stop).toHaveBeenCalledOnce();
});
it('stops on 1.6 seconds of silence after speech and releases mic/audio context',async()=>{
 vi.useFakeTimers();let loud=true;const stop=vi.fn();const close=vi.fn().mockResolvedValue(undefined);
 vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop}]})}});
 vi.stubGlobal('requestAnimationFrame',(fn:()=>void)=>setTimeout(fn,50));vi.stubGlobal('cancelAnimationFrame',clearTimeout);
 vi.stubGlobal('AudioContext',class{createAnalyser(){return {fftSize:128,getByteTimeDomainData:(samples:Uint8Array)=>samples.fill(loud?160:128)}}createMediaStreamSource(){return {connect:()=>{}}}close=close;});
 vi.stubGlobal('MediaRecorder',class{
  static isTypeSupported(){return true;}state='inactive';mimeType='audio/webm';onstop=()=>{};ondataavailable=(_event:unknown)=>{};
  start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['audio'])});this.onstop();}
 });
 const pending=listenOnce(new AbortController().signal,()=>{});
 await vi.advanceTimersByTimeAsync(100);loud=false;await vi.advanceTimersByTimeAsync(1700);
 const recording=await pending;expect(recording.audio.size).toBeGreaterThan(0);expect(recording.duration).toBeLessThan(3);expect(stop).toHaveBeenCalled();expect(close).toHaveBeenCalled();
});
it('does not upload while offline',async()=>{
 vi.stubGlobal('navigator',{onLine:false});await expect(transcribe('c',{audio:new Blob(['a']),duration:1},new AbortController().signal)).rejects.toThrow('network');expect(mocks.invoke).not.toHaveBeenCalled();
});

it('the actual Supabase SDK preserves the edge audio bytes as a Blob',async()=>{
 const {createClient}=await import('@supabase/supabase-js');
 const {VOICE_AUDIO_CONTENT_TYPE}=await import('../../../../supabase/functions/assistant-voice/logic');
 const bytes=new Uint8Array([0xff,0xfb,0x90,0,0xff]);
 const client=createClient('https://project.supabase.co','test-anon',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async()=>new Response(bytes,{headers:{'Content-Type':VOICE_AUDIO_CONTENT_TYPE}})}});
 const {data,error}=await client.functions.invoke('assistant-voice',{body:{kind:'tts',text:'Hi'}});
 expect(error).toBeNull();expect(data).toBeInstanceOf(Blob);expect(new Uint8Array(await data.arrayBuffer())).toEqual(bytes);
});
