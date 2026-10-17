import {useEffect,useState} from 'react';
import {RefreshCw,Truck} from 'lucide-react';
import {supabase} from './supabase';

type Area={id:number;name:string};
type Center={id:number;name:string};
type PriorityList={file_id:number;name:string;resource_type:string|null;published_at:string|null;synced_at:string|null;sync_status:'complete'|'partial'};
type DispatchEntry={rank:number;company_name:string|null;equipment_location:string|null;vin:string|null;cafs:string|null;daily_rate:number|null;rate_status:'matched'|'not_found'|'ambiguous'};

const sourceUrl='https://www.fs.usda.gov/business/incident/vipr.php';
const message=(error:unknown)=>error instanceof Error?error.message:'Dispatch data could not be loaded.';

export default function DispatchListsPage(){
  const [areas,setAreas]=useState<Area[]>([]);
  const [centers,setCenters]=useState<Center[]>([]);
  const [lists,setLists]=useState<PriorityList[]>([]);
  const [entries,setEntries]=useState<DispatchEntry[]>([]);
  const [areaId,setAreaId]=useState('');
  const [centerId,setCenterId]=useState('');
  const [listId,setListId]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);

  useEffect(()=>{
    let active=true;
    if(!supabase){setLoading(false);return}
    setLoading(true);setError('');
    void (async()=>{try{
      const {data,error:failure}=await supabase.from('usfs_geographic_areas').select('id,name').eq('is_active',true).order('name');
      if(!active)return;if(failure)throw failure;
      const next=(data??[]) as Area[];setAreas(next);setAreaId(current=>next.some(item=>String(item.id)===current)?current:String(next[0]?.id??''));
    }catch(failure){if(active)setError(message(failure))}finally{if(active)setLoading(false)}})();
    return()=>{active=false};
  },[refresh]);

  useEffect(()=>{
    let active=true;setCenters([]);setCenterId('');setLists([]);setListId('');setEntries([]);
    if(!supabase||!areaId)return()=>{active=false};
    setLoading(true);setError('');
    void (async()=>{try{
      const {data,error:failure}=await supabase.from('usfs_dispatch_centers').select('id,name').eq('geographic_area_id',Number(areaId)).eq('is_active',true).order('name');
      if(!active)return;if(failure)throw failure;const next=(data??[]) as Center[];setCenters(next);setCenterId(String(next[0]?.id??''));
    }catch(failure){if(active)setError(message(failure))}finally{if(active)setLoading(false)}})();
    return()=>{active=false};
  },[areaId,refresh]);

  useEffect(()=>{
    let active=true;setLists([]);setListId('');setEntries([]);
    if(!supabase||!centerId)return()=>{active=false};
    setLoading(true);setError('');
    void (async()=>{try{
      const {data,error:failure}=await supabase.from('usfs_priority_lists').select('file_id,name,resource_type,published_at,synced_at,sync_status').eq('dispatch_center_id',Number(centerId)).eq('is_active',true).in('sync_status',['complete','partial']).order('published_at',{ascending:false});
      if(!active)return;if(failure)throw failure;const next=(data??[]) as PriorityList[];setLists(next);setListId(String(next[0]?.file_id??''));
    }catch(failure){if(active)setError(message(failure))}finally{if(active)setLoading(false)}})();
    return()=>{active=false};
  },[centerId,refresh]);

  useEffect(()=>{
    let active=true;setEntries([]);
    if(!supabase||!listId)return()=>{active=false};
    setLoading(true);setError('');
    void (async()=>{try{
      const {data,error:failure}=await supabase.from('usfs_dispatch_entries').select('rank,company_name,equipment_location,vin,cafs,daily_rate,rate_status').eq('priority_list_file_id',Number(listId)).order('rank');
      if(!active)return;if(failure)throw failure;setEntries((data??[]) as DispatchEntry[]);
    }catch(failure){if(active)setError(message(failure))}finally{if(active)setLoading(false)}})();
    return()=>{active=false};
  },[listId,refresh]);

  const selectedList=lists.find(item=>String(item.file_id)===listId);
  return <div className="page dispatch-page">
    <div className="page-heading"><div><h1>Dispatch Lists</h1><p>USFS VIPR rankings with award rates matched by VIN.</p></div><button className="secondary dispatch-refresh" onClick={()=>setRefresh(value=>value+1)} disabled={loading}><RefreshCw className={loading?'spin':''}/>Refresh</button></div>
    <section className="dispatch-filters" aria-label="Dispatch list filters">
      <label><span>Geographic area</span><select value={areaId} onChange={event=>setAreaId(event.target.value)} disabled={!areas.length}>{areas.map(area=><option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
      <label><span>Dispatch center</span><select value={centerId} onChange={event=>setCenterId(event.target.value)} disabled={!centers.length}>{centers.map(center=><option key={center.id} value={center.id}>{center.name}</option>)}</select></label>
      <label><span>Priority list</span><select value={listId} onChange={event=>setListId(event.target.value)} disabled={!lists.length}>{lists.map(list=><option key={list.file_id} value={list.file_id}>{list.resource_type||list.name}</option>)}</select></label>
    </section>
    {error?<div className="dispatch-state error" role="alert"><b>Dispatch data unavailable</b><span>{error}</span></div>:null}
    {!error&&!supabase?<div className="dispatch-state"><b>Dispatch data unavailable in demo mode</b><span>Connect FireOps to Supabase to browse imported lists.</span></div>:null}
    {!error&&supabase&&!loading&&!selectedList?<div className="dispatch-state"><b>No published lists found</b><span>Try another dispatch center or check again after scheduled import.</span></div>:null}
    {selectedList?<section className="dispatch-results" aria-busy={loading}>
      <header><div><h2>{selectedList.resource_type||selectedList.name}</h2><p>{selectedList.published_at?`Published ${new Date(selectedList.published_at).toLocaleString()}`:'Publish date unavailable'} · {entries.length} ranked resources</p></div>{selectedList.sync_status==='partial'?<span className="dispatch-warning">Rates updating</span>:null}</header>
      <div className="dispatch-table-wrap"><table><thead><tr><th>Rank</th><th>Company</th><th>Equipment location</th><th>VIN</th><th>CAFS</th><th>Daily rate</th></tr></thead><tbody>{entries.map(entry=><tr key={entry.rank}><td className="dispatch-rank">#{entry.rank}</td><td><b>{entry.company_name||'Not reported'}</b></td><td>{entry.equipment_location||'Not reported'}</td><td className="dispatch-vin">{entry.vin||'Not reported'}</td><td>{entry.cafs||'Not reported'}</td><td className="dispatch-rate">{entry.rate_status==='matched'&&entry.daily_rate!==null?Number(entry.daily_rate).toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2}):entry.rate_status==='ambiguous'?'Needs review':'Not matched'}</td></tr>)}</tbody></table></div>
      {!entries.length&&!loading?<div className="dispatch-empty"><Truck/><b>No ranked resources found</b></div>:null}
      <footer>Source: USDA Forest Service VIPR public records. <a href={sourceUrl} target="_blank" rel="noreferrer">Verify official source</a>. FireOps is not affiliated with or endorsed by USDA or Forest Service.</footer>
    </section>:null}
  </div>;
}
