import {FileInput} from './demo-uploads';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, ChevronDown, CircleDollarSign, CircleX, ExternalLink, FileText, Plus, Trash2, Upload, X } from 'lucide-react';
import { createPayrollRows, formatCalendarRange, canProcessFinance, normalizePayrollRows, payrollCrewIds, payrollCrewTotals, payrollCtrAttachments, payrollDayName, payrollTotals, updatePayrollCrew, updatePayrollDate, type CrewMember, type FireOpsUser, type PayrollAttachment, type PayrollDay, type PayrollForm } from '@fireops/domain';
import { supabase } from './supabase';
import { useDialogA11y } from './useDialogA11y';
import { createId } from './create-id';

type PayrollRow = {id:string;company_id:string;created_by:string;created_by_name:string;engine_number:string;incidents:string;attachment:PayrollForm['attachment'];rows:PayrollDay[];status:PayrollForm['status'];submitted_at:string|null;approved_at:string|null;approved_by:string|null;rejection_notes:string|null;rejected_at:string|null;rejected_by:string|null;created_at:string;updated_at:string};
const columns = 'id,company_id,created_by,created_by_name,engine_number,incidents,attachment,rows,status,submitted_at,approved_at,approved_by,rejection_notes,rejected_at,rejected_by,created_at,updated_at';
const fromRow = (row:PayrollRow):PayrollForm => ({id:row.id,companyId:row.company_id,createdBy:row.created_by,createdByName:row.created_by_name,engineNumber:row.engine_number,incidents:row.incidents,attachment:row.attachment,rows:normalizePayrollRows(row.rows),status:row.status,submittedAt:row.submitted_at,approvedAt:row.approved_at,approvedBy:row.approved_by,rejectionNotes:row.rejection_notes,rejectedAt:row.rejected_at,rejectedBy:row.rejected_by,createdAt:row.created_at,updatedAt:row.updated_at});
const PAYROLL_BUCKET = 'payroll-files';
const PAYROLL_FILE_TYPES = ['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'];
const CTR_FILE_TYPES = ['image/jpeg','image/png','image/webp','image/heic','image/heif'];
const PAYROLL_FILE_LIMIT = 10 * 1024 * 1024;
function payrollFileType(file:File){return file.type||(/\.pdf$/i.test(file.name)?'application/pdf':/\.hei[cf]$/i.test(file.name)?'image/heic':'')}
function safePayrollFileName(name:string){return name.trim().replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'attachment'}
function isInlineAttachment(attachment:PayrollAttachment){return /^(data:|blob:|demo:)/i.test(attachment.storagePath)}
function readFileAsDataUrl(file:File){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result??''));reader.onerror=()=>reject(reader.error??new Error('Could not read file.'));reader.readAsDataURL(file)})}

export default function PayrollPage({companyId,user,crew,requestedPayrollId,onPayrollOpened,demoForms,onDemoChange}:{companyId?:string;user:FireOpsUser;crew:CrewMember[];requestedPayrollId?:string|null;onPayrollOpened?:()=>void;demoForms?:PayrollForm[];onDemoChange?:(forms:PayrollForm[])=>void}) {
  const manager = canProcessFinance(user.role);
  const [forms,setForms] = useState<PayrollForm[]>(()=> (demoForms??[]).map(form=>({...form,rows:normalizePayrollRows(form.rows)})));
  const [selected,setSelected] = useState<PayrollForm|null>(null);
  const [draft,setDraft] = useState<PayrollForm|null>(()=>{
    const found=demoForms?.find(form=>(form.status==='draft'||form.status==='rejected')&&form.createdBy===user.id);
    return found?{...found,rows:normalizePayrollRows(found.rows)}:null;
  });
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const currentYear = new Date().getFullYear();
  const [year,setYear] = useState(currentYear);
  const [crewFilter,setCrewFilter] = useState('all');
  const [rejecting,setRejecting] = useState<PayrollForm|null>(null);
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
    setSelected({id:createId(),companyId:companyId??'',createdBy:user.id,createdByName:user.name,engineNumber:'',incidents:'',attachment:null,rows:createPayrollRows(),status:'draft',submittedAt:null,approvedAt:null,approvedBy:null,rejectionNotes:null,rejectedAt:null,rejectedBy:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  }
  function queueSave(form:PayrollForm){
    setSelected(form);setDraft(form);if(saveTimer.current)clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>void save(form),650);
  }
  async function save(form:PayrollForm){
    const normalized={...form,rows:normalizePayrollRows(form.rows)};
    if(demoForms){const saved={...normalized,updatedAt:new Date().toISOString()};setDraft(saved);setSelected(saved);setForms(current=>[saved,...current.filter(item=>item.id!==saved.id)]);return saved}
    if(!supabase||!companyId||(normalized.status!=='draft'&&normalized.status!=='rejected'))return null;setSaving(true);setError('');
    const payload={id:normalized.id,company_id:companyId,created_by:user.id,created_by_name:user.name,engine_number:normalized.engineNumber,incidents:normalized.incidents,attachment:normalized.attachment,rows:normalized.rows,status:normalized.status};
    const query=normalized.status==='rejected'?supabase.from('payroll_forms').update(payload).eq('company_id',companyId).eq('id',normalized.id):supabase.from('payroll_forms').upsert(payload);
    const {data,error:failure}=await query.select(columns).single<PayrollRow>();
    setSaving(false);if(failure){setError(`Autosave failed. ${failure.message}`);return null}const saved=fromRow(data);setDraft(saved);setSelected(current=>current?.id===saved.id?saved:current);setForms(current=>[saved,...current.filter(item=>item.id!==saved.id)]);return saved;
  }
  async function attach(file:File){
    if(!selected||saving)return;const mimeType=payrollFileType(file);
    if(!PAYROLL_FILE_TYPES.includes(mimeType)||file.size<=0||file.size>PAYROLL_FILE_LIMIT){setError('Choose a JPG, PNG, WebP, HEIC, or PDF attachment up to 10 MB.');return}
    if(demoForms){
      if(saveTimer.current)clearTimeout(saveTimer.current);setSaving(true);setError('');
      try{const dataUrl=await readFileAsDataUrl(file);await save({...selected,attachment:{name:file.name,mimeType,byteSize:file.size,storagePath:dataUrl}})}catch(failure){setError(`Attachment could not upload. ${(failure as {message?:string}).message??'Try again.'}`)}finally{setSaving(false)}
      return;
    }
    if(!supabase||!companyId)return;
    if(saveTimer.current)clearTimeout(saveTimer.current);setSaving(true);setError('');const storagePath=`${companyId}/${user.id}/forms/${selected.id}/${createId()}-${safePayrollFileName(file.name)}`;
    try{const {error:uploadError}=await supabase.storage.from(PAYROLL_BUCKET).upload(storagePath,file,{contentType:mimeType});if(uploadError)throw uploadError;const previous=selected.attachment;const saved=await save({...selected,attachment:{name:file.name,mimeType,byteSize:file.size,storagePath}});if(!saved){await supabase.storage.from(PAYROLL_BUCKET).remove([storagePath]);return}if(previous&&!isInlineAttachment(previous)){const {error:removeError}=await supabase.storage.from(PAYROLL_BUCKET).remove([previous.storagePath]);if(removeError)setError(`Attachment replaced, but old file could not be removed. ${removeError.message}`)}}catch(failure){setError(`Attachment could not upload. ${(failure as {message?:string}).message??'Try again.'}`)}finally{setSaving(false)}
  }
  async function removeAttachment(){
    if(!selected?.attachment||saving)return;if(saveTimer.current)clearTimeout(saveTimer.current);const attachment=selected.attachment;const saved=await save({...selected,attachment:null});if(!saved)return;
    if(!demoForms&&supabase&&!isInlineAttachment(attachment)){const {error:failure}=await supabase.storage.from(PAYROLL_BUCKET).remove([attachment.storagePath]);if(failure)setError(`Attachment was removed from form, but file could not be deleted. ${failure.message}`)}
  }
  async function openStoredAttachment(attachment:PayrollAttachment){
    if(isInlineAttachment(attachment)){const tab=window.open(attachment.storagePath,'_blank');if(tab)tab.opener=null;else setError('Allow pop-ups to open attachment, then try again.');return}
    if(!supabase)return;const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;const {data,error:failure}=await supabase.storage.from(PAYROLL_BUCKET).createSignedUrl(attachment.storagePath,3600);if(failure){tab?.close();setError(`Attachment could not open. ${failure.message}`);return}if(tab)tab.location.href=data.signedUrl;else setError('Allow pop-ups to open attachment, then try again.');
  }
  async function attachCtr(dayIndex:number,file:File){
    if(!selected||saving)return;const mimeType=payrollFileType(file);
    if(!CTR_FILE_TYPES.includes(mimeType)||file.size<=0||file.size>PAYROLL_FILE_LIMIT){setError('Choose a JPG, PNG, WebP, or HEIC CTR photo up to 10 MB.');return}
    if(saveTimer.current)clearTimeout(saveTimer.current);setSaving(true);setError('');
    const previous=selected.rows[dayIndex]?.ctr??null;
    try{
      let attachment:PayrollAttachment;
      if(demoForms){
        const dataUrl=await readFileAsDataUrl(file);
        attachment={name:file.name||`ctr-day-${dayIndex+1}.jpg`,mimeType,byteSize:file.size,storagePath:dataUrl};
      }else{
        if(!supabase||!companyId)return;
        const storagePath=`${companyId}/${user.id}/forms/${selected.id}/ctr-day-${dayIndex+1}-${createId()}-${safePayrollFileName(file.name||'ctr.jpg')}`;
        const {error:uploadError}=await supabase.storage.from(PAYROLL_BUCKET).upload(storagePath,file,{contentType:mimeType});
        if(uploadError)throw uploadError;
        attachment={name:file.name||`ctr-day-${dayIndex+1}.jpg`,mimeType,byteSize:file.size,storagePath};
      }
      const rows=normalizePayrollRows(selected.rows).map((row,index)=>index===dayIndex?{...row,ctr:attachment}:row);
      const saved=await save({...selected,rows});
      if(!saved){
        if(!demoForms&&supabase&&!isInlineAttachment(attachment))await supabase.storage.from(PAYROLL_BUCKET).remove([attachment.storagePath]);
        return;
      }
      if(previous&&!isInlineAttachment(previous)&&supabase){const {error:removeError}=await supabase.storage.from(PAYROLL_BUCKET).remove([previous.storagePath]);if(removeError)setError(`CTR replaced, but old photo could not be removed. ${removeError.message}`)}
    }catch(failure){setError(`CTR photo could not upload. ${(failure as {message?:string}).message??'Try again.'}`)}
    finally{setSaving(false)}
  }
  async function removeCtr(dayIndex:number){
    if(!selected||saving)return;const previous=selected.rows[dayIndex]?.ctr;if(!previous)return;
    if(saveTimer.current)clearTimeout(saveTimer.current);
    const rows=normalizePayrollRows(selected.rows).map((row,index)=>index===dayIndex?{...row,ctr:null}:row);
    const saved=await save({...selected,rows});
    if(!saved)return;
    if(!demoForms&&supabase&&!isInlineAttachment(previous)){const {error:failure}=await supabase.storage.from(PAYROLL_BUCKET).remove([previous.storagePath]);if(failure)setError(`CTR was removed from the day, but file could not be deleted. ${failure.message}`)}
  }
  async function submit(){
    if(!selected)return;
    if(demoForms){if(saveTimer.current)clearTimeout(saveTimer.current);const submitted:PayrollForm={...selected,rows:normalizePayrollRows(selected.rows),status:'pending',submittedAt:new Date().toISOString()};setForms(current=>[submitted,...current.filter(item=>item.id!==submitted.id)]);setSelected(null);setDraft(null);return}
    if(!supabase)return;if(saveTimer.current)clearTimeout(saveTimer.current);const saved=await save(selected);if(!saved)return;
    const {data,error:failure}=await supabase.from('payroll_forms').update({status:'pending'}).eq('company_id',companyId).eq('id',saved.id).in('status',['draft','rejected']).select(columns).single<PayrollRow>();
    if(failure){setError(`Payroll could not submit. ${failure.message}`);return}const submitted=fromRow(data);setSelected(null);setDraft(null);setForms(current=>[submitted,...current.filter(item=>item.id!==submitted.id)]);
  }
  async function setManagerStatus(form:PayrollForm,status:'approved'|'rejected'|'paid',notes?:string){
    if(demoForms){const timestamp=new Date().toISOString();const updated:PayrollForm={...form,status,updatedAt:timestamp,...(status==='approved'?{approvedAt:timestamp,approvedBy:user.id}:{}),...(status==='rejected'?{rejectionNotes:notes??'',rejectedAt:timestamp,rejectedBy:user.id}:{})};setSelected(status==='rejected'?null:updated);setForms(current=>current.map(item=>item.id===updated.id?updated:item));return true}
    if(!supabase||!companyId)return false;setSaving(true);setError('');const payload=status==='rejected'?{status,rejection_notes:notes}:{status};const {data,error:failure}=await supabase.from('payroll_forms').update(payload).eq('company_id',companyId).eq('id',form.id).select(columns).single<PayrollRow>();setSaving(false);
    if(failure){setError(`Payroll could not be ${status}. ${failure.message}`);return false}const updated=fromRow(data);setSelected(status==='rejected'?null:updated);setForms(current=>current.map(item=>item.id===updated.id?updated:item));return true;
  }
  async function remove(){
    if(!selected||((selected.status!=='draft'&&selected.status!=='rejected')&&!manager)||selected.status==='approved'||selected.status==='paid'||!window.confirm('Delete this payroll form? This cannot be undone.'))return;
    if(saveTimer.current)clearTimeout(saveTimer.current);setSaving(true);setError('');
    if(!demoForms&&supabase&&companyId){
      const {error:failure}=await supabase.from('payroll_forms').delete().eq('company_id',companyId).eq('id',selected.id);
      if(failure){setError(`Payroll form could not be deleted. ${failure.message}`);setSaving(false);return}
      const paths=[selected.attachment,...payrollCtrAttachments(selected.rows)].filter((item):item is PayrollAttachment=>item!==null&&!isInlineAttachment(item)).map(item=>item.storagePath);
      if(paths.length){const {error:storageFailure}=await supabase.storage.from(PAYROLL_BUCKET).remove(paths);if(storageFailure)setError(`Payroll form was deleted, but attachment could not be removed. ${storageFailure.message}`)}
    }
    const id=selected.id;setForms(current=>current.filter(item=>item.id!==id));setDraft(current=>current?.id===id?null:current);setSelected(null);setSaving(false);
  }
  const years=useMemo(()=>[...new Set([currentYear,...forms.map(form=>new Date(form.createdAt).getFullYear())])].sort((a,b)=>b-a),[forms,currentYear]);
  const visible=forms.filter(form=>form.status!=='draft'&&new Date(form.createdAt).getFullYear()===year&&(!manager||crewFilter==='all'||form.createdBy===crewFilter));
  if(selected)return <><PayrollEditor form={selected} crew={formCrew} saving={saving} error={error} onBack={()=>setSelected(null)} onChange={queueSave} onAttach={file=>void attach(file)} onRemoveAttachment={()=>void removeAttachment()} onOpenAttachment={()=>selected.attachment&&void openStoredAttachment(selected.attachment)} onAttachCtr={(index,file)=>void attachCtr(index,file)} onRemoveCtr={index=>void removeCtr(index)} onOpenCtr={attachment=>void openStoredAttachment(attachment)} onDelete={()=>void remove()} onSubmit={()=>void submit()} onApprove={()=>void setManagerStatus(selected,'approved')} onReject={()=>{setError('');setRejecting(selected)}} onMarkPaid={()=>{if(window.confirm('Mark this payroll as paid? This cannot be undone in the app.'))void setManagerStatus(selected,'paid')}} canEdit={selected.createdBy===user.id} canManage={manager}/>{rejecting&&<RejectPayrollDialog saving={saving} error={error} onCancel={()=>setRejecting(null)} onReject={async notes=>{if(await setManagerStatus(rejecting,'rejected',notes))setRejecting(null)}}/>}</>;
  return <div className="page payroll-page"><div className="page-heading hero-heading"><div><h1>Payroll</h1></div><button className="primary" onClick={newForm}><Plus/>New Payroll Form</button></div>
    {draft&&<button className={`payroll-draft-card${draft.status==='rejected'?' rejected':''}`} onClick={()=>setSelected(draft)}><span><b>{draft.status==='rejected'?'Payroll returned for changes':'Payroll form in progress'}</b><small>{draft.status==='rejected'?draft.rejectionNotes:`Last saved ${new Date(draft.updatedAt).toLocaleString()}`}</small></span><strong>{draft.status==='rejected'?'Review':'Continue'}</strong></button>}
    {error&&<p className="receipt-error" role="alert">{error}</p>}
    <section className="receipt-list-card"><div className="receipt-list-heading"><h2>{manager?'Payroll forms':'Submitted payroll'}</h2><div className="payroll-filters"><label>Year <select value={year} onChange={event=>setYear(Number(event.target.value))}>{years.map(value=><option key={value}>{value}</option>)}</select></label>{manager&&<label>Crew member <select value={crewFilter} onChange={event=>setCrewFilter(event.target.value)}><option value="all">All Crew</option>{eligibleCrew.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}</div></div>
      {loading?<p className="receipt-state">Loading payroll…</p>:!visible.length?<div className="receipt-empty"><FileText/><h3>No payroll forms found</h3><p>{forms.some(form=>form.status!=='draft')?'Change filters to see more payroll forms.':'Select New Payroll Form to start one.'}</p></div>:<div className="receipt-table-wrap"><table className="receipt-table"><thead><tr>{manager&&<th>Submitted by</th>}<th>Engine</th><th>Period</th><th>Hours</th>{manager&&<th>Crew</th>}<th>Status</th>{manager&&<><th className="payroll-milestone-column">Approved</th><th className="payroll-milestone-column">Paid</th></>}<th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map(form=>{const totals=payrollTotals(form.rows);const approved=form.status==='approved'||form.status==='paid';return <tr key={form.id}>{manager&&<td>{form.createdByName}</td>}<td>{form.engineNumber||'—'}</td><td>{formatCalendarRange(form.rows[0]?.date??'',form.rows[form.rows.length-1]?.date??'')}</td><td>{totals.totalHours} ({totals.overtimeHours} OT)</td>{manager&&<td>{payrollCrewIds(form.rows).map(id=>crewNames.get(id)??'Unknown crew').join(', ')||'—'}</td>}<td><span className={`payroll-status ${form.status}`}>{form.status}</span></td>{manager&&<><td className="payroll-milestone-column"><span className={`payroll-milestone${approved?' complete':''}`} title={approved?'Approved':'Not approved'}><Check/></span></td><td className="payroll-milestone-column"><span className={`payroll-milestone${form.status==='paid'?' complete paid':''}`} title={form.status==='paid'?'Paid':'Not paid'}><CircleDollarSign/></span></td></>}<td><button className="receipt-open" onClick={()=>setSelected(form)} aria-label={`View payroll for ${form.createdByName}`}><ExternalLink/>View</button></td></tr>})}</tbody></table></div>}
    </section></div>;
}

function PayrollEditor({form,crew,saving,error,onBack,onChange,onAttach,onRemoveAttachment,onOpenAttachment,onAttachCtr,onRemoveCtr,onOpenCtr,onDelete,onSubmit,onApprove,onReject,onMarkPaid,canEdit,canManage}:{form:PayrollForm;crew:CrewMember[];saving:boolean;error:string;onBack:()=>void;onChange:(form:PayrollForm)=>void;onAttach:(file:File)=>void;onRemoveAttachment:()=>void;onOpenAttachment:()=>void;onAttachCtr:(dayIndex:number,file:File)=>void;onRemoveCtr:(dayIndex:number)=>void;onOpenCtr:(attachment:PayrollAttachment)=>void;onDelete:()=>void;onSubmit:()=>void;onApprove:()=>void;onReject:()=>void;onMarkPaid:()=>void;canEdit:boolean;canManage:boolean}){
  const [showEmptyDays,setShowEmptyDays]=useState(false);
  const editable=canEdit&&(form.status==='draft'||form.status==='rejected');
  const emptyDays=form.rows.filter(row=>row.date&&!row.hoursWorked&&!row.notes&&!row.ctr).length;
  const names=new Map(crew.map(person=>[person.id,person.name]));
  const totals=payrollTotals(form.rows);
  const selectedCrew=payrollCrewIds(form.rows);
  const crewTotals=payrollCrewTotals(form.rows);
  function patch(values:Partial<PayrollForm>){if(editable)onChange({...form,...values})}
  function patchRow(index:number,values:Partial<PayrollDay>){patch({rows:form.rows.map((row,i)=>i===index?{...row,...values}:row)})}
  return <div className="page payroll-page"><div className="page-heading"><div><button className="back-link" onClick={onBack}>← Back to payroll</button><h1>{editable?'Payroll form':`Payroll · ${form.status}`}</h1><p>{editable?(saving?'Saving changes…':form.status==='rejected'?'Update payroll, then send it back for approval.':'Changes save automatically'):'Submitted payroll is view only.'}</p></div>{(editable||(canManage&&form.status!=='approved'&&form.status!=='paid'))&&<button className="payroll-delete" disabled={saving} onClick={onDelete}><Trash2/>Delete form</button>}</div>
    {error&&<p className="receipt-error" role="alert">{error}</p>}
    {form.rejectionNotes&&<div className="payroll-rejection-note"><CircleX/><span><b>Changes requested</b>{form.rejectionNotes}</span></div>}
    <section className="payroll-form-card"><div className="payroll-header-fields"><label><span>Resource</span>{editable?<input value={form.engineNumber} onChange={event=>patch({engineNumber:event.target.value})}/>:<span className="payroll-readonly-value">{form.engineNumber||'—'}</span>}</label><label><span>Incident(s)</span>{editable?<input value={form.incidents} onChange={event=>patch({incidents:event.target.value})}/>:<span className="payroll-readonly-value">{form.incidents||'—'}</span>}</label><div className="payroll-attachment-field"><span>Attachment</span>{form.attachment?<div className="payroll-attachment"><FileText/><span><b>{form.attachment.name}</b><small>{(form.attachment.byteSize/1024/1024).toFixed(1)} MB</small></span><button type="button" onClick={onOpenAttachment} aria-label={`Open ${form.attachment.name}`}><ExternalLink/></button>{editable&&<button type="button" disabled={saving} onClick={onRemoveAttachment} aria-label="Remove attachment"><X/></button>}</div>:editable?<label className="payroll-attachment-picker"><Upload/><span>{saving?'Uploading…':'Attach file or image'}</span><FileInput type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif" disabled={saving} onChange={event=>{const file=event.target.files?.[0];if(file)onAttach(file);event.target.value=''}}/></label>:<span className="payroll-readonly-value">—</span>}<small className="payroll-attachment-help">JPG, PNG, WebP, HEIC, or PDF · 10 MB max</small></div></div>
      {!editable&&canManage?<div className="payroll-crew-summary"><table><thead><tr><th>Crew</th><th>Regular hours</th><th>Overtime hours</th><th>Days worked</th></tr></thead><tbody>{crewTotals.length?crewTotals.map(item=><tr key={item.crewId}><td>{names.get(item.crewId)??'Unknown crew'}</td><td>{item.regularHours}</td><td>{item.overtimeHours}</td><td>{item.totalDays}</td></tr>):<tr><td colSpan={4}>No crew selected</td></tr>}</tbody></table></div>:<div className="payroll-form-crew"><b>Crew on form</b><span>{selectedCrew.length?selectedCrew.map(id=>names.get(id)??'Unknown crew').join(', '):'No crew selected'}</span></div>}
      <div className="payroll-grid-wrap"><table className="payroll-grid"><thead><tr><th>Date</th><th>Day of week</th><th>Hours worked</th><th>Crew</th><th>Notes</th><th>CTR</th></tr></thead><tbody>{form.rows.map((row,index)=>!editable&&!showEmptyDays&&!row.hoursWorked&&!row.notes&&!row.ctr?null:<tr key={index}><td>{editable?<input aria-label={`Row ${index+1} date`} className={!row.date?'payroll-date-empty':undefined} type="date" value={row.date} disabled={!form.rows[0].date&&index>0} onChange={event=>patch({rows:updatePayrollDate(form.rows,index,event.target.value)})}/>:row.date||'—'}</td><td>{payrollDayName(row.date)}</td><td>{editable?<input aria-label={`Row ${index+1} hours`} type="number" min="0" step="0.25" value={row.hoursWorked||''} onChange={event=>patchRow(index,{hoursWorked:Math.max(0,Number(event.target.value))})}/>:row.hoursWorked}</td><td>{editable?<><CrewSelect crew={crew} selected={row.crewIds} disabled={false} onChange={ids=>patch({rows:updatePayrollCrew(form.rows,index,ids)})}/><small className="payroll-day-crew">{row.crewIds.length?row.crewIds.map(id=>names.get(id)??'Unknown crew').join(', '):'No crew selected'}</small></>:row.crewIds.length?row.crewIds.map(id=>names.get(id)??'Unknown crew').join(', '):'—'}</td><td>{editable?<input aria-label={`Row ${index+1} notes`} value={row.notes} onChange={event=>patchRow(index,{notes:event.target.value})} placeholder="Add notes"/>:row.notes||'—'}</td><td><DayCtrCell editable={editable} saving={saving} ctr={row.ctr} dayIndex={index} onAttach={onAttachCtr} onRemove={onRemoveCtr} onOpen={onOpenCtr}/></td></tr>)}</tbody></table>{!editable&&emptyDays>0&&<button type="button" className="payroll-empty-days" onClick={()=>setShowEmptyDays(value=>!value)}>{showEmptyDays?'Hide days with no hours':`Show ${emptyDays} ${emptyDays===1?'day':'days'} with no hours`}</button>}</div>
      <p className="payroll-ctr-help">CTR = optional photo of your crew time report (shift ticket).</p>
      <div className="payroll-totals"><span><b>{totals.totalDays}</b>Total days</span><span><b>{totals.regularHours}</b>Regular hours</span><span><b>{totals.overtimeHours}</b>Overtime hours</span><span><b>{totals.totalHours}</b>Total hours</span></div>
      {editable?<button className="primary payroll-submit" onClick={onSubmit} disabled={saving}>{form.status==='rejected'?'Send Back for Approval':'Submit Payroll'}</button>:form.status==='pending'&&canManage?<div className="payroll-review-actions"><button className="payroll-reject" onClick={onReject} disabled={saving}><CircleX/>Reject Payroll</button><button className="primary payroll-submit" onClick={onApprove} disabled={saving}><Check/>Approve Payroll</button></div>:form.status==='approved'&&canManage?<button className="payroll-paid payroll-submit" onClick={onMarkPaid} disabled={saving}><CircleDollarSign/>Mark as Paid</button>:null}
    </section></div>;
}

function DayCtrCell({editable,saving,ctr,dayIndex,onAttach,onRemove,onOpen}:{editable:boolean;saving:boolean;ctr:PayrollAttachment|null;dayIndex:number;onAttach:(dayIndex:number,file:File)=>void;onRemove:(dayIndex:number)=>void;onOpen:(attachment:PayrollAttachment)=>void}){
  const cameraInput=useRef<HTMLInputElement>(null);
  if(ctr){
    return <div className="payroll-ctr-cell"><button type="button" className="payroll-ctr-view" onClick={()=>onOpen(ctr)} aria-label={`Open CTR for day ${dayIndex+1}`}><Camera/><span>View</span></button>{editable&&<button type="button" className="payroll-ctr-remove" disabled={saving} onClick={()=>onRemove(dayIndex)} aria-label={`Remove CTR for day ${dayIndex+1}`}><X/></button>}</div>;
  }
  if(!editable)return <span className="payroll-readonly-value">—</span>;
  return <div className="payroll-ctr-cell">
    <button type="button" className="payroll-ctr-add" disabled={saving} onClick={()=>cameraInput.current?.click()} aria-label={`Add CTR photo for day ${dayIndex+1}`}><Camera/><span>Add</span></button>
    {/* capture opens the rear camera on phones; desktop browsers fall back to a file picker. */}
    <input ref={cameraInput} className="sr-only" type="file" accept="image/*" capture="environment" disabled={saving} onChange={event=>{const file=event.target.files?.[0];if(file)onAttach(dayIndex,file);event.target.value=''}}/>
  </div>;
}

function CrewSelect({crew,selected,disabled,onChange}:{crew:CrewMember[];selected:string[];disabled:boolean;onChange:(ids:string[])=>void}){
  return <details className="crew-multiselect"><summary><span>{selected.length?`${selected.length} selected`:'Select crew'}</span><ChevronDown/></summary><div>{crew.filter(person=>person.status==='Active').map(person=><label key={person.id}><input type="checkbox" checked={selected.includes(person.id)} disabled={disabled} onChange={()=>onChange(selected.includes(person.id)?selected.filter(id=>id!==person.id):[...selected,person.id])}/><span>{person.name}</span></label>)}</div></details>;
}

function RejectPayrollDialog({saving,error,onCancel,onReject}:{saving:boolean;error:string;onCancel:()=>void;onReject:(notes:string)=>Promise<void>}){
  const [notes,setNotes]=useState('');const dialog=useDialogA11y<HTMLElement>(()=>{if(!saving)onCancel()});
  const submit=(event:FormEvent)=>{event.preventDefault();if(notes.trim()&&!saving)void onReject(notes.trim())};
  return createPortal(<div className="receipt-edit-overlay" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)onCancel()}}><section ref={dialog.ref} className="receipt-edit-dialog" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} aria-busy={saving} tabIndex={-1}><header><div><h2 id={dialog.titleId}>Reject payroll</h2><p>Notes are sent to the employee with the rejection.</p></div><button type="button" disabled={saving} onClick={onCancel} aria-label="Close reject payroll"><X/></button></header><form onSubmit={submit}><label><span>What needs to change</span><textarea autoFocus required maxLength={1000} rows={5} value={notes} onChange={event=>setNotes(event.target.value)}/></label>{error&&<p className="receipt-error" role="alert">{error}</p>}<footer><button className="secondary" type="button" disabled={saving} onClick={onCancel}>Cancel</button><button className="payroll-reject" type="submit" disabled={saving||!notes.trim()}><CircleX/>{saving?'Rejecting…':'Reject Payroll'}</button></footer></form></section></div>,document.body);
}
