import {describe,expect,it} from 'vitest';
import {
  assignableUserRoles,canDispatchFleet,canInspectVehicle,canManageInventory,canOpenVehicleIssue,canProcessFinance,canViewCrewRoster,isCompanyManager,userRoleLabel,type UserRole,
} from './models';
import {canManagePersonalTasks} from './tasks';
import {dashboardPreferenceGroups} from './dashboard-preferences';

const roles:UserRole[]=['owner','admin','resource_boss','shop_tech','fire_fighter','accounting'];

describe('Resource Boss role',()=>{
  it('is assignable and labeled',()=>{
    expect(assignableUserRoles.some(role=>role.value==='resource_boss'&&role.label==='Resource Boss')).toBe(true);
    expect(userRoleLabel('resource_boss')).toBe('Resource Boss');
  });

  it('manages inventory and dispatches the fleet with owners and admins',()=>{
    expect(roles.map(canManageInventory)).toEqual([true,true,true,false,false,false]);
    expect(roles.map(canDispatchFleet)).toEqual([true,true,true,false,false,false]);
    expect(canOpenVehicleIssue('resource_boss')).toBe(true);
    expect(canInspectVehicle('resource_boss')).toBe(true);
  });

  it('stays crew-level for management, finance, tasks and the crew roster',()=>{
    expect(isCompanyManager('resource_boss')).toBe(false);
    expect(canProcessFinance('resource_boss')).toBe(false);
    expect(canManagePersonalTasks('resource_boss')).toBe(false);
    expect(roles.map(canViewCrewRoster)).toEqual([true,true,false,true,true,true]);
  });

  it('gets the crew dashboard plus Needs Attention',()=>{
    const command=dashboardPreferenceGroups('resource_boss','web')[0].items.map(item=>item.id);
    expect(command).toEqual(['greeting','attention','currentIssues']);
    expect(dashboardPreferenceGroups('fire_fighter','web')[0].items.map(item=>item.id)).toEqual(['greeting','currentIssues']);
  });
});
