import type {CrewCredential,CrewMember} from './models';
import {crewCredentials} from './rules';

export type SignaturePoint={x:number;y:number};
export type SavedSignature={strokes:SignaturePoint[][]};
export type QualificationCardStatus='pending'|'approved'|'superseded';
export type QualificationCardRequest={
  id:string;companyId:string;crewUserId:string;crewName:string;status:QualificationCardStatus;
  companyPhone:string;homeBase:string;primaryQualificationId:string;cardPosition?:string;photoPath:string;
  ownerSignature?:SavedSignature;ownerName?:string;
  submittedAt:string;approvedAt?:string;
};
export type QualificationCardInput={
  employeeName:string;
  companyName:string;
  companyPhone:string;
  homeBase:string;
  companyLogoDataUrl?:string;
  primaryQualificationId:string;
  cardPosition?:string;
  photoDataUrl?:string;
  ownerSignature?:SavedSignature;
  ownerName?:string;
  approvedAt?:string;
};

export function qualificationCardPositions(member?:CrewMember){
  if(!member)return [];
  return crewCredentials(member).filter(credential=>credential.recordType==='Qualification'||!credential.recordType);
}

export function qualificationCardPositionLabel(credential?:CrewCredential){
  return credential?[credential.courseCode,credential.name].filter(Boolean).join(' — '):'Not selected';
}

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[character]!);
const formatDate=(value?:string)=>value?new Date(`${value}T12:00:00`).toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'numeric'}):'—';
export function signatureHasInk(signature?:SavedSignature){return Boolean(signature?.strokes.some(stroke=>stroke.length>1))}
export function signatureSvg(signature?:SavedSignature){
  if(!signatureHasInk(signature))return '';
  const lines=signature!.strokes.filter(stroke=>stroke.length>1).map(stroke=>`<polyline points="${stroke.map(point=>`${Math.max(0,Math.min(1,point.x))*600},${Math.max(0,Math.min(1,point.y))*120}`).join(' ')}"/>`).join('');
  return `<svg viewBox="0 0 600 120" preserveAspectRatio="none" aria-label="Company representative signature"><g fill="none" stroke="#111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${lines}</g></svg>`;
}

export function createQualificationCardHtml(member:CrewMember,input:QualificationCardInput){
  const positions=qualificationCardPositions(member);
  const primary=positions.find(item=>item.id===input.primaryQualificationId);
  const cardPosition=(input.cardPosition||primary?.courseCode||primary?.name||'—').trim();
  const issueDate=input.approvedAt?new Date(input.approvedAt):new Date();
  const year=issueDate.getFullYear();
  const annual=member.annualRecord;
  const photo=input.photoDataUrl?`<img class="photo" src="${escapeHtml(input.photoDataUrl)}" alt="">`:'<div class="photo-empty">PHOTO</div>';
  const logo=input.companyLogoDataUrl?`<img class="logo" src="${escapeHtml(input.companyLogoDataUrl)}" alt="">`:`<div class="logo-empty">${escapeHtml(input.companyName)}</div>`;
  const positionNames=positions.map(item=>item.courseCode||item.name).filter(Boolean);
  if(cardPosition!=='—'&&!positionNames.some(name=>name.toLocaleLowerCase()===cardPosition.toLocaleLowerCase()))positionNames.unshift(cardPosition);
  const positionRows=positionNames.length?positionNames.map(name=>`<div>${escapeHtml(name)}</div>`).join(''):'<div>—</div>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(input.employeeName)} — Incident Qualification Card</title><style>
@page{size:letter portrait;margin:.3in}*{box-sizing:border-box}html,body{margin:0;color:#080808;background:#fff;font-family:Georgia,'Times New Roman',serif}body{padding:0}.card{width:100%;min-height:10.35in;border:1.5px solid #111;padding:.14in .27in .28in;background:#fff}.banner{height:.8in;display:flex;align-items:center;justify-content:center;border:2px solid #111;background:#c90000;color:#050505;font-size:27px;font-weight:900;font-variant:small-caps;letter-spacing:.2px}.identity{display:grid;grid-template-columns:1.05fr 1fr;gap:.18in;padding:.1in .06in .26in}.company-block{display:flex;min-height:3.35in;flex-direction:column;align-items:center;justify-content:flex-end}.logo-wrap{display:flex;width:2.55in;height:2.25in;align-items:center;justify-content:center;margin-bottom:.04in}.logo{display:block;max-width:100%;max-height:100%;object-fit:contain}.logo-empty{display:flex;width:2.15in;height:2.15in;align-items:center;justify-content:center;border:5px solid #222;border-radius:50%;padding:.2in;text-align:center;font-size:18px;font-weight:900}.phone{font:900 20px Arial,sans-serif;letter-spacing:1px}.owner-signature{position:relative;width:2.65in;height:.62in;border-bottom:3px solid #111}.owner-signature svg{position:absolute;inset:0 3px 1px;width:calc(100% - 6px);height:.58in}.representative{font:900 12px Arial,sans-serif;text-transform:uppercase}.employee-block{display:flex;flex-direction:column;justify-content:flex-end;align-items:center}.photo,.photo-empty{display:flex;width:2.18in;height:2.53in;align-items:center;justify-content:center;border:2px solid #111;background:#eee;object-fit:cover;color:#777;font:800 16px Arial,sans-serif}.employee-title{width:100%;min-height:.9in;margin-top:.08in;border:1.5px solid #111;padding:.1in;text-align:center}.employee-title strong{display:block;font-size:20px;font-variant:small-caps;line-height:1.15}.employee-title span{display:block;margin-top:.03in;font-size:20px;font-weight:900}.details{display:grid;grid-template-columns:1fr 1.02fr;border:2px solid #111;font-size:17px;font-weight:700}.company-details,.training-details{min-height:1.85in;padding:.14in .2in}.company-details{border-right:2px solid #111}.details p{margin:0 0 .28in}.details p:last-child{margin-bottom:0}.details b{font-variant:small-caps}.training-details{font-size:14px}.training-details p{margin-bottom:.2in;line-height:1.35}.qualifications{min-height:1.75in;border:2px solid #111;border-top:0;padding:.1in .2in}.qualifications h2{margin:0 0 .05in;font-size:17px;font-variant:small-caps}.position-list{font-size:16px;font-weight:800;line-height:1.38}.footer{padding-top:.12in;text-align:center;font:8px Arial,sans-serif;color:#555}
</style></head><body><article class="card"><header class="banner">Incident Qualification Card</header><section class="identity"><div class="company-block"><div class="logo-wrap">${logo}</div><div class="phone">${escapeHtml(input.companyPhone)||'—'}</div><div class="owner-signature">${signatureSvg(input.ownerSignature)}</div><div class="representative">Company Representative</div></div><div class="employee-block">${photo}<div class="employee-title"><strong>${escapeHtml(input.employeeName)}</strong><span>${escapeHtml(cardPosition)}</span></div></div></section><section class="details"><div class="company-details"><p><b>Year:</b>&nbsp; ${year}</p><p><b>Home Base:</b>&nbsp; ${escapeHtml(input.homeBase)||'—'}</p><p><b>Company:</b>&nbsp; ${escapeHtml(input.companyName)}</p></div><div class="training-details"><p><b>WCT Type/Completion Date:</b> ${formatDate(annual?.wctCompletionDate)}</p><p><b>ARD —</b> ${formatDate(annual?.wctCurrencyDate)}</p><p><b>RT-130 Completion Date:</b><br>${formatDate(annual?.rt130CompletionDate)}</p></div></section><section class="qualifications"><h2>Qualified Positions:</h2><div class="position-list">${positionRows}</div></section><footer class="footer">Generated by FireOps · Verify all qualifications before incident use.</footer></article></body></html>`;
}
