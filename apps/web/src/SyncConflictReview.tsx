import {useEffect,useRef,useState} from 'react';
import {
  syncReviewAuthorText,syncReviewCanApprove,syncReviewFieldLabel,syncReviewLocked,syncReviewValueText,
  type SyncReviewClient,type SyncReviewClientState,type SyncReviewFieldProvenance,type SyncFieldValue,
} from '@fireops/domain';
import './sync-conflict-review.css';

const date=(value?:string|null)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString(undefined,{timeZoneName:'short'}):'Not recorded';
function Author({value,receivedAt}:{value?:SyncReviewFieldProvenance;receivedAt?:string}){
  return <div className="sync-author"><p>{syncReviewAuthorText(value)}</p>
    <dl><div><dt>Device save time (reported)</dt><dd>{date(value?.savedAt)}</dd></div><div><dt>Server {receivedAt?'received':'recorded'}</dt><dd>{date(receivedAt??value?.serverRecordedAt)}</dd></div></dl>
    {value?.deviceId&&<small>Device: {value.deviceId}</small>}
    {value?.approvedBy&&<small>Approved by {value.approvedByName||value.approvedBy} · {date(value.approvedAt)}</small>}
    {value?.origin==='baseline'&&<small>Original change time and author were not recorded for this legacy baseline.</small>}
  </div>;
}
export function SyncConflictReview({state,controller,onBack}:{state:SyncReviewClientState;controller:SyncReviewClient;onBack:()=>void}){
  const [confirmed,setConfirmed]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null);
  const locked=syncReviewLocked(state);
  const review=state.review;
  useEffect(()=>setConfirmed(false),[review?.reviewToken,state.choices]);
  useEffect(()=>{heading.current?.focus()},[state.reviewLoading,state.decision]);
  const label=review?.currentRecord?.[state.target?.entityType==='vehicle'?'unit':'title'];
  return <div className="sync-review">
    <button className="command-back" disabled={locked} onClick={onBack}>← Command Center</button>
    <header><h1 tabIndex={-1} ref={heading}>Data conflict review</h1><p>{typeof label==='string'?label:`${state.target?.entityType==='vehicle'?'Vehicle':'Issue'} record`} · {state.target?.entityId}</p></header>
    <p>Choose the value to keep for each field. Independent changes may be preselected. Approval is online-only and checks for newer changes.</p>
    {state.reviewLoading&&<p role="status">Loading the latest versions…</p>}
    {state.reviewError&&<div className="sync-review-notice" role="alert"><p>{state.reviewError}</p>
      {state.approval==='uncertain'?<button className="primary" onClick={()=>void controller.approve()}>Retry approval confirmation</button>:!locked&&state.target&&<button className="secondary" onClick={()=>void controller.openReview(state.target!)}>Refresh review</button>}
    </div>}
    {state.decision&&<section className="sync-review-result" role="status"><h2>Conflict resolved</h2><p>{state.decision.outcomes.filter(item=>item.outcome==='kept').length} proposals kept · {state.decision.outcomes.filter(item=>item.outcome==='partially_kept').length} partly kept · {state.decision.outcomes.filter(item=>item.outcome==='not_selected').length} not kept.</p><p>Approved {date(state.decision.decidedAt)}. Other versions remain in audit history.</p><button className="secondary" onClick={onBack}>Return to dashboard</button></section>}
    {review&&<form onSubmit={event=>{event.preventDefault();if(confirmed&&syncReviewCanApprove(state))void controller.approve()}}>
      <div className="sync-review-notice"><p>{review.candidates.length} competing {review.candidates.length===1?'proposal':'proposals'} · Shared revision {review.currentRevision}</p><p>Device times and connection labels are reported by the app; server times are listed separately.</p></div>
      {(review.currentRecord===null||review.candidates.some(item=>item.lifecycleChanged||item.reason!=='fields'))&&<div className="sync-review-notice" role="note"><strong>Record lifecycle changed</strong><p>{review.currentRecord===null?'This record was deleted. It can only be kept deleted here; restoring it requires a separate workflow.':'This record was deleted or re-created. Review all choices explicitly; only the selected detail fields will change.'}</p>{review.currentRecord===null&&<button type="button" className="secondary" disabled={locked} onClick={()=>{setConfirmed(false);Object.keys(review.fields).forEach(key=>controller.choose(key,'current'))}}>Keep record deleted</button>}</div>}
      {Object.entries(review.fields).map(([key,field])=><fieldset key={key} disabled={locked} className="sync-review-field"><legend>{syncReviewFieldLabel(key)}</legend><div className="sync-review-options">
        <label className={`sync-review-option ${state.choices[key]==='current'?'selected':''}`}><span className="sync-review-option-title"><input type="radio" name={`sync-${key}`} value="current" checked={state.choices[key]==='current'} onChange={()=>{setConfirmed(false);controller.choose(key,'current')}}/>Current shared value</span><pre>{review.currentRecord===null?'Record deleted':syncReviewValueText(field.current)}</pre><Author value={review.currentProvenance[key]}/></label>
        {field.options.map(option=>{
          const candidate=review.candidates.find(item=>item.id===option.source)!;
          const original:SyncFieldValue=Object.prototype.hasOwnProperty.call(candidate.baseRecord,key)?{present:true,value:candidate.baseRecord[key]}:{present:false};
          return <label key={option.source} className={`sync-review-option ${state.choices[key]===option.source?'selected':''}`}><span className="sync-review-option-title"><input type="radio" name={`sync-${key}`} value={option.source} checked={state.choices[key]===option.source} disabled={locked||review.currentRecord===null} onChange={()=>{setConfirmed(false);controller.choose(key,option.source)}}/>Proposed value · {option.source.slice(-8)}</span><pre>{syncReviewValueText(option.value)}</pre><Author value={option.provenance} receivedAt={candidate.receivedAt}/><details><summary>Originally downloaded value</summary><pre>{syncReviewValueText(original)}</pre></details></label>;
        })}
      </div></fieldset>)}
      {!Object.keys(review.fields).length&&<p>No field values differ in this proposal. Review the record lifecycle before approving.</p>}
      <label className="sync-review-confirm"><input type="checkbox" checked={confirmed} disabled={locked} onChange={event=>setConfirmed(event.target.checked)}/><span>I approve the selected values. Other proposed values will be discarded from active data and kept in audit history.</span></label>
      <button className="primary sync-review-submit" type="submit" disabled={!confirmed||!syncReviewCanApprove(state)}>{state.approval==='saving'?'Confirming approval…':'Approve selected values'}</button>
      {!syncReviewCanApprove(state)&&!locked&&<p role="status">Choose a source for every field before approving.</p>}
      {locked&&<p role="status">Keep this review open until approval is confirmed. Retrying uses the same request and cannot approve twice.</p>}
    </form>}
  </div>;
}
