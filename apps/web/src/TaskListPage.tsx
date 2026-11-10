import {useEffect, useRef, useState, type FormEvent} from 'react';
import {ArrowLeft} from 'lucide-react';
import {canManagePersonalTasks, formatCalendarDate, taskDueStatus, type FireOpsUser, type PersonalTask} from '@fireops/domain';
import {usePersonalTasks} from './usePersonalTasks';
import './TaskListPage.css';

function todayIso(){const today=new Date();return `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`}

/** A task the FireOps Assistant drafted: opens the New task form filled in for the user to check and save. */
export type AssistantTaskRequest={id:number;subject:string;description:string;dueDate:string};

export function TaskListPage({companyId,user,onBack,assistantRequest,onAssistantRequestDone}:{companyId?:string;user:FireOpsUser;onBack:()=>void;assistantRequest?:AssistantTaskRequest|null;onAssistantRequestDone?:()=>void}) {
  const allowed = canManagePersonalTasks(user.role);
  const {tasks,loading,busy,error,save,remove,retry,connected} = usePersonalTasks(allowed?companyId:undefined,allowed?user.id:undefined);
  const [creating,setCreating] = useState(false);
  const [editingId,setEditingId] = useState<string>();
  function edit(task:PersonalTask) {
    setEditingId(task.id);setSubject(task.subject);setDescription(task.description);setDueDate(task.due_date);setCreating(true);
  }
  const [subject,setSubject] = useState('');
  const [description,setDescription] = useState('');
  const [dueDate,setDueDate] = useState('');
  const handledAssistant = useRef<number|null>(null);
  useEffect(()=>{
    if(!assistantRequest||!allowed||handledAssistant.current===assistantRequest.id)return;
    handledAssistant.current=assistantRequest.id;
    onAssistantRequestDone?.();
    setEditingId(undefined);setSubject(assistantRequest.subject);setDescription(assistantRequest.description);setDueDate(assistantRequest.dueDate||todayIso());setCreating(true);
  });
  async function submit(event:FormEvent) {
    event.preventDefault();
    if(await save({subject,description,dueDate},editingId)){setSubject('');setDescription('');setDueDate('');setEditingId(undefined);setCreating(false);}
  }
  // Completing deletes the task permanently, so confirm before removing it.
  function complete(task:PersonalTask) {
    if (window.confirm(`Mark "${task.subject}" completed? Completed tasks are removed permanently.`)) void remove(task.id);
  }
  const form = <form className="task-form" onSubmit={event=>void submit(event)}><h2>{editingId?'Edit task':'New task'}</h2><fieldset disabled={!connected||busy}>
    <label htmlFor="task-subject">Subject<input id="task-subject" autoFocus required maxLength={200} value={subject} onChange={event=>setSubject(event.target.value)}/></label>
    <label htmlFor="task-description">Description<textarea id="task-description" rows={4} maxLength={5000} value={description} onChange={event=>setDescription(event.target.value)}/></label>
    <label htmlFor="task-due-date">Due date<input id="task-due-date" type="date" required value={dueDate} onChange={event=>setDueDate(event.target.value)}/></label>
    <div className="task-actions"><button className="primary" type="submit">{busy?'Saving…':'Save task'}</button><button className="secondary" type="button" onClick={()=>{setCreating(false);setEditingId(undefined);setSubject('');setDescription('');setDueDate('');}}>Cancel</button></div>
  </fieldset></form>;
  if (!allowed) return <div className="page"><p>Task List is available to owners, admins, and techs.</p></div>;
  return <div className="page task-page"><button type="button" className="page-back" onClick={onBack}><ArrowLeft/> Back</button><div className="page-heading hero-heading"><div><h1>Task List</h1><p>Your personal tasks. Reminders are scheduled for 9 AM on the due date in your saved device time zone. Completing a task removes it permanently.</p></div></div>
    {!connected&&<p>Connect a company account to save tasks.</p>}
    {error&&<p role="alert" className="receipt-error">{error} <button className="secondary" disabled={busy} onClick={retry}>Retry</button></p>}
    {!creating&&<p><button className="primary" disabled={!connected||busy} onClick={()=>{setDueDate(todayIso());setCreating(true);}}>New task</button></p>}
    {creating&&!editingId&&form}
    <section className="task-list" aria-label="Your tasks" aria-busy={loading}>{loading?<p>Loading tasks…</p>:<>{tasks.map(task=><article key={task.id}>{editingId===task.id?form:<><h2>{task.subject}</h2><p className={`task-due ${taskDueStatus(task.due_date)}`}>{taskDueStatus(task.due_date)==='overdue'?'Overdue · ':''}{taskDueStatus(task.due_date)==='today'?'Due today':`Due ${formatCalendarDate(task.due_date)}`}</p>{task.description&&<p className="task-description">{task.description}</p>}<div className="task-actions"><button className="secondary" disabled={busy||creating||!connected} onClick={()=>edit(task)} aria-label={`Edit ${task.subject}`}>Edit</button><button className="primary" disabled={busy||creating} onClick={()=>complete(task)} aria-label={`Mark ${task.subject} as completed`}>Mark completed</button></div></>}</article>)}{connected&&!error&&!tasks.length&&<p>No open tasks. Select New task to create one.</p>}</>}</section>
  </div>;
}
