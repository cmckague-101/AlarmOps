import {taskDueStatus} from './tasks';

// Command Center cards carry an accent rail only when they are urgent:
// incidents (red) and Needs Attention (yellow) once they have rows. The other cards stay plain.
export const urgentCommandCardIds=['incidents','attention'] as const;
export function isUrgentCommandCard(card:{id:string;rows:readonly unknown[]}):boolean {
  return (urgentCommandCardIds as readonly string[]).includes(card.id)&&card.rows.length>0;
}

export function overdueTaskCount(dueDates:readonly string[],today=new Date()):number {
  return dueDates.filter(dueDate=>taskDueStatus(dueDate,today)==='overdue').length;
}

type InspectionLike={id:string;createdAt:string;items:readonly {result?:string|null}[]};
// Failed inspections stay listed until deleted, so the urgent rail follows the Failed Inspections page's
// default view: failed inspections recorded this calendar year.
export function failedInspectionCount(vehicles:readonly {inspections?:readonly InspectionLike[]|null}[],year=new Date().getFullYear(),isHidden:(inspectionId:string)=>boolean=()=>false):number {
  return vehicles.reduce((total,vehicle)=>total+(vehicle.inspections??[]).filter(inspection=>!isHidden(inspection.id)&&new Date(inspection.createdAt).getFullYear()===year&&inspection.items.some(item=>item.result==='Fail')).length,0);
}
