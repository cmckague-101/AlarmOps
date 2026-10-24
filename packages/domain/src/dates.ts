// Calendar dates are stored as YYYY-MM-DD; parse them as local dates so they never shift a day by time zone.
function calendarDate(value:string){const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);return match?new Date(Number(match[1]),Number(match[2])-1,Number(match[3])):null}
export function formatCalendarDate(value:string,fallback='—'){const date=calendarDate(value);return date?new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(date):fallback}
export function formatCalendarRange(start:string,end:string,fallback='—'){
  const from=calendarDate(start),to=calendarDate(end);
  if(!from)return fallback;if(!to)return formatCalendarDate(start,fallback);
  const sameYear=from.getFullYear()===to.getFullYear();
  return `${new Intl.DateTimeFormat(undefined,sameYear?{month:'short',day:'numeric'}:{month:'short',day:'numeric',year:'numeric'}).format(from)} – ${formatCalendarDate(end,fallback)}`;
}
