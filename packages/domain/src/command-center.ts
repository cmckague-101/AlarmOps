import type {CrewMember, FleetIssue, NifcIncident} from './models';
import {dotInspectionWarning, inspectionExpirationDate, localDateToday} from './dot-inspection';
import {nextOilChangeWarning} from './oil-change';

export type CommandVehicle = {id:string;unit:string;status:string;assignedTo?:string|null;assignedFire?:Pick<NifcIncident,'id'|'name'|'state'>;documents?:{id:string;name:string;inspectionDate?:string}[];nextOilChange?:string;nextOilChangeDue?:string};
export type CommandTarget = {type:'vehicle'|'crew'|'issue'|'incident'|'payroll'|'shop'|'inventory';id:string};
export type CommandRow = {id:string;title:string;detail:string;badge:string;urgent?:boolean;lines:string[];target?:CommandTarget};
export type CommandAlert = CommandRow & {kind:'vehicle'|'payroll'|'crew'};
export type CommandPayroll = {id:string;createdByName:string;engineNumber:string;incidents:string;status:string};

/** RT-130 / work capacity test reminders: from 11 months after completion until renewed. */
export function annualQualificationRows(crew:CrewMember[],now=new Date()):CommandRow[] {
  const today=localDateToday(now);
  return crew.flatMap(member=>{
    const record=member.annualRecord;
    if(!record)return [];
    return ([['rt130CompletionDate','RT-130'],['wctCompletionDate','Work capacity test']] as const).flatMap(([field,label])=>{
      const completion=record[field];
      const expiration=inspectionExpirationDate(completion);
      if(!expiration)return [];
      const date=new Date(`${completion}T00:00:00Z`);
      const month=date.getUTCMonth()+11;
      const day=Math.min(date.getUTCDate(),new Date(Date.UTC(date.getUTCFullYear(),month+1,0)).getUTCDate());
      const reminder=new Date(Date.UTC(date.getUTCFullYear(),month,day)).toISOString().slice(0,10);
      if(today<reminder)return [];
      const expired=today>=expiration;
      return [{id:`annual-${member.id}-${field}`,title:`${member.name} — ${label} ${expired?'expired':'expires soon'}`,detail:`${expired?'Expired':'Expires'} ${expiration} · Annual record needs updating`,badge:expired?'Expired':'Due soon',urgent:expired,lines:[],target:{type:'crew' as const,id:member.id}}];
    });
  });
}

export function commandAlerts(vehicles:CommandVehicle[],issues:FleetIssue[],payrolls:CommandPayroll[],now=new Date(),crew:CrewMember[]=[]):CommandAlert[] {
  const rank={Critical:0,High:1,Medium:2,Low:3};
  const vehicleAlerts=vehicles.flatMap(vehicle=>{
    const open=issues.filter(issue=>issue.vehicleId===vehicle.id&&issue.status==='Open').sort((a,b)=>rank[a.priority]-rank[b.priority]);
    if(!open.length)return [];
    const highest=open[0];
    return [{id:`vehicle-${vehicle.id}`,kind:'vehicle' as const,title:`${vehicle.unit} has ${open.length} open ${open.length===1?'issue':'issues'}`,detail:open.map(issue=>issue.title).join(' · '),badge:highest.priority,urgent:highest.priority==='Critical'||highest.priority==='High',lines:[],target:{type:'vehicle' as const,id:vehicle.id}}];
  });
  const payrollAlerts=payrolls.filter(form=>form.status==='pending').map(form=>({id:`payroll-${form.id}`,kind:'payroll' as const,title:`${form.createdByName}'s payroll needs approval`,detail:[form.engineNumber&&`Resource ${form.engineNumber}`,form.incidents].filter(Boolean).join(' · ')||'Submitted payroll',badge:'Approval',urgent:false,lines:[],target:{type:'payroll' as const,id:form.id}}));
  const inspectionAlerts:CommandAlert[]=vehicles.flatMap(vehicle=>{
    const warning=dotInspectionWarning(vehicle,now);
    if(!warning)return [];
    const {inspectionDate,expiration,expired}=warning;
    return [{id:`dot-inspection-${vehicle.id}`,kind:'vehicle',title:`${vehicle.unit} DOT inspection ${expired?'expired':'expires soon'}`,detail:`${expired?'Expired':'Expires'} ${expiration} · Inspected ${inspectionDate}`,badge:expired?'Expired':'Due soon',urgent:expired,lines:[],target:{type:'vehicle',id:vehicle.id}}];
  });
  const oilChangeAlerts:CommandAlert[]=vehicles.flatMap(vehicle=>{
    const warning=nextOilChangeWarning(vehicle,now);
    if(!warning)return [];
    return [{id:`oil-change-${vehicle.id}`,kind:'vehicle',title:`${vehicle.unit} needs attention — oil change due`,detail:[warning.note,`Due ${warning.due}`].filter(Boolean).join(' · '),badge:'Needs attention',urgent:true,lines:[],target:{type:'vehicle',id:vehicle.id}}];
  });
  const annualAlerts:CommandAlert[]=annualQualificationRows(crew,now).map(row=>({...row,kind:'crew' as const}));
  return [...vehicleAlerts,...oilChangeAlerts,...inspectionAlerts,...annualAlerts,...payrollAlerts];
}
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
