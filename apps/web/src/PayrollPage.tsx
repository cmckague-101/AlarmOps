import {FileInput} from './demo-uploads';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, CircleDollarSign, CircleX, ExternalLink, FileText, Plus, Trash2, Upload, X } from 'lucide-react';
import { createPayrollRows, formatCalendarRange, isCompanyManager, payrollCrewIds, payrollCrewTotals, payrollDayName, payrollTotals, updatePayrollCrew, updatePayrollDate, type CrewMember, type FireOpsUser, type PayrollDay, type PayrollForm } from '@fireops/domain';
import { supabase } from './supabase';

type PayrollRow = {id:string;company_id:string;created_by:string;created_by_name:string;engine_number:string;incidents:string;attachment:PayrollForm['attachment'];rows:PayrollDay[];status:PayrollForm['status'];submitted_at:string|null;approved_at:string|null;approved_by:string|null;rejection_notes:string|null;rejected_at:string|null;rejected_by:string|null;created_at:string;updated_at:string};
const columns = 'id,company_id,created_by,created_by_name,engine_number,incidents,attachment,rows,status,submitted_at,approved_at,approved_by,rejection_notes,rejected_at,rejected_by,created_at,updated_at';
const fromRow = (row:PayrollRow):PayrollForm => ({id:row.id,companyId:row.company_id,createdBy:row.created_by,createdByName:row.created_by_name,engineNumber:row.engine_number,incidents:row.incidents,attachment:row.attachment,rows:row.rows,status:row.status,submittedAt:row.submitted_at,approvedAt:row.approved_at,approvedBy:row.approved_by,rejectionNotes:row.rejection_notes,rejectedAt:row.rejected_at,rejectedBy:row.rejected_by,createdAt:row.created_at,updatedAt:row.updated_at});
const PAYROLL_BUCKET = 'payroll-files';
const PAYROLL_FILE_TYPES = ['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'];
const PAYROLL_FILE_LIMIT = 10 * 1024 * 1024;
function payrollFileType(file:File){return file.type||(/\.pdf$/i.test(file.name)?'application/pdf':/\.hei[cf]$/i.test(file.name)?'image/heic':'')}
function safePayrollFileName(name:string){return name.trim().replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'attachment'}

export default function PayrollPage({companyId,user,crew,requestedPayrollId,onPayrollOpened,demoForms,onDemoChange}:{companyId?:string;user:FireOpsUser;crew:CrewMember[];requestedPayrollId?:string|null;onPayrollOpened?:()=>void;demoForms?:PayrollForm[];onDemoChange?:(forms:PayrollForm[])=>void}) {
  const manager = isCompanyManager(user.role);
  const [forms,setForms] = useState<PayrollForm[]>(demoForms??[]);
  const [selected,setSelected] = useState<PayrollForm|null>(null);
  const [draft,setDraft] = useState<PayrollForm|null>(()=>demoForms?.find(form=>(form.status==='draft'||form.status==='rejected')&&form.createdBy===user.id)??null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const currentYear = new Date().getFullYear();
  const [year,setYear] = useState(currentYear);
  const [crewFilter,setCrewFilter] = useState('all');
  const saveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const formCrew = useMemo(()=>crew.filter(person=>person.role!=='owner'),[crew]);
  const eligibleCrew = useMemo(()=>formCrew.filter(person=>person.status==='Active'),[formCrew]);
  const crewNames = useMemo(()=>new Map(formCrew.map(person=>[person.id,person.name])),[formCrew]);

  const demoCallback=useRef(onDemoChange);demoCallback.current=onDemoChange;
  useEffect(()=>{if(demoForms)demoCallback.current?.(forms)},[forms,Boolean(demoForms)]);
  const load = useCallback(async()=>{
    if(demoForms||!supabase||!companyId){setLoading(false);return}
    const {data,error:failure}=await supabase.from('payroll_forms').select(columns).eq('company_id',companyId).order('created_at',{ascending:false});
    if(failure){setError(`Payroll could not load. ${failure.message}`);setLoading(false);return}
    const loaded=((data??[]) as PayrollRow[]).map(fromRow);setForms(loaded);setDraft(loaded.find(form=>(form.status==='draft'||form.status==='rejected')&&form.createdBy===user.id)??null);setError('');setLoading(false);
  },[companyId,user.id,Boolean(demoForms)]);
  useEffect(()=>{void load();if(demoForms||!supabase||!companyId)return;const client=supabase;const channel=client.channel(`payroll:${companyId}`).on('postgres_changes',{event:'*',schema:'public',table:'payroll_forms',filter:`company_id=eq.${companyId}`},()=>void load()).subscribe();return()=>{void client.removeChannel(channel)}},[companyId,load]);
  useEffect(()=>{if(!requestedPayrollId||loading)return;const requested=forms.find(form=>form.id===requestedPayrollId);if(requested)setSelected(requested);onPayrollOpened?.()},[forms,loading,onPayrollOpened,requestedPayrollId]);
  useEffect(()=>()=>{if(saveTimer.current)clearTimeout(saveTimer.current)},[]);

  function newForm(){
    if(draft){setSelected(draft);return}
    setSelected({id:crypto.randomUUID(),companyId:companyId??'',createdBy:user.id,createdByName:user.name,engineNumber:'',incidents:'',attachment:null,rows:createPayrollRows(),status:'draft',submittedAt:null,approvedAt:null,approvedBy:null,rejectionNotes:null,rejectedAt:null,rejectedBy:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  }
  function queueSave(form:PayrollForm){
    setSelected(form);setDraft(form);if(saveTimer.current)clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>void save(form),650);
  }
  async function save(form:PayrollForm){
    if(demoForms){const saved={...form,updatedAt:new Date().toISOString()};setDraft(saved);setSelected(saved);setForms(current=>[saved,...current.filter(item=>item.id!==saved.id)]);return saved}
    if(!supabase||!companyId||(form.status!=='draft'&&form.status!=='rejected'))return null;setSaving(true);setError('');
    const payload={id:form.id,company_id:companyId,created_by:user.id,created_by_name:user.name,engine_number:form.engineNumber,incidents:form.incidents,attachment:form.attachment,rows:form.rows,status:form.status};
    const query=form.status==='rejected'?supabase.from('payroll_forms').update(payload).eq('company_id',companyId).eq('id',form.id):supabase.from('payroll_forms').upsert(payload);
    const {data,error:failure}=await query.select(columns).single<PayrollRow>();
    setSaving(false);if(failure){setError(`Autosave failed. ${failure.message}`);return null}const saved=fromRow(data);setDraft(saved);setSelected(current=>current?.id===saved.id?saved:current);setForms(current=>[saved,...current.filter(item=>item.id!==saved.id)]);return saved;
  }
  async function attach(file:File){
    if(!selected||!supabase||!companyId||saving)return;const mimeType=payrollFileType(file);
    if(!PAYROLL_FILE_TYPES.includes(mimeType)||file.size<=0||file.size>PAYROLL_FILE_LIMIT){setError('Choose a JPG, PNG, WebP, HEIC, or PDF attachment up to 10 MB.');return}
    if(saveTimer.current)clearTimeout(saveTimer.current);setSaving(true);setError('');const storagePath=`${companyId}/${user.id}/forms/${selected.id}/${crypto.randomUUID()}-${safePayrollFileName(file.name)}`;
    try{const {error:uploadError}=await supabase.storage.from(PAYROLL_BUCKET).upload(storagePath,file,{contentType:mimeType});if(uploadError)throw uploadError;const previous=selected.attachment;const saved=await save({...selected,attachment:{name:file.name,mimeType,byteSize:file.size,storagePath}});if(!saved){await supabase.storage.from(PAYROLL_BUCKET).remove([storagePath]);return}if(previous){const {error:removeError}=await supabase.storage.from(PAYROLL_BUCKET).remove([previous.storagePath]);if(removeError)setError(`Attachment replaced, but old file could not be removed. ${removeError.message}`)}}catch(failure){setError(`Attachment could not upload. ${(failure as {message?:string}).message??'Try again.'}`)}finally{setSaving(false)}
  }
  async function removeAttachment(){
    if(!selected?.attachment||!supabase||saving)return;if(saveTimer.current)clearTimeout(saveTimer.current);const attachment=selected.attachment;const saved=await save({...selected,attachment:null});if(!saved)return;const {error:failure}=await supabase.storage.from(PAYROLL_BUCKET).remove([attachment.storagePath]);if(failure)setError(`Attachment was removed from form, but file could not be deleted. ${failure.message}`);
  }
  async function openAttachment(form:PayrollForm){
    if(!form.attachment||!supabase)return;const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;const {data,error:failure}=await supabase.storage.from(PAYROLL_BUCKET).createSignedUrl(form.attachment.storagePath,3600);if(failure){tab?.close();setError(`Attachment could not open. ${failure.message}`);return}if(tab)tab.location.href=data.signedUrl;else setError('Allow pop-ups to open attachment, then try again.');
  }
  async function submit(){
    if(!selected)return;if(demoForms){if(saveTimer.current)clearTimeout(saveTimer.current);const submitted:PayrollForm={...selected,status:'pending',submittedAt:new Date().toISOString()};setForms(current=>[submitted,...current.filter(item=>item.id!==submitted.id)]);setSelected(null);setDraft(null);return}if(!supabase)return;if(saveTimer.current)clearTimeout(saveTimer.current);const saved=await save(selected);if(!saved)return;
    const {data,error:failure}=await supabase.from('payroll_forms').update({status:'pending'}).eq('company_id',companyId).eq('id',saved.id).in('status',['draft','rejected']).select(columns).single<PayrollRow>();
    if(failure){setError(`Payroll could not submit. ${failure.message}`);return}const submitted=fromRow(data);setSelected(null);setDraft(null);setForms(current=>[submitted,...current.filter(item=>item.id!==submitted.id)]);
  }
  async function setManagerStatus(form:PayrollForm,status:'approved'|'rejected'|'paid',notes?:string){
    if(demoForms){const timestamp=new Date().toISOString();const updated:PayrollForm={...form,status,updatedAt:timestamp,...(status==='approved'?{approvedAt:timestamp,approvedBy:user.id}:{}),...(status==='rejected'?{rejectionNotes:notes??'',rejectedAt:timestamp,rejectedBy:user.id}:{})};setSelected(status==='rejected'?null:updated);setForms(current=>current.map(item=>item.id===updated.id?updated:item));return}
    if(!supabase||!companyId)return;setSaving(true);setError('');const payload=status==='rejected'?{status,rejection_notes:notes}:{status};const {data,error:failure}=await supabase.from('payroll_forms').update(payload).eq('company_id',companyId).eq('id',form.id).select(columns).single<PayrollRow>();setSaving(false);
    if(failure){setError(`Payroll could not be ${status}. ${failure.message}`);return}const updated=fromRow(data);setSelected(status==='rejected'?null:updated);setForms(current=>current.map(item=>item.id===updated.id?updated:item));
  }
  function reject(form:PayrollForm){const notes=window.prompt('Add notes explaining what needs to change.');if(notes===null)return;if(!notes.trim()){setError('Rejection notes are required.');return}if(notes.trim().length>1000){setError('Rejection notes must be 1,000 characters or fewer.');return}void setManagerStatus(form,'rejected',notes.trim())}
  async function remove(){
    if(!selected||((selected.status!=='draft'&&selected.status!=='rejected')&&!manager)||!window.confirm('Delete this payroll form? This cannot be undone.'))return;
    if(saveTimer.current)clearTimeout(saveTimer.current);setSaving(true);setError('');
    if(!demoForms&&supabase&&companyId){const {error:failure}=await supabase.from('payroll_forms').delete().eq('company_id',companyId).eq('id',selected.id);if(failure){setError(`Payroll form could not be deleted. ${failure.message}`);setSaving(false);return}if(selected.attachment){const {error:storageFailure}=await supabase.storage.from(PAYROLL_BUCKET).remove([selected.attachment.storagePath]);if(storageFailure)setError(`Payroll form was deleted, but attachment could not be removed. ${storageFailure.message}`)}}
    const id=selected.id;setForms(current=>current.filter(item=>item.id!==id));setDraft(current=>current?.id===id?null:current);setSelected(null);setSaving(false);
  }
  const years=useMemo(()=>[...new Set([currentYear,...forms.map(form=>new Date(form.createdAt).getFullYear())])].sort((a,b)=>b-a),[forms,currentYear]);
  const visible=forms.filter(form=>form.status!=='draft'&&new Date(form.createdAt).getFullYear()===year&&(!manager||crewFilter==='all'||form.createdBy===crewFilter));
  if(selected)return <PayrollEditor form={selected} crew={formCrew} saving={saving} error={error} onBack={()=>setSelected(null)} onChange={queueSave} onAttach={file=>void attach(file)} onRemoveAttachment={()=>void removeAttachment()} onOpenAttachment={()=>void openAttachment(selected)} onDelete={()=>void remove()} onSubmit={()=>void submit()} onApprove={()=>void setManagerStatus(selected,'approved')} onReject={()=>reject(selected)} onMarkPaid={()=>void setManagerStatus(selected,'paid')} canEdit={selected.createdBy===user.id} canManage={manager}/>;
  return <div className="page payroll-page"><div className="page-heading"><div><h1>Payroll</h1></div><button className="primary" onClick={newForm}><Plus/>New Payroll Form</button></div>
    {draft&&<button className={`payroll-draft-card${draft.status==='rejected'?' rejected':''}`} onClick={()=>setSelected(draft)}><span><b>{draft.status==='rejected'?'Payroll returned for changes':'Payroll form in progress'}</b><small>{draft.status==='rejected'?draft.rejectionNotes:`Last saved ${new Date(draft.updatedAt).toLocaleString()}`}</small></span><strong>{draft.status==='rejected'?'Review':'Continue'}</strong></button>}
    {error&&<p className="receipt-error" role="alert">{error}</p>}
    <section className="receipt-list-card"><div className="receipt-list-heading"><h2>{manager?'Payroll forms':'Submitted payroll'}</h2><div className="payroll-filters"><label>Year <select value={year} onChange={event=>setYear(Number(event.target.value))}>{years.map(value=><option key={value}>{value}</option>)}</select></label>{manager&&<label>Crew member <select value={crewFilter} onChange={event=>setCrewFilter(event.target.value)}><option value="all">All Crew</option>{eligibleCrew.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}</div></div>
      {loading?<p className="receipt-state">Loading payroll…</p>:!visible.length?<p className="receipt-state">No payroll forms found for selected filters.</p>:<div className="receipt-table-wrap"><table className="receipt-table"><thead><tr>{manager&&<th>Crew member</th>}<th>Engine</th><th>Period</th><th>Hours</th>{manager&&<th>Crew</th>}<th>Status</th>{manager&&<><th className="payroll-milestone-column">Approved</th><th className="payroll-milestone-column">Paid</th></>}<th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map(form=>{const totals=payrollTotals(form.rows);const approved=form.status==='approved'||form.status==='paid';return <tr key={form.id}>{manager&&<td>{form.createdByName}</td>}<td>{form.engineNumber||'—'}</td><td>{formatCalendarRange(form.rows[0]?.date??'',form.rows[form.rows.length-1]?.date??'')}</td><td>{totals.totalHours} ({totals.overtimeHours} OT)</td>{manager&&<td>{payrollCrewIds(form.rows).map(id=>crewNames.get(id)??'Unknown crew').join(', ')||'—'}</td>}<td><span className={`payroll-status ${form.status}`}>{form.status}</span></td>{manager&&<><td className="payroll-milestone-column"><span className={`payroll-milestone${approved?' complete':''}`} title={approved?'Approved':'Not approved'}><Check/></span></td><td className="payroll-milestone-column"><span className={`payroll-milestone${form.status==='paid'?' complete paid':''}`} title={form.status==='paid'?'Paid':'Not paid'}><CircleDollarSign/></span></td></>}<td><button className="receipt-open" onClick={()=>setSelected(form)} aria-label={`View payroll for ${form.createdByName}`}><ExternalLink/>View</button></td></tr>})}</tbody></table></div>}
    </section></div>;
}

function PayrollEditor({form,crew,saving,error,onBack,onChange,onAttach,onRemoveAttachment,onOpenAttachment,onDelete,onSubmit,onApprove,onReject,onMarkPaid,canEdit,canManage}:{form:PayrollForm;crew:CrewMember[];saving:boolean;error:string;onBack:()=>void;onChange:(form:PayrollForm)=>void;onAttach:(file:File)=>void;onRemoveAttachment:()=>void;onOpenAttachment:()=>void;onDelete:()=>void;onSubmit:()=>void;onApprove:()=>void;onReject:()=>void;onMarkPaid:()=>void;canEdit:boolean;canManage:boolean}){
  const editable=canEdit&&(form.status==='draft'||form.status==='rejected');const names=new Map(crew.map(person=>[person.id,person.name]));const totals=payrollTotals(form.rows);const selectedCrew=payrollCrewIds(form.rows);const crewTotals=payrollCrewTotals(form.rows);
  function patch(values:Partial<PayrollForm>){if(editable)onChange({...form,...values})}
  function patchRow(index:number,values:Partial<PayrollDay>){patch({rows:form.rows.map((row,i)=>i===index?{...row,...values}:row)})}
  return <div className="page payroll-page"><div className="page-heading"><div><button className="back-link" onClick={onBack}>← Back to payroll</button><h1>{editable?'Payroll form':`Payroll · ${form.status}`}</h1><p>{editable?(saving?'Saving changes…':form.status==='rejected'?'Update payroll, then send it back for approval.':'Changes save automatically'):'Submitted payroll is view only.'}</p></div>{(editable||canManage)&&<button className="payroll-delete" disabled={saving} onClick={onDelete}><Trash2/>Delete form</button>}</div>
    {error&&<p className="receipt-error" role="alert">{error}</p>}
    {form.rejectionNotes&&<div className="payroll-rejection-note"><CircleX/><span><b>Changes requested</b>{form.rejectionNotes}</span></div>}
    <section className="payroll-form-card"><div className="payroll-header-fields"><label><span>Resource</span>{editable?<input value={form.engineNumber} onChange={event=>patch({engineNumber:event.target.value})}/>:<span className="payroll-readonly-value">{form.engineNumber||'—'}</span>}</label><label><span>Incident(s)</span>{editable?<input value={form.incidents} onChange={event=>patch({incidents:event.target.value})}/>:<span className="payroll-readonly-value">{form.incidents||'—'}</span>}</label><div className="payroll-attachment-field"><span>Attachment</span>{form.attachment?<div className="payroll-attachment"><FileText/><span><b>{form.attachment.name}</b><small>{(form.attachment.byteSize/1024/1024).toFixed(1)} MB</small></span><button type="button" onClick={onOpenAttachment} aria-label={`Open ${form.attachment.name}`}><ExternalLink/></button>{editable&&<button type="button" disabled={saving} onClick={onRemoveAttachment} aria-label="Remove attachment"><X/></button>}</div>:editable?<label className="payroll-attachment-picker"><Upload/><span>{saving?'Uploading…':'Attach file or image'}</span><FileInput type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif" disabled={saving} onChange={event=>{const file=event.target.files?.[0];if(file)onAttach(file);event.target.value=''}}/></label>:<span className="payroll-readonly-value">—</span>}<small className="payroll-attachment-help">JPG, PNG, WebP, HEIC, or PDF · 10 MB max</small></div></div>
      {!editable&&canManage?<div className="payroll-crew-summary"><table><thead><tr><th>Crew</th><th>Regular hours</th><th>Overtime hours</th><th>Days worked</th></tr></thead><tbody>{crewTotals.length?crewTotals.map(item=><tr key={item.crewId}><td>{names.get(item.crewId)??'Unknown crew'}</td><td>{item.regularHours}</td><td>{item.overtimeHours}</td><td>{item.totalDays}</td></tr>):<tr><td colSpan={4}>No crew selected</td></tr>}</tbody></table></div>:<div className="payroll-form-crew"><b>Crew on form</b><span>{selectedCrew.length?selectedCrew.map(id=>names.get(id)??'Unknown crew').join(', '):'No crew selected'}</span></div>}
      <div className="payroll-grid-wrap"><table className="payroll-grid"><thead><tr><th>Date</th><th>Day of week</th><th>Hours worked</th><th>Crew</th><th>Notes</th></tr></thead><tbody>{form.rows.map((row,index)=><tr key={index}><td>{editable?<input aria-label={`Row ${index+1} date`} className={!row.date?'payroll-date-empty':undefined} type="date" value={row.date} disabled={!form.rows[0].date&&index>0} onChange={event=>patch({rows:updatePayrollDate(form.rows,index,event.target.value)})}/>:row.date||'—'}</td><td>{payrollDayName(row.date)}</td><td>{editable?<input aria-label={`Row ${index+1} hours`} type="number" min="0" step="0.25" value={row.hoursWorked||''} onChange={event=>patchRow(index,{hoursWorked:Math.max(0,Number(event.target.value))})}/>:row.hoursWorked}</td><td>{editable?<><CrewSelect crew={crew} selected={row.crewIds} disabled={false} onChange={ids=>patch({rows:updatePayrollCrew(form.rows,index,ids)})}/><small className="payroll-day-crew">{row.crewIds.length?row.crewIds.map(id=>names.get(id)??'Unknown crew').join(', '):'No crew selected'}</small></>:row.crewIds.length?row.crewIds.map(id=>names.get(id)??'Unknown crew').join(', '):'—'}</td><td>{editable?<input aria-label={`Row ${index+1} notes`} value={row.notes} onChange={event=>patchRow(index,{notes:event.target.value})}/>:row.notes||'—'}</td></tr>)}</tbody></table></div>
      <div className="payroll-totals"><span><b>{totals.totalDays}</b>Total days</span><span><b>{totals.regularHours}</b>Regular hours</span><span><b>{totals.overtimeHours}</b>Overtime hours</span><span><b>{totals.totalHours}</b>Total hours</span></div>
      {editable?<button className="primary payroll-submit" onClick={onSubmit} disabled={saving}>{form.status==='rejected'?'Send Back for Approval':'Submit Payroll'}</button>:form.status==='pending'&&canManage?<div className="payroll-review-actions"><button className="payroll-reject" onClick={onReject} disabled={saving}><CircleX/>Reject Payroll</button><button className="primary payroll-submit" onClick={onApprove} disabled={saving}><Check/>Approve Payroll</button></div>:form.status==='approved'&&canManage?<button className="payroll-paid payroll-submit" onClick={onMarkPaid} disabled={saving}><CircleDollarSign/>Mark as Paid</button>:null}
    </section></div>;
}

function CrewSelect({crew,selected,disabled,onChange}:{crew:CrewMember[];selected:string[];disabled:boolean;onChange:(ids:string[])=>void}){
  return <details className="crew-multiselect"><summary><span>{selected.length?`${selected.length} selected`:'Select crew'}</span><ChevronDown/></summary><div>{crew.filter(person=>person.status==='Active').map(person=><label key={person.id}><input type="checkbox" checked={selected.includes(person.id)} disabled={disabled} onChange={()=>onChange(selected.includes(person.id)?selected.filter(id=>id!==person.id):[...selected,person.id])}/><span>{person.name}</span></label>)}</div></details>;
}
