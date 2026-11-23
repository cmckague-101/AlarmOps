import {useMemo,useState} from 'react';
import {ArrowLeft,Check,ClipboardCopy,Download} from 'lucide-react';
import {viprBidPackageFileName,viprBidPackageText,viprCategoryFor,viprExportSummary,viprFieldsFor,viprSelectableVehicles,type Vehicle} from '@fireops/domain';
import './SendToViprFlow.css';

type Step=1|2|3;

function downloadText(text:string,fileName:string){
  const blob=new Blob([text],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=fileName;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}

const statusLabel={mapped:'Mapped',missing:'Missing',check:'Check'} as const;
const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`;

/** Fleet → Send to VIPR: select units, review mapped fields, then copy or download a bid package. */
export default function SendToViprFlow({vehicles,companyName,onClose,onEditVehicle}:{vehicles:Vehicle[];companyName?:string;onClose:()=>void;onEditVehicle?:(vehicle:Vehicle)=>void}){
  const sorted=useMemo(()=>[...vehicles].sort((a,b)=>a.unit.localeCompare(b.unit,undefined,{numeric:true})),[vehicles]);
  const {selectable,blocked}=useMemo(()=>viprSelectableVehicles(sorted),[sorted]);
  const [step,setStep]=useState<Step>(1);
  const [selected,setSelected]=useState<Set<string>>(()=>new Set(selectable.map(vehicle=>vehicle.id)));
  const [reviewIndex,setReviewIndex]=useState(0);
  const [note,setNote]=useState('');

  const chosen=useMemo(()=>selectable.filter(vehicle=>selected.has(vehicle.id)),[selectable,selected]);
  const reviewVehicle=chosen[Math.min(reviewIndex,chosen.length-1)];
  const reviewFields=reviewVehicle?viprFieldsFor(reviewVehicle):[];
  const summary=useMemo(()=>viprExportSummary(chosen),[chosen]);
  const packageText=useMemo(()=>step===3?viprBidPackageText(chosen,{companyName}):'',[step,chosen,companyName]);

  const toggle=(id:string)=>setSelected(current=>{
    const next=new Set(current);
    if(next.has(id))next.delete(id);else next.add(id);
    return next;
  });
  const copy=async()=>{
    try{await navigator.clipboard.writeText(packageText);setNote('Bid package copied.')}
    catch{setNote('Copy is unavailable in this browser. Download the package instead.')}
  };

  return <div className="page send-vipr-page">
    <button type="button" className="page-back" onClick={onClose}><ArrowLeft/> Back</button>
    <div className="page-heading hero-heading">
      <div>
        <h1>Send to VIPR</h1>
        <p>Build a bid package from Fleet units. VIPR has no import API, so you paste the values into VIPR yourself.</p>
      </div>
    </div>

    <ol className="send-vipr-steps" aria-label="Export steps">
      <li className={step===1?'active':'done'} aria-current={step===1?'step':undefined}><span>{step>1?<Check/>:1}</span>Select units</li>
      <li className={step===2?'active':step>2?'done':''} aria-current={step===2?'step':undefined}><span>{step>2?<Check/>:2}</span>Review mapped fields</li>
      <li className={step===3?'active':''} aria-current={step===3?'step':undefined}><span>3</span>Bid package</li>
    </ol>

    {step===1&&<section className="send-vipr-panel" aria-labelledby="send-vipr-select-heading">
      <div className="send-vipr-body">
        <div className="send-vipr-toolbar">
          <div>
            <h2 id="send-vipr-select-heading">Choose units for this bid / quote</h2>
            <p><em>{selected.size}</em> of {selectable.length} selected{blocked.length?` · ${blocked.length} blocked`:''}</p>
          </div>
          <div className="send-vipr-toolbar-actions">
            <button type="button" className="secondary compact" onClick={()=>setSelected(new Set(selectable.map(vehicle=>vehicle.id)))}>Select all</button>
            <button type="button" className="secondary compact" onClick={()=>setSelected(new Set())}>Clear</button>
          </div>
        </div>
        {selectable.length?<ul className="send-vipr-unit-list">
          {selectable.map(vehicle=>{
            const on=selected.has(vehicle.id);
            const {category,guessed}=viprCategoryFor(vehicle);
            return <li key={vehicle.id}>
              <label className={on?'selected':''}>
                <input type="checkbox" checked={on} onChange={()=>toggle(vehicle.id)}/>
                <span className="send-vipr-unit-copy">
                  <b>{vehicle.unit}</b>
                  <small>{category}{guessed?' (guessed)':''} · {vehicle.year} {vehicle.make} {vehicle.model}</small>
                </span>
                <span className={`send-vipr-ready ${vehicle.status==='Ready'?'ok':''}`}>{vehicle.status}</span>
              </label>
            </li>;
          })}
        </ul>:<p className="send-vipr-empty">No units can be sent. Add vehicles in Fleet or bring them back into service.</p>}
        {blocked.length>0&&<p className="send-vipr-blocked" role="status">{blocked.map(vehicle=>vehicle.unit).join(', ')} can’t be selected while Out of service. Fix in Fleet.</p>}
        <p className="send-vipr-note">Fleet is the single source of truth. Each unit carries one VIPR category in Fleet; correct values there, not in the package.</p>
        <footer className="send-vipr-footer">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={!chosen.length} onClick={()=>{setReviewIndex(0);setStep(2)}}>Next: review fields →</button>
        </footer>
      </div>
    </section>}

    {step===2&&reviewVehicle&&<section className="send-vipr-panel" aria-labelledby="send-vipr-review-heading">
      <div className="send-vipr-body">
        <div className="send-vipr-toolbar">
          <div>
            <h2 id="send-vipr-review-heading">{reviewVehicle.unit} · {viprCategoryFor(reviewVehicle).category}</h2>
            <p>{reviewIndex+1} of {chosen.length} units</p>
          </div>
          <div className="send-vipr-toolbar-actions">
            {onEditVehicle&&<button type="button" className="secondary compact" onClick={()=>onEditVehicle(reviewVehicle)}>Edit in Fleet</button>}
            <button type="button" className="secondary compact" disabled={reviewIndex===0} onClick={()=>setReviewIndex(index=>index-1)}>Previous</button>
            <button type="button" className="secondary compact" disabled={reviewIndex>=chosen.length-1} onClick={()=>setReviewIndex(index=>index+1)}>Next unit</button>
          </div>
        </div>
        <div className="send-vipr-review-layout">
          <table className="send-vipr-map-table">
            <thead><tr><th scope="col">FireOps field</th><th scope="col">Value</th><th scope="col">VIPR field</th><th scope="col">Status</th></tr></thead>
            <tbody>{reviewFields.map(field=><tr key={field.key}>
              <td>{field.fireops}</td>
              <td>{field.value}</td>
              <td>{field.vipr}</td>
              <td><span className={`send-vipr-status ${field.status}`}>{statusLabel[field.status]}</span></td>
            </tr>)}</tbody>
          </table>
          <aside className="send-vipr-summary">
            <h3>Export summary</h3>
            <dl>
              <div><dt>Units</dt><dd>{summary.units}</dd></div>
              <div><dt>Fields mapped</dt><dd>{summary.mapped} / {summary.total}</dd></div>
              <div><dt>Missing (required)</dt><dd>{summary.missing}</dd></div>
              <div><dt>To check</dt><dd>{summary.check}</dd></div>
            </dl>
            {summary.missing>0&&<p className="send-vipr-alert" role="alert">Required fields are missing on one or more units. You can still build the bid package; fill them in Fleet before submitting in VIPR.</p>}
          </aside>
        </div>
        <footer className="send-vipr-footer">
          <button type="button" className="secondary" onClick={()=>setStep(1)}>← Back</button>
          <button type="button" className="primary" onClick={()=>{setNote('');setStep(3)}}>Next: bid package →</button>
        </footer>
      </div>
    </section>}

    {step===3&&<section className="send-vipr-panel" aria-labelledby="send-vipr-package-heading">
      <div className="send-vipr-body">
        <div className="send-vipr-toolbar">
          <div>
            <h2 id="send-vipr-package-heading">Bid package · {plural(chosen.length,'unit')}</h2>
            <p>Field-by-field in VIPR order. Keep it open on a second screen next to VIPR.</p>
          </div>
          <div className="send-vipr-toolbar-actions">
            <button type="button" className="secondary compact" onClick={()=>void copy()}><ClipboardCopy/> Copy</button>
            <button type="button" className="primary compact" onClick={()=>{downloadText(packageText,viprBidPackageFileName());setNote(`Downloaded bid package for ${plural(chosen.length,'unit')}.`)}}><Download/> Download .txt</button>
          </div>
        </div>
        <pre className="send-vipr-package" tabIndex={0} aria-label="Bid package text">{packageText}</pre>
        {note&&<p className="send-vipr-done-note" role="status">{note}</p>}
        <footer className="send-vipr-footer">
          <button type="button" className="secondary" onClick={()=>setStep(2)}>← Back</button>
          <button type="button" className="secondary" onClick={onClose}>Done</button>
        </footer>
      </div>
    </section>}
  </div>;
}
