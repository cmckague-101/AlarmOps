import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { createPayrollRows, isCompanyManager, payrollCrewIds, payrollCrewTotals, payrollDayName, payrollTotals, updatePayrollCrew, updatePayrollDate, type CrewMember, type FireOpsUser, type PayrollDay, type PayrollForm } from '@fireops/domain';
import { supabase } from './supabase';

type PayrollRow = {id:string;company_id:string;created_by:string;created_by_name:string;engine_number:string;incidents:string;rows:PayrollDay[];status:PayrollForm['status'];submitted_at:string|null;approved_at:string|null;approved_by:string|null;created_at:string;updated_at:string};
const columns = 'id,company_id,created_by,created_by_name,engine_number,incidents,rows,status,submitted_at,approved_at,approved_by,created_at,updated_at';
const fromRow = (row:PayrollRow):PayrollForm => ({id:row.id,companyId:row.company_id,createdBy:row.created_by,createdByName:row.created_by_name,engineNumber:row.engine_number,incidents:row.incidents,rows:row.rows,status:row.status,submittedAt:row.submitted_at,approvedAt:row.approved_at,approvedBy:row.approved_by,createdAt:row.created_at,updatedAt:row.updated_at});

export default function PayrollPage({companyId,user,crew}:{companyId?:string;user:FireOpsUser;crew:CrewMember[]}) {
  const manager = isCompanyManager(user.role);
  const [forms,setForms] = useState<PayrollForm[]>([]);
  const [selected,setSelected] = useState<PayrollForm|null>(null);
  const [draft,setDraft] = useState<PayrollForm|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const currentYear = new Date().getFullYear();
  const [year,setYear] = useState(currentYear);
  const [crewFilter,setCrewFilter] = useState('all');
  const saveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const formCrew = useMemo(()=>crew.filter(person=>person.role!=='owner'),[crew]);
  const eligibleCrew = useMemo(()=>formCrew.filter(person=>person.status==='Active'),[formCrew]);

  const load = useCallback(async()=>{
    if(!supabase||!companyId){setLoading(false);return}
    const {data,error:failure}=await supabase.from('payroll_forms').select(columns).eq('company_id',companyId).order('created_at',{ascending:false});
    if(failure){setError(`Payroll could not load. ${failure.message}`);setLoading(false);return}
    const loaded=((data??[]) as PayrollRow[]).map(fromRow);setForms(loaded);setDraft(loaded.find(form=>form.status==='draft'&&form.createdBy===user.id)??null);setError('');setLoading(false);
  },[companyId,user.id]);
  useEffect(()=>{void load();if(!supabase||!companyId)return;const client=supabase;const channel=client.channel(`payroll:${companyId}`).on('postgres_changes',{event:'*',schema:'public',table:'payroll_forms',filter:`company_id=eq.${companyId}`},()=>void load()).subscribe();return()=>{void client.removeChannel(channel)}},[companyId,load]);
  useEffect(()=>()=>{if(saveTimer.current)clearTimeout(saveTimer.current)},[]);

  function newForm(){
    if(draft){setSelected(draft);return}
    setSelected({id:crypto.randomUUID(),companyId:companyId??'',createdBy:user.id,createdByName:user.name,engineNumber:'',incidents:'',rows:createPayrollRows(),status:'draft',submittedAt:null,approvedAt:null,approvedBy:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  }
  function queueSave(form:PayrollForm){
    setSelected(form);setDraft(form);if(saveTimer.current)clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>void save(form),650);
  }
  async function save(form:PayrollForm){
    if(!supabase||!companyId||form.status!=='draft')return;setSaving(true);setError('');
    const payload={id:form.id,company_id:companyId,created_by:user.id,created_by_name:user.name,engine_number:form.engineNumber,incidents:form.incidents,rows:form.rows,status:'draft'};
    const {data,error:failure}=await supabase.from('payroll_forms').upsert(payload).select(columns).single<PayrollRow>();
    setSaving(false);if(failure){setError(`Autosave failed. ${failure.message}`);return}const saved=fromRow(data);setDraft(saved);setSelected(current=>current?.id===saved.id?saved:current);setForms(current=>[saved,...current.filter(item=>item.id!==saved.id)]);
  }
  async function submit(){
    if(!selected||!supabase)return;if(saveTimer.current)clearTimeout(saveTimer.current);await save(selected);
    const {data,error:failure}=await supabase.from('payroll_forms').update({status:'pending'}).eq('id',selected.id).eq('status','draft').select(columns).single<PayrollRow>();
    if(failure){setError(`Payroll could not submit. ${failure.message}`);return}const submitted=fromRow(data);setSelected(null);setDraft(null);setForms(current=>[submitted,...current.filter(item=>item.id!==submitted.id)]);
  }
  async function approve(form:PayrollForm){
    if(!supabase)return;const {data,error:failure}=await supabase.from('payroll_forms').update({status:'approved'}).eq('id',form.id).eq('status','pending').select(columns).single<PayrollRow>();
    if(failure){setError(`Payroll could not be approved. ${failure.message}`);return}const approved=fromRow(data);setSelected(null);setForms(current=>current.map(item=>item.id===approved.id?approved:item));
  }
  async function removeDraft(){
    if(!selected||selected.status!=='draft'||!window.confirm('Delete this payroll form? This cannot be undone.'))return;
    if(saveTimer.current)clearTimeout(saveTimer.current);setSaving(true);setError('');
    if(supabase&&companyId){const {error:failure}=await supabase.from('payroll_forms').delete().eq('company_id',companyId).eq('id',selected.id).eq('status','draft');if(failure){setError(`Payroll form could not be deleted. ${failure.message}`);setSaving(false);return}}
    const id=selected.id;setForms(current=>current.filter(item=>item.id!==id));setDraft(null);setSelected(null);setSaving(false);
  }
  const years=useMemo(()=>[...new Set([currentYear,...forms.map(form=>new Date(form.createdAt).getFullYear())])].sort((a,b)=>b-a),[forms,currentYear]);
  const visible=forms.filter(form=>form.status!=='draft'&&new Date(form.createdAt).getFullYear()===year&&(!manager||crewFilter==='all'||form.createdBy===crewFilter));
  if(selected)return <PayrollEditor form={selected} crew={formCrew} saving={saving} error={error} onBack={()=>setSelected(null)} onChange={queueSave} onDelete={()=>void removeDraft()} onSubmit={()=>void submit()} onApprove={()=>void approve(selected)} canApprove={manager}/>;
  return <div className="page payroll-page"><div className="page-heading"><div><h1>Payroll</h1></div><button className="primary" onClick={newForm}><Plus/>New Payroll Form</button></div>
    {draft&&<button className="payroll-draft-card" onClick={()=>setSelected(draft)}><span><b>Payroll form in progress</b><small>Last saved {new Date(draft.updatedAt).toLocaleString()}</small></span><strong>Continue</strong></button>}
    {error&&<p className="receipt-error" role="alert">{error}</p>}
    <section className="receipt-list-card"><div className="receipt-list-heading"><h2>{manager?'Payroll forms':'Submitted payroll'}</h2><div className="payroll-filters"><label>Year <select value={year} onChange={event=>setYear(Number(event.target.value))}>{years.map(value=><option key={value}>{value}</option>)}</select></label>{manager&&<label>Crew member <select value={crewFilter} onChange={event=>setCrewFilter(event.target.value)}><option value="all">All Crew</option>{eligibleCrew.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}</div></div>
      {loading?<p className="receipt-state">Loading payroll…</p>:!visible.length?<p className="receipt-state">No payroll forms found for selected filters.</p>:<div className="receipt-table-wrap"><table className="receipt-table"><thead><tr>{manager&&<th>Crew member</th>}<th>Engine</th><th>Period</th><th>Hours</th><th>Status</th><th/></tr></thead><tbody>{visible.map(form=>{const totals=payrollTotals(form.rows);return <tr key={form.id}>{manager&&<td>{form.createdByName}</td>}<td>{form.engineNumber||'—'}</td><td>{form.rows[0]?.date} – {form.rows[20]?.date}</td><td>{totals.totalHours} ({totals.overtimeHours} OT)</td><td><span className={`payroll-status ${form.status}`}>{form.status}</span></td><td><button className="receipt-open" onClick={()=>setSelected(form)}>View</button></td></tr>})}</tbody></table></div>}
    </section></div>;
}

function PayrollEditor({form,crew,saving,error,onBack,onChange,onDelete,onSubmit,onApprove,canApprove}:{form:PayrollForm;crew:CrewMember[];saving:boolean;error:string;onBack:()=>void;onChange:(form:PayrollForm)=>void;onDelete:()=>void;onSubmit:()=>void;onApprove:()=>void;canApprove:boolean}){
  const editable=form.status==='draft';const names=new Map(crew.map(person=>[person.id,person.name]));const totals=payrollTotals(form.rows);const selectedCrew=payrollCrewIds(form.rows);const crewTotals=payrollCrewTotals(form.rows);
  function patch(values:Partial<PayrollForm>){if(editable)onChange({...form,...values})}
  function patchRow(index:number,values:Partial<PayrollDay>){patch({rows:form.rows.map((row,i)=>i===index?{...row,...values}:row)})}
  return <div className="page payroll-page"><div className="page-heading"><div><button className="back-link" onClick={onBack}>← Back to payroll</button><h1>{editable?'Payroll form':`Payroll · ${form.status}`}</h1><p>{editable?(saving?'Saving changes…':'Changes save automatically'):'Submitted payroll is view only.'}</p></div>{editable&&<button className="payroll-delete" disabled={saving} onClick={onDelete}><Trash2/>Delete form</button>}</div>
    {error&&<p className="receipt-error" role="alert">{error}</p>}
    <section className="payroll-form-card"><div className="payroll-header-fields"><label><span>Engine number</span><input value={form.engineNumber} disabled={!editable} onChange={event=>patch({engineNumber:event.target.value})}/></label><label><span>Incident(s)</span><input value={form.incidents} disabled={!editable} onChange={event=>patch({incidents:event.target.value})}/></label></div>
      {!editable&&canApprove?<div className="payroll-crew-summary"><table><thead><tr><th>Crew</th><th>Regular hours</th><th>Overtime hours</th><th>Days worked</th></tr></thead><tbody>{crewTotals.length?crewTotals.map(item=><tr key={item.crewId}><td>{names.get(item.crewId)??'Unknown crew'}</td><td>{item.regularHours}</td><td>{item.overtimeHours}</td><td>{item.totalDays}</td></tr>):<tr><td colSpan={4}>No crew selected</td></tr>}</tbody></table></div>:<div className="payroll-form-crew"><b>Crew on form</b><span>{selectedCrew.length?selectedCrew.map(id=>names.get(id)??'Unknown crew').join(', '):'No crew selected'}</span></div>}
      <div className="payroll-grid-wrap"><table className="payroll-grid"><thead><tr><th>Date</th><th>Day of week</th><th>Hours worked</th><th>Crew</th><th>Notes</th></tr></thead><tbody>{form.rows.map((row,index)=><tr key={index}><td><input aria-label={`Row ${index+1} date`} className={!row.date?'payroll-date-empty':undefined} type="date" value={row.date} disabled={!editable||(!form.rows[0].date&&index>0)} onChange={event=>patch({rows:updatePayrollDate(form.rows,index,event.target.value)})}/></td><td>{payrollDayName(row.date)}</td><td><input aria-label={`Row ${index+1} hours`} type="number" min="0" step="0.25" value={row.hoursWorked||''} disabled={!editable} onChange={event=>patchRow(index,{hoursWorked:Math.max(0,Number(event.target.value))})}/></td><td><CrewSelect crew={crew} selected={row.crewIds} disabled={!editable} onChange={ids=>patch({rows:updatePayrollCrew(form.rows,index,ids)})}/><small className="payroll-day-crew">{row.crewIds.length?row.crewIds.map(id=>names.get(id)??'Unknown crew').join(', '):'No crew selected'}</small></td><td><input aria-label={`Row ${index+1} notes`} value={row.notes} disabled={!editable} onChange={event=>patchRow(index,{notes:event.target.value})}/></td></tr>)}</tbody></table></div>
      <div className="payroll-totals"><span><b>{totals.totalDays}</b>Total days</span><span><b>{totals.regularHours}</b>Regular hours</span><span><b>{totals.overtimeHours}</b>Overtime hours</span><span><b>{totals.totalHours}</b>Total hours</span></div>
      {editable?<button className="primary payroll-submit" onClick={onSubmit} disabled={saving}>Submit Payroll</button>:form.status==='pending'&&canApprove?<button className="primary payroll-submit" onClick={onApprove}><Check/>Approve Payroll</button>:null}
    </section></div>;
}

function CrewSelect({crew,selected,disabled,onChange}:{crew:CrewMember[];selected:string[];disabled:boolean;onChange:(ids:string[])=>void}){
  return <details className="crew-multiselect"><summary><span>{selected.length?`${selected.length} selected`:'Select crew'}</span><ChevronDown/></summary><div>{crew.filter(person=>person.status==='Active').map(person=><label key={person.id}><input type="checkbox" checked={selected.includes(person.id)} disabled={disabled} onChange={()=>onChange(selected.includes(person.id)?selected.filter(id=>id!==person.id):[...selected,person.id])}/><span>{person.name}</span></label>)}</div></details>;
}
