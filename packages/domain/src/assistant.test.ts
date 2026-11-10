import {describe,expect,it} from 'vitest';
import {
  ASSISTANT_ROUTE_IDS,assistantHistory,assistantMobileHref,assistantThreadTitle,assistantWebPage,canOpenAssistantRoute,
  cleanAssistantThreads,parseAssistantDraft,parseAssistantReply,upsertAssistantThread,type AssistantChatItem,
} from './assistant';
import {assignableUserRoles,type UserRole} from './models';
import * as edge from '../../../supabase/functions/assistant-chat/logic';

const roles:UserRole[]=['owner',...assignableUserRoles.map(option=>option.value)];

describe('assistant routes',()=>{
  it('matches the edge function route ids and role rules',()=>{
    expect([...ASSISTANT_ROUTE_IDS]).toEqual([...edge.ASSISTANT_ROUTE_IDS]);
    expect([...roles].sort()).toEqual([...edge.ROLES].sort());
    for(const role of roles)for(const id of ASSISTANT_ROUTE_IDS)expect(canOpenAssistantRoute(role,id),`${role} ${id}`).toBe(edge.canOpenRoute(role,id));
  });
  it('maps every route id to a web page and a mobile path',()=>{
    expect(assistantWebPage('fleet','owner')).toBe('vehicles');
    expect(assistantWebPage('dashboard','fire_fighter')).toBe('overview');
    expect(assistantMobileHref('fleet','owner')).toBe('/fleet');
    expect(assistantMobileHref('vipr-dpls','owner')).toBe('/dispatch-lists');
    for(const id of ASSISTANT_ROUTE_IDS){expect(assistantWebPage(id,'owner')).toBeTruthy();expect(assistantMobileHref(id,'owner')).toMatch(/^\//)}
  });
  it('hides screens the role cannot open and unknown ids',()=>{
    expect(assistantWebPage('roster','resource_boss')).toBeNull();
    expect(assistantMobileHref('shop','fire_fighter')).toBeNull();
    expect(assistantMobileHref('tasks','accounting')).toBeNull();
    expect(assistantWebPage('send-to-vipr','shop_tech')).toBeNull();
    expect(assistantWebPage('audit-log','admin')).toBe('audit-log');
    expect(assistantWebPage('javascript:alert(1)','owner')).toBeNull();
    expect(assistantMobileHref(undefined,'owner')).toBeNull();
  });
});

describe('assistant replies and drafts',()=>{
  it('parses a reply and drops links and drafts the role may not use',()=>{
    expect(parseAssistantReply({text:' Two units. ',navigate:'fleet',draft:null},'fire_fighter')).toEqual({text:'Two units.',navigate:'fleet',draft:null});
    expect(parseAssistantReply({text:'Hi',navigate:'audit-log',draft:{kind:'task',subject:'Oil'}},'fire_fighter')).toEqual({text:'Hi',navigate:null,draft:null});
    expect(()=>parseAssistantReply({error:'Daily assistant limit reached.'},'owner')).toThrow('Daily assistant limit reached.');
    expect(()=>parseAssistantReply(null,'owner')).toThrow();
  });
  it('cleans task drafts',()=>{
    expect(parseAssistantDraft({kind:'task',subject:'  Change oil E-12 ',description:'Bring filter',dueDate:'2026-11-12'},'shop_tech')).toEqual({kind:'task',subject:'Change oil E-12',description:'Bring filter',dueDate:'2026-11-12'});
    expect(parseAssistantDraft({kind:'task',subject:'x',dueDate:'tomorrow'},'owner')).toEqual({kind:'task',subject:'x',description:'',dueDate:''});
    expect(parseAssistantDraft({kind:'task',subject:'  '},'owner')).toBeNull();
    expect(parseAssistantDraft({kind:'invoice'},'fire_fighter')).toEqual({kind:'invoice'});
    expect(parseAssistantDraft({kind:'payroll'},'owner')).toBeNull();
  });
  it('sends only recent user and assistant turns',()=>{
    const items=[{id:'welcome',role:'assistant',text:'Hi'},...Array.from({length:20},(_,index)=>({id:`m${index}`,role:index%2?'assistant':'user',text:`m${index}`}))];
    const history=assistantHistory(items);
    expect(history).toHaveLength(12);
    expect(history[0]).toEqual({role:'user',content:'m8'});
    expect(history[history.length-1]).toEqual({role:'assistant',content:'m19'});
  });
});

describe('assistant history',()=>{
  const user=(text:string):AssistantChatItem=>({id:`u-${text}`,role:'user',text});
  it('titles threads from the first message and skips empty chats',()=>{
    expect(assistantThreadTitle([user('  Which   units are down? ')])).toBe('Which units are down?');
    expect(assistantThreadTitle([user('x'.repeat(60))])).toBe(`${'x'.repeat(45)}…`);
    expect(upsertAssistantThread([],'t1',[{id:'welcome',role:'assistant',text:'Hi'}])).toEqual([]);
  });
  it('keeps the newest 30 threads, newest first',()=>{
    let threads=upsertAssistantThread([],'a',[user('a')],new Date('2026-11-01T00:00:00Z'));
    threads=upsertAssistantThread(threads,'b',[user('b')],new Date('2026-11-02T00:00:00Z'));
    threads=upsertAssistantThread(threads,'a',[user('a'),user('again')],new Date('2026-11-03T00:00:00Z'));
    expect(threads.map(thread=>thread.id)).toEqual(['a','b']);
    for(let index=0;index<40;index+=1)threads=upsertAssistantThread(threads,`n${index}`,[user(String(index))]);
    expect(threads).toHaveLength(30);
  });
  it('drops malformed stored threads',()=>{
    expect(cleanAssistantThreads('nope')).toEqual([]);
    expect(cleanAssistantThreads([{id:'a',updatedAt:'2026-11-01',messages:[{id:'1',role:'user',text:'hi'},{id:'2',role:'system',text:'x'}]},{id:5}])).toEqual([{id:'a',title:'hi',updatedAt:'2026-11-01',messages:[{id:'1',role:'user',text:'hi'}]}]);
  });
});
