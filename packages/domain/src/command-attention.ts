import type {CrewMember, FleetIssue, InventoryItem} from './models';
import {annualQualificationRows, type CommandRow, type CommandVehicle} from './command-center';
import {nextOilChangeWarning} from './oil-change';
import {credentialExpiresWithinMonth, crewCredentials} from './rules';

function oilChangeRows(vehicles:readonly CommandVehicle[],now:Date):CommandRow[] {
  return vehicles.flatMap(vehicle=>{
    const warning=nextOilChangeWarning(vehicle,now);
    if(!warning)return [];
    return [{
      id:`attention-oil-${vehicle.id}`,
      title:`${vehicle.unit} — oil change due`,
      detail:[warning.note,`Due ${warning.due}`].filter(Boolean).join(' · '),
      badge:'Oil due',
      urgent:true,
      lines:[],
      target:{type:'vehicle' as const,id:vehicle.id},
    }];
  });
}

function credentialRows(crew:readonly CrewMember[],now:Date):CommandRow[] {
  return crew.flatMap(member=>crewCredentials(member).flatMap(credential=>{
    if(!credential.expirationDate)return [];
    const expiration=new Date(`${credential.expirationDate}T23:59:59`);
    if(Number.isNaN(expiration.getTime()))return [];
    const expired=expiration<now;
    if(!expired&&!credentialExpiresWithinMonth(credential,now))return [];
    return [{
      id:`attention-credential-${member.id}-${credential.id}`,
      title:`${member.name} — ${credential.name} ${expired?'expired':'expires soon'}`,
      detail:`${expired?'Expired':'Expires'} ${credential.expirationDate}`,
      badge:expired?'Expired':'Due soon',
      urgent:expired,
      lines:[],
      target:{type:'crew' as const,id:member.id},
    }];
  }));
}

/**
 * Owner Command Center Needs Attention: oil changes due, and expiring annual
 * qualifications and credentials. Rows are derived live, so they drop off as
 * soon as the oil change is logged or the record is renewed.
 */
export function needsAttentionRows(
  vehicles:readonly CommandVehicle[],
  crew:readonly CrewMember[],
  now=new Date(),
):CommandRow[] {
  return [
    ...oilChangeRows(vehicles,now),
    ...annualQualificationRows([...crew],now).map(row=>({...row,id:`attention-${row.id}`})),
    ...credentialRows(crew,now),
  ];
}

/** Replace the Command Center "attention" card with the given Needs Attention rows. */
export function withNeedsAttentionCard<T extends {id:string;description:string;summary:string;rows:CommandRow[]}>(cards:T[],rows:CommandRow[]):T[] {
  const urgent=rows.filter(row=>row.urgent).length;
  return cards.map(card=>card.id!=='attention'?card:{
    ...card,
    description:'Oil changes due and expiring qualifications',
    summary:urgent
      ?`${urgent} urgent ${urgent===1?'item':'items'}`
      :rows.length?`${rows.length} ${rows.length===1?'item':'items'} to review`:'Nothing needs attention',
    rows,
  });
}

/** Gear checked out longer than this many days counts as overdue on the Resource Boss Needs Attention list. */
export const overdueGearDays=14;
const dayMs=24*60*60*1000;

type AttentionIssue=Pick<FleetIssue,'id'|'vehicleId'|'title'|'description'|'priority'|'status'|'createdAt'>;
type AttentionInventoryItem=Pick<InventoryItem,'id'|'name'|'quantity'|'checkouts'>;

/**
 * Resource Boss Needs Attention (crew dashboard): open critical/high fleet issues, items with
 * nothing left on hand, and gear checked out for more than {@link overdueGearDays} days.
 */
export function resourceAttentionRows(
  issues:readonly AttentionIssue[],
  vehicles:readonly Pick<CommandVehicle,'id'|'unit'>[],
  items:readonly AttentionInventoryItem[],
  now=new Date(),
):CommandRow[] {
  const rank:Record<string,number>={Critical:0,High:1};
  const issueRows=issues
    .filter(issue=>issue.status==='Open'&&(issue.priority==='Critical'||issue.priority==='High'))
    .sort((a,b)=>rank[a.priority]-rank[b.priority]||Date.parse(b.createdAt)-Date.parse(a.createdAt))
    .map(issue=>({
      id:`attention-issue-${issue.id}`,
      title:issue.title,
      detail:`${vehicles.find(vehicle=>vehicle.id===issue.vehicleId)?.unit??'Fleet vehicle'} · ${issue.priority} priority fleet issue`,
      badge:issue.priority,
      urgent:true,
      lines:issue.description?.trim()?[issue.description.trim()]:[],
      target:{type:'issue' as const,id:issue.id},
    }));
  const sortedItems=[...items].sort((a,b)=>a.name.localeCompare(b.name));
  const stockRows=sortedItems.filter(item=>item.quantity<=0).map(item=>{
    const out=item.checkouts.reduce((sum,checkout)=>sum+checkout.quantity,0);
    return {
      id:`attention-stock-${item.id}`,
      title:`${item.name} — out of stock`,
      detail:out?`None on hand · ${out} checked out`:'None on hand',
      badge:'Out of stock',
      urgent:false,
      lines:[],
      target:{type:'inventory' as const,id:item.id},
    };
  });
  const overdueRows=sortedItems.flatMap(item=>item.checkouts.flatMap(checkout=>{
    const since=Date.parse(checkout.checkedOutAt);
    if(Number.isNaN(since))return [];
    const days=Math.floor((now.getTime()-since)/dayMs);
    if(days<=overdueGearDays)return [];
    return [{
      id:`attention-gear-${item.id}-${checkout.userId}`,
      title:`${item.name} — ${checkout.userName}`,
      detail:`${checkout.quantity} checked out ${days} days ago`,
      badge:'Overdue',
      urgent:true,
      lines:[],
      target:{type:'inventory' as const,id:item.id},
    }];
  }));
  return [...issueRows,...overdueRows,...stockRows];
}
