import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type PropsWithChildren} from 'react';
import {
  ASSISTANT_OFFLINE,ASSISTANT_WELCOME,createAssistantThreadId,upsertAssistantThread,
  type AssistantChatItem,type AssistantThread,type FireOpsUser,
} from '@fireops/domain';
import {askAssistant,loadAssistantEnabled} from '@/lib/assistant-client';
import {loadAssistantChats,saveAssistantChats} from '@/lib/assistant-conversation-store';
import {loadReceiptAutofillEnabled} from '@/lib/receipts-store';
import {useNetworkStatus} from './network-provider';
import {useSession} from './session-provider';

export const assistantWelcome:AssistantChatItem={id:'welcome',role:'assistant',text:ASSISTANT_WELCOME};

type AssistantContextValue={
  /** The company has the add-on and the user is signed in to it. */
  enabled:boolean;
  offline:boolean;
  autofillEnabled:boolean;
  user:FireOpsUser|null;
  open:boolean;
  setOpen:(open:boolean)=>void;
  view:'chat'|'history';
  setView:(view:'chat'|'history')=>void;
  messages:AssistantChatItem[];
  threads:AssistantThread[];
  threadId:string;
  busy:boolean;
  error:string;
  input:string;
  setInput:(value:string)=>void;
  send:(prompt:string)=>Promise<void>;
  startNewChat:()=>void;
  openThread:(thread:AssistantThread)=>void;
  removeThread:(id:string)=>void;
  clearAll:()=>void;
};

const AssistantContext=createContext<AssistantContextValue|null>(null);

/** FireOps Assistant chat state for the signed-in member. Chats stay on this phone (SQLite), per user and company. */
export function AssistantProvider({children}:PropsWithChildren){
  const {access}=useSession();
  const {isOffline:offline}=useNetworkStatus();
  const member=access.value?.kind==='member'?access.value:null;
  const companyId=member?.company.id??null;
  const user=member?.user??null;
  const userId=user?.id??null;
  const [enabled,setEnabled]=useState(false);
  const [autofillEnabled,setAutofillEnabled]=useState(false);
  const [open,setOpen]=useState(false);
  const [view,setView]=useState<'chat'|'history'>('chat');
  const [input,setInput]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [threadId,setThreadId]=useState(()=>createAssistantThreadId());
  const [messages,setMessages]=useState<AssistantChatItem[]>([assistantWelcome]);
  const [threads,setThreads]=useState<AssistantThread[]>([]);
  const threadsRef=useRef(threads);threadsRef.current=threads;
  const request=useRef(0);

  // The add-on switch; re-checked when the company changes or the phone reconnects (offline uses the cached answer).
  useEffect(()=>{
    let active=true;
    if(!companyId){setEnabled(false);setAutofillEnabled(false);return}
    void loadAssistantEnabled(companyId).then(value=>{if(active)setEnabled(value)});
    if(!offline)void loadReceiptAutofillEnabled(companyId).then(value=>{if(active)setAutofillEnabled(value)});
    return()=>{active=false};
  },[companyId,offline]);

  // Load this user's saved chats for this company; a different user or company never sees them.
  useEffect(()=>{
    let active=true;
    request.current+=1;
    setBusy(false);setError('');setInput('');setView('chat');setOpen(false);
    setThreads([]);setThreadId(createAssistantThreadId());setMessages([assistantWelcome]);
    if(!userId||!companyId)return;
    void loadAssistantChats(userId,companyId).then(saved=>{
      if(!active)return;
      setThreads(saved.threads);
      const current=saved.threads.find(thread=>thread.id===saved.activeId);
      if(current){setThreadId(current.id);setMessages(current.messages.length?current.messages:[assistantWelcome])}
    }).catch(()=>{/* SQLite unavailable: chat still works without history. */});
    return()=>{active=false};
  },[userId,companyId]);

  const persist=useCallback((next:AssistantThread[],activeId:string|null)=>{
    threadsRef.current=next;setThreads(next);
    if(userId&&companyId)void saveAssistantChats(userId,companyId,next,activeId);
  },[userId,companyId]);

  const record=useCallback((id:string,next:AssistantChatItem[])=>{
    setMessages(next);
    persist(upsertAssistantThread(threadsRef.current,id,next),id);
  },[persist]);

  const send=useCallback(async(prompt:string)=>{
    const text=prompt.trim();
    if(!text||busy||!user||!companyId)return;
    if(offline){setError(ASSISTANT_OFFLINE);return}
    setError('');setInput('');setBusy(true);
    const ticket=++request.current;
    const id=threadId;
    const withUser=[...messages,{id:`u-${Date.now()}`,role:'user' as const,text}];
    record(id,withUser);
    try{
      const reply=await askAssistant(companyId,user.role,withUser);
      if(ticket!==request.current)return;
      record(id,[...withUser,{id:`a-${Date.now()}`,role:'assistant',text:reply.text,navigate:reply.navigate,draft:reply.draft}]);
    }catch(failure){
      if(ticket===request.current)setError(failure instanceof Error?failure.message:'The assistant could not answer right now. Try again.');
    }finally{
      if(ticket===request.current)setBusy(false);
    }
  },[busy,user,companyId,offline,threadId,messages,record]);

  const startNewChat=useCallback(()=>{
    request.current+=1;setBusy(false);
    const id=createAssistantThreadId();
    setThreadId(id);setMessages([assistantWelcome]);setView('chat');setError('');setInput('');
    persist(threadsRef.current,id);
  },[persist]);

  const openThread=useCallback((thread:AssistantThread)=>{
    request.current+=1;setBusy(false);
    setThreadId(thread.id);setMessages(thread.messages.length?thread.messages:[assistantWelcome]);setView('chat');setError('');
    persist(threadsRef.current,thread.id);
  },[persist]);

  const removeThread=useCallback((id:string)=>{
    const next=threadsRef.current.filter(thread=>thread.id!==id);
    if(id===threadId){
      request.current+=1;setBusy(false);
      const fresh=createAssistantThreadId();
      setThreadId(fresh);setMessages([assistantWelcome]);setError('');
      persist(next,fresh);
    }else persist(next,threadId);
  },[persist,threadId]);

  const clearAll=useCallback(()=>{
    request.current+=1;setBusy(false);
    const fresh=createAssistantThreadId();
    setThreadId(fresh);setMessages([assistantWelcome]);setError('');setView('chat');
    persist([],null);
  },[persist]);

  const value=useMemo<AssistantContextValue>(()=>({
    enabled:Boolean(enabled&&user&&companyId),offline,autofillEnabled,user,open,setOpen,view,setView,messages,threads,threadId,busy,error,input,setInput,
    send,startNewChat,openThread,removeThread,clearAll,
  }),[enabled,user,companyId,offline,autofillEnabled,open,view,messages,threads,threadId,busy,error,input,send,startNewChat,openThread,removeThread,clearAll]);

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(){
  const value=useContext(AssistantContext);
  if(!value)throw new Error('Assistant provider is missing.');
  return value;
}
