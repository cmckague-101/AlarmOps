import type {OutboxEntry} from './offline-outbox';

// Verified company-list downloads (server: get_company_sync_snapshot). Each
// section holds exactly the rows/columns its store loads online, as of one
// server snapshot, plus this user's receipt watermark. Never an HTTP cache.
export const companySnapshotSections={
  inventory:{company_inventory_items:['created_at','id','name','quantity','updated_at'],company_inventory_checkouts:['checked_out_at','item_id','quantity','updated_at','user_id','user_name']},
  training:{company_trainings:['capacity','course_code','course_information','course_title','created_at','id','instructor','location','starts_at','updated_at'],company_training_signups:['signed_up_at','training_id','user_id','user_name'],company_training_reads:['training_id','viewed_at']},
  payroll:{payroll_forms:['approved_at','approved_by','attachment','company_id','created_at','created_by','created_by_name','engine_number','id','incidents','rejected_at','rejected_by','rejection_notes','rows','status','submitted_at','updated_at']},
  invoices:{invoice_forms:['attachment','company_id','created_at','created_by','created_by_name','customer_id','id','invoice_amount','invoice_date','invoice_number','status','submitted_at','updated_at'],invoice_customers:['company_id','created_at','id','name','updated_at']},
  receipts:{company_receipts:['amount_cents','byte_size','created_at','id','mime_type','name','original_file_name','storage_path','uploaded_by','uploaded_by_name']},
  crew_chat:{communication_threads:['created_at','created_by','created_by_name','created_by_role','description','id','subject'],communication_replies:['body','created_at','created_by','created_by_name','id','thread_id'],communication_reads:['seen_at','thread_id']},
  notifications:{user_notifications:['body','created_at','entity_id','entity_type','event_type','group_key','id','path','read_at','title'],notification_preferences:['communication_replies','document_added','issue_updates','push_enabled','training_created']},
} as const;
const sectionLimit=(section:CompanySnapshotSection)=>section==='crew_chat'?10000:5000;
export type CompanySnapshotSection=keyof typeof companySnapshotSections;
export const companySnapshotSectionNames=Object.keys(companySnapshotSections) as CompanySnapshotSection[];
export type CompanySnapshot={schemaVersion:1;section:CompanySnapshotSection;companyId:string;userId:string;serverRequestAt:string;receiptWatermark:string;tables:Record<string,Record<string,unknown>[]>};
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid company download');return value as Record<string,unknown>};
const sameKeys=(value:Record<string,unknown>,expected:readonly string[])=>Object.keys(value).sort().join()===[...expected].sort().join();

export function decodeCompanySnapshot(value:unknown,scope:{userId:string;companyId:string},section:CompanySnapshotSection):CompanySnapshot{
  const data=object(value);
  if(!sameKeys(data,['schemaVersion','section','companyId','userId','serverRequestAt','receiptWatermark','tables']))throw new Error('Invalid company download shape');
  if(data.schemaVersion!==1||data.section!==section||data.companyId!==scope.companyId||data.userId!==scope.userId)throw new Error('Company download account, company or section changed');
  if(typeof data.serverRequestAt!=='string'||!Number.isFinite(Date.parse(data.serverRequestAt)))throw new Error('Invalid company download time');
  if(typeof data.receiptWatermark!=='string'||!/^(0|[1-9][0-9]{0,17})$/.test(data.receiptWatermark))throw new Error('Invalid company download watermark');
  const expected=companySnapshotSections[section] as Record<string,readonly string[]>;const tables=object(data.tables);
  if(!sameKeys(tables,Object.keys(expected)))throw new Error('Invalid company download tables');
  let total=0;const decoded:Record<string,Record<string,unknown>[]>={};
  for(const [name,columns] of Object.entries(expected)){
    const rows=tables[name];if(!Array.isArray(rows))throw new Error('Invalid company download rows');total+=rows.length;
    decoded[name]=rows.map(raw=>{const row=object(raw);if(!sameKeys(row,columns))throw new Error(`Invalid ${name} row`);return {...row}});
  }
  if(total>sectionLimit(section))throw new Error('Company download is too large');
  return {schemaVersion:1,section,companyId:scope.companyId,userId:scope.userId,serverRequestAt:data.serverRequestAt,receiptWatermark:data.receiptWatermark,tables:decoded};
}
/** A stored section is replaced only by one that is not older in server time or receipts. */
export function newerCompanySnapshot(saved:CompanySnapshot|null,next:CompanySnapshot){
  return !saved||(Date.parse(next.serverRequestAt)>=Date.parse(saved.serverRequestAt)&&BigInt(next.receiptWatermark)>=BigInt(saved.receiptWatermark));
}
/**
 * Entries to overlay on a downloaded list: unresolved ones, plus this device's
 * applied commands newer than the download's watermark (shown as still saved
 * on the device until a newer download includes them).
 */
export function entriesAfterDownload(entries:readonly OutboxEntry[],receiptWatermark:string|null|undefined):OutboxEntry[]{
  if(receiptWatermark==null)return [...entries];const watermark=BigInt(receiptWatermark);
  return entries.map(entry=>{
    const receipt=entry.receipt;const delivery=entry.delivery as {notApplied?:unknown}|null;
    return entry.status==='synced'&&receipt?.kind==='applied'&&/^\d+$/.test(receipt.revision)&&BigInt(receipt.revision)>watermark&&delivery?.notApplied===undefined?{...entry,status:'pending' as const}:entry;
  });
}

export type CompanySnapshotState=Readonly<{sections:Partial<Record<CompanySnapshotSection,{snapshot:CompanySnapshot;verifiedAt:string}>>;loaded:boolean;refreshing:boolean;error:string}>;
type SnapshotStore={getCompanySnapshot(section:CompanySnapshotSection):Promise<{snapshot:CompanySnapshot;verifiedAt:string}|null>;putCompanySnapshot(section:CompanySnapshotSection,value:unknown,verifiedAt:string):Promise<{snapshot:CompanySnapshot;verifiedAt:string}>};
export function companySnapshotError(error:unknown){
  const code=error&&typeof error==='object'?String((error as {code?:unknown}).code??''):'';
  if(code==='54000')return 'Some lists are too large to download for offline use.';
  if(code==='42501')return 'Current access does not allow downloading company lists.';
  if(['PGRST202','42883'].includes(code))return 'Offline downloads need a server update.';
  if(code==='SYNC_PAUSED')return '';
  return 'Some company lists could not be downloaded. The last downloads are kept.';
}
/** Single-flight, account-scoped download of every company-list section into device storage. */
export function createCompanySnapshotSync(options:{session:SnapshotStore;download:(section:CompanySnapshotSection,signal:AbortSignal)=>Promise<unknown>;canRun:()=>boolean;now?:()=>string;timeoutMs?:number}){
  let state:CompanySnapshotState={sections:{},loaded:false,refreshing:false,error:''};
  const listeners=new Set<()=>void>();let stopped=false;let flight:Promise<void>|null=null;const abort=new AbortController();
  const publish=(change:Partial<CompanySnapshotState>)=>{if(stopped)return;state=Object.freeze({...state,...change});listeners.forEach(listener=>listener())};
  const store=(section:CompanySnapshotSection,saved:{snapshot:CompanySnapshot;verifiedAt:string})=>publish({sections:{...state.sections,[section]:saved}});
  return {
    getSnapshot:()=>state,
    subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}},
    async load(){
      let error='';
      for(const section of companySnapshotSectionNames){try{const saved=await options.session.getCompanySnapshot(section);if(saved)store(section,saved)}catch{error='Saved company lists could not be read on this device.'}}
      publish({loaded:true,...(error?{error}:{})});
    },
    refresh(){
      if(stopped||!options.canRun())return Promise.resolve();
      flight??=(async()=>{
        publish({refreshing:true});let error='';
        for(const section of companySnapshotSectionNames){
          if(stopped||!options.canRun())break;
          const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),options.timeoutMs??20_000);
          const stop=()=>controller.abort();abort.signal.addEventListener('abort',stop,{once:true});
          try{
            const value=await options.download(section,controller.signal);if(stopped)return;
            store(section,await options.session.putCompanySnapshot(section,value,(options.now??(()=>new Date().toISOString()))()));
          }catch(failure){error||=companySnapshotError(failure)}
          finally{clearTimeout(timer);abort.signal.removeEventListener('abort',stop)}
        }
        publish({error,loaded:true});
      })().finally(()=>{publish({refreshing:false});flight=null});
      return flight;
    },
    stop(){stopped=true;abort.abort();listeners.clear()},
  };
}
export type CompanySnapshotSync=ReturnType<typeof createCompanySnapshotSync>;
