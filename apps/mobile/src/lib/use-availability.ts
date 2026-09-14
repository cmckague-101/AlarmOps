import {useCallback, useEffect, useState} from 'react';
import {supabase} from '@/lib/supabase';

export function useAvailability(companyId?:string|null) {
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
  const save = useCallback(async (userId:string,available:boolean) => {
    if (!companyId || !supabase || busy) return;
    setBusy(true);setError('');
    try {
      const {error:failure} = await supabase.from('crew_availability').upsert({company_id:companyId,user_id:userId,available,updated_at:new Date().toISOString()},{onConflict:'company_id,user_id'});
      if (failure) throw failure;
      setStatuses(current=>({...current,[userId]:available}));
    } catch (failure) {setError(`Availability could not be saved. ${(failure as {message?:string}).message ?? 'Try again.'}`);}
    finally {setBusy(false);}
  },[companyId,busy]);
  return {statuses,loading,error,busy,save,retry:()=>setRevision(value=>value+1)};
}
