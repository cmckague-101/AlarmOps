import type {UserRole} from './models';

export type PersonalTask = {id:string;company_id:string;user_id:string;subject:string;description:string;due_date:string;created_at:string};
export type TaskDraft = {subject:string;description:string;dueDate:string};
export function canManagePersonalTasks(role:UserRole) {
  return role === 'owner' || role === 'admin' || role === 'shop_tech';
}
export function taskDraftError(draft:TaskDraft):string|null {
  if (!draft.subject.trim()) return 'Enter a subject.';
  if (draft.subject.trim().length > 200) return 'Subject must be 200 characters or fewer.';
  if (draft.description.length > 5000) return 'Description must be 5,000 characters or fewer.';
  const date = new Date(`${draft.dueDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0,10) !== draft.dueDate) return 'Enter a valid due date (YYYY-MM-DD).';
  return null;
}
export type TaskDueStatus = 'overdue'|'today'|'upcoming';
// Compare calendar dates in the viewer's local day so a task due today is never shown as overdue.
export function taskDueStatus(dueDate:string, today=new Date()):TaskDueStatus {
  const local=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  return dueDate<local?'overdue':dueDate===local?'today':'upcoming';
}
