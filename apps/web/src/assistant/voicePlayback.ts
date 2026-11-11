/** Call synchronously from Talk's click handler, before microphone/network awaits. */
export function createVoicePlayback(signal:AbortSignal) {
 signal.throwIfAborted();
 if(typeof AudioContext==='undefined') throw new Error('Voice playback is not supported in this browser. You can still type.');
 const context=new AudioContext();
 let closed=false;
 let source:AudioBufferSourceNode|null=null;
 let stopWaiting!:(error:Error)=>void;
 const stopped=new Promise<never>((_resolve,reject)=>{stopWaiting=reject});
 // Closing before the first reply must not create an unhandled rejection.
 void stopped.catch(()=>{});
 const ready=context.resume();
 void ready.catch(()=>{});
 const wait=<T>(pending:Promise<T>)=>Promise.race([pending,stopped]);
 const close=()=>{
  if(closed)return;
  closed=true;signal.removeEventListener('abort',close);
  stopWaiting(new DOMException('Aborted','AbortError'));
  if(source){source.onended=null;source.stop();source.disconnect();source=null;}
  void context.close().catch(()=>{});
 };
 signal.addEventListener('abort',close,{once:true});
 return {
  close,
  async play(blob:Blob) {
   signal.throwIfAborted();
   await wait(ready);
   if(context.state!=='running') throw new Error('Audio playback was paused by the browser.');
   const bytes=await wait(blob.arrayBuffer());
   const decoded=await wait(context.decodeAudioData(bytes));
   signal.throwIfAborted();
   if(closed)throw new DOMException('Aborted','AbortError');
   const next=context.createBufferSource();
   next.buffer=decoded;next.connect(context.destination);source=next;
   try {
    await wait(new Promise<void>((resolve,reject)=>{
     next.onended=()=>resolve();
     try{next.start()}catch(error){reject(error)}
    }));
   } finally {
    next.onended=null;
    if(source===next){next.disconnect();source=null;}
   }
  },
 };
}
