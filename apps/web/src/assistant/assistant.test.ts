import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),select:vi.fn()}));
vi.mock('../supabase',()=>({supabase:{
  functions:{invoke:mocks.invoke},
  from:()=>({select:(columns:string)=>({eq:()=>({maybeSingle:()=>mocks.select(columns)})})}),
}}));
import {askAssistant,loadAssistantEnabled} from './assistantClient';
import {loadAssistantChats,saveAssistantChats} from './conversationStore';

const store=new Map<string,string>();
beforeEach(()=>{
  vi.clearAllMocks();store.clear();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>void store.set(key,value),removeItem:(key:string)=>void store.delete(key)});
});

describe('assistant client',()=>{
  it('reads the per-company add-on switch',async()=>{
    mocks.select.mockResolvedValueOnce({data:{assistant_enabled:true},error:null});
    expect(await loadAssistantEnabled('c1')).toBe(true);
    expect(mocks.select).toHaveBeenCalledWith('assistant_enabled');
    mocks.select.mockResolvedValueOnce({data:null,error:{message:'no'}});
    expect(await loadAssistantEnabled('c1')).toBe(false);
  });
  it('sends recent turns to the edge function and keeps only allowed links',async()=>{
    mocks.invoke.mockResolvedValue({data:{text:'E-12 is out of service.',navigate:'audit-log',draft:{kind:'receipt'}},error:null});
    const reply=await askAssistant('c1','fire_fighter',[{id:'welcome',role:'assistant',text:'Hi'},{id:'u1',role:'user',text:'Which units are down?'}]);
    expect(reply).toEqual({text:'E-12 is out of service.',navigate:null,draft:{kind:'receipt'}});
    const [name,options]=mocks.invoke.mock.calls[0];
    expect(name).toBe('assistant-chat');
    expect(options.body).toMatchObject({companyId:'c1',messages:[{role:'user',content:'Which units are down?'}]});
    expect(options.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(options)).not.toMatch(/xai|api_key/i);
  });
  it('shows the server message, such as the daily limit',async()=>{
    mocks.invoke.mockResolvedValue({data:null,error:{context:{json:async()=>({error:'Daily assistant limit reached. Try again tomorrow.'})}}});
    await expect(askAssistant('c1','owner',[{id:'u1',role:'user',text:'hi'}])).rejects.toThrow('Daily assistant limit reached.');
  });
});

describe('assistant chat history on this device',()=>{
  const thread={id:'t1',title:'Units',updatedAt:'2026-11-10T00:00:00.000Z',messages:[{id:'u1',role:'user' as const,text:'Units'}]};
  it('keeps chats per user and company',()=>{
    saveAssistantChats('u1','c1',{threads:[thread],activeId:'t1'});
    expect(loadAssistantChats('u1','c1')).toEqual({threads:[thread],activeId:'t1'});
    expect(loadAssistantChats('u2','c1')).toEqual({threads:[],activeId:null});
    expect(loadAssistantChats('u1','c2')).toEqual({threads:[],activeId:null});
  });
  it('removes the entry when everything is deleted and survives bad data',()=>{
    saveAssistantChats('u1','c1',{threads:[thread],activeId:'t1'});
    saveAssistantChats('u1','c1',{threads:[],activeId:null});
    expect(store.size).toBe(0);
    store.set('fireops-assistant:u1:c1','{oops');
    expect(loadAssistantChats('u1','c1')).toEqual({threads:[],activeId:null});
  });
});
