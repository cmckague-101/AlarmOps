import {useCallback, useEffect, useState} from 'react';
import {ExternalLink, RefreshCw} from 'lucide-react';
import {createDemoNationalFireActivity,type NationalFireActivity} from '@fireops/domain';
import {supabase} from './supabase';

const number = new Intl.NumberFormat('en-US');

const totalStats = [
  {key:'incidents',label:'Incidents'},
  {key:'crews',label:'Crews'},
  {key:'engines',label:'Engines'},
  {key:'helicopters',label:'Helicopters'},
  {key:'totalPersonnel',label:'Total Personnel'},
] as const;

const gaccNames: Record<string,string> = {
  AICC:'Alaska Interagency Coordination Center',
  NWCC:'Northwest Area Coordination Center',
  ONCC:'Northern California Coordination Center',
  OSCC:'Southern California Coordination Center',
  NRCC:'Northern Rockies Coordination Center',
  GBCC:'Great Basin Coordination Center',
  SWCC:'Southwest Area Coordination Center',
  RMCC:'Rocky Mountain Area Coordination Center',
  EACC:'Eastern Area Coordination Center',
  SACC:'Southern Area Coordination Center',
};

export default function NationalFireActivitySection({demoMode=false}:{demoMode?:boolean}) {
  const [activity,setActivity] = useState<NationalFireActivity|null>(()=>demoMode?createDemoNationalFireActivity():null);
  const [loading,setLoading] = useState(!demoMode);
  const [error,setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);setError('');
    try {
      if(demoMode){setActivity(createDemoNationalFireActivity());return}
      if (!supabase) throw new Error('FireOps data service is not configured.');
      const {data,error:failure} = await supabase.functions.invoke<NationalFireActivity>('national-fire-activity');
      if (failure) throw failure;
      if (!data) throw new Error('NIFC returned no activity data.');
      setActivity(data);
    } catch (failure) {
      setError((failure as {message?:string}).message ?? 'National fire activity could not be loaded.');
    } finally {setLoading(false);}
  },[demoMode]);
  useEffect(()=>{void load();},[load]);
  return <section className="national-fire-panel" aria-labelledby="national-fire-title">
    <header>
      <div><h2 id="national-fire-title">National Fire Activity</h2><p>{activity?`Active Incident Resource Summary · ${activity.reportDate}`:'Active Incident Resource Summary'}</p></div>
      <div className="national-fire-actions">{activity&&!demoMode&&<a href={activity.sourceUrl} target="_blank" rel="noreferrer">Source PDF <ExternalLink/></a>}<button className="secondary" disabled={loading} onClick={()=>void load()}><RefreshCw className={loading?'spin':''}/>Refresh</button></div>
    </header>
    {loading&&!activity&&<p className="national-fire-state">Loading latest NIFC situation report…</p>}
    {error&&<div className="national-fire-error" role="alert"><b>Activity unavailable</b><span>{error}</span><button className="secondary" onClick={()=>void load()}>Try again</button></div>}
    {activity&&<>
      <div className="national-fire-totals">{totalStats.map(({key,label})=><div className={`national-fire-total national-fire-total-${key}`} key={key}><span>{label}</span><strong>{number.format(activity.total[key])}</strong></div>)}</div>
      <div className="national-fire-areas" aria-label="Incidents by GACC">
        <h3>Incidents by GACC</h3>
        <ul>{activity.areas.map(area=><li key={area.gacc}><span className="national-fire-area-name"><b>{area.gacc}</b><small>{gaccNames[area.gacc]}</small></span><strong>{number.format(area.incidents)}</strong></li>)}</ul>
      </div>
      <footer>{demoMode?'Fictional sample data for demonstration. Not a current NIFC situation report.':'Data extracted from current National Interagency Coordination Center situation report.'}</footer>
    </>}
  </section>;
}