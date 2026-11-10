import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),select:vi.fn(),demo:false}));
vi.mock('./supabase',()=>({
  isDemoActive:()=>mocks.demo,
  supabase:{functions:{invoke:mocks.invoke},from:()=>({select:(columns:string)=>({eq:()=>({maybeSingle:()=>mocks.select(columns)})})})},
}));
import {askAssistant,loadAssistantEnabled,loadAssistantVoiceEnabled} from './assistant-client';

beforeEach(()=>{vi.clearAllMocks();mocks.demo=false});

describe('mobile assistant client',()=>{
  it('reads the add-on switch and is always off in demo',async()=>{
    mocks.select.mockResolvedValue({data:{assistant_enabled:true},error:null});
    expect(await loadAssistantEnabled('c1')).toBe(true);
    mocks.demo=true;
    expect(await loadAssistantEnabled('c1')).toBe(false);
  });
  it('asks the edge function and keeps only links the role can open',async()=>{
    mocks.invoke.mockResolvedValue({data:{text:'Open Roster.',navigate:'roster',draft:{kind:'task',subject:'Call Ana'}},error:null});
    expect(await askAssistant('c1','resource_boss',[{id:'u1',role:'user',text:'Who is on the crew?'}])).toEqual({text:'Open Roster.',navigate:null,draft:null});
    expect(mocks.invoke).toHaveBeenCalledWith('assistant-chat',{body:expect.objectContaining({companyId:'c1',messages:[{role:'user',content:'Who is on the crew?'}]})});
  });
  it('explains a lost connection and server limits',async()=>{
    mocks.invoke.mockResolvedValueOnce({data:null,error:{message:'This action requires a connection.'}});
    await expect(askAssistant('c1','owner',[{id:'u1',role:'user',text:'hi'}])).rejects.toThrow('The assistant needs a network connection.');
    mocks.invoke.mockResolvedValueOnce({data:null,error:{message:'x',context:{json:async()=>({error:'The FireOps Assistant is not included for this company.'})}}});
    await expect(askAssistant('c1','owner',[{id:'u1',role:'user',text:'hi'}])).rejects.toThrow('not included');
  });
});

it('voice requires both paid switches and fails closed on errors',async()=>{
 for(const [chat,voice,expected] of [[false,false,false],[true,false,false],[false,true,false],[true,true,true]]){
  mocks.select.mockResolvedValue({data:{assistant_enabled:chat,assistant_voice_enabled:voice},error:null});
  expect(await loadAssistantVoiceEnabled('c1')).toBe(expected);
 }
 mocks.select.mockRejectedValue(new Error('offline'));expect(await loadAssistantVoiceEnabled('c1')).toBe(false);
});
