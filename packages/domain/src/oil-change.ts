import {localDateToday} from './dot-inspection';

/** True when a stored due date is today or earlier. */
export function nextOilChangeWarning(
  vehicle:{nextOilChangeDue?:string;nextOilChange?:string;unit?:string},
  now=new Date(),
):{due:string;note?:string;expired:boolean}|null {
  const due=vehicle.nextOilChangeDue?.trim()??'';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(due))return null;
  const parsed=new Date(`${due}T00:00:00Z`);
  if(!Number.isFinite(parsed.valueOf())||parsed.toISOString().slice(0,10)!==due)return null;
  const today=localDateToday(now);
  if(today<due)return null;
  const note=vehicle.nextOilChange?.trim()||undefined;
  return {due,note,expired:today>due};
}
