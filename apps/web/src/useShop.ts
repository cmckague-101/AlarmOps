import {useCallback, useEffect, useRef, useState} from 'react';
import {
  FLEET_REPAIR_COLUMNS, REPAIR_TYPE_COLUMNS, SHOP_JOB_COLUMNS, SHOP_JOB_NOTE_COLUMNS,
  fleetRepairFromRow, repairTypeFromRow, shopJobFromRow, shopJobNoteFromRow,
  type FleetRepair, type FleetRepairFileRequest, type FleetRepairRow, type RepairType, type RepairTypeRow,
  type ShopJob, type ShopJobNote, type ShopJobNoteRow, type ShopJobPriority, type ShopJobRow, type ShopJobStatus,
} from '@fireops/domain';
import {supabase} from './supabase';

export type ShopJobDraft = {
  title:string;description:string;priority:ShopJobPriority;status:ShopJobStatus;blockerReason?:string;
  kind:'general'|'fleet';shopArea?:string;fleetVehicleId?:string;assignToMe:boolean;
};
export type ShopJobPatch = Partial<Pick<ShopJob,'priority'|'status'>>&{blockerReason?:string|null};
type ShopData = {jobs:ShopJob[];notes:ShopJobNote[];repairTypes:RepairType[];repairs:FleetRepair[]};
const empty:ShopData = {jobs:[],notes:[],repairTypes:[],repairs:[]};

async function invoke<T>(name:string, body:Record<string,unknown>):Promise<T> {
  const {data,error} = await supabase!.functions.invoke<T & {error?:string}>(name,{body});
  if (error) {
    // Edge Function errors carry the JSON body on the response context.
    let message = '';
    try {message = (await (error as {context?:Response}).context?.json?.())?.error ?? '';} catch {/* not JSON */}
    throw new Error(message || error.message || 'The shop request failed.');
  }
  if (data && typeof data === 'object' && 'error' in data && data.error) throw new Error(String(data.error));
  return data as T;
}

/** Shop board, activity notes and fleet repairs for one company, kept live with Realtime. */
export function useShop(companyId?:string) {
  const [data,setData] = useState<ShopData>(empty);
  const [loading,setLoading] = useState(Boolean(companyId&&supabase));
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [revision,setRevision] = useState(0);
  const active = useRef(companyId);
  active.current = companyId;
  const refresh = useCallback(()=>setRevision(value=>value+1),[]);

  useEffect(()=>{
    let current = true;
    setError('');
    if (!companyId || !supabase) {setData(empty);setLoading(false);return;}
    void (async()=>{
      try {
        const client = supabase!;
        const [jobs,notes,types,repairs] = await Promise.all([
          client.from('shop_jobs').select(SHOP_JOB_COLUMNS).eq('company_id',companyId).order('opened_at'),
          client.from('shop_job_notes').select(SHOP_JOB_NOTE_COLUMNS).eq('company_id',companyId).order('created_at',{ascending:false}).limit(2000),
          client.from('repair_types').select(REPAIR_TYPE_COLUMNS).eq('company_id',companyId).order('name'),
          client.from('fleet_repairs').select(FLEET_REPAIR_COLUMNS).eq('company_id',companyId).order('created_at',{ascending:false}).limit(2000),
        ]);
        const failure = jobs.error??notes.error??types.error??repairs.error;
        if (failure) throw failure;
        if (!current) return;
        setData({
          jobs:(jobs.data as ShopJobRow[]).map(shopJobFromRow),
          notes:(notes.data as ShopJobNoteRow[]).map(shopJobNoteFromRow),
          repairTypes:(types.data as RepairTypeRow[]).map(repairTypeFromRow),
          repairs:(repairs.data as FleetRepairRow[]).map(fleetRepairFromRow),
        });
      } catch {if(current)setError('Shop jobs could not load. Check your connection and try again.');}
      finally {if(current)setLoading(false);}
    })();
    return ()=>{current=false;};
  },[companyId,revision]);

  useEffect(()=>{
    if (!companyId || !supabase) return;
    const client = supabase;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const changed = ()=>{clearTimeout(timer);timer=setTimeout(refresh,250);};
    const channel = client.channel(`shop:${companyId}`);
    for (const table of ['shop_jobs','shop_job_notes','fleet_repairs']) {
      channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`company_id=eq.${companyId}`},changed);
    }
    channel.subscribe();
    return ()=>{clearTimeout(timer);void client.removeChannel(channel);};
  },[companyId,refresh]);

  async function run<T>(action:()=>Promise<T>):Promise<T> {
    setBusy(true);setError('');
    try {
      const result = await action();
      refresh();
      return result;
    } catch (failure) {
      const message = failure instanceof Error && failure.message ? failure.message : 'The shop change could not be saved.';
      if (active.current===companyId) setError(message);
      throw failure;
    } finally {setBusy(false);}
  }

  const connected = Boolean(companyId && supabase);
  return {
    ...data, loading, error, busy, connected, refresh,
    clearError:()=>setError(''),
    createJob:(draft:ShopJobDraft)=>run(async()=>shopJobFromRow((await invoke<{job:ShopJobRow}>('shop-job-create',{companyId,...draft})).job)),
    assignToMe:(jobId:string)=>run(()=>invoke('shop-job-assign',{companyId,jobId})),
    /** Owners, admins and resource bosses assign a job to any shop worker. */
    assignTech:(jobId:string,techId:string)=>run(()=>invoke('shop-job-assign',{companyId,jobId,techId})),
    addNote:(jobId:string,body:string)=>run(()=>invoke('shop-job-note',{companyId,jobId,body})),
    updateJob:(jobId:string,patch:ShopJobPatch)=>run(async()=>{
      const values:Record<string,unknown> = {};
      if (patch.priority) values.priority = patch.priority;
      if (patch.status) values.status = patch.status;
      if (patch.blockerReason !== undefined) values.blocker_reason = patch.blockerReason;
      const {error:failure} = await supabase!.from('shop_jobs').update(values).eq('id',jobId).eq('company_id',companyId!).select('id').single();
      if (failure) throw new Error('The shop job could not be updated.');
    }),
    deleteJob:(jobId:string)=>run(async()=>{
      const {error:failure} = await supabase!.from('shop_jobs').delete().eq('id',jobId).eq('company_id',companyId!).select('id').single();
      if (failure) throw new Error('The shop job could not be deleted.');
    }),
    fileRepair:(request:Omit<FleetRepairFileRequest,'companyId'>)=>run(()=>invoke<{shopJobId?:string|null}>('fleet-repair-file',{companyId,...request})),
  };
}
