type Registration={userId:string;pauses:number;pause:()=>void;resume:()=>void};
let active:Registration|null=null;
/** Only the current native provider registers; stale cleanup cannot affect a newer account. */
export function registerOfflineSyncSession(userId:string,callbacks:{pause:()=>void;resume:()=>void}){
  const registration:Registration={userId,pauses:0,...callbacks};active=registration;
  return()=>{if(active===registration)active=null};
}
export function offlineSyncSessionPaused(userId:string){return active?.userId===userId&&active.pauses>0}
export function pauseOfflineSyncForSignOut(userId:string){
  const registration=active;
  if(!registration||registration.userId!==userId)return()=>{};
  registration.pauses+=1;if(registration.pauses===1)registration.pause();
  let released=false;
  return()=>{if(released)return;released=true;if(active===registration){registration.pauses-=1;if(!registration.pauses)registration.resume()}};
}
