import {supabase} from '../supabase';

async function voiceRequest(body: FormData | {companyId:string;kind:'tts';text:string}, signal:AbortSignal) {
  if (!supabase) throw new Error('Assistant voice is unavailable.');
  if (navigator.onLine === false) throw new Error('The assistant needs a network connection.');
  const {data,error} = await supabase.functions.invoke('assistant-voice',{body,signal});
  if (error) {
    let message = '';
    try { message = (await error.context?.json())?.error ?? ''; } catch { /* non-JSON */ }
    throw new Error(message || 'Assistant voice is unavailable. Check your connection or use text chat.');
  }
  return data;
}

/** One recording, bounded to 60 seconds. Abort releases every resource, including a late permission grant. */
export async function listenOnce(signal:AbortSignal, onReady:(finish:()=>void)=>void):Promise<{audio:Blob;duration:number}> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || typeof AudioContext === 'undefined') throw new Error('Voice input is not supported in this browser. You can still type.');
  const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}}).catch(()=>{throw new Error('Microphone access is required for voice. You can still type.');});
  let context:AudioContext|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let frame = 0;
  let abort:()=>void = ()=>{};
  try {
    signal.throwIfAborted();
    context = new AudioContext();
    const analyser = context.createAnalyser();
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const mimeType = ['audio/webm;codecs=opus','audio/mp4','audio/ogg'].find(type=>MediaRecorder.isTypeSupported(type));
    const recorder = mimeType ? new MediaRecorder(stream,{mimeType}) : new MediaRecorder(stream);
    const chunks:Blob[] = []; let bytes = 0; let speech = false; let quietSince = 0;
    const started = Date.now();
    const audio = await new Promise<Blob>((resolve,reject)=>{
      const finish = ()=>{if(recorder.state === 'recording')recorder.stop();};
      abort = ()=>{finish();reject(new DOMException('Aborted','AbortError'));};
      recorder.ondataavailable = event=>{chunks.push(event.data);bytes+=event.data.size;if(bytes>10*1024*1024){finish();reject(new Error('Recording is too large. Try a shorter question.'));}};
      recorder.onstop = ()=>resolve(new Blob(chunks,{type:recorder.mimeType}));
      recorder.onerror = ()=>reject(new Error('Microphone recording failed. You can still type.'));
      signal.addEventListener('abort',abort,{once:true});
      recorder.start(250);onReady(finish);
      timer = setTimeout(finish,59_500);
      const watch = ()=>{
        analyser.getByteTimeDomainData(samples);
        const level = Math.sqrt(samples.reduce((sum,value)=>sum+((value-128)/128)**2,0)/samples.length);
        if(level>0.028){speech=true;quietSince=0;}
        else if(speech){quietSince ||= Date.now();if(Date.now()-quietSince>=1600){finish();return;}}
        if(recorder.state==='recording')frame=requestAnimationFrame(watch);
      };
      frame=requestAnimationFrame(watch);
    });
    signal.throwIfAborted();
    return {audio,duration:Math.min(60,(Date.now()-started)/1000)};
  } finally {
    signal.removeEventListener('abort',abort);clearTimeout(timer);cancelAnimationFrame(frame);
    stream.getTracks().forEach(track=>track.stop());void context?.close().catch(()=>{});
  }
}

export async function transcribe(companyId:string, recording:{audio:Blob;duration:number}, signal:AbortSignal):Promise<string> {
  const body = new FormData();
  body.append('companyId',companyId);body.append('kind','stt');body.append('duration',String(recording.duration));body.append('file',recording.audio,'question.audio');
  const data = await voiceRequest(body,signal);
  if (!data?.text?.trim()) throw new Error('No speech detected. Tap Talk and try again.');
  return data.text;
}

export async function speakText(companyId:string,text:string,signal:AbortSignal,options?:{
  playAudio:(blob:Blob)=>Promise<void>;
  onFallback:()=>void;
}) {
  signal.throwIfAborted();
  try {
    const blob = await voiceRequest({companyId,kind:'tts',text:text.slice(0,2000)},signal);
    signal.throwIfAborted();
    if(!(blob instanceof Blob)) throw new Error('Audio response was unreadable.');
    if(options){await options.playAudio(blob);return;}
    const url = URL.createObjectURL(new Blob([blob],{type:'audio/mpeg'}));
    const audio = new Audio(url);
    let abort:()=>void = ()=>{};
    try {
      await new Promise<void>((resolve,reject)=>{
        abort = ()=>{audio.pause();audio.src='';reject(new DOMException('Aborted','AbortError'));};
        signal.addEventListener('abort',abort,{once:true});
        audio.onended=()=>resolve();audio.onerror=()=>reject(new Error('Playback failed.'));
        void audio.play().catch(reject);
      });
    } finally {signal.removeEventListener('abort',abort);audio.pause();audio.src='';URL.revokeObjectURL(url);}
  } catch (error) {
    signal.throwIfAborted();
    // Limits and switches remain authoritative; only service/playback failures use device TTS.
    if(error instanceof Error && /limit|not included/i.test(error.message)) throw error;
    if(!window.speechSynthesis) throw new Error('Audio playback is unavailable. Your reply is in the chat.');
    options?.onFallback();
    await new Promise<void>((resolve,reject)=>{
      const utterance = new SpeechSynthesisUtterance(text);
      const abort = ()=>{window.speechSynthesis.cancel();cleanup();reject(new DOMException('Aborted','AbortError'));};
      const cleanup = ()=>signal.removeEventListener('abort',abort);
      utterance.onend=()=>{cleanup();resolve();};utterance.onerror=()=>{cleanup();reject(new Error('Audio playback failed. Your reply is in the chat.'));};
      signal.addEventListener('abort',abort,{once:true});window.speechSynthesis.speak(utterance);
    });
  }
}
