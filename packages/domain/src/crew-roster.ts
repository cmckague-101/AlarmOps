import {userRoleLabel,type CrewMember,type UserRole} from './models';

export type RosterSort='name'|'status'|'role';
export const rosterSortOptions:ReadonlyArray<{value:RosterSort;label:string}>=[{value:'name',label:'Name'},{value:'status',label:'Status'},{value:'role',label:'Role'}];
const roleOrder:UserRole[]=['owner','admin','accounting','resource_boss','shop_tech','fire_fighter'];

// Search matches name, email or role label; status sort puts invited members first.
export function filterAndSortCrew<T extends Pick<CrewMember,'name'|'email'|'role'|'status'>>(crew:readonly T[],query:string,sort:RosterSort):T[]{
  const term=query.trim().toLowerCase();
  const byName=(a:T,b:T)=>a.name.localeCompare(b.name);
  const rank=(role:UserRole)=>{const index=roleOrder.indexOf(role);return index<0?roleOrder.length:index};
  return crew.filter(person=>!term||[person.name,person.email,userRoleLabel(person.role)].some(value=>value?.toLowerCase().includes(term)))
    .sort((a,b)=>sort==='status'?(a.status==='Active'?1:0)-(b.status==='Active'?1:0)||byName(a,b):sort==='role'?rank(a.role)-rank(b.role)||byName(a,b):byName(a,b));
}
