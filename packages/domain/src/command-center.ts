import type {CrewMember, FleetIssue, NifcIncident} from './models';

export type CommandVehicle = {id:string;unit:string;status:string;assignedTo?:string|null;assignedFire?:Pick<NifcIncident,'id'|'name'|'state'>};
export type CommandRow = {id:string;title:string;detail:string;badge:string;urgent?:boolean;lines:string[];target?:{type:'vehicle'|'crew'|'issue'|'incident';id:string}};
export function commandCenter(vehicles:CommandVehicle[],crew:CrewMember[],issues:FleetIssue[]) {
  const assigned=vehicles.filter(vehicle=>Boolean(vehicle.assignedTo));
  const fires=new Map<string,CommandVehicle[]>();
  vehicles.forEach(vehicle=>{if(vehicle.assignedFire){const group=fires.get(vehicle.assignedFire.id)??[];group.push(vehicle);fires.set(vehicle.assignedFire.id,group)}});
  const rank={Critical:0,High:1,Medium:2,Low:3};
  const open=issues.filter(issue=>issue.status==='Open').sort((a,b)=>rank[a.priority]-rank[b.priority]);
  const incidents:CommandRow[]=[...fires].map(([id,resources])=>({id,target:{type:'incident',id},title:resources[0].assignedFire!.name,detail:resources[0].assignedFire!.state||'Location not reported',badge:'Active',lines:[resources.map(v=>v.unit).join(' · '),`${new Set(resources.flatMap(v=>v.assignedTo?[v.assignedTo]:[])).size} personnel`]}));
  const personnel:CommandRow[]=crew.filter(member=>assigned.some(v=>v.assignedTo===member.id)).map(member=>({id:member.id,title:member.name,detail:'',badge:member.role==='owner'?'Owner':'Crew',lines:assigned.filter(v=>v.assignedTo===member.id).map(v=>`${v.assignedFire?.name??'No fire assigned'} · ${v.unit}`),target:{type:'crew',id:member.id}}));
  const resources:CommandRow[]=vehicles.filter(v=>v.assignedTo||v.assignedFire).map(v=>({id:v.id,title:v.unit,detail:v.assignedFire?.name??'No fire assigned',badge:v.status,lines:[crew.find(member=>member.id===v.assignedTo)?.name??'No crew assigned'],target:{type:'vehicle',id:v.id}}));
  const attention:CommandRow[]=open.map(issue=>{const vehicle=vehicles.find(v=>v.id===issue.vehicleId);return {id:issue.id,title:issue.title,detail:[vehicle?.unit??'Unknown vehicle',vehicle?.assignedFire?.name].filter(Boolean).join(' · '),badge:issue.priority,urgent:issue.priority==='Critical'||issue.priority==='High',lines:issue.description?[issue.description]:[],target:{type:'issue',id:issue.id}}});
  return [
    {id:'incidents',title:'Active Incidents',description:'Resource assignments by incident',summary:`${vehicles.filter(v=>v.assignedFire).length} vehicles on fires`,rows:incidents},
    {id:'personnel',title:'Assigned Personnel',description:'Current employee and crew assignments',summary:`${assigned.length} vehicles crewed`,rows:personnel},
    {id:'resources',title:'Assigned Resources',description:'Current vehicle and fire assignments',summary:`${vehicles.filter(v=>v.status==='Ready'&&!v.assignedTo&&!v.assignedFire).length} available`,rows:resources},
    {id:'attention',title:'Needs Attention',description:'Operational issues requiring review',summary:`${open.filter(i=>i.priority==='Critical').length} critical alerts`,rows:attention},
  ];
}
