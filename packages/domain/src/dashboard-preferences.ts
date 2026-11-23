import {canInspectVehicle, canManageInventory, isCompanyManager, type UserRole} from './models';
import {canManagePersonalTasks} from './tasks';

export type DashboardItem = 'greeting'|'incidents'|'personnel'|'resources'|'attention'|'currentIssues'|'currentPicture'|'incidentMap'|'availability'|'tasks'|'inspections'|'inventory'|'payroll'|'receipts'|'invoices'|'nationalFireActivity'|'recentActivity';
export type DashboardPreferences = Partial<Record<DashboardItem, boolean>>;
export function parseDashboardPreferences(value:unknown):DashboardPreferences {
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).filter(([key,value])=>dashboardItems.includes(key as DashboardItem)&&typeof value==='boolean'));
}
// 'incidentMap' is no longer offered: the Operations map always shows. 'nationalFireActivity' moved to
// the News Feed page. Saved values for both are kept and ignored. Legacy 'shop' prefs are ignored.
export const dashboardItems:readonly DashboardItem[]=['greeting','incidents','personnel','resources','attention','currentIssues','currentPicture','incidentMap','availability','tasks','inspections','inventory','payroll','receipts','invoices','nationalFireActivity','recentActivity'];
export function dashboardPreferenceGroups(role:UserRole, platform:'web'|'mobile') {
  const manager=isCompanyManager(role);
  const item=(id:DashboardItem,label:string)=>({id,label});
  return [
    {title:'Command Center',items:[item('greeting','Greeting'),...(manager?[item('incidents','Active Incidents'),item('personnel','Assigned Personnel'),item('resources','Assigned Resources'),item('attention','Needs Attention')]:[...(canManageInventory(role)?[item('attention','Needs Attention')]:[]),item('currentIssues','Current issues'),...(platform==='mobile'?[item('currentPicture','Current picture — vehicles needing attention')]:[])])]},
    {title:'Quick Actions',items:[item('availability','Availability'),...(canManagePersonalTasks(role)?[item('tasks','Task list')]:[]),...(canInspectVehicle(role)&&!manager?[item('inspections','Inspect')]:[]),...(keepsInventoryInMainNav(role)?[item('inventory','Inventory')]:[]),item('payroll','Payroll'),item('invoices','Invoices')]},
    ...(!manager?[{title:'Recent Resources Activity',items:[item('recentActivity','Recent resources activity')]}]:[]),
  ];
}

/**
 * Inventory and Failed Inspections live under More. Resource Bosses and shop
 * techs use Inventory constantly, so it stays in their main navigation and
 * Quick Actions.
 */
export function keepsInventoryInMainNav(role:UserRole){return role==='resource_boss'||role==='shop_tech'}
