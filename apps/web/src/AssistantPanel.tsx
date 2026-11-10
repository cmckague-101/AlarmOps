import {useEffect,useRef,useState,type ReactNode} from 'react';
import {History,Plus,Send,Trash2,WifiOff,X} from 'lucide-react';
import {
  ASSISTANT_OFFLINE,ASSISTANT_ROUTE_LABELS,ASSISTANT_SUGGESTIONS,ASSISTANT_WELCOME,assistantDraftLabel,assistantWebPage,
  createAssistantThreadId,formatAssistantThreadTime,upsertAssistantThread,
  type AssistantChatItem,type AssistantDraft,type AssistantThread,type FireOpsUser,
} from '@fireops/domain';
import {askAssistant} from './assistant/assistantClient';
import {loadAssistantChats,saveAssistantChats} from './assistant/conversationStore';
import {useDialogA11y} from './useDialogA11y';
import './AssistantPanel.css';

const welcome:AssistantChatItem={id:'welcome',role:'assistant',text:ASSISTANT_WELCOME};
const photoAccept='image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
const receiptAccept=`${photoAccept},application/pdf,.pdf`;

function useOnline(){
  const [online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine!==false);
  useEffect(()=>{
    const update=()=>setOnline(navigator.onLine!==false);
    window.addEventListener('online',update);window.addEventListener('offline',update);
    return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update)};
  },[]);
  return online;
}

/** The open sheet: focus trap, Escape to close and inert background while mounted. */
function Sheet({onClose,children}:{onClose:()=>void;children:(titleId:string)=>ReactNode}){
  const {ref,titleId}=useDialogA11y<HTMLElement>(onClose);
  return <div className="assistant-overlay" role="presentation" onClick={event=>{if(event.target===event.currentTarget)onClose()}}>
    <section ref={ref} className="assistant-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>{children(titleId)}</section>
  </div>;
}

function Mascot({size}:{size:number}){
  return <picture className="assistant-mascot" style={{width:size,height:size}}>
    <source srcSet="/assistant-mascot.png" media="(prefers-reduced-motion: reduce)"/>
    <img src="/assistant-mascot.gif" alt="" width={size} height={size}/>
  </picture>;
}

/**
 * FireOps Assistant chat (text). Answers come from the assistant-chat edge
 * function; it can suggest a screen or a draft, which opens the existing form
 * for the user to review and submit. Chats stay in this browser.
 */
export default function AssistantPanel({companyId,user,autofillEnabled,onNavigate,onDraft}:{
  companyId:string;
  user:FireOpsUser;
  autofillEnabled:boolean;
  onNavigate:(page:string)=>void;
  /** Open a draft in its form. Files are photos the user picked from the draft button. */
  onDraft:(draft:AssistantDraft,files?:File[])=>void;
}){
  const online=useOnline();
  const boot=useRef<ReturnType<typeof loadAssistantChats>|null>(null);
  boot.current??=loadAssistantChats(user.id,companyId);
  const [open,setOpen]=useState(false);
  const [view,setView]=useState<'chat'|'history'>('chat');
  const [threads,setThreads]=useState<AssistantThread[]>(boot.current.threads);
  const initial=boot.current.threads.find(thread=>thread.id===boot.current!.activeId);
  const [threadId,setThreadId]=useState(initial?.id??createAssistantThreadId());
  const [messages,setMessages]=useState<AssistantChatItem[]>(initial?.messages.length?initial.messages:[welcome]);
  const [input,setInput]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const listRef=useRef<HTMLDivElement>(null);
  const request=useRef(0);

  useEffect(()=>{if(open&&view==='chat')listRef.current?.scrollTo({top:listRef.current.scrollHeight})},[messages,open,view,busy]);

  const persist=(nextThreads:AssistantThread[],activeId:string|null)=>{
    setThreads(nextThreads);
    saveAssistantChats(user.id,companyId,{threads:nextThreads,activeId});
  };
  const record=(id:string,next:AssistantChatItem[])=>{
    setMessages(next);
    setThreads(current=>{const updated=upsertAssistantThread(current,id,next);saveAssistantChats(user.id,companyId,{threads:updated,activeId:id});return updated});
  };

  async function send(text:string){
    const prompt=text.trim();
    if(!prompt||busy)return;
    if(!online){setError(ASSISTANT_OFFLINE);return}
    setError('');setInput('');setBusy(true);
    const id=threadId;
    const ticket=++request.current;
    const withUser=[...messages,{id:`u-${Date.now()}`,role:'user' as const,text:prompt}];
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
  }

  function startNewChat(){
    request.current+=1;setBusy(false);
    const id=createAssistantThreadId();
    setThreadId(id);setMessages([welcome]);setView('chat');setError('');setInput('');
    saveAssistantChats(user.id,companyId,{threads,activeId:id});
  }
  function openThread(thread:AssistantThread){
    request.current+=1;setBusy(false);
    setThreadId(thread.id);setMessages(thread.messages.length?thread.messages:[welcome]);setView('chat');setError('');
    saveAssistantChats(user.id,companyId,{threads,activeId:thread.id});
  }
  function deleteThread(id:string){
    const next=threads.filter(thread=>thread.id!==id);
    persist(next,id===threadId?null:threadId);
    if(id===threadId)startNewChat();
  }
  function clearAll(){
    if(!window.confirm('Delete all assistant chats on this device?'))return;
    persist([],null);startNewChat();
  }

  const go=(page:string)=>{onNavigate(page);setOpen(false)};
  const draftAction=(item:AssistantChatItem)=>{
    const draft=item.draft;
    if(!draft)return null;
    const label=assistantDraftLabel(draft,autofillEnabled);
    const pick=(accept:string,multiple:boolean)=><label className="assistant-action primary">{label}<input type="file" className="sr-only" accept={accept} multiple={multiple} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';if(files.length){onDraft(draft,files);setOpen(false)}}}/></label>;
    if(draft.kind==='invoice'&&autofillEnabled)return pick(photoAccept,false);
    if(draft.kind==='receipt')return pick(receiptAccept,true);
    return <button type="button" className="assistant-action primary" onClick={()=>{onDraft(draft);setOpen(false)}}>{label}</button>;
  };

  return <>
    <button type="button" className={`assistant-fab${online?'':' offline'}`} aria-label={online?'Open FireOps Assistant':'FireOps Assistant (needs a network connection)'} onClick={()=>setOpen(true)}>
      <Mascot size={52}/>
      {!online&&<span className="assistant-fab-offline" aria-hidden="true"><WifiOff/></span>}
    </button>

    {open&&<Sheet onClose={()=>setOpen(false)}>{titleId=><>
        <header>
          <Mascot size={38}/>
          <div><h2 id={titleId}>FireOps Assistant</h2><p>{view==='history'?'Saved on this device':online?'Ask about FireOps and your company':ASSISTANT_OFFLINE}</p></div>
          <button type="button" className="assistant-header-btn" aria-label={view==='history'?'Back to chat':'Chat history'} aria-pressed={view==='history'} onClick={()=>setView(current=>current==='history'?'chat':'history')}><History/></button>
          <button type="button" className="assistant-header-btn" aria-label="New chat" onClick={startNewChat}><Plus/></button>
          <button type="button" className="assistant-header-btn" aria-label="Close assistant" onClick={()=>setOpen(false)}><X/></button>
        </header>

        {view==='history'?<div className="assistant-history">
          <div className="assistant-history-toolbar">
            <p>{threads.length?`${threads.length} saved chat${threads.length===1?'':'s'}`:'No saved chats yet'}</p>
            <button type="button" className="assistant-history-reset" onClick={clearAll} disabled={!threads.length}><Trash2/> Delete all</button>
          </div>
          {!threads.length&&<p className="assistant-history-empty">Chats are saved on this device only, so you can reopen them later. No one else can see them.</p>}
          <ul>{threads.map(thread=><li key={thread.id}>
            <button type="button" className={`assistant-history-item${thread.id===threadId?' active':''}`} onClick={()=>openThread(thread)}>
              <span className="assistant-history-title">{thread.title}</span>
              <span className="assistant-history-meta">{formatAssistantThreadTime(thread.updatedAt)} · {thread.messages.filter(item=>item.id!=='welcome').length} messages</span>
            </button>
            <button type="button" className="assistant-history-delete" aria-label={`Delete ${thread.title}`} onClick={()=>deleteThread(thread.id)}><Trash2/></button>
          </li>)}</ul>
        </div>:<div className="assistant-messages" ref={listRef} aria-live="polite">
          {messages.map(item=>{
            const page=item.role==='assistant'?assistantWebPage(item.navigate,user.role):null;
            return <div key={item.id} className={`assistant-bubble ${item.role}`}>
              {item.text}
              {(page||item.draft)&&<div className="assistant-actions">
                {page&&item.navigate&&<button type="button" className="assistant-action" onClick={()=>go(page)}>Open {ASSISTANT_ROUTE_LABELS[item.navigate]} →</button>}
                {draftAction(item)}
              </div>}
            </div>;
          })}
          {messages.length<=1&&online&&<div className="assistant-suggestions">{ASSISTANT_SUGGESTIONS.map(suggestion=><button key={suggestion} type="button" disabled={busy} onClick={()=>void send(suggestion)}>{suggestion}</button>)}</div>}
          {busy&&<div className="assistant-bubble assistant assistant-thinking" role="status">Thinking…</div>}
          {error&&<p className="assistant-error" role="alert">{error}</p>}
        </div>}

        {view==='chat'&&<form className="assistant-composer" onSubmit={event=>{event.preventDefault();void send(input)}}>
          {!online&&<p className="assistant-offline" role="status"><WifiOff/> {ASSISTANT_OFFLINE}</p>}
          <div className="assistant-note-row">
            <input type="text" value={input} onChange={event=>setInput(event.target.value)} maxLength={2000} placeholder={online?'Ask the assistant…':'Needs a network connection'} aria-label="Message the FireOps Assistant" disabled={!online} enterKeyHint="send" autoComplete="off"/>
            <button type="submit" className="assistant-send-btn" disabled={busy||!online||!input.trim()} aria-label="Send"><Send/></button>
          </div>
          <p className="assistant-hint">The assistant can make mistakes. It never saves or submits anything; you review drafts first.</p>
        </form>}
    </>}</Sheet>}
  </>;
}
