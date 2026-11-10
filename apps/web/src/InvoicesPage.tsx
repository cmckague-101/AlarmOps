import {FileInput} from './demo-uploads';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, ExternalLink, FileText, Plus, Trash2, Upload, X } from 'lucide-react';
import { INVOICE_REVIEW_MESSAGE, applyInvoiceAutofill, canProcessFinance, qboFieldsFromRow, type QboInvoiceRow, changedInvoiceFields, formatCalendarDate, invoiceDueDate, invoicePaymentState, type FireOpsUser, type InvoiceAttachment, type InvoiceCustomer, type InvoiceForm, type InvoiceReviewField } from '@fireops/domain';
import { autofillImage, loadReceiptAutofillEnabled, requestInvoiceAutofill } from './receipt-autofill';
import { supabase } from './supabase';
import { InvoiceGenerator } from './InvoiceGenerator';
import { QboStatusBadge, QuickbooksInvoicePanel } from './QuickbooksPanels';
import { loadQuickbooksConnected, loadQuickbooksEnabled, quickbooks, type QboInvoiceResult } from './quickbooks';
import { createId } from './create-id';

type FormRow=QboInvoiceRow&{id:string;company_id:string;created_by:string;created_by_name:string;invoice_number:string;invoice_date:string|null;invoice_amount:number|string;customer_id:string|null;attachment:InvoiceAttachment|null;status:InvoiceForm['status'];submitted_at:string|null;due_date?:string|null;paid_at?:string|null;paid_by_name?:string|null;created_at:string;updated_at:string};
type CustomerRow={id:string;company_id:string;name:string;created_at:string;updated_at:string};
const formColumns='*';
const paymentLabel={draft:'Draft',unpaid:'Unpaid',overdue:'Overdue',paid:'Paid'} as const;
const customerColumns='id,company_id,name,created_at,updated_at';
const ADD_CUSTOMER='__add_customer__';
const fromForm=(row:FormRow):InvoiceForm=>({id:row.id,companyId:row.company_id,createdBy:row.created_by,createdByName:row.created_by_name,invoiceNumber:row.invoice_number,invoiceDate:row.invoice_date??'',invoiceAmount:Number(row.invoice_amount),customerId:row.customer_id??'',attachment:row.attachment,status:row.status,submittedAt:row.submitted_at,dueDate:row.due_date??undefined,paidAt:row.paid_at??null,paidByName:row.paid_by_name??null,...qboFieldsFromRow(row),createdAt:row.created_at,updatedAt:row.updated_at});
const fromCustomer=(row:CustomerRow):InvoiceCustomer=>({id:row.id,companyId:row.company_id,name:row.name,createdAt:row.created_at,updatedAt:row.updated_at});
const accepted=['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'];
const scanAccept='image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
/** What the last photo scan left to check on one form; kept for the page's lifetime so leaving and reopening the form keeps it. */
type ScanReview={formId:string;fields:InvoiceReviewField[];newCustomerName?:string;note?:string};
const limit=10*1024*1024;
const money=(value:number)=>value.toLocaleString(undefined,{style:'currency',currency:'USD'});
const safeName=(name:string)=>name.trim().replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||'attachment';
function fileType(file:File){return file.type||(/\.pdf$/i.test(file.name)?'application/pdf':/\.hei[cf]$/i.test(file.name)?'image/heic':'')}
function canEditInvoice(form:InvoiceForm,user:FireOpsUser,manager:boolean){
  if(form.status==='paid')return false;
  if(form.status==='draft')return form.createdBy===user.id;
  return form.createdBy===user.id||manager;
}

type DemoInvoices={invoices:InvoiceForm[];customers:InvoiceCustomer[]};
/** An invoice draft the FireOps Assistant asked to open: scan this photo, or start a new invoice. Handled once per id. */
export type AssistantInvoiceRequest={id:number;file?:File};

export default function InvoicesPage({companyId,user,company,companyLogoUrl,demoData,onDemoChange,assistantRequest,onAssistantRequestDone,onBack}:{companyId?:string;user:FireOpsUser;company?:{name:string;phone?:string;location?:string};companyLogoUrl?:string|null;demoData?:DemoInvoices;onDemoChange?:(data:DemoInvoices)=>void;assistantRequest?:AssistantInvoiceRequest|null;onAssistantRequestDone?:()=>void;onBack?:()=>void}){
  const [generatorOpen,setGeneratorOpen]=useState(false);
  const manager=canProcessFinance(user.role);
  const [paymentFilter,setPaymentFilter]=useState<'all'|'unpaid'|'paid'>('all');
  const [forms,setForms]=useState<InvoiceForm[]>(demoData?.invoices??[]);
  const [customers,setCustomers]=useState<InvoiceCustomer[]>(demoData?.customers??[]);
  const [selected,setSelected]=useState<InvoiceForm|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [addingCustomer,setAddingCustomer]=useState(false);
  const [customerName,setCustomerName]=useState('');
  const [autofillEnabled,setAutofillEnabled]=useState(false);
  const [scanning,setScanning]=useState(false);
  const [scanReview,setScanReview]=useState<ScanReview|null>(null);
  // QuickBooks (paid add-on): anyone's submit may trigger the company's automatic sync; owners and accounting see status and sync.
  const [qboAddOn,setQboAddOn]=useState(false);
  const [qboConnected,setQboConnected]=useState(false);
  const qboVisible=manager&&qboAddOn&&qboConnected&&!demoData;
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const demoCallback=useRef(onDemoChange);demoCallback.current=onDemoChange;
  useEffect(()=>{if(demoData)demoCallback.current?.({invoices:forms,customers})},[forms,customers,Boolean(demoData)]);
  const load=useCallback(async()=>{
    if(demoData||!supabase||!companyId){setLoading(false);return}
    const [formResult,customerResult]=await Promise.all([
      supabase.from('invoice_forms').select(formColumns).eq('company_id',companyId).order('created_at',{ascending:false}),
      supabase.from('invoice_customers').select(customerColumns).eq('company_id',companyId).order('name'),
    ]);
    if(formResult.error)setError(`Invoices could not load. ${formResult.error.message}`);
    else setForms(((formResult.data??[]) as FormRow[]).map(fromForm));
    if(customerResult.error)setError(`Customers could not load. ${customerResult.error.message}`);
    else setCustomers(((customerResult.data??[]) as CustomerRow[]).map(fromCustomer));
    setLoading(false);
  },[companyId,Boolean(demoData)]);
  useEffect(()=>{
    void load();
    if(demoData||!supabase||!companyId)return;
    const client=supabase;
    const channel=client.channel(`invoices:${companyId}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'invoice_forms',filter:`company_id=eq.${companyId}`},()=>void load())
      .on('postgres_changes',{event:'*',schema:'public',table:'invoice_customers',filter:`company_id=eq.${companyId}`},()=>void load())
      .subscribe();
    return()=>{void client.removeChannel(channel)};
  },[companyId,load]);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[]);
  useEffect(()=>{
    let active=true;
    if(companyId&&!demoData)void loadReceiptAutofillEnabled(companyId).then(enabled=>{if(active)setAutofillEnabled(enabled)});
    return()=>{active=false};
  },[companyId,Boolean(demoData)]);
  useEffect(()=>{
    let active=true;
    if(companyId&&!demoData)void loadQuickbooksEnabled(companyId).then(async enabled=>{if(!active)return;setQboAddOn(enabled);if(enabled&&manager){const connected=await loadQuickbooksConnected(companyId);if(active)setQboConnected(connected)}});
    return()=>{active=false};
  },[companyId,manager,Boolean(demoData)]);
  useEffect(()=>{setAddingCustomer(false);setCustomerName('')},[selected?.id]);
  // From the assistant: once invoices and customers have loaded, scan the picked photo (or open a new invoice). Never submits.
  const handledAssistant=useRef<number|null>(null);
  useEffect(()=>{
    if(!assistantRequest||loading||handledAssistant.current===assistantRequest.id)return;
    handledAssistant.current=assistantRequest.id;
    onAssistantRequestDone?.();
    if(assistantRequest.file)void scan(assistantRequest.file);
    else openNew();
  });

  const draft=forms.find(form=>form.status==='draft'&&form.createdBy===user.id);
  const blankDraft=():InvoiceForm=>({id:createId(),companyId:companyId??'',createdBy:user.id,createdByName:user.name,invoiceNumber:'',invoiceDate:new Date().toISOString().slice(0,10),invoiceAmount:0,customerId:'',attachment:null,status:'draft',submittedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  function openNew(){
    setSelected(draft??blankDraft());
  }

  async function save(form:InvoiceForm){
    if(demoData){
      const saved={...form,updatedAt:new Date().toISOString()};
      setSelected(saved);
      setForms(current=>[saved,...current.filter(item=>item.id!==saved.id)]);
      return saved;
    }
    if(!supabase||!companyId)return null;
    if(form.status==='paid')return null;
    setSaving(true);setError('');
    const payload={
      invoice_number:form.invoiceNumber,
      invoice_date:form.invoiceDate||null,
      invoice_amount:form.invoiceAmount,
      customer_id:form.customerId||null,
      attachment:form.attachment,
      ...(form.dueDate?{due_date:form.dueDate}:{due_date:null}),
    };
    const query=form.status==='draft'
      ?supabase.from('invoice_forms').upsert({id:form.id,company_id:companyId,created_by:user.id,created_by_name:user.name,...payload,status:'draft'})
      :supabase.from('invoice_forms').update(payload).eq('company_id',companyId).eq('id',form.id).eq('status','submitted');
    const {data,error:failure}=await query.select(formColumns).single<FormRow>();
    setSaving(false);
    if(failure){setError(`Invoice could not save. ${failure.message}`);return null}
    const saved=fromForm(data);
    setSelected(saved);
    setForms(current=>[saved,...current.filter(item=>item.id!==saved.id)]);
    return saved;
  }

  function change(form:InvoiceForm){
    if(scanning)return;
    if(form.dueDate&&form.invoiceDate&&form.dueDate<form.invoiceDate){setError('Due date cannot be before the invoice date.');return}
    setError('');
    // Fields the person edits no longer need checking; picking a customer answers the new-customer prompt.
    if(selected&&scanReview?.formId===form.id){
      const edited=changedInvoiceFields(selected,form);
      if(edited.length)setScanReview({...scanReview,fields:scanReview.fields.filter(field=>!edited.includes(field)),newCustomerName:edited.includes('customerId')?undefined:scanReview.newCustomerName});
    }
    setSelected(form);
    if(timer.current)clearTimeout(timer.current);
    timer.current=setTimeout(()=>void save(form),650);
  }

  async function attach(file:File,base:InvoiceForm|null=selected):Promise<InvoiceForm|null>{
    if(!base||saving||!canEditInvoice(base,user,manager))return null;
    const mimeType=fileType(file);
    if(!accepted.includes(mimeType)||file.size<=0||file.size>limit){setError('Choose a JPG, PNG, WebP, HEIC, or PDF attachment up to 10 MB.');return null}
    if(demoData){
      if(timer.current)clearTimeout(timer.current);
      setSaving(true);setError('');
      try{
        const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result??''));reader.onerror=()=>reject(reader.error??new Error('Could not read file.'));reader.readAsDataURL(file)});
        return await save({...base,attachment:{name:file.name,mimeType,byteSize:file.size,storagePath:dataUrl}});
      }catch(failure){setError(`Attachment could not upload. ${(failure as {message?:string}).message??'Try again.'}`);return null}
      finally{setSaving(false)}
    }
    if(!supabase||!companyId)return null;
    if(timer.current)clearTimeout(timer.current);setSaving(true);
    const path=`${companyId}/${user.id}/forms/${base.id}/${createId()}-${safeName(file.name)}`;
    const {error:uploadError}=await supabase.storage.from('invoice-files').upload(path,file,{contentType:mimeType});
    if(uploadError){setError(`Attachment could not upload. ${uploadError.message}`);setSaving(false);return null}
    const previous=base.attachment;
    const saved=await save({...base,attachment:{name:file.name,mimeType,byteSize:file.size,storagePath:path}});
    if(!saved)await supabase.storage.from('invoice-files').remove([path]);
    else if(previous&&!previous.storagePath.startsWith('data:'))await supabase.storage.from('invoice-files').remove([previous.storagePath]);
    setSaving(false);
    return saved;
  }

  /** Read an invoice photo into the open form (or the draft in progress / a new draft), then attach the photo. Never submits. */
  async function scan(file:File){
    if(scanning||saving||!companyId)return;
    let base=selected;
    if(!base){
      if(draft&&(draft.invoiceNumber.trim()||draft.invoiceAmount>0||draft.customerId||draft.attachment)&&!window.confirm('Scan into your invoice in progress? Details read from the photo replace what is there.'))return;
      base=draft??blankDraft();
    }
    if(!canEditInvoice(base,user,manager))return;
    const mimeType=fileType(file);
    if(!accepted.includes(mimeType)||mimeType==='application/pdf'||file.size<=0||file.size>limit){setError('Choose a JPG, PNG, WebP, or HEIC photo up to 10 MB.');return}
    if(timer.current)clearTimeout(timer.current);
    setSelected(base);setScanning(true);setError('');
    let next=base;
    let review:ScanReview={formId:base.id,fields:[]};
    try{
      const photo=await autofillImage(file,mimeType);
      if(!photo)review.note='This browser cannot read that photo for auto-fill. It is attached; enter the details.';
      else{
        const outcome=applyInvoiceAutofill(base,await requestInvoiceAutofill(companyId,photo),customers);
        next=outcome.form;
        review={formId:base.id,fields:outcome.review,newCustomerName:outcome.newCustomerName,note:outcome.note};
      }
    }catch(failure){review.note=failure instanceof Error?failure.message:'Auto-fill could not read this photo. Enter the details.'}
    setScanReview(review);
    try{
      const saved=await attach(file,next);
      if(!saved){setSelected(next);await save(next)}
    }finally{setScanning(false)}
  }

  async function removeAttachment(){
    if(!selected?.attachment||!canEditInvoice(selected,user,manager))return;
    const old=selected.attachment;
    const saved=await save({...selected,attachment:null});
    if(saved&&!demoData&&supabase&&!old.storagePath.startsWith('data:'))await supabase.storage.from('invoice-files').remove([old.storagePath]);
  }

  async function openAttachment(form:InvoiceForm){
    if(!form.attachment)return;
    if(form.attachment.storagePath.startsWith('data:')||form.attachment.storagePath.startsWith('blob:')){window.open(form.attachment.storagePath,'_blank','noopener,noreferrer');return}
    if(!supabase)return;
    const {data,error:failure}=await supabase.storage.from('invoice-files').createSignedUrl(form.attachment.storagePath,3600);
    if(failure){setError(failure.message);return}
    window.open(data.signedUrl,'_blank','noopener,noreferrer');
  }

  async function submit(){
    if(!selected)return;
    if(scanReview?.formId===selected.id&&scanReview.fields.length){setError(INVOICE_REVIEW_MESSAGE);return}
    if(!selected.invoiceNumber.trim()||!selected.invoiceDate||selected.invoiceAmount<=0||!selected.customerId){setError('Invoice number, date, positive amount, and customer are required.');return}
    if(timer.current)clearTimeout(timer.current);
    const saved=await save(selected);if(!saved)return;
    if(demoData){const submitted:InvoiceForm={...saved,status:'submitted',submittedAt:new Date().toISOString()};setForms(current=>[submitted,...current.filter(item=>item.id!==submitted.id)]);setSelected(null);return}
    if(!supabase)return;
    const {data,error:failure}=await supabase.from('invoice_forms').update({status:'submitted'}).eq('id',saved.id).eq('company_id',companyId).select(formColumns).single<FormRow>();
    if(failure){setError(`Invoice could not submit. ${failure.message}`);return}
    const submitted=fromForm(data);
    setForms(current=>[submitted,...current.filter(item=>item.id!==submitted.id)]);
    setSelected(null);
    if(qboAddOn)syncInBackground(submitted,'submitted');
  }

  async function addFromGenerator(generated:{invoiceNumber:string;invoiceDate:string;amount:number;customerId:string}){
    if(draft)throw new Error('Finish or delete your invoice in progress before adding another.');
    const now=new Date().toISOString();
    const saved=await save({id:createId(),companyId:companyId??'',createdBy:user.id,createdByName:user.name,invoiceNumber:generated.invoiceNumber,invoiceDate:generated.invoiceDate,invoiceAmount:generated.amount,customerId:generated.customerId,attachment:null,status:'draft',submittedAt:null,createdAt:now,updatedAt:now});
    if(!saved)throw new Error('Invoice could not be added. Check your connection and try again.');
    setGeneratorOpen(false);setSelected(saved);
  }

  async function markPaid(form:InvoiceForm){
    if(!window.confirm('Mark this invoice as paid? This cannot be undone in the app.'))return;
    if(demoData){const paid={...form,status:'paid' as const,paidAt:new Date().toISOString(),paidByName:user.name};setSelected(paid);setForms(current=>[paid,...current.filter(item=>item.id!==paid.id)]);return}
    if(!supabase||!companyId)return;
    setSaving(true);setError('');
    const {data,error:failure}=await supabase.from('invoice_forms').update({status:'paid'}).eq('company_id',companyId).eq('id',form.id).eq('status','submitted').select(formColumns).single<FormRow>();
    setSaving(false);
    if(failure){setError(`Invoice could not be marked paid. ${failure.message}`);return}
    const paid=fromForm(data);
    setSelected(paid);setForms(current=>[paid,...current.filter(item=>item.id!==paid.id)]);
    if(qboVisible&&paid.qboPaymentPending)syncInBackground(paid,'payment');
  }

  /** Merge a QuickBooks sync result into the list and the open invoice. */
  function applyQbo(result:QboInvoiceResult){
    const merge=(form:InvoiceForm):InvoiceForm=>form.id!==result.id?form:{...form,status:result.status,paidAt:result.paid_at,paidByName:result.paid_by_name,...qboFieldsFromRow(result)};
    setForms(current=>current.map(merge));
    setSelected(current=>current?merge(current):current);
  }
  function syncInBackground(form:InvoiceForm,action:'submitted'|'payment'){
    if(!companyId||demoData)return;
    void quickbooks.syncInvoice(companyId,form.id,action).then(result=>applyQbo(result.invoice)).catch(()=>{/* shown as Needs attention / retried by the scheduled sync */});
  }

  async function remove(form:InvoiceForm){
    if(!window.confirm('Delete this invoice? This cannot be undone.'))return;
    if(demoData){setForms(current=>current.filter(item=>item.id!==form.id));setSelected(null);return}
    if(!supabase)return;
    setSaving(true);
    const {error:failure}=await supabase.from('invoice_forms').delete().eq('company_id',companyId).eq('id',form.id);
    if(failure){setError(failure.message);setSaving(false);return}
    if(form.attachment&&!form.attachment.storagePath.startsWith('data:'))await supabase.storage.from('invoice-files').remove([form.attachment.storagePath]);
    setForms(current=>current.filter(item=>item.id!==form.id));setSelected(null);setSaving(false);
  }

  async function addCustomer(nameInput?:string){
    const name=(nameInput??customerName).trim();
    if(!name)return null;
    if(demoData){
      const timestamp=new Date().toISOString();
      const created={id:createId(),companyId:'demo',name,createdAt:timestamp,updatedAt:timestamp};
      setCustomers(current=>[...current,created].sort((a,b)=>a.name.localeCompare(b.name)));
      setCustomerName('');setAddingCustomer(false);
      return created;
    }
    if(!supabase||!companyId)return null;
    const {data,error:failure}=await supabase.from('invoice_customers').insert({company_id:companyId,name}).select(customerColumns).single<CustomerRow>();
    if(failure){setError(`Customer could not be added. ${failure.message}`);return null}
    const created=fromCustomer(data);
    setCustomers(current=>[...current,created].sort((a,b)=>a.name.localeCompare(b.name)));
    setCustomerName('');setAddingCustomer(false);
    return created;
  }

  if(generatorOpen&&manager)return <InvoiceGenerator companyLogoUrl={companyLogoUrl} company={company??{name:''}} customers={customers} onAddCustomer={async name=>{const created=await addCustomer(name);if(!created)throw new Error('Customer could not be added.');return created}} draftKey={`fireops.invoice-generator.${companyId??'demo'}.${user.id}`} onAddToInvoices={addFromGenerator} onBack={()=>setGeneratorOpen(false)}/>;

  if(selected){
    const editable=canEditInvoice(selected,user,manager);
    const customer=customers.find(item=>item.id===selected.customerId);
    const review=scanReview?.formId===selected.id?scanReview:null;
    const unsure=(field:InvoiceReviewField)=>Boolean(editable&&review?.fields.includes(field));
    const checkTag=(field:InvoiceReviewField)=>unsure(field)?<em className="invoice-check-tag">Check</em>:null;
    const fieldClass=(field:InvoiceReviewField)=>unsure(field)?'invoice-field-check':undefined;
    const scanPicker=(label:string)=><label className={`payroll-attachment-picker invoice-scan-picker${scanning||saving?' disabled':''}`}><Camera/><span>{label}</span><FileInput type="file" accept={scanAccept} disabled={scanning||saving} onChange={event=>{const file=event.target.files?.[0];if(file)void scan(file);event.target.value=''}}/></label>;
    return <div className="page payroll-page invoice-page"><div className="page-heading"><div><button className="back-link" onClick={()=>setSelected(null)}>← Back to invoices</button><h1>{editable?(selected.status==='draft'?'Invoice submission':'Edit invoice'):'Invoice details'}</h1><p>{editable?(scanning?'Reading invoice photo…':saving?'Saving changes…':selected.status==='draft'?'Changes save automatically':'Edits save automatically'):'Paid invoice is view only.'}</p></div>{(editable||(manager&&selected.status==='submitted'))&&selected.status!=='paid'&&<button className="payroll-delete" disabled={saving} onClick={()=>void remove(selected)}><Trash2/>Delete invoice</button>}</div>
      {error&&<p className="receipt-error" role="alert">{error}</p>}
      {editable&&scanning&&<p className="invoice-scan-banner" role="status">Reading the invoice photo. Fields fill in when it is done.</p>}
      {editable&&!scanning&&review?.note&&<p className="invoice-scan-banner" role="status">{review.note}</p>}
      {editable&&!scanning&&review&&review.fields.length>0&&<div className="invoice-scan-banner review" role="status"><span>Auto-filled from the photo. Check the highlighted fields.</span><button type="button" className="secondary" onClick={()=>setScanReview({...review,fields:[]})}>They are correct</button></div>}
      <section className="payroll-form-card">{editable&&autofillEnabled&&<div className="invoice-scan-row">{scanPicker(selected.attachment?'Scan a new invoice photo':'Scan invoice to auto-fill')}<small className="payroll-attachment-help">Reads invoice #, dates, amount and customer from a photo. You check them before submitting.</small></div>}<div className="invoice-fields">
        <label className={fieldClass('invoiceNumber')}><span>Invoice number{checkTag('invoiceNumber')}</span>{editable?<input value={selected.invoiceNumber} maxLength={160} onChange={event=>change({...selected,invoiceNumber:event.target.value})}/>:<b>{selected.invoiceNumber}</b>}</label>
        <label className={fieldClass('invoiceDate')}><span>Invoice date{checkTag('invoiceDate')}</span>{editable?<input type="date" value={selected.invoiceDate} onChange={event=>change({...selected,invoiceDate:event.target.value})}/>:<b>{formatCalendarDate(selected.invoiceDate)}</b>}</label>
        <label className={fieldClass('dueDate')}><span>Due date{checkTag('dueDate')}</span>{editable?<><input type="date" min={selected.invoiceDate||undefined} value={invoiceDueDate(selected)} onChange={event=>change({...selected,dueDate:event.target.value||undefined})}/>{!selected.dueDate&&<small className="payroll-attachment-help">Defaults to 30 days after the invoice date.</small>}</>:<b>{formatCalendarDate(invoiceDueDate(selected))} {selected.status!=='draft'&&<i className={`invoice-payment ${invoicePaymentState(selected)}`}>{paymentLabel[invoicePaymentState(selected)]}</i>}</b>}{selected.status==='paid'&&selected.paidAt&&<small className="payroll-attachment-help">Paid {new Date(selected.paidAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}{selected.paidByName?` · marked by ${selected.paidByName}`:''}</small>}</label>
        <label className={fieldClass('invoiceAmount')}><span>Invoice amount{checkTag('invoiceAmount')}</span>{editable?<input type="number" min="0" step="0.01" value={selected.invoiceAmount||''} onChange={event=>change({...selected,invoiceAmount:Number(event.target.value)||0})}/>:<b>{money(selected.invoiceAmount)}</b>}</label>
        <label className={fieldClass('customerId')}><span>Customer{checkTag('customerId')}</span>{editable?<select value={addingCustomer?ADD_CUSTOMER:selected.customerId} onChange={event=>{if(event.target.value===ADD_CUSTOMER){setAddingCustomer(true);setCustomerName('');return}setAddingCustomer(false);change({...selected,customerId:event.target.value})}}><option value="">Select customer</option>{customers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}<option value={ADD_CUSTOMER}>Add customer…</option></select>:<b>{customer?.name??'Customer unavailable'}</b>}
          {editable&&addingCustomer&&<div className="invoice-inline-customer"><input autoFocus value={customerName} maxLength={160} placeholder="Customer name" onChange={event=>setCustomerName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void addCustomer().then(created=>{if(created)change({...selected,customerId:created.id})})}}}/><button type="button" className="primary" disabled={!customerName.trim()||saving} onClick={()=>void addCustomer().then(created=>{if(created)change({...selected,customerId:created.id})})}>Add</button><button type="button" className="secondary" onClick={()=>{setAddingCustomer(false);setCustomerName('')}}>Cancel</button></div>}
          {editable&&!scanning&&review?.newCustomerName&&<div className="invoice-scan-customer" role="status"><span>“{review.newCustomerName}” from the photo is not in your customer list.</span><button type="button" className="primary" disabled={saving} onClick={event=>{event.preventDefault();const name=review.newCustomerName!;void addCustomer(name).then(created=>{if(created)change({...selected,customerId:created.id})})}}>Add “{review.newCustomerName}”</button><button type="button" className="secondary" onClick={event=>{event.preventDefault();setScanReview({...review,newCustomerName:undefined})}}>Dismiss</button></div>}
        </label>
        <div className="payroll-attachment-field"><span>Attachment</span>{selected.attachment?<div className="payroll-attachment"><FileText/><span><b>{selected.attachment.name}</b><small>{(selected.attachment.byteSize/1024/1024).toFixed(1)} MB</small></span><button onClick={()=>void openAttachment(selected)} aria-label="Open attachment"><ExternalLink/></button>{editable&&<button onClick={()=>void removeAttachment()} aria-label="Remove attachment"><X/></button>}</div>:editable?<label className="payroll-attachment-picker"><Upload/><span>Attach file or image</span><FileInput type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif" onChange={event=>{const file=event.target.files?.[0];if(file)void attach(file);event.target.value=''}}/></label>:<span>—</span>}<small className="payroll-attachment-help">JPG, PNG, WebP, HEIC, or PDF · 10 MB max</small></div>
      </div>
      {qboVisible&&companyId&&selected.status!=='draft'&&<QuickbooksInvoicePanel companyId={companyId} form={selected} customer={customer} onResult={applyQbo}/>}
      {editable&&selected.status==='draft'&&<button className="primary payroll-submit" disabled={saving} onClick={()=>void submit()}>Submit Invoice</button>}
      {manager&&selected.status==='submitted'&&<button className="primary payroll-submit invoice-mark-paid" disabled={saving} onClick={()=>void markPaid(selected)}>{saving?'Saving…':'Mark as paid'}</button>}
      </section></div>;
  }

  const submittedAll=forms.filter(form=>form.status!=='draft');
  const visible=submittedAll.filter(form=>paymentFilter==='all'||(paymentFilter==='paid')===(form.status==='paid'));
  return <div className="page payroll-page invoice-page">{onBack&&<button type="button" className="page-back" onClick={onBack}><ArrowLeft/> Back</button>}<div className="page-heading hero-heading"><div><h1>Invoices</h1></div><div className="invoice-heading-actions">{manager&&<button className="secondary" onClick={()=>setGeneratorOpen(true)}><FileText/>Invoice Generator</button>}{autofillEnabled&&<label className={`secondary invoice-scan-button${scanning||saving?' disabled':''}`}><Camera/>Scan invoice<FileInput type="file" accept={scanAccept} aria-label="Scan invoice photo" disabled={scanning||saving} onChange={event=>{const file=event.target.files?.[0];if(file)void scan(file);event.target.value=''}}/></label>}<button className="primary" onClick={openNew}><Plus/>New Invoice</button></div></div>
    {draft&&<button className="payroll-draft-card" onClick={()=>setSelected(draft)}><span><b>Invoice in progress</b><small>Last saved {new Date(draft.updatedAt).toLocaleString()}</small></span><strong>Continue</strong></button>}
    {error&&<p className="receipt-error" role="alert">{error}</p>}
    <section className="receipt-list-card"><div className="receipt-list-heading"><h2>{manager?'Submitted invoices':'Your submitted invoices'}</h2>{submittedAll.length>0&&<div className="roster-sort" role="radiogroup" aria-label="Filter invoices">{(['all','unpaid','paid'] as const).map(value=><button key={value} type="button" role="radio" aria-checked={paymentFilter===value} className={paymentFilter===value?'selected':''} onClick={()=>setPaymentFilter(value)}>{value==='all'?'All':value==='paid'?'Paid':'Unpaid'}</button>)}</div>}</div>
      {loading?<p className="receipt-state">Loading invoices…</p>:!submittedAll.length?<div className="receipt-empty"><FileText/><h3>No submitted invoices</h3><p>{draft?'Continue your invoice in progress to submit it.':'Select New Invoice to submit your first invoice.'}</p></div>:<div className="receipt-table-wrap"><table className="receipt-table"><thead><tr><th>Invoice</th><th className="receipt-date">Date</th><th>Customer</th><th className="receipt-amount">Amount</th><th>Status</th><th className="invoice-attachment-column">Attachment</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map(form=>{const editable=canEditInvoice(form,user,manager);return <tr key={form.id}><td>{form.invoiceNumber}</td><td className="receipt-date">{formatCalendarDate(form.invoiceDate)}</td><td>{customers.find(item=>item.id===form.customerId)?.name??'—'}</td><td className="receipt-amount">{money(form.invoiceAmount)}</td><td><i className={`invoice-payment ${invoicePaymentState(form)}`}>{paymentLabel[invoicePaymentState(form)]}</i>{form.status!=='paid'&&invoiceDueDate(form)&&<small className="invoice-due">Due {formatCalendarDate(invoiceDueDate(form))}</small>}{qboVisible&&<span className="invoice-qbo-cell" title="QuickBooks"><QboStatusBadge status={form.qboSyncStatus}/></span>}</td><td className="invoice-attachment-column">{form.attachment?'Yes':'—'}</td><td><button className="receipt-open" onClick={()=>setSelected(form)} aria-label={`${editable?'Edit':'View'} invoice ${form.invoiceNumber}`}><ExternalLink/>{editable?'Edit':'View'}</button></td></tr>})}</tbody></table>{!visible.length&&<p className="receipt-state">No {paymentFilter} invoices.</p>}</div>}
    </section></div>;
}
