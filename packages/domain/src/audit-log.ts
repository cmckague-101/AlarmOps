// Audit summaries list changed field names split from camelCase (e.g. "joined At"); show them in plain lowercase.
export function formatAuditDescription(description:string){
  return description.replace(/\(changed: ([^)]*)\)/,(_,fields:string)=>`(changed: ${fields.toLowerCase()})`);
}
export function formatAuditTimestamp(value:string){
  const date=new Date(value);
  return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(date);
}
