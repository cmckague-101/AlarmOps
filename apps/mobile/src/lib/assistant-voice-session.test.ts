import {beforeEach,it,expect,vi} from 'vitest';
const native=vi.hoisted(()=>({mode:vi.fn(),stop:vi.fn(),speak:vi.fn(),start:vi.fn(),abort:vi.fn(),finish:vi.fn(),permission:vi.fn(),listeners:new Map<string,(value?:any)=>void>()}));
vi.mock('expo-audio',()=>({setAudioModeAsync:native.mode}));
vi.mock('expo-speech',()=>({stop:native.stop,speak:native.speak}));
vi.mock('expo-speech-recognition',()=>({ExpoSpeechRecognitionModule:{
 isRecognitionAvailable:()=>true,supportsOnDeviceRecognition:()=>true,
 requestPermissionsAsync:native.permission,start:native.start,stop:native.finish,abort:native.abort,
 addListener:(name:string,fn:(value:any)=>void)=>{native.listeners.set(name,fn);return {remove:()=>native.listeners.delete(name)};},
}}));
import {listenOnce,speakText,releaseVoiceAudio} from './assistant-voice-session';
beforeEach(()=>{vi.clearAllMocks();native.listeners.clear();native.permission.mockResolvedValue({granted:true});});
it('uses local recognition with an audio session that cannot continue in background',async()=>{
 const pending=listenOnce(new AbortController().signal);
 for(let i=0;i<10;i++)await Promise.resolve();
 expect(native.start).toHaveBeenCalledWith(expect.objectContaining({requiresOnDeviceRecognition:true,continuous:false}));
 expect(native.mode).toHaveBeenCalledWith(expect.objectContaining({allowsRecording:true,shouldPlayInBackground:false}));
 native.listeners.get('result')!({isFinal:true,results:[{transcript:'Open Fleet'}]});
 expect(await pending).toBe('Open Fleet');expect(native.listeners.size).toBe(0);expect(native.abort).toHaveBeenCalled();
});
it('reports permission denial while leaving text chat untouched',async()=>{
 native.permission.mockResolvedValue({granted:false});
 await expect(listenOnce(new AbortController().signal)).rejects.toThrow('You can still type');expect(native.start).not.toHaveBeenCalled();
});
it('cancels recognition and removes listeners on End or background',async()=>{
 const controller=new AbortController();const pending=listenOnce(controller.signal);
 for(let i=0;i<10;i++)await Promise.resolve();controller.abort();
 await expect(pending).rejects.toThrow('Voice ended');expect(native.listeners.size).toBe(0);
 await releaseVoiceAudio();expect(native.stop).toHaveBeenCalled();expect(native.mode).toHaveBeenLastCalledWith({allowsRecording:false,shouldPlayInBackground:false});
});
it('device TTS releases playback on cancellation',async()=>{
 const controller=new AbortController();const pending=speakText('Hello',controller.signal);
 for(let i=0;i<10;i++)await Promise.resolve();expect(native.speak).toHaveBeenCalled();controller.abort();
 await expect(pending).rejects.toThrow('Voice ended');expect(native.stop).toHaveBeenCalled();
});
