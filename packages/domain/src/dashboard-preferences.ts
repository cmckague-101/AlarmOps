import {canInspectVehicle, isCompanyManager, type UserRole} from './models';
import {canManagePersonalTasks} from './tasks';

export type DashboardItem = 'greeting'|'incidents'|'personnel'|'resources'|'attention'|'currentIssues'|'availability'|'tasks'|'inspections'|'inventory'|'payroll'|'receipts'|'invoices'|'nationalFireActivity'|'recentActivity';
export type DashboardPreferences = Partial<Record<DashboardItem, boolean>>;
export function parseDashboardPreferences(value:unknown):DashboardPreferences {
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).filter(([key,value])=>dashboardItems.includes(key as DashboardItem)&&typeof value==='boolean'));
}
const dashboardItems:DashboardItem[]=['greeting','incidents','personnel','resources','attention','currentIssues','availability','tasks','inspections','inventory','payroll','receipts','invoices','nationalFireActivity','recentActivity'];
export function dashboardPreferenceGroups(role:UserRole, _platform:'web'|'mobile') {
  const manager=isCompanyManager(role);
  const item=(id:DashboardItem,label:string)=>({id,label});
  return [
    {title:'Command Center',items:[item('greeting','Greeting'),...(manager?[item('incidents','Active Incidents'),item('personnel','Assigned Personnel'),item('resources','Assigned Resources'),item('attention','Needs Attention')]:[item('currentIssues','Current issues')])]},
    {title:'Quick Actions',items:[item('availability','Availability'),...(canManagePersonalTasks(role)?[item('tasks','Task list')]:[]),...(canInspectVehicle(role)?[item('inspections','Inspections')]:[]),item('inventory','Check out gear'),item('payroll','Payroll'),item('receipts','Receipts'),item('invoices','Invoices')]},
    {title:'National Fire Activity',items:[item('nationalFireActivity','National fire activity')]},
    ...(!manager?[{title:'Recent Fleet Activity',items:[item('recentActivity','Recent fleet activity')]}]:[]),
  ];
}
