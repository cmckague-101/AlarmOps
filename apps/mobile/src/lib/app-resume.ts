/**
 * Realtime events are missed while the app is backgrounded or offline, and the module-level stores only
 * reload on realtime events or pull-to-refresh. Stores register here to reload when the app returns to the
 * foreground, when the device reconnects, or when their realtime channel rejoins.
 */
const listeners=new Set<()=>unknown>();
/** Short app switches (camera, share sheet) keep the socket alive; longer ones can drop it. */
export const RESUME_AFTER_MS=15_000;
let backgroundedAt:number|null=null;

export function onAppResume(listener:()=>unknown){listeners.add(listener);return()=>{listeners.delete(listener)}}

export function notifyAppResume(){
  listeners.forEach(listener=>{try{void Promise.resolve(listener()).catch(error=>console.warn('Resume refresh failed',error))}catch(error){console.warn('Resume refresh failed',error)}});
}

/** Returns true when the app came back to the foreground after a long enough background stay. */
export function noteAppState(state:string,now=Date.now()){
  if(state==='background'){backgroundedAt??=now;return false}
  if(state!=='active')return false;
  const away=backgroundedAt;backgroundedAt=null;
  return away!==null&&now-away>=RESUME_AFTER_MS;
}

/** Realtime channel subscribe callback that refreshes on every rejoin after the first join. */
export function refreshOnRejoin(refresh:()=>unknown){
  let joined=false;
  return (status:string)=>{if(status!=='SUBSCRIBED')return;if(joined)void Promise.resolve(refresh()).catch(()=>{});joined=true};
}
