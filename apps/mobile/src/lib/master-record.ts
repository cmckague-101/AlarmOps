import {crewCredentials,type CrewCredential,type CrewMember} from '@fireops/domain';

export type MasterRecordSection={title:string;columns:string[];rows:string[][]};

export function formatMasterRecordDate(value?:string){
  if(!value)return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

function credentialRows(items:CrewCredential[]){
  return items.map(item=>[item.courseCode||'—',item.name,formatMasterRecordDate(item.completionDate),formatMasterRecordDate(item.expirationDate),item.provider||'—']);
}

function byType(credentials:CrewCredential[],types:CrewCredential['recordType'][]){
  return credentials.filter(item=>item.recordType&&types.includes(item.recordType));
}

export function getMasterRecordSections(member:CrewMember):MasterRecordSection[]{
  const credentials=crewCredentials(member);
  const trainingRows=credentialRows(byType(credentials,['Training']));
  const annual=member.annualRecord;
  if(annual)trainingRows.push(
    ['RT-130','Annual Fireline Safety Refresher',formatMasterRecordDate(annual.rt130CompletionDate),formatMasterRecordDate(annual.rt130CurrencyDate),'—'],
    ['WCT','Work Capacity Test',formatMasterRecordDate(annual.wctCompletionDate),formatMasterRecordDate(annual.wctCurrencyDate),'—'],
  );
  return [
    {title:'Incident Qualifications',columns:['Code','Position title','Completed','Expires','Provider'],rows:credentialRows(byType(credentials,['Qualification']))},
    {title:'Position Task Books',columns:['Code','Position title','Completed','Expires','Provider'],rows:credentialRows(byType(credentials,['Task Book']))},
    {title:'Training',columns:['Code','Training title','Completed','Currency / expiration','Provider'],rows:trainingRows},
    {title:'Licenses and Certificates',columns:['Code','License or certificate','Issued','Expiration','Issued by'],rows:credentialRows(byType(credentials,['License','DOT Medical']))},
    {title:'Incident Experience',columns:['Incident','Position','Days','Documentation'],rows:(member.experiences??[]).map(item=>[item.incident,item.position,item.days,item.file?'Attached':'—'])},
    {title:'Other Qualifications',columns:['Code','Qualification title','Completed','Expiration','Provider'],rows:credentials.filter(item=>!item.recordType).map(item=>['—',item.name,'—','—','—'])},
  ];
}

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[character]!);

export function createMasterRecordHtml(member:CrewMember){
  const sections=getMasterRecordSections(member);
  const prepared=new Date().toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});
  const content=sections.map(section=>`<section><h2>${escapeHtml(section.title)}</h2><table><thead><tr>${section.columns.map(column=>`<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${section.rows.length?section.rows.map(row=>`<tr>${row.map(value=>`<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join(''):`<tr><td class="empty" colspan="${section.columns.length}">No records on file</td></tr>`}</tbody></table></section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:letter;margin:.45in}*{box-sizing:border-box}body{font:9px Arial,sans-serif;color:#111;margin:0}header{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}.responder small{display:block;text-transform:uppercase;letter-spacing:.08em;color:#555;margin-bottom:4px}.responder strong{font-size:20px}.report{text-align:right;line-height:1.45}.report strong{font-size:11px}h1{font-size:15px;margin:0 0 3px}h2{font-size:10px;text-transform:uppercase;letter-spacing:.08em;background:#e9ece8;border:1px solid #333;margin:12px 0 0;padding:5px 6px;break-after:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #777;text-align:left;vertical-align:top;padding:4px;overflow-wrap:anywhere}th{background:#f5f5f2;font-size:8px;text-transform:uppercase}.empty{text-align:center;color:#666;font-style:italic;padding:7px}footer{border-top:1px solid #777;margin-top:14px;padding-top:7px;display:flex;justify-content:space-between;color:#555}</style></head><body><header><div class="responder"><small>Responder</small><strong>${escapeHtml(member.name)}</strong></div><div class="report"><strong>Master Qualification Record</strong><br>Responder Master Record (C028) Report</div></header><main><h1>Master Record</h1>${content}</main><footer><span>FireOps qualification record</span><span>Prepared ${escapeHtml(prepared)}</span></footer></body></html>`;
}
