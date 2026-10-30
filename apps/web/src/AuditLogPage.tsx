import {useEffect, useRef, useState} from 'react';
import {formatAuditDescription, formatAuditTimestamp} from '@fireops/domain';
import {supabase} from './supabase';
import './AuditLogPage.css';

type AuditEntry = {id:string;created_at:string;actor_name:string;description:string};
const pageSize=100;

export default function AuditLogPage({companyId,demoEntries}:{companyId?:string;demoEntries?:AuditEntry[]}){
  const [entries,setEntries]=useState<AuditEntry[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [hasMore,setHasMore]=useState(false);
  const [reload,setReload]=useState(0);
  const [page,setPage]=useState(0);
  const newestAt=useRef<string|null>(null);
  useEffect(()=>{
    let active=true;
    if(demoEntries){setEntries(demoEntries);setLoading(false);setError('');setHasMore(false);return;}
    setLoading(true);setError('');
    if(page===0)setEntries([]);
    const load=async()=>{
      if(!companyId||!supabase){setLoading(false);setHasMore(false);return;}
      let query=supabase.from('company_audit_log')
        .select('id,created_at,actor_name,description').eq('company_id',companyId)
        .gte('created_at',new Date(Date.now()-30*86400000).toISOString())
        .order('created_at',{ascending:false}).order('id',{ascending:false})
        .range(page*pageSize,(page+1)*pageSize-1);
      // Keep later pages stable when new activity arrives before a refresh.
      if(page>0&&newestAt.current)query=query.lte('created_at',newestAt.current);
      const {data,error}=await query;
      if(!active)return;
      if(!error&&page===0)newestAt.current=data?.[0]?.created_at??null;
      if(error)setError(error.message);
      else{setEntries(previous=>page===0?(data??[]):[...previous,...(data??[])]);setHasMore(data?.length===pageSize);}
      setLoading(false);
    };
    void load().catch(error=>{if(active){setError(error instanceof Error?error.message:'Audit log could not be loaded.');setLoading(false);}});
    return()=>{active=false;};
  },[companyId,demoEntries,page,reload]);
  return <div className="page audit-log-page">
    <div className="page-heading"><div><h1>Audit log</h1><p>Company activity from the last 30 days. Latest first.</p></div><button className="secondary" disabled={loading} onClick={()=>{setPage(0);setReload(value=>value+1);}}>Refresh</button></div>
    {error&&<p role="alert">{error} <button className="secondary" onClick={()=>setReload(value=>value+1)}>Retry</button></p>}
    {entries.length>0&&<div className="audit-log-table-wrap"><table className="audit-log-table"><thead><tr><th scope="col">Date</th><th scope="col">Name</th><th scope="col">Change</th></tr></thead><tbody>{entries.map(entry=><tr key={entry.id}><td><time dateTime={entry.created_at}>{formatAuditTimestamp(entry.created_at)}</time></td><td>{entry.actor_name}</td><td>{formatAuditDescription(entry.description)}</td></tr>)}</tbody></table></div>}
    {loading&&<p role="status">Loading audit log…</p>}
    {!loading&&!error&&entries.length===0&&<p>No activity in the last 30 days.</p>}
    {hasMore&&!loading&&!error&&<button className="secondary" onClick={()=>setPage(value=>value+1)}>Load more</button>}
  </div>;
}
