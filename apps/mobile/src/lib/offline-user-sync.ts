import {createPayrollRows,createSyncPatch,decodeDashboardPreferenceChanges,type InvoiceForm,type PayrollDay,type PayrollForm,type SyncOperation,type SyncRecord} from '@fireops/domain';
import type {OfflineOutboxSession,OutboxEntry,OutboxScope} from './offline-outbox';
import type {OfflineReceiptFiles} from './offline-receipt-files';

// User-owned offline commands (server: sync_user_command). No manager review:
// tasks are private, availability/dashboard target the caller only, and read
// markers touch only the caller's own notification/thread state.
export const userSyncCommands:Readonly<Record<string,readonly string[]>>={personal_task:['task.create','task.complete'],availability:['availability.set'],dashboard:['dashboard.set'],
  notification:['notification.read'],communication_read:['communication.seen'],communication_reply:['reply.create'],vehicle_note:['note.create'],inventory_checkout:['checkout.add'],training_signup:['signup.join','signup.cancel'],payroll_form:['form.save','form.submit'],invoice_form:['form.save','form.submit'],receipt:['receipt.create'],feedback:['feedback.send'],notification_preferences:['preferences.set'],
  communication_thread:['thread.create'],training:['training.create'],inventory_item:['item.create'],company_document:['document.create']};
export const isUserSyncOperation=(operation:SyncOperation)=>operation.mutation.kind==='command'&&!!userSyncCommands[operation.entityType]?.includes(operation.mutation.command);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const unresolved=(entry:OutboxEntry)=>['pending','syncing','awaiting_review'].includes(entry.status)||(entry.status==='blocked'&&!entry.reviewOutcome);
export type OfflineTask={id:string;subject:string;description:string;dueDate:string};
export function scopedUserEntries(entries:readonly OutboxEntry[],userId?:string|null,companyId?:string|null){
  return userId?entries.filter(entry=>entry.operation.provenance.userId===userId&&(!companyId||entry.operation.companyId===companyId)):[];
}
/** Verified reconciliation result, never the proposed value or upload receipt. */
export function latestUserSetting(entries:readonly OutboxEntry[],scope:OutboxScope,entity:'availability'|'dashboard'){
  let latest:{id:string;revision:string;record:SyncRecord|null;sequence:number}|undefined;
  for(const entry of scopedUserEntries(entries,scope.userId,scope.companyId)){
    const op=entry.operation;const receipt=entry.receipt;
    if(op.entityType!==entity||op.entityId!==scope.userId||!isUserSyncOperation(op)||entry.status!=='synced'||receipt?.kind!=='applied'||!/^\d+$/.test(receipt.revision))continue;
    if(!latest||BigInt(receipt.revision)>BigInt(latest.revision)||(receipt.revision===latest.revision&&entry.sequence>latest.sequence))latest={id:op.operationId,revision:receipt.revision,record:receipt.record,sequence:entry.sequence};
  }
  return latest;
}
/** Pending local task changes to overlay on the last downloaded list. */
export function pendingTaskChanges(entries:readonly OutboxEntry[]):{created:OfflineTask[];completed:Set<string>}{
  const created:OfflineTask[]=[];const completed=new Set<string>();
  for(const entry of entries){
    const op=entry.operation;if(op.entityType!=='personal_task'||op.mutation.kind!=='command'||!unresolved(entry))continue;
    if(op.mutation.command==='task.create')created.push({id:op.entityId,...(op.mutation.payload as Omit<OfflineTask,'id'>)});else completed.add(op.entityId);
  }
  return {created:created.filter(task=>!completed.has(task.id)),completed};
}
/** Latest pending value of the caller's own availability / dashboard items. */
export function pendingAvailability(entries:readonly OutboxEntry[],userId:string):boolean|undefined{
  let value:boolean|undefined;for(const entry of entries){const op=entry.operation;if(op.entityType==='availability'&&op.entityId===userId&&op.mutation.kind==='command'&&unresolved(entry))value=(op.mutation.payload as {available:boolean}).available}return value;
}
export function pendingDashboard(entries:readonly OutboxEntry[]):Record<string,SyncRecord[string]>{
  const changes:Record<string,SyncRecord[string]>={};for(const entry of entries){const op=entry.operation;if(op.entityType==='dashboard'&&op.mutation.kind==='command'&&unresolved(entry))Object.assign(changes,(op.mutation.payload as {changes:Record<string,SyncRecord[string]>}).changes)}return changes;
}
// Read markers only move forward, so synced ones may keep overlaying a stale
// downloaded list until it refreshes. Refused ones never overlay.
const marking=(entry:OutboxEntry)=>unresolved(entry)||(entry.status==='synced'&&entry.receipt?.kind==='applied');
/** Notifications this user marked read on the device (pending or confirmed), with the device time. */
export function pendingNotificationReads(entries:readonly OutboxEntry[]):Map<string,string>{
  const reads=new Map<string,string>();for(const entry of entries){const op=entry.operation;if(op.entityType==='notification'&&op.mutation.kind==='command'&&marking(entry)&&!reads.has(op.entityId))reads.set(op.entityId,op.provenance.savedAt)}return reads;
}
/** Newer server timestamp of two; ties keep the longer (more precise) string. */
export function laterTimestamp(left:string|undefined,right:string){
  if(left===undefined)return right;const a=Date.parse(left),b=Date.parse(right);return b>a||(b===a&&right.length>left.length)?right:left;
}
/** Highest seen marker per thread this user saved on the device (pending or confirmed). */
export function pendingThreadSeen(entries:readonly OutboxEntry[]):Map<string,string>{
  const seen=new Map<string,string>();
  for(const entry of entries){const op=entry.operation;if(op.entityType!=='communication_read'||op.mutation.kind!=='command'||!marking(entry))continue;seen.set(op.entityId,laterTimestamp(seen.get(op.entityId),(op.mutation.payload as {seenThrough:string}).seenThrough))}
  return seen;
}
type DeviceCreate<Payload>={id:string;savedAt:string;state:'saved'|'action_needed'|'posted';createdAt?:string}&Payload;
/** Records this device created through a user command: waiting, needing action, or confirmed (until downloaded lists have them). */
function deviceCreates<Payload>(entries:readonly OutboxEntry[],entityType:string):DeviceCreate<Payload>[]{
  const created:DeviceCreate<Payload>[]=[];
  for(const entry of entries){
    const op=entry.operation;if(op.entityType!==entityType||op.mutation.kind!=='command')continue;
    const base={...(op.mutation.payload as Payload),id:op.entityId,savedAt:op.provenance.savedAt};
    if(unresolved(entry)){created.push({...base,state:entry.status==='blocked'?'action_needed':'saved'});continue}
    const delivery=entry.delivery as {notApplied?:unknown;record?:{createdAt?:unknown}|null}|null;
    const createdAt=(entry.receipt?.kind==='applied'?entry.receipt.record?.createdAt:undefined)??delivery?.record?.createdAt;
    if(entry.status==='synced'&&delivery?.notApplied===undefined&&typeof createdAt==='string')created.push({...base,state:'posted',createdAt});
  }
  return created;
}
export type DeviceReply=DeviceCreate<{threadId:string;body:string}>;
/** Crew Chat replies saved on this device. */
export const deviceReplies=(entries:readonly OutboxEntry[])=>deviceCreates<{threadId:string;body:string}>(entries,'communication_reply');
export type ReceiptDetails={name:string;amountCents:number;fileName:string;mimeType:string;byteSize:number};
export type DeviceReceipt=DeviceCreate<ReceiptDetails>;
/** Receipts created on this device (file kept on the device until created on the server). */
export const deviceReceipts=(entries:readonly OutboxEntry[])=>deviceCreates<ReceiptDetails>(entries,'receipt');
export const receiptMimeTypes=['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'];
/** Server path an offline receipt's file is uploaded to before its command is sent. */
export const offlineReceiptPath=(scope:OutboxScope,receiptId:string)=>`${scope.companyId}/${scope.userId}/sync-${receiptId}`;
/** Commands whose kept device file is uploaded first: bucket and fixed path in the caller's own folder. */
export const offlineFileUploads:Readonly<Record<string,{bucket:string;path:(scope:OutboxScope,id:string)=>string}>>={
  receipt:{bucket:'receipt-files',path:offlineReceiptPath},
  company_document:{bucket:'fleet-files',path:(scope,id)=>`${scope.companyId}/${scope.userId}/doc-${id}`},
};
export type DocumentDetails={name:string;fileName:string;mimeType:string;byteSize:number};
export type DeviceDocument=DeviceCreate<DocumentDetails>;
/** Company documents added on this device (owners/admins); the file is kept on the device until created. */
export const deviceDocuments=(entries:readonly OutboxEntry[])=>deviceCreates<DocumentDetails>(entries,'company_document');
export const documentMimeTypes=['image/jpeg','image/png','image/webp','image/gif','application/pdf'];
export type DeviceThread=DeviceCreate<{subject:string;description:string}>;
/** Crew Chat threads started on this device (owners/admins). */
export const deviceThreads=(entries:readonly OutboxEntry[])=>deviceCreates<{subject:string;description:string}>(entries,'communication_thread');
export type TrainingDetails={courseCode:string;courseTitle:string;startsAt:string;location:string;instructor:string;capacity:number;courseInformation:string};
export type DeviceTraining=DeviceCreate<TrainingDetails>;
/** Trainings created on this device (owners/admins). */
export const deviceTrainings=(entries:readonly OutboxEntry[])=>deviceCreates<TrainingDetails>(entries,'training');
export type DeviceInventoryItem=DeviceCreate<{name:string;quantity:number}>;
/** Inventory items added on this device (owners/admins). */
export const deviceInventoryItems=(entries:readonly OutboxEntry[])=>deviceCreates<{name:string;quantity:number}>(entries,'inventory_item');
export type DeviceVehicleNote=DeviceCreate<{vehicleId:string;subject:string;body:string}>;
/** Vehicle notes created on this device for one vehicle. */
export const deviceVehicleNotes=(entries:readonly OutboxEntry[],vehicleId:string)=>deviceCreates<{vehicleId:string;subject:string;body:string}>(entries,'vehicle_note').filter(note=>note.vehicleId===vehicleId);
/** Gear checkouts saved on this device and not yet applied, per item. */
export function pendingCheckouts(entries:readonly OutboxEntry[]):Map<string,number>{
  const pending=new Map<string,number>();
  for(const entry of entries){const op=entry.operation;if(op.entityType==='inventory_checkout'&&op.mutation.kind==='command'&&unresolved(entry))pending.set(op.entityId,(pending.get(op.entityId)??0)+(op.mutation.payload as {quantity:number}).quantity)}
  return pending;
}
/** Latest unapplied sign-up intent per training saved on this device (true = join, false = cancel). */
export function pendingTrainingSignups(entries:readonly OutboxEntry[]):Map<string,boolean>{
  const pending=new Map<string,boolean>();
  for(const entry of entries){const op=entry.operation;if(op.entityType==='training_signup'&&op.mutation.kind==='command'&&unresolved(entry))pending.set(op.entityId,op.mutation.command==='signup.join')}
  return pending;
}
export type PayrollChanges=Partial<Pick<PayrollForm,'engineNumber'|'incidents'|'rows'>>;
export type DeviceForm<Changes>={changes:Changes;submitted:boolean;savedAt:string;actionNeeded:boolean};
export type DevicePayroll=DeviceForm<PayrollChanges>;
/** Unapplied draft saves/submission per form on this device, merged in save order. */
function deviceForms<Changes extends object>(entries:readonly OutboxEntry[],entityType:'payroll_form'|'invoice_form'):Map<string,DeviceForm<Changes>>{
  const forms=new Map<string,DeviceForm<Changes>>();
  for(const entry of entries){
    const op=entry.operation;if(op.entityType!==entityType||op.mutation.kind!=='command'||!unresolved(entry))continue;
    const current=forms.get(op.entityId)??{changes:{} as Changes,submitted:false,savedAt:op.provenance.savedAt,actionNeeded:false};
    forms.set(op.entityId,{changes:op.mutation.command==='form.save'?{...current.changes,...(op.mutation.payload as Changes)}:current.changes,
      submitted:current.submitted||op.mutation.command==='form.submit',savedAt:op.provenance.savedAt,actionNeeded:current.actionNeeded||entry.status==='blocked'});
  }
  return forms;
}
export const devicePayrollForms=(entries:readonly OutboxEntry[])=>deviceForms<PayrollChanges>(entries,'payroll_form');
export type InvoiceChanges=Partial<Pick<InvoiceForm,'invoiceNumber'|'invoiceDate'|'invoiceAmount'|'customerId'>>;
export type DeviceInvoice=DeviceForm<InvoiceChanges>;
export const deviceInvoiceForms=(entries:readonly OutboxEntry[])=>deviceForms<InvoiceChanges>(entries,'invoice_form');
/** Downloaded invoices with this device's unapplied changes on top; invoices created on the device appear as drafts. */
export function overlayInvoiceForms(forms:readonly InvoiceForm[],device:ReadonlyMap<string,DeviceInvoice>,author:{companyId:string;userId:string;name:string}):InvoiceForm[]{
  const result=forms.map(form=>{const saved=device.get(form.id);return saved&&form.createdBy===author.userId?{...form,...saved.changes,status:saved.submitted?'submitted' as const:form.status,submittedAt:saved.submitted?form.submittedAt??saved.savedAt:form.submittedAt,updatedAt:saved.savedAt}:form});
  for(const [id,saved] of device){
    if(forms.some(form=>form.id===id))continue;
    result.unshift({id,companyId:author.companyId,createdBy:author.userId,createdByName:author.name,invoiceNumber:'',invoiceDate:'',invoiceAmount:0,customerId:'',attachment:null,...saved.changes,
      status:saved.submitted?'submitted':'draft',submittedAt:saved.submitted?saved.savedAt:null,createdAt:saved.savedAt,updatedAt:saved.savedAt});
  }
  return result;
}
/** Downloaded payroll forms with this device's unapplied changes on top; forms created on the device appear as drafts. */
export function overlayPayrollForms(forms:readonly PayrollForm[],device:ReadonlyMap<string,DevicePayroll>,author:{companyId:string;userId:string;name:string}):PayrollForm[]{
  const result=forms.map(form=>{const saved=device.get(form.id);return saved&&form.createdBy===author.userId?{...form,...saved.changes,status:saved.submitted&&(form.status==='draft'||form.status==='rejected')?'pending' as const:form.status,submittedAt:saved.submitted?form.submittedAt??saved.savedAt:form.submittedAt,updatedAt:saved.savedAt}:form});
  for(const [id,saved] of device){
    if(forms.some(form=>form.id===id))continue;
    result.unshift({id,companyId:author.companyId,createdBy:author.userId,createdByName:author.name,engineNumber:'',incidents:'',attachment:null,rows:createPayrollRows(),...saved.changes,
      status:saved.submitted?'pending':'draft',submittedAt:saved.submitted?saved.savedAt:null,approvedAt:null,approvedBy:null,rejectionNotes:null,rejectedAt:null,rejectedBy:null,createdAt:saved.savedAt,updatedAt:saved.savedAt});
  }
  return result;
}
const payrollDate=/^(\d{4}-\d{2}-\d{2})?$/;
const validPayrollRows=(rows:unknown):rows is PayrollDay[]=>Array.isArray(rows)&&rows.length===21&&rows.every(day=>day&&typeof day==='object'&&Object.keys(day).sort().join()==='crewIds,date,hoursWorked,notes'
  &&typeof day.date==='string'&&payrollDate.test(day.date)&&typeof day.hoursWorked==='number'&&Number.isFinite(day.hoursWorked)&&day.hoursWorked>=0&&typeof day.notes==='string'&&day.notes.length<=2000
  &&Array.isArray(day.crewIds)&&day.crewIds.length<=200&&day.crewIds.every((id:unknown)=>typeof id==='string'&&uuid.test(id)));
export const notificationPreferenceKeys=['pushEnabled','communicationReplies','documentAdded','trainingCreated','issueUpdates'] as const;
/** Latest unapplied notification preference value per key saved on this device. */
export function pendingNotificationPreferences(entries:readonly OutboxEntry[]):Record<string,boolean>{
  const changes:Record<string,boolean>={};for(const entry of entries){const op=entry.operation;if(op.entityType==='notification_preferences'&&op.mutation.kind==='command'&&unresolved(entry))Object.assign(changes,(op.mutation.payload as {changes:Record<string,boolean>}).changes)}return changes;
}
const serverTime=/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/;
export function createOfflineUserSync(options:{session:OfflineOutboxSession;id:()=>string;now?:()=>string;offline:()=>boolean;canEdit:()=>boolean;changed:()=>Promise<void>;receiptFiles?:OfflineReceiptFiles}){
  const {session}=options;const scope={...session.scope};
  const guard=()=>{if(!options.canEdit())throw new Error('Offline saving is unavailable for the current account.')};
  type Save={operationId:string;savedAt:string;connectivity:'offline'|'online';operation?:SyncOperation;promise?:Promise<OutboxEntry>};
  // Retain failed/uncertain local saves only. A later intentional save gets a new ID.
  const saves=new Map<string,Save>();
  async function enqueue(entityType:string,entityId:string,command:string,payload:SyncRecord,projection:SyncRecord|null,dependsOn:string[]=[]):Promise<OutboxEntry>{
    guard();createSyncPatch({},payload);if(projection!==null)createSyncPatch({},projection);
    const captured=JSON.parse(JSON.stringify({payload,projection,dependsOn})) as {payload:SyncRecord;projection:SyncRecord|null;dependsOn:string[]};
    const key=JSON.stringify([entityType,entityId,command,captured],(_key,value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
    let save=saves.get(key);
    if(!save){save={operationId:options.id(),savedAt:(options.now??(()=>new Date().toISOString()))(),connectivity:options.offline()?'offline':'online'};saves.set(key,save)}
    if(save.promise)return save.promise;
    const request=save;
    request.promise=(async()=>{
      if(!request.operation){
        const deviceId=await session.getDeviceId(options.id);guard();
        request.operation={schemaVersion:1,operationId:request.operationId,companyId:scope.companyId,entityType,entityId,
          provenance:{userId:scope.userId,deviceId,savedAt:request.savedAt,connectivity:request.connectivity},dependsOn:captured.dependsOn,mutation:{kind:'command',command,payload:captured.payload}};
      }
      guard();const entry=await session.enqueue(request.operation,captured.projection,{sequenceCommand:true});
      saves.delete(key);
      try{await options.changed()}catch{/* Committed command remains durable. */}
      return entry;
    })();
    try{return await request.promise}finally{request.promise=undefined}
  }
  return {
    scope:Object.freeze({...scope}),
    createTask(task:OfflineTask){
      const subject=task.subject.trim();const description=task.description.trim();
      if(!uuid.test(task.id)||!subject||subject.length>200||description.length>5000||!/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate))return Promise.reject(new Error('Check the task subject, description and due date.'));
      const payload={subject,description,dueDate:task.dueDate};return enqueue('personal_task',task.id,'task.create',payload,{id:task.id,...payload});
    },
    /** Completing a task created on this device waits for its create to sync. */
    async completeTask(id:string){
      if(!uuid.test(id))throw new Error('Invalid task.');
      const create=(await session.list()).find(entry=>entry.operation.entityType==='personal_task'&&entry.operation.entityId===id&&entry.operation.mutation.kind==='command'&&entry.operation.mutation.command==='task.create');
      return enqueue('personal_task',id,'task.complete',{},null,create?[create.operation.operationId]:[]);
    },
    /** `base` is the value shown on this device; if someone changed it since, the server keeps theirs. */
    setAvailability(available:boolean,base:boolean|null){return enqueue('availability',scope.userId,'availability.set',{available,base},{id:scope.userId,available})},
    async setDashboard(changes:Record<string,boolean>){
      const patch=decodeDashboardPreferenceChanges(changes);
      return enqueue('dashboard',scope.userId,'dashboard.set',{changes:patch},null);
    },
    /** `id` is chosen once per intended reply and reused for retries of the same save. */
    postReply(reply:{id:string;threadId:string;body:string}){
      const body=reply.body.trim();
      if(!uuid.test(reply.id)||!uuid.test(reply.threadId)||!body||body.length>5000)return Promise.reject(new Error('Check the reply text.'));
      return enqueue('communication_reply',reply.id,'reply.create',{threadId:reply.threadId,body},null);
    },
    /** `id` is chosen once per intended note and reused for retries of the same save. */
    createVehicleNote(note:{id:string;vehicleId:string;subject:string;body:string}){
      const subject=note.subject.trim();const body=note.body.trim();
      if(!uuid.test(note.id)||!uuid.test(note.vehicleId)||!subject||subject.length>160||!body||body.length>5000)return Promise.reject(new Error('Check the note subject and details.'));
      return enqueue('vehicle_note',note.id,'note.create',{vehicleId:note.vehicleId,subject,body},null);
    },
    /** Stock is checked when it reaches the server; a shortfall is rejected and kept on the device. */
    checkOut(itemId:string,quantity:number){
      if(!uuid.test(itemId)||!Number.isInteger(quantity)||quantity<1||quantity>999999)return Promise.reject(new Error('Check the checkout quantity.'));
      return enqueue('inventory_checkout',itemId,'checkout.add',{quantity},null);
    },
    /** Capacity is checked when it reaches the server; a full class is rejected and kept on the device. */
    joinTraining(trainingId:string){
      if(!uuid.test(trainingId))return Promise.reject(new Error('Invalid training.'));
      return enqueue('training_signup',trainingId,'signup.join',{},null);
    },
    cancelTraining(trainingId:string){
      if(!uuid.test(trainingId))return Promise.reject(new Error('Invalid training.'));
      return enqueue('training_signup',trainingId,'signup.cancel',{},null);
    },
    /** Merges the given fields over the creator's draft (created if new); a submitted or deleted form is left unchanged. */
    savePayrollForm(formId:string,changes:PayrollChanges){
      const payload:PayrollChanges={};
      if(changes.engineNumber!==undefined)payload.engineNumber=changes.engineNumber;if(changes.incidents!==undefined)payload.incidents=changes.incidents;if(changes.rows!==undefined)payload.rows=changes.rows;
      if(!uuid.test(formId)||!Object.keys(payload).length||(payload.engineNumber!==undefined&&(typeof payload.engineNumber!=='string'||payload.engineNumber.length>160))
        ||(payload.incidents!==undefined&&(typeof payload.incidents!=='string'||payload.incidents.length>500))||(payload.rows!==undefined&&!validPayrollRows(payload.rows)))
        return Promise.reject(new Error('Check the payroll resource, incidents and days.'));
      return enqueue('payroll_form',formId,'form.save',payload as SyncRecord,null);
    },
    /** Same rules as payroll; the customer must still exist and a submission must be complete when it arrives. */
    saveInvoiceForm(formId:string,changes:InvoiceChanges){
      const payload:InvoiceChanges={};
      if(changes.invoiceNumber!==undefined)payload.invoiceNumber=changes.invoiceNumber;if(changes.invoiceDate!==undefined)payload.invoiceDate=changes.invoiceDate;
      if(changes.invoiceAmount!==undefined)payload.invoiceAmount=changes.invoiceAmount;if(changes.customerId!==undefined)payload.customerId=changes.customerId;
      const amount=payload.invoiceAmount;
      if(!uuid.test(formId)||!Object.keys(payload).length||(payload.invoiceNumber!==undefined&&(typeof payload.invoiceNumber!=='string'||payload.invoiceNumber.length>160))
        ||(payload.invoiceDate!==undefined&&(typeof payload.invoiceDate!=='string'||!payrollDate.test(payload.invoiceDate)))
        ||(amount!==undefined&&(typeof amount!=='number'||!Number.isFinite(amount)||amount<0||amount>=1e10||Math.round(amount*100)/100!==amount))
        ||(payload.customerId!==undefined&&(typeof payload.customerId!=='string'||(payload.customerId!==''&&!uuid.test(payload.customerId)))))
        return Promise.reject(new Error('Check the invoice number, date, amount and customer.'));
      return enqueue('invoice_form',formId,'form.save',payload as SyncRecord,null);
    },
    submitInvoiceForm(formId:string){
      if(!uuid.test(formId))return Promise.reject(new Error('Invalid invoice.'));
      return enqueue('invoice_form',formId,'form.submit',{},null);
    },
    submitPayrollForm(formId:string){
      if(!uuid.test(formId))return Promise.reject(new Error('Invalid payroll form.'));
      return enqueue('payroll_form',formId,'form.submit',{},null);
    },
    /** Keeps the file on the device first, then saves the command; `id` is chosen once per intended receipt. */
    async createReceipt(receipt:{id:string;name:string;amountCents:number;fileName:string;mimeType:string},fileUri:string){
      const name=receipt.name.trim();const fileName=receipt.fileName.trim();
      if(!uuid.test(receipt.id)||!name||name.length>160||!Number.isInteger(receipt.amountCents)||receipt.amountCents<1||receipt.amountCents>100000000
        ||!fileName||fileName.length>255||/[\x00-\x1f\x7f]/.test(fileName)||!receiptMimeTypes.includes(receipt.mimeType))throw new Error('Check the receipt name, amount and file type.');
      if(!options.receiptFiles)throw new Error('Saving receipts offline is unavailable on this device.');
      guard();const byteSize=await options.receiptFiles.keep(receipt.id,fileUri);
      return enqueue('receipt',receipt.id,'receipt.create',{name,amountCents:receipt.amountCents,fileName,mimeType:receipt.mimeType,byteSize},null);
    },
    /** Own notification preferences, merged per key on the server (later arrival wins). */
    setNotificationPreferences(changes:Record<string,boolean>){
      const keys=Object.keys(changes);
      if(!keys.length||keys.some(key=>!(notificationPreferenceKeys as readonly string[]).includes(key)||typeof changes[key]!=='boolean'))return Promise.reject(new Error('Invalid notification preferences.'));
      return enqueue('notification_preferences',scope.userId,'preferences.set',{changes:{...changes}},null);
    },
    /** `id` is chosen once per intended feedback message and reused for retries. */
    sendFeedback(feedback:{id:string;category:string;message:string;source:string}){
      const message=feedback.message.trim();
      if(!uuid.test(feedback.id)||!['idea','issue','other'].includes(feedback.category)||!message||message.length>5000||!['ios','android'].includes(feedback.source))return Promise.reject(new Error('Check the feedback message.'));
      return enqueue('feedback',feedback.id,'feedback.send',{category:feedback.category,message,source:feedback.source},null);
    },
    /** Owners/admins; `id` is chosen once per intended thread and reused for retries. */
    createThread(thread:{id:string;subject:string;description:string}){
      const subject=thread.subject.trim();const description=thread.description.trim();
      if(!uuid.test(thread.id)||!subject||subject.length>160||!description||description.length>5000)return Promise.reject(new Error('Check the thread subject and message.'));
      return enqueue('communication_thread',thread.id,'thread.create',{subject,description},null);
    },
    /** Owners/admins; `id` is chosen once per intended training and reused for retries. */
    createTraining(training:{id:string}&TrainingDetails){
      const value={courseCode:training.courseCode.trim(),courseTitle:training.courseTitle.trim(),startsAt:training.startsAt,location:training.location.trim(),instructor:training.instructor.trim(),capacity:training.capacity,courseInformation:training.courseInformation};
      if(!uuid.test(training.id)||!value.courseCode||value.courseCode.length>80||!value.courseTitle||value.courseTitle.length>200||!value.location||value.location.length>300||!value.instructor||value.instructor.length>160
        ||value.courseInformation.length>5000||!Number.isInteger(value.capacity)||value.capacity<1||value.capacity>10000||!serverTime.test(value.startsAt)||!Number.isFinite(Date.parse(value.startsAt)))return Promise.reject(new Error('Check the training details.'));
      return enqueue('training',training.id,'training.create',value,null);
    },
    /** Owners/admins; a name already used in the company is reported when it syncs and nothing is added. */
    createInventoryItem(item:{id:string;name:string;quantity:number}){
      const name=item.name.trim();
      if(!uuid.test(item.id)||!name||name.length>160||!Number.isInteger(item.quantity)||item.quantity<0||item.quantity>999999)return Promise.reject(new Error('Check the item name and quantity.'));
      return enqueue('inventory_item',item.id,'item.create',{name,quantity:item.quantity},null);
    },
    /** Owners/admins. Keeps the file on the device first (8 MB, as fleet files), then saves the command. */
    async createCompanyDocument(document:{id:string;name:string;fileName:string;mimeType:string},fileUri:string){
      const name=document.name.trim();const fileName=document.fileName.trim();
      if(!uuid.test(document.id)||!name||name.length>160||!fileName||fileName.length>255||/[\x00-\x1f\x7f]/.test(fileName)||!documentMimeTypes.includes(document.mimeType))throw new Error('Check the document name and file type (JPG, PNG, WebP, GIF or PDF).');
      if(!options.receiptFiles)throw new Error('Saving documents offline is unavailable on this device.');
      guard();const byteSize=await options.receiptFiles.keep(document.id,fileUri);
      if(byteSize>8*1024*1024){options.receiptFiles.remove(document.id);throw new Error('Documents must be 8 MB or smaller.')}
      return enqueue('company_document',document.id,'document.create',{name,fileName,mimeType:document.mimeType,byteSize},null);
    },
    markNotificationRead(id:string){
      if(!uuid.test(id))return Promise.reject(new Error('Invalid notification.'));
      return enqueue('notification',id,'notification.read',{},null);
    },
    /** `seenThrough` is the newest server timestamp displayed for the thread, verbatim. */
    markThreadSeen(threadId:string,seenThrough:string){
      if(!uuid.test(threadId)||!serverTime.test(seenThrough)||!Number.isFinite(Date.parse(seenThrough)))return Promise.reject(new Error('Invalid thread seen marker.'));
      return enqueue('communication_read',threadId,'communication.seen',{seenThrough},null);
    },
  };
}
export type OfflineUserSync=ReturnType<typeof createOfflineUserSync>;
