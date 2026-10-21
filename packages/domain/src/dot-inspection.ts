// Date-only values avoid timezone shifts in inspection and expiration dates.
export function inspectionExpirationDate(inspectionDate:string):string|null {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(inspectionDate))return null;
  const date=new Date(`${inspectionDate}T00:00:00Z`);
  if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==inspectionDate)return null;
  const year=date.getUTCFullYear()+1;
  const month=date.getUTCMonth();
  const day=Math.min(date.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate());
  return new Date(Date.UTC(year,month,day)).toISOString().slice(0,10);
}

export function inspectionReminderDate(expirationDate:string):string {
  const date=new Date(`${expirationDate}T00:00:00Z`);
  const month=date.getUTCMonth()-1;
  const day=Math.min(date.getUTCDate(),new Date(Date.UTC(date.getUTCFullYear(),month+1,0)).getUTCDate());
  return new Date(Date.UTC(date.getUTCFullYear(),month,day)).toISOString().slice(0,10);
}

export function localDateToday(now=new Date()):string {
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
