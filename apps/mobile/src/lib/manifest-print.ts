import {
  emtColumnValue,
  medicMarkLabel,
  selectedDispatchCenter,
  type CrewManifestDocument,
  type ManifestCompanyStamp,
} from './crew-manifest';

/** Ops Clean tokens — FireCo red / black / white only. */
export const OPS_CLEAN={
  red:'#B71C1C',
  black:'#0B0B0B',
  ink:'#141414',
  muted:'#3A3A3A',
  line:'#BDBDBD',
  wash:'#F3F3F3',
  paper:'#FFFFFF',
} as const;

function escapeHtml(value:string){
  return value.replace(/[&<>"']/g,character=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[character]!));
}

function formatPrepared(iso:string){
  const date=new Date(iso);
  if(Number.isNaN(date.getTime()))return '—';
  return date.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});
}

/** Ops Clean print stylesheet with company-stamp block. */
export function manifestPrintStyles():string{
  return `@page{size:letter landscape;margin:.45in}
*{box-sizing:border-box}
body{margin:0;color:${OPS_CLEAN.ink};background:${OPS_CLEAN.paper};font:11px/1.35 "IBM Plex Sans",system-ui,sans-serif}
.company-stamp{display:flex;align-items:center;gap:14px;margin:0 0 12px;padding:10px 12px;border:1px solid ${OPS_CLEAN.line};background:${OPS_CLEAN.wash};border-radius:6px}
.company-stamp .company-logo{width:52px;height:52px;object-fit:contain;border-radius:6px;background:${OPS_CLEAN.paper};border:1px solid ${OPS_CLEAN.line}}
.company-stamp .kicker{font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${OPS_CLEAN.red};margin:0 0 2px}
.company-stamp strong{display:block;font-size:14px;color:${OPS_CLEAN.black}}
.company-stamp p{margin:3px 0 0;color:${OPS_CLEAN.muted};font-size:11px}
header{display:flex;justify-content:space-between;gap:16px;color:#fff;padding:14px 16px;background:${OPS_CLEAN.black};border-radius:6px 6px 0 0}
header h1{margin:0;font:650 17px/1.2 "IBM Plex Sans",system-ui,sans-serif;letter-spacing:.01em;color:#fff}
header p{margin:4px 0 0;color:rgba(255,255,255,.85)}
.badge{display:inline-block;background:${OPS_CLEAN.red};color:#fff;padding:5px 10px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;border-radius:4px}
table{width:100%;border-collapse:collapse;border:1px solid ${OPS_CLEAN.black}}
th,td{padding:7px 8px;vertical-align:top;text-align:left;border-bottom:1px solid #D4D4D4;color:${OPS_CLEAN.ink}}
th{background:${OPS_CLEAN.red};color:#fff;font-size:10px;font-weight:650;text-transform:uppercase;letter-spacing:.04em}
table.vehicles{margin-top:8px}
.staff{display:flex;border:1px solid ${OPS_CLEAN.black};border-top:0;border-radius:0 0 6px 6px}
.staff div{flex:1;padding:10px 12px;border-right:1px solid #D4D4D4}
.staff div:last-child{border-right:0}
.staff span{display:inline-block;background:${OPS_CLEAN.black};color:#fff;padding:3px 7px;font-size:9px;font-weight:650;text-transform:uppercase;letter-spacing:.05em;border-radius:3px}
.staff strong{display:block;margin-top:7px;font-size:12px;color:${OPS_CLEAN.ink}}
.staff em{display:block;margin-top:2px;font-style:normal;color:${OPS_CLEAN.muted}}
.notes-block{margin:10px 0 0;padding:8px 10px;border:1px solid ${OPS_CLEAN.line}}
footer{margin-top:10px;color:${OPS_CLEAN.muted};font-size:10px}`;
}

function companyStampHtml(company:ManifestCompanyStamp):string{
  const contact=[company.ownerName,company.phone,company.ownerEmail||company.location]
    .filter(Boolean)
    .join(' · ');
  const logo=company.logoDataUrl
    ?`<img class="company-logo" src="${escapeHtml(company.logoDataUrl)}" alt=""/>`
    :'';
  return `<aside class="company-stamp">
  ${logo}
  <div>
    <div class="kicker">Company identification</div>
    <strong>${escapeHtml(company.name||'—')}</strong>
    ${contact?`<p>${escapeHtml(contact)}</p>`:''}
  </div>
</aside>`;
}

/** Build Ops Clean HTML for Create PDF — stamps company profile each export. */
export function createManifestPrintHtml(
  manifest:CrewManifestDocument,
  company:ManifestCompanyStamp,
):string{
  const dispatch=selectedDispatchCenter(manifest);
  const peopleRows=manifest.people.map(person=>{
    const notes=[person.notes,medicMarkLabel(person.medicMark)].filter(Boolean).join(' · ')||'—';
    return `<tr>
      <td>${person.lineNumber}</td>
      <td>${escapeHtml(person.sex||'—')}</td>
      <td><strong>${escapeHtml(person.name||'—')}</strong><br><span>${escapeHtml(person.dob||'DOB —')}</span></td>
      <td>${escapeHtml(person.position||'—')}</td>
      <td>${escapeHtml(person.additionalQuals.join(', ')||'—')}</td>
      <td style="text-align:center">${escapeHtml(emtColumnValue(person.medicMark))}</td>
      <td>${escapeHtml(person.phone||'—')}</td>
      <td>${escapeHtml(notes)}</td>
    </tr>`;
  }).join('');
  const vehicleRows=manifest.vehicles.map(vehicle=>`<tr>
    <td><strong>${escapeHtml(vehicle.firNumber||'—')}</strong></td>
    <td>${escapeHtml(vehicle.make||'—')}</td>
    <td>${escapeHtml(vehicle.model||'—')}</td>
    <td>${escapeHtml(vehicle.vin||'—')}</td>
    <td>${escapeHtml(vehicle.plate||'—')}</td>
    <td>${escapeHtml(vehicle.notes||'—')}</td>
  </tr>`).join('');
  const vehiclesHtml=manifest.vehicles.length
    ?`<table class="vehicles"><thead><tr><th>Fleet ID</th><th>Make</th><th>Model</th><th>VIN</th><th>License plate</th><th>Notes</th></tr></thead><tbody>${vehicleRows}</tbody></table>`
    :'<p>No vehicles selected.</p>';
  const notesHtml=manifest.sheetNotes
    ?`<div class="notes-block"><strong>Manifest Notes</strong><br>${escapeHtml(manifest.sheetNotes)}</div>`
    :'';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(manifest.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
  <style>${manifestPrintStyles()}</style></head><body>
  ${companyStampHtml(company)}
  <header><div><h1>${escapeHtml(manifest.moduleName)}</h1><p>${escapeHtml(manifest.title)}</p></div>
  <div style="text-align:right"><span class="badge">${escapeHtml(manifest.incidentLabel||'Crew personnel manifest')}</span><p>Prepared ${escapeHtml(formatPrepared(manifest.preparedAt))}</p></div></header>
  <table><thead><tr><th>#</th><th>M/F</th><th>Name (as appears on ID) &amp; DOB</th><th>Position</th><th>Additional quals</th><th>EMT</th><th>Phone</th><th>Notes</th></tr></thead>
  <tbody>${peopleRows||`<tr><td colspan="8" style="text-align:center;color:#666">No personnel selected</td></tr>`}</tbody></table>
  <section style="margin-top:10px;padding:8px 10px;border:1px solid ${OPS_CLEAN.line}"><strong>Vehicles</strong>${vehiclesHtml}</section>
  <div class="staff">
    <div><span>Crew Coordinator</span><strong>${escapeHtml(manifest.handCrewCoordinator.name||'—')}</strong>${manifest.handCrewCoordinator.phone?`<em>${escapeHtml(manifest.handCrewCoordinator.phone)}</em>`:''}</div>
    <div><span>Dispatch Center</span><strong>${escapeHtml(dispatch?.name||'—')}</strong>${dispatch?.phone?`<em>${escapeHtml(dispatch.phone)}</em>`:''}</div>
  </div>
  ${notesHtml}
  <footer>FireCo personnel manifest · Ops Clean · red / black / white</footer>
  </body></html>`;
}

export function manifestPdfFileName(company:ManifestCompanyStamp,manifest:CrewManifestDocument):string{
  const base=(company.name||'FireCo').replace(/[^\w.-]+/g,'-').replace(/^-|-$/g,'')||'FireCo';
  const incident=(manifest.incidentLabel||'manifest').replace(/[^\w.-]+/g,'-').replace(/^-|-$/g,'').slice(0,40);
  return `${base}-${incident||'manifest'}.pdf`;
}
