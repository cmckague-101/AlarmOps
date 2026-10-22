import {useCallback, useEffect, useMemo, useState} from 'react';
import {supabase} from '@/lib/supabase';
import {pendingAvailability} from './offline-user-sync';
import {useOptionalOfflineSync} from '@/providers/offline-sync-provider';

export function useAvailability(companyId?:string|null,selfId?:string|null) {
  // Offline: only your own availability is saved on device (base = the value shown), overlaid until synced.
  const offlineSync=useOptionalOfflineSync();const userSync=offlineSync?.userSync??null;const offline=!!offlineSync?.offline;const entries=offlineSync?.state.entries;
  const [statuses,setStatuses] = useState<Record<string,boolean>>({});
  const [loading,setLoading] = useState(Boolean(companyId));
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [revision,setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const client = supabase;
    void Promise.resolve().then(() => {
      if (!active) return;
      setStatuses({});setLoading(Boolean(companyId));setError('');
      if (!companyId || !client) setLoading(false);
    });
    if (!companyId || !client) return () => {active=false;};
    async function load() {
      try {
        const {data,error:failure} = await client!.from('crew_availability').select('user_id,available').eq('company_id',companyId!);
        if (failure) throw failure;
        if (active) {setStatuses(Object.fromEntries((data ?? []).map(row=>[row.user_id,row.available])));setError('');}
      } catch (failure) {if(active)setError(`Availability could not load. ${(failure as {message?:string}).message ?? 'Try again.'}`);}
      finally {if(active)setLoading(false);}
    }
    void load();
    const channel = client.channel(`availability:${companyId}:${Math.random()}`).on('postgres_changes',{event:'*',schema:'public',table:'crew_availability',filter:`company_id=eq.${companyId}`},()=>void load()).subscribe();
    return ()=>{active=false;void client.removeChannel(channel);};
  },[companyId,revision]);
  const ownPending = useMemo(()=>selfId?pendingAvailability(entries??[],selfId):undefined,[entries,selfId]);
  const shown = useMemo(()=>selfId&&ownPending!==undefined?{...statuses,[selfId]:ownPending}:statuses,[statuses,selfId,ownPending]);
  const save = useCallback(async (userId:string,available:boolean) => {
    if (offline && userSync) {
      if (busy) return;
      if (userId !== selfId) {setError('Changing someone else’s availability requires a connection.');return;}
      setBusy(true);setError('');
      try {await userSync.setAvailability(available,shown[userId]??null);}
      catch (failure) {setError(failure instanceof Error?failure.message:'Availability could not be saved on this device.');}
      finally {setBusy(false);}
      return;
    }
    if (!companyId || !supabase || busy) return;
    setBusy(true);setError('');
    try {
      const {error:failure} = await supabase.from('crew_availability').upsert({company_id:companyId,user_id:userId,available,updated_at:new Date().toISOString()},{onConflict:'company_id,user_id'});
      if (failure) throw failure;
      setStatuses(current=>({...current,[userId]:available}));
    } catch (failure) {setError(`Availability could not be saved. ${(failure as {message?:string}).message ?? 'Try again.'}`);}
    finally {setBusy(false);}
  },[companyId,busy,offline,userSync,selfId,shown]);
  return {statuses:shown,loading,error,busy,save,retry:()=>setRevision(value=>value+1)};
}
