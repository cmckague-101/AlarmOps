import {canViewCrewRoster,isCompanyManager,type UserRole} from './models';
import {canWorkShop} from './shop';
import {canManagePersonalTasks} from './tasks';
import {canSendToVipr} from './vipr';

/**
 * Screens the FireOps Assistant can suggest. The assistant-chat edge function
 * answers with one of these ids; web and mobile each map it to their own route.
 * Keep in sync with ASSISTANT_ROUTE_IDS in supabase/functions/assistant-chat/logic.ts
 * (a test checks both lists and the role rules match).
 */
export const ASSISTANT_ROUTE_IDS=[
  'dashboard','operations','fleet','send-to-vipr','vipr-dpls','travel','communications','shop','roster',
  'qualifications','documents','receipts','invoices','payroll','tasks','availability','training',
  'inventory','inspections','audit-log','settings','more',
] as const;
export type AssistantRouteId=typeof ASSISTANT_ROUTE_IDS[number];

/** Web App page for each route id (App.tsx `Page`). */
const WEB_PAGES:Record<AssistantRouteId,string>={
  dashboard:'overview',operations:'operations',fleet:'vehicles','send-to-vipr':'send-vipr','vipr-dpls':'dispatch',
  travel:'hotels',communications:'communications',shop:'shop',roster:'crew',qualifications:'qualifications',
  documents:'documents',receipts:'receipts',invoices:'invoices',payroll:'payroll',tasks:'tasks',
  availability:'availability',training:'training',inventory:'inventory',inspections:'inspections',
  'audit-log':'audit-log',settings:'settings',more:'more',
};

/** Expo Router path for each route id. */
const MOBILE_HREFS:Record<AssistantRouteId,string>={
  dashboard:'/',operations:'/operations',fleet:'/fleet','send-to-vipr':'/send-to-vipr','vipr-dpls':'/dispatch-lists',
  travel:'/hotels',communications:'/communications',shop:'/shop',roster:'/crew',qualifications:'/qualifications',
  documents:'/documents',receipts:'/receipts',invoices:'/invoices',payroll:'/payroll',tasks:'/tasks',
  availability:'/availability',training:'/training',inventory:'/inventory',inspections:'/inspections',
  'audit-log':'/audit-log',settings:'/settings',more:'/more',
};

export const ASSISTANT_ROUTE_LABELS:Record<AssistantRouteId,string>={
  dashboard:'Dashboard',operations:'Operations',fleet:'Fleet','send-to-vipr':'Send to VIPR','vipr-dpls':'VIPR DPLs',
  travel:'Travel',communications:'Communications',shop:'Shop',roster:'Roster',qualifications:'Qualifications',
  documents:'Documents',receipts:'Receipts',invoices:'Invoices',payroll:'Payroll',tasks:'Task List',
  availability:'Availability',training:'Training',inventory:'Inventory',inspections:'Failed Inspections',
  'audit-log':'Audit log',settings:'Settings',more:'More',
};

export function isAssistantRouteId(value:unknown):value is AssistantRouteId{
  return typeof value==='string'&&(ASSISTANT_ROUTE_IDS as readonly string[]).includes(value);
}

/** Whether a role can open the screen; the app hides links to screens the user cannot use. */
export function canOpenAssistantRoute(role:UserRole,id:AssistantRouteId):boolean{
  switch(id){
    case 'shop':return canWorkShop(role);
    case 'roster':return canViewCrewRoster(role);
    case 'send-to-vipr':return canSendToVipr(role);
    case 'tasks':return canManagePersonalTasks(role);
    case 'inspections':case 'audit-log':return isCompanyManager(role);
    default:return true;
  }
}

/** The web page for a route id the role may open, or null. */
export function assistantWebPage(id:unknown,role:UserRole):string|null{
  return isAssistantRouteId(id)&&canOpenAssistantRoute(role,id)?WEB_PAGES[id]:null;
}

/** The mobile path for a route id the role may open, or null. */
export function assistantMobileHref(id:unknown,role:UserRole):string|null{
  return isAssistantRouteId(id)&&canOpenAssistantRoute(role,id)?MOBILE_HREFS[id]:null;
}

/**
 * Drafts the assistant can prepare. Nothing is saved by the assistant: the app
 * opens the existing form (invoice photo scan, receipt photos, a new task) and
 * the user reviews and submits it.
 */
export type AssistantDraft=
  | {kind:'invoice'}
  | {kind:'receipt'}
  | {kind:'task';subject:string;description:string;dueDate:string};

export function canUseAssistantDraft(role:UserRole,draft:AssistantDraft):boolean{
  return draft.kind==='task'?canManagePersonalTasks(role):true;
}

/** Clean a draft from the edge function; null when it is malformed or not allowed for the role. */
export function parseAssistantDraft(value:unknown,role:UserRole):AssistantDraft|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const record=value as Record<string,unknown>;
  let draft:AssistantDraft|null=null;
  if(record.kind==='invoice'||record.kind==='receipt')draft={kind:record.kind};
  else if(record.kind==='task'){
    const subject=typeof record.subject==='string'?record.subject.trim().slice(0,200):'';
    const description=typeof record.description==='string'?record.description.slice(0,5000):'';
    const dueDate=typeof record.dueDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(record.dueDate)?record.dueDate:'';
    if(subject)draft={kind:'task',subject,description,dueDate};
  }
  return draft&&canUseAssistantDraft(role,draft)?draft:null;
}

export function assistantDraftLabel(draft:AssistantDraft,autofillEnabled:boolean):string{
  if(draft.kind==='invoice')return autofillEnabled?'Scan invoice photo':'Open new invoice';
  if(draft.kind==='receipt')return 'Add receipt photos';
  return 'Review task';
}

export type AssistantChatMessage={role:'user'|'assistant';content:string};
export type AssistantChatReply={text:string;navigate:AssistantRouteId|null;draft:AssistantDraft|null};
/** Messages sent back to the edge function as context. */
export const ASSISTANT_HISTORY_LIMIT=12;
export const ASSISTANT_MESSAGE_MAX=2000;

/** Recent turns for the next request: last N user/assistant messages, trimmed. */
export function assistantHistory(items:ReadonlyArray<{role:string;text:string;id?:string}>):AssistantChatMessage[]{
  return items
    .filter(item=>(item.role==='user'||item.role==='assistant')&&item.id!=='welcome'&&item.text.trim())
    .slice(-ASSISTANT_HISTORY_LIMIT)
    .map(item=>({role:item.role as 'user'|'assistant',content:item.text.slice(0,ASSISTANT_MESSAGE_MAX)}));
}

/** Parse the edge function's JSON reply; throws when there is no text. */
export function parseAssistantReply(value:unknown,role:UserRole):AssistantChatReply{
  const record=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const text=typeof record.text==='string'?record.text.trim():'';
  if(!text)throw new Error(typeof record.error==='string'&&record.error?record.error:'The assistant did not answer. Try again.');
  const navigate=isAssistantRouteId(record.navigate)&&canOpenAssistantRoute(role,record.navigate)?record.navigate:null;
  return {text,navigate,draft:parseAssistantDraft(record.draft,role)};
}

// ---------- On-device history (web localStorage and mobile SQLite share these shapes) ----------

export type AssistantChatItem={
  id:string;
  role:'user'|'assistant';
  text:string;
  navigate?:AssistantRouteId|null;
  draft?:AssistantDraft|null;
};
export type AssistantThread={id:string;title:string;updatedAt:string;messages:AssistantChatItem[]};
export const ASSISTANT_MAX_THREADS=30;

export function assistantThreadTitle(messages:ReadonlyArray<AssistantChatItem>):string{
  const first=messages.find(item=>item.role==='user'&&item.id!=='welcome');
  const text=first?.text.trim().replace(/\s+/g,' ')??'';
  if(!text)return 'New chat';
  return text.length>48?`${text.slice(0,45)}…`:text;
}

/** Whether a thread has anything worth saving (at least one message from the user). */
export function isSavableAssistantThread(messages:ReadonlyArray<AssistantChatItem>):boolean{
  return messages.some(item=>item.role==='user'&&item.id!=='welcome');
}

/** Insert or replace a thread at the top, newest first, keeping at most ASSISTANT_MAX_THREADS. */
export function upsertAssistantThread(threads:ReadonlyArray<AssistantThread>,id:string,messages:AssistantChatItem[],now=new Date()):AssistantThread[]{
  const rest=threads.filter(thread=>thread.id!==id);
  if(!isSavableAssistantThread(messages))return rest;
  return [{id,title:assistantThreadTitle(messages),updatedAt:now.toISOString(),messages},...rest].slice(0,ASSISTANT_MAX_THREADS);
}

/** Drop malformed threads read back from storage. */
export function cleanAssistantThreads(value:unknown):AssistantThread[]{
  if(!Array.isArray(value))return [];
  return value
    .filter((thread):thread is AssistantThread=>Boolean(thread)&&typeof thread.id==='string'&&typeof thread.updatedAt==='string'&&Array.isArray(thread.messages))
    .map(thread=>({...thread,title:typeof thread.title==='string'?thread.title:assistantThreadTitle(thread.messages),messages:thread.messages.filter(item=>item&&typeof item.id==='string'&&typeof item.text==='string'&&(item.role==='user'||item.role==='assistant'))}))
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))
    .slice(0,ASSISTANT_MAX_THREADS);
}

export function createAssistantThreadId(){
  return `t-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
}

export function formatAssistantThreadTime(iso:string,now=new Date()):string{
  const date=new Date(iso);
  if(Number.isNaN(date.getTime()))return '';
  const mins=Math.round((now.getTime()-date.getTime())/60000);
  if(mins<1)return 'Just now';
  if(mins<60)return `${mins}m ago`;
  const hours=Math.round(mins/60);
  if(hours<24)return `${hours}h ago`;
  const days=Math.round(hours/24);
  if(days<7)return `${days}d ago`;
  return date.toLocaleDateString();
}

export const ASSISTANT_SUGGESTIONS=[
  'Which units are out of service?',
  'Whose qualifications expire soon?',
  'Where do I add a receipt?',
] as const;

export const ASSISTANT_WELCOME='Hi! Ask me where to find something in FireOps, or about your company’s fleet, qualifications, invoices and tasks. I can also start an invoice, receipt or task for you to review. Chats stay on this device.';
export const ASSISTANT_OFFLINE='The assistant needs a network connection.';
