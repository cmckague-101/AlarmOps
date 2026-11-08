import type {CrewMember} from './models';
import {annualQualificationRows, type CommandRow, type CommandVehicle} from './command-center';
import {nextOilChangeWarning} from './oil-change';
import {credentialExpiresWithinMonth, crewCredentials} from './rules';
import {shopPriorityLabel, shopStatusLabel, type ShopJob, type ShopJobPriority, type ShopJobStatus} from './shop';

/** Shop job priorities that put a repair on the owner's Needs Attention list. */
export const attentionShopPriorities:readonly ShopJobPriority[]=['critical','high'];
/** Every shop status except Done: open work that still needs handling. */
export const openShopStatuses:readonly ShopJobStatus[]=['parts','approval','blocked','progress','queued','ready'];

type AttentionShopJob=Pick<ShopJob,'id'|'title'|'description'|'priority'|'status'|'kind'|'shopArea'|'fleetVehicleId'|'updatedAt'>;

function shopRepairRows(jobs:readonly AttentionShopJob[],vehicles:readonly CommandVehicle[]):CommandRow[] {
  const rank:Record<string,number>={critical:0,high:1};
  return jobs
    .filter(job=>job.status!=='done'&&attentionShopPriorities.includes(job.priority))
    .sort((a,b)=>rank[a.priority]-rank[b.priority]||Date.parse(b.updatedAt)-Date.parse(a.updatedAt))
    .map(job=>{
      const vehicle=job.fleetVehicleId?vehicles.find(item=>item.id===job.fleetVehicleId):undefined;
      const context=job.kind==='fleet'?(vehicle?.unit??'Fleet vehicle'):(job.shopArea?.trim()||'General shop');
      const description=job.description?.trim();
      return {
        id:`attention-shop-${job.id}`,
        title:job.title,
        detail:`${context} · ${shopPriorityLabel(job.priority)} shop repair · ${shopStatusLabel(job.status)}`,
        badge:shopPriorityLabel(job.priority),
        urgent:true,
        lines:description?[description]:[],
        target:{type:'shop' as const,id:job.id},
      };
    });
}

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
 * Owner Command Center Needs Attention: open critical/high shop repairs, oil changes due,
 * and expiring annual qualifications and credentials. Rows are derived live, so they drop
 * off as soon as the job is done, the oil change is logged or the record is renewed.
 */
export function needsAttentionRows(
  vehicles:readonly CommandVehicle[],
  crew:readonly CrewMember[],
  shopJobs:readonly AttentionShopJob[],
  now=new Date(),
):CommandRow[] {
  return [
    ...shopRepairRows(shopJobs,vehicles),
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
    description:'Critical and high shop repairs, oil changes due, and expiring qualifications',
    summary:urgent
      ?`${urgent} urgent ${urgent===1?'item':'items'}`
      :rows.length?`${rows.length} ${rows.length===1?'item':'items'} to review`:'Nothing needs attention',
    rows,
  });
}
