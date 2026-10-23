/** Online form primitives only: no persistence, queue, polling or reconnect replay. */
export type AccountRpcClient={auth:{getSession():PromiseLike<{data:{session:{user:{id:string};access_token:string}|null};error:unknown}>};rpc(name:string,args:Record<string,unknown>):{setHeader(key:string,value:string):{abortSignal(signal:AbortSignal):PromiseLike<{data:unknown;error:unknown}>}}};
export type AccountRpcTransport={invoke(name:string,args:Record<string,unknown>,signal:AbortSignal,current:()=>boolean):Promise<unknown>};
const changed=()=>Object.assign(new Error('Online account changed.'),{code:'ONLINE_ACCOUNT_CHANGED'});
export function createAccountRpcTransport(client:AccountRpcClient,actorId:string,online:()=>boolean=()=>true):AccountRpcTransport{
  return {async invoke(name,args,signal,current){
    const guard=()=>{if(!current()||signal.aborted)throw changed();if(!online())throw new Error('A connection is required. This choice remains only in memory.');};
    guard();const {data,error}=await client.auth.getSession();guard();
    if(error||!data.session||data.session.user.id!==actorId)throw changed();
    const result=await client.rpc(name,args).setHeader('Authorization',`Bearer ${data.session.access_token}`).abortSignal(signal);
    if(!current()||signal.aborted)throw changed();if(result.error)throw result.error;return result.data;
  }};
}
export async function readOnlineValue<T>(label:string,current:()=>boolean,read:(signal:AbortSignal)=>Promise<T>){
  const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([
    (async()=>{if(!current())throw changed();const value=await read(abort.signal);if(!current()||abort.signal.aborted)throw changed();return value})(),
    new Promise<never>((_yes,no)=>{timer=setTimeout(()=>{abort.abort();no(new Error(`${label} refresh timed out.`))},15_000)}),
  ])}finally{if(timer)clearTimeout(timer);abort.abort()}
}
export function createOnlineWrite<Receipt extends {},Value>(options:{label:string;send:(signal:AbortSignal,current:()=>boolean)=>Promise<unknown>;accept:(raw:unknown)=>Receipt;read:(receipt:Receipt,signal:AbortSignal,current:()=>boolean)=>Promise<Value>;timeoutMs?:number}){
  let receipt:Receipt|undefined;
  let flight:{current:()=>boolean;abort:AbortController;promise:Promise<Value>}|undefined;
  function run(current:()=>boolean):Promise<Value>{
    if(!current())return Promise.reject(changed());
    if(flight?.current())return flight.promise;
    flight?.abort.abort();
    const abort=new AbortController();let timedOut=false;let timer:ReturnType<typeof setTimeout>|undefined;let cancel:()=>void=()=>{};
    const attempt={current,abort,promise:undefined as unknown as Promise<Value>};flight=attempt;
    const guard=()=>{if(!current()||abort.signal.aborted)throw changed();};
    attempt.promise=(async()=>{
      try{return await Promise.race([
        (async()=>{
          guard();if(receipt===undefined){const raw=await options.send(abort.signal,current);guard();receipt=options.accept(raw);}
          const value=await options.read(receipt,abort.signal,current);guard();return value;
        })(),
        new Promise<never>((_yes,no)=>{cancel=()=>no(timedOut?new Error(`${options.label} request timed out. Retry the original choice.`):changed());abort.signal.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>{timedOut=true;abort.abort()},options.timeoutMs??15_000)}),
      ])}finally{if(timer)clearTimeout(timer);abort.signal.removeEventListener('abort',cancel);abort.abort();if(flight===attempt)flight=undefined}
    })();return attempt.promise;
  }
  return {run,get acknowledged(){return receipt!==undefined}};
}
