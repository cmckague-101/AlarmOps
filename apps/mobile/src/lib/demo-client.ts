import {createClient} from '@supabase/supabase-js';
import {createDemoBackend} from './demo-backend';

export function createDemoClient(companyId:string){
  const backend=createDemoBackend(companyId);
  const client=createClient('https://demo.invalid','demo-public-key',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:backend.fetch},
  });
  // Functions normally hide the response message behind a generic HTTP error.
  // Preserve the local demo restriction so existing native forms explain it.
  const functions=client.functions;
  const invoke=functions.invoke.bind(functions);
  functions.invoke=(async(name,options)=>{
    const result=await invoke(name,options);
    if(result.error?.context instanceof Response){
      const body=await result.error.context.clone().json().catch(()=>null);
      if(typeof body?.message==='string')result.error.message=body.message;
    }
    return result;
  }) as typeof functions.invoke;
  Object.defineProperty(client,'functions',{value:functions});
  // Local subscriptions keep existing native stores working without realtime sockets.
  client.channel=((..._args:unknown[])=>{
    const handlers:{table:string;callback:(payload:Record<string,unknown>)=>void}[]=[];
    let unsubscribe:(()=>void)|undefined;
    const channel={
      on(_event:string,filter:{table:string},callback:(payload:Record<string,unknown>)=>void){handlers.push({table:filter.table,callback});return channel},
      subscribe(){unsubscribe?.();unsubscribe=backend.subscribe((table,payload)=>queueMicrotask(()=>{
        if(unsubscribe)handlers.filter(handler=>handler.table===table).forEach(handler=>handler.callback(payload));
      }));return channel},
      unsubscribe(){unsubscribe?.();unsubscribe=undefined;return Promise.resolve('ok')},
      teardown(){unsubscribe?.();unsubscribe=undefined},
    };
    return channel;
  }) as typeof client.channel;
  client.removeChannel=(async channel=>{await channel.unsubscribe();return 'ok'}) as typeof client.removeChannel;
  return {client,dispose:backend.dispose};
}
