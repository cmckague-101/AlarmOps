import type {AnnualQualificationRecord,CrewCredential,CrewMember} from './models';
import {crewCredentials} from './rules';

export type QualificationCardInput={
  employeeName:string;
  companyName:string;
  companyPhone:string;
  homeBase:string;
  primaryQualificationId:string;
  photoDataUrl?:string;
};

export function qualificationCardPositions(member?:CrewMember){
  if(!member)return [];
  return crewCredentials(member).filter(credential=>credential.recordType==='Qualification'||!credential.recordType);
}

export function qualificationCardPositionLabel(credential?:CrewCredential){
  return credential?[credential.courseCode,credential.name].filter(Boolean).join(' — '):'Not selected';
}

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[character]!);
const formatDate=(value?:string)=>value?new Date(`${value}T12:00:00`).toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}):'—';
const currentThrough=(primary?:CrewCredential,annual?:AnnualQualificationRecord)=>primary?.expirationDate||annual?.wctCurrencyDate||annual?.rt130CurrencyDate;

export function createQualificationCardHtml(member:CrewMember,input:QualificationCardInput){
  const positions=qualificationCardPositions(member);
  const primary=positions.find(item=>item.id===input.primaryQualificationId);
  const issueDate=new Date();
  const issueDateText=issueDate.toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'});
  const year=issueDate.getFullYear();
  const annual=member.annualRecord;
  const photo=input.photoDataUrl?`<img src="${escapeHtml(input.photoDataUrl)}" alt="">`:'<div class="photo-empty">PHOTO</div>';
  const positionRows=positions.length?positions.map(item=>`<tr class="${item.id===primary?.id?'primary-row':''}"><td><strong>${escapeHtml(item.courseCode||'—')}</strong></td><td>${escapeHtml(item.name)}</td><td>Q</td><td>${formatDate(item.completionDate)}</td><td>${formatDate(item.expirationDate)}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">No incident qualifications on file</td></tr>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(input.employeeName)} — Incident Qualification Card</title><style>
@page{size:letter landscape;margin:.25in}*{box-sizing:border-box}html,body{margin:0;color:#111;font-family:Arial,sans-serif}body{padding:0}.card{width:100%;min-height:7.5in;border:2px solid #111;background:#fff;overflow:hidden}.banner{height:.55in;display:flex;align-items:center;justify-content:center;background:#c91417;color:#fff;font-size:28px;font-weight:900;letter-spacing:1px}.main{display:grid;grid-template-columns:1fr 2.45in}.left{border-right:2px solid #111}.identity{display:grid;grid-template-columns:1.1fr .9fr;min-height:1.9in;padding:14px 16px;gap:18px}.details{display:grid;grid-template-columns:max-content 1fr;align-content:start;gap:8px 12px;font-size:13px}.details b{font-size:12px}.qualifications h2{margin:0;padding:6px 14px;border-top:2px solid #111;border-bottom:1px solid #111;background:#e8e8e8;font-size:16px}.qualifications table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:11px}.qualifications th,.qualifications td{padding:6px 8px;border-right:1px solid #999;border-bottom:1px solid #999;text-align:left}.qualifications th:nth-child(1){width:15%}.qualifications th:nth-child(2){width:35%}.qualifications th:nth-child(3){width:10%;text-align:center}.qualifications th:nth-child(4),.qualifications th:nth-child(5){width:20%;text-align:center}.qualifications td:nth-child(n+3){text-align:center}.qualifications th{background:#f3f3f3;font-size:10px}.primary-row{background:#fff8dc}.legend{padding:7px 14px;font-size:10px}.portrait{padding:12px;text-align:center}.photo,.photo-empty{width:100%;height:3.15in;border:1px solid #111;background:#eee}.photo{object-fit:cover}.photo-empty{display:flex;align-items:center;justify-content:center;color:#888;font-size:18px;font-weight:800}.portrait h2{margin:9px 0 7px;font-size:21px}.primary{padding-top:10px;border-top:1px solid #111}.primary small{display:block;font-size:10px;letter-spacing:.8px}.primary strong{display:block;margin-top:5px;font-size:31px}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:28px;padding:16px;border-top:2px solid #111}.signature{height:.58in;border-bottom:1px solid #111;font-size:11px;font-weight:700}.footer{padding:5px;text-align:center;font-size:8px;color:#555}.empty{text-align:center!important;color:#666;font-style:italic}
</style></head><body><article class="card"><header class="banner">INCIDENT QUALIFICATION CARD</header><div class="main"><div class="left"><section class="identity"><div class="details"><b>Employee Name:</b><span>${escapeHtml(input.employeeName)}</span><b>Company / Agency:</b><span>${escapeHtml(input.companyName)}</span><b>Home Base / Home Unit:</b><span>${escapeHtml(input.homeBase)||'—'}</span><b>Company Phone:</b><span>${escapeHtml(input.companyPhone)||'—'}</span></div><div class="details"><b>Year:</b><span>${year}</span><b>Issue Date:</b><span>${issueDateText}</span><b>Current Through:</b><span>${formatDate(currentThrough(primary,annual))}</span><b>WCT Completion:</b><span>${formatDate(annual?.wctCompletionDate)}</span><b>RT-130 Refresher:</b><span>${formatDate(annual?.rt130CompletionDate)}</span></div></section><section class="qualifications"><h2>QUALIFIED POSITIONS</h2><table><thead><tr><th>Position Code</th><th>Position Title</th><th>Status</th><th>Attained Date</th><th>Expiration Date</th></tr></thead><tbody>${positionRows}</tbody></table><div class="legend"><b>Q</b> = Qualified</div></section></div><aside class="portrait"><div>${input.photoDataUrl?photo.replace('<img ','<img class="photo" '):photo}</div><h2>${escapeHtml(input.employeeName)}</h2><div class="primary"><small>PRIMARY QUALIFICATION</small><strong>${escapeHtml(primary?.courseCode||primary?.name||'—')}</strong></div></aside></div><section class="signatures"><div class="signature">Employee Signature</div><div class="signature">Certifying Official Signature</div></section><footer class="footer">Generated by FireOps · Verify all qualifications before incident use.</footer></article></body></html>`;
}
