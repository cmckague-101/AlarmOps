import {useState, type FormEvent} from 'react';
import {canManagePersonalTasks, type FireOpsUser} from '@fireops/domain';
import {usePersonalTasks} from './usePersonalTasks';
import './TaskListPage.css';

export function TaskListPage({companyId,user,onBack}:{companyId?:string;user:FireOpsUser;onBack:()=>void}) {
  const allowed = canManagePersonalTasks(user.role);
  const {tasks,loading,busy,error,save,remove,retry,connected} = usePersonalTasks(allowed?companyId:undefined,allowed?user.id:undefined);
  const [creating,setCreating] = useState(false);
  const [subject,setSubject] = useState('');
  const [description,setDescription] = useState('');
  const [dueDate,setDueDate] = useState('');
  async function submit(event:FormEvent) {
    event.preventDefault();
    if(await save({subject,description,dueDate})){setSubject('');setDescription('');setDueDate('');setCreating(false);}
  }
  if (!allowed) return <div className="page"><p>Task List is available to owners, admins, and techs.</p></div>;
  return <div className="page task-page"><button className="secondary" onClick={onBack}>← Dashboard</button><div className="page-heading"><div><h1>Task List</h1><p>Your personal tasks. Completing a task removes it permanently.</p></div></div>
    {!connected&&<p>Connect a company account to save tasks.</p>}
    {error&&<p role="alert" className="receipt-error">{error} <button className="secondary" disabled={busy} onClick={retry}>Retry</button></p>}
    {!creating&&<p><button className="primary" disabled={!connected||busy} onClick={()=>setCreating(true)}>New task</button></p>}
    {creating&&<form className="task-form" onSubmit={event=>void submit(event)}><h2>New task</h2><fieldset disabled={!connected||busy}>
      <label htmlFor="task-subject">Subject<input id="task-subject" autoFocus required maxLength={200} value={subject} onChange={event=>setSubject(event.target.value)}/></label>
      <label htmlFor="task-description">Description<textarea id="task-description" rows={4} maxLength={5000} value={description} onChange={event=>setDescription(event.target.value)}/></label>
      <label htmlFor="task-due-date">Due date<input id="task-due-date" type="date" required value={dueDate} onChange={event=>setDueDate(event.target.value)}/></label>
      <div className="task-actions"><button className="primary" type="submit">{busy?'Saving…':'Save task'}</button><button className="secondary" type="button" onClick={()=>setCreating(false)}>Cancel</button></div>
    </fieldset></form>}
    <section className="task-list" aria-label="Your tasks" aria-busy={loading}>{loading?<p>Loading tasks…</p>:<>{tasks.map(task=><article key={task.id}><h2>{task.subject}</h2><p>Due {new Date(`${task.due_date}T12:00:00`).toLocaleDateString()}</p>{task.description&&<p className="task-description">{task.description}</p>}<div className="task-actions"><button className="primary" disabled={busy} onClick={()=>void remove(task.id)} aria-label={`Mark ${task.subject} as completed`}>Mark completed</button><button className="secondary" disabled={busy} onClick={()=>{if(window.confirm(`Delete “${task.subject}”?`))void remove(task.id)}} aria-label={`Delete ${task.subject}`}>Delete</button></div></article>)}{connected&&!error&&!tasks.length&&<p>No open tasks. Select New task to create one.</p>}</>}</section>
  </div>;
}
