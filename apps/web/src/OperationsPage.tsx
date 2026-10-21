import {lazy, Suspense, useEffect, useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import {geoAlbersUsa, geoPath} from 'd3-geo';
import type {FeatureCollection} from 'geojson';
import {feature} from 'topojson-client';
import type {Topology} from 'topojson-specification';
import statesTopology from 'us-atlas/states-10m.json';
import {ArrowLeft, CalendarDays, ChevronRight, Flame, Gauge, MapPin, RefreshCw, Search, Truck, Users, X} from 'lucide-react';
import {useDialogA11y} from './useDialogA11y';
import type {FireResourceVehicle,NifcIncident} from '@fireops/domain';
export type {FireResourceVehicle,NifcIncident} from '@fireops/domain';

const OperationsMap=lazy(()=>import('./OperationsMap'));

const NIFC_QUERY='https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query';
const NIFC_ITEM='https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-incident-locations-current/about';
const OUT_FIELDS='OBJECTID,UniqueFireIdentifier,IncidentName,IncidentSize,PercentContained,TotalIncidentPersonnel,POOState,FireDiscoveryDateTime,ModifiedOnDateTime_dt,InitialLatitude,InitialLongitude';
const US_STATE_NAMES:Record<string,string>={
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia'
};

type ArcGisFeature={attributes:Record<string,string|number|null>;geometry?:{x:number;y:number}};
type ArcGisResponse={features?:ArcGisFeature[];exceededTransferLimit?:boolean;error?:{message?:string}};

function parseIncident(item:ArcGisFeature):NifcIncident|null{
  const a=item.attributes;
  const latitude=Number(item.geometry?.y??a.InitialLatitude);
  const longitude=Number(item.geometry?.x??a.InitialLongitude);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return null;
  const nullableNumber=(value:unknown)=>value===null||value===undefined||value===''?null:Number(value);
  return {
    id:String(a.UniqueFireIdentifier??a.OBJECTID),
    name:String(a.IncidentName??'Unnamed incident'),
    acres:nullableNumber(a.IncidentSize),
    contained:nullableNumber(a.PercentContained),
    personnel:nullableNumber(a.TotalIncidentPersonnel),
    state:String(a.POOState??'').replace(/^US-/,''),
    discovered:nullableNumber(a.FireDiscoveryDateTime),
    updated:nullableNumber(a.ModifiedOnDateTime_dt),
    latitude,
    longitude
  };
}

export async function fetchIncidents(signal:AbortSignal){
  const incidents=new Map<string,NifcIncident>();
  let offset=0;
  for(let page=0;page<5;page+=1){
    const params=new URLSearchParams({
      f:'json',
      where:"IncidentTypeCategory='WF' AND FireOutDateTime IS NULL",
      outFields:OUT_FIELDS,
      returnGeometry:'true',
      outSR:'4326',
      orderByFields:'ModifiedOnDateTime_dt DESC',
      resultRecordCount:'1000',
      resultOffset:String(offset)
    });
    const response=await fetch(`${NIFC_QUERY}?${params}`,{signal});
    if(!response.ok)throw new Error(`NIFC request failed with ${response.status}`);
    const body=await response.json() as ArcGisResponse;
    if(body.error)throw new Error(body.error.message??'NIFC returned an error');
    const features=body.features??[];
    features.map(parseIncident).filter((item):item is NifcIncident=>Boolean(item)).forEach(item=>incidents.set(item.id,item));
    if(!body.exceededTransferLimit||!features.length)break;
    // ArcGIS offsets count every source feature, including rows discarded for
    // invalid geometry. Advancing by parsed rows can fetch overlapping pages.
    offset+=features.length;
  }
  return [...incidents.values()];
}

const states=feature(statesTopology as unknown as Topology,'states') as unknown as FeatureCollection;
const projection=geoAlbersUsa().fitExtent([[20,20],[880,540]],states);
const path=geoPath(projection);
function frameBounds(bounds:[[number,number],[number,number]]){
  const [[x0,y0],[x1,y1]]=bounds;
  const centerX=(x0+x1)/2;
  const centerY=(y0+y1)/2;
  let width=Math.max(100,(x1-x0)*1.35);
  let height=Math.max(70,(y1-y0)*1.35);
  const ratio=900/560;
  if(width/height>ratio)height=width/ratio;else width=height*ratio;
  return [centerX-width/2,centerY-height/2,width,height];
}

export default function OperationsPage({requestedIncidentId,onIncidentOpened,requestedVehicleId,onVehicleOpened,resources=[],motiveEnabled=false,assignableVehicles=[],onAssignVehicle,onVehicleSelect}:{requestedIncidentId?:string|null;onIncidentOpened?:()=>void;requestedVehicleId?:string|null;onVehicleOpened?:()=>void;assignedIncidentIds?:string[];resources?:FireResourceVehicle[];motiveEnabled?:boolean;assignableVehicles?:FireResourceVehicle[];onAssignVehicle?:(vehicleId:string,fire:{id:string;name:string;state:string})=>void;onVehicleSelect?:(vehicleId:string)=>void}){
  const [incidents,setIncidents]=useState<NifcIncident[]>([]);
  const [selected,setSelected]=useState<NifcIncident|null>(null);
  const [focusedVehicleId,setFocusedVehicleId]=useState<string|null>(null);
  const [fireQuery,setFireQuery]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [request,setRequest]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');
    void fetchIncidents(controller.signal).then(data=>{setIncidents(data);setLoading(false)}).catch(fetchError=>{
      if(fetchError instanceof DOMException&&fetchError.name==='AbortError')return;
      setError('Current NIFC fire data could not be loaded. Check connection and try again.');setLoading(false);
    });
    return()=>controller.abort();
  },[request]);

  useEffect(()=>{
    if(!requestedIncidentId||loading||error)return;
    const incident=incidents.find(item=>item.id===requestedIncidentId);
    if(incident)setSelected(incident);
    else setError('This assigned fire is no longer available in the current NIFC feed.');
    onIncidentOpened?.();
  },[requestedIncidentId,loading,error,incidents,onIncidentOpened]);

  useEffect(()=>{
    if(!requestedVehicleId)return;
    setSelected(null);setFocusedVehicleId(requestedVehicleId);onVehicleOpened?.();
  },[requestedVehicleId,onVehicleOpened]);

  const visible=incidents;
  const normalizedFireQuery=fireQuery.trim().toLocaleLowerCase();
  const sortedVisible=[...visible].sort((a,b)=>(b.acres??-1)-(a.acres??-1)||a.name.localeCompare(b.name));
  const searchResults=normalizedFireQuery?sortedVisible.filter(incident=>incident.name.toLocaleLowerCase().includes(normalizedFireQuery)):[];
  const motiveVehicles=useMemo(()=>motiveEnabled?resources.filter(resource=>resource.motive):[],[motiveEnabled,resources]);
  const latestUpdate=incidents.reduce<number|null>((latest,incident)=>incident.updated&&(!latest||incident.updated>latest)?incident.updated:latest,null);

  return <div className="page operations-page">
    <div className="page-heading operations-heading"><div><h1>Operations</h1></div></div>
    <section className="operations-workspace" aria-label="Wildfire operations map and incident list">
      <div className="fire-map-panel">
        <header><div><b>Incident Map</b><span>{loading?'Updating NIFC data':`${visible.length} ${visible.length===1?'incident':'incidents'}`}</span></div>{latestUpdate&&<small>Updated {formatRelative(latestUpdate)}</small>}</header>
        <div className="fire-map" aria-label={`Map showing ${visible.length} wildfire incidents`}>
          <Suspense fallback={<MapState icon={<RefreshCw className="spin"/>} title="Loading map" copy="Preparing the interactive operations map."/>}>
            <OperationsMap incidents={visible} vehicles={motiveVehicles} selected={selected} focusedVehicleId={focusedVehicleId} onSelect={setSelected} onVehicleSelect={onVehicleSelect} onReset={()=>{setSelected(null);setFocusedVehicleId(null)}}/>
          </Suspense>
          {loading&&<MapState icon={<RefreshCw className="spin"/>} title="Loading current fires" copy="Requesting active incident data from NIFC."/>}
          {!loading&&error&&<MapState icon={<Flame/>} title="NIFC data unavailable" copy={error} action={<button className="secondary" onClick={()=>setRequest(value=>value+1)}><RefreshCw/> Try again</button>}/>} 
          {!loading&&!error&&!visible.length&&<MapState icon={<MapPin/>} title="No active fires reported" copy="NIFC is not reporting any active wildfire incidents."/>}
        </div>
        <footer><span><i/> Active wildfire</span>{motiveVehicles.length?<span className="vehicle-legend"><i/> Motive fleet</span>:null}<a href={NIFC_ITEM} target="_blank" rel="noreferrer">Source: NIFC WFIGS</a></footer>
      </div>
      <aside className="fire-list-panel" aria-label="Fire search">
        <header><h2>Fire search</h2>{normalizedFireQuery&&<span>{searchResults.length}</span>}</header>
        <div className="operations-fire-search search"><Search/><input value={fireQuery} onChange={event=>setFireQuery(event.target.value)} placeholder="Search fires by name" aria-label="Search fires by name"/>{fireQuery&&<button type="button" onClick={()=>setFireQuery('')} aria-label="Clear fire search"><X/></button>}</div>
        {normalizedFireQuery?<div className="fire-list">{searchResults.length?searchResults.map((incident,index)=><FireRow key={`${incident.id}-${index}`} incident={incident} onSelect={()=>setSelected(incident)}/>):<div className="empty compact-empty"><Flame/><h3>No fires found</h3><p>No fire names match “{fireQuery.trim()}”.</p></div>}</div>:<div className="empty compact-empty"><Search/><h3>Search active fires</h3><p>Enter a fire name to find and open incident details.</p></div>}
        {motiveVehicles.length?<section className="motive-operations-section"><header><h2>Fleet locations</h2><span>{motiveVehicles.length}</span></header><div className="motive-vehicle-list">{motiveVehicles.map(vehicle=><button key={vehicle.id} type="button" className="motive-vehicle-row" onClick={()=>onVehicleSelect?.(vehicle.id)} disabled={!onVehicleSelect}><span><Truck/></span><span><b>{vehicle.unit}</b><small><MapPin/>{vehicle.motive?.location}</small><small><Gauge/>{vehicle.motive?.speed} · {vehicle.motive?.updatedAt}</small></span><ChevronRight/></button>)}</div></section>:null}
      </aside>
    </section>
    {selected&&createPortal(<IncidentDetail incident={selected} assignableVehicles={assignableVehicles} onAssignVehicle={onAssignVehicle} onClose={()=>setSelected(null)}/>,document.body)}
  </div>;
}

function FireRow({incident,onSelect}:{incident:NifcIncident;onSelect:()=>void}){
  return <button className="fire-row" onClick={onSelect}><span className="fire-row-mark"><Flame/></span><span className="fire-row-copy"><b>{incident.name}</b><small><MapPin/>{formatAcres(incident.acres)} acres</small></span><span className="fire-containment">{formatPercent(incident.contained)}<small>contained</small></span><ChevronRight/></button>;
}

function MapState({icon,title,copy,action}:{icon:React.ReactNode;title:string;copy:string;action?:React.ReactNode}){
  return <div className="fire-map-state"><span>{icon}</span><b>{title}</b><p>{copy}</p>{action}</div>;
}

function IncidentDetail({incident,assignableVehicles,onAssignVehicle,onClose}:{incident:NifcIncident;assignableVehicles:FireResourceVehicle[];onAssignVehicle?:(vehicleId:string,fire:{id:string;name:string;state:string})=>void;onClose:()=>void}){
  const dialog=useDialogA11y(onClose);
  const [vehicleId,setVehicleId]=useState('');
  const selectedVehicle=assignableVehicles.find(vehicle=>vehicle.id===vehicleId);
  const assign=()=>{if(!vehicleId||!onAssignVehicle)return;onAssignVehicle(vehicleId,{id:incident.id,name:incident.name,state:incident.state});setVehicleId('')};
  return <div className="overlay"><section ref={dialog.ref} className="drawer detail-drawer incident-drawer" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}>
    <header><button className="back-mobile" onClick={onClose} aria-label="Back to operations"><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>{incident.name}</h2><p>{incident.state?`${incident.state} wildfire`:'Wildfire incident'}</p></div><button className="close" onClick={onClose} aria-label="Close incident details"><X/></button></header>
    <div className="incident-summary"><span className="incident-flame"><Flame/></span><div><span>Active wildfire</span><h3>{incident.name}</h3><p><MapPin/>{incident.state?US_STATE_NAMES[incident.state]??incident.state:'Location not reported'}</p></div></div>
    <IncidentLocationMap incident={incident}/>
    <dl className="incident-metrics"><div><dt>Acres</dt><dd>{formatAcres(incident.acres)}</dd></div><div><dt>Contained</dt><dd>{formatPercent(incident.contained)}</dd></div><div><dt>Personnel</dt><dd>{formatNumber(incident.personnel)}</dd></div></dl>
    {assignableVehicles.length>0&&onAssignVehicle?<div className="detail-section"><h4>Assign to this fire</h4><div className="assign-vehicle-control"><select aria-label="Fleet vehicle" value={vehicleId} onChange={event=>setVehicleId(event.target.value)}><option value="">Select vehicle</option>{assignableVehicles.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.unit}{vehicle.assignedFire?` · currently ${vehicle.assignedFire.name}`:''}</option>)}</select><button className="add" disabled={!vehicleId||selectedVehicle?.assignedFire?.id===incident.id} onClick={assign}><Truck/> {selectedVehicle?.assignedFire?.id===incident.id?'Assigned':'Assign'}</button></div>{selectedVehicle&&selectedVehicle.assignedFire?.id!==incident.id&&<small className="assign-vehicle-preview">Assigns {selectedVehicle.assignedCrew?.name??'assigned crew'} and {selectedVehicle.unit} to {incident.name}.</small>}</div>:null}
    <div className="detail-section"><h4>Incident information</h4><dl className="details"><DetailLine icon={<CalendarDays/>} label="Discovered" value={formatDate(incident.discovered)}/><DetailLine icon={<RefreshCw/>} label="NIFC updated" value={formatDateTime(incident.updated)}/><DetailLine icon={<Users/>} label="Personnel" value={formatNumber(incident.personnel)}/></dl></div>
    <div className="incident-source"><p>Incident values come from NIFC WFIGS and may change as agencies update reports.</p><a href={NIFC_ITEM} target="_blank" rel="noreferrer">Open NIFC source</a></div>
  </section></div>;
}

function IncidentLocationMap({incident}:{incident:NifcIncident}){
  const point=projection([incident.longitude,incident.latitude]);
  if(!point)return null;
  const stateFeature=states.features.find(state=>state.properties?.name===US_STATE_NAMES[incident.state]);
  const mapViewBox=stateFeature?frameBounds(path.bounds(stateFeature)):frameBounds([[point[0]-40,point[1]-40],[point[0]+40,point[1]+40]]);
  const markerRadius=mapViewBox[2]/58;
  return <figure className="incident-location-map"><div><svg viewBox={mapViewBox.join(' ')} role="img" aria-label={`Reported location of ${incident.name} in ${US_STATE_NAMES[incident.state]??incident.state}`}><g className="us-states">{states.features.map((state,index)=><path key={String(state.id??index)} className={state===stateFeature?'location-state':''} d={path(state)??undefined}/>)}</g><circle className="location-pulse" cx={point[0]} cy={point[1]} r={markerRadius*2.2}/><circle className="location-marker" cx={point[0]} cy={point[1]} r={markerRadius}/></svg></div><figcaption><span><MapPin/>Reported fire location</span><small>{incident.latitude.toFixed(3)}, {incident.longitude.toFixed(3)}</small></figcaption></figure>;
}

function DetailLine({icon,label,value}:{icon:React.ReactNode;label:string;value:string}){return <div><dt>{icon}{label}</dt><dd>{value}</dd></div>}
function formatNumber(value:number|null){return value===null||!Number.isFinite(value)?'Not reported':Math.round(value).toLocaleString('en-US')}
function formatAcres(value:number|null){return value===null||!Number.isFinite(value)?'Not reported':value.toLocaleString('en-US',{maximumFractionDigits:value<10?1:0})}
function formatPercent(value:number|null){return value===null||!Number.isFinite(value)?'Not reported':`${Math.round(value)}%`}
function formatDate(value:number|null){return value?new Date(value).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):'Not reported'}
function formatDateTime(value:number|null){return value?new Date(value).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'Not reported'}
function formatRelative(value:number){const minutes=Math.max(0,Math.round((Date.now()-value)/60000));if(minutes<1)return'just now';if(minutes<60)return`${minutes}m ago`;const hours=Math.round(minutes/60);if(hours<24)return`${hours}h ago`;return new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
