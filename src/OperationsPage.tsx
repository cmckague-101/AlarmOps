import {useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {geoAlbersUsa, geoPath} from 'd3-geo';
import type {FeatureCollection} from 'geojson';
import {feature} from 'topojson-client';
import type {Topology} from 'topojson-specification';
import statesTopology from 'us-atlas/states-10m.json';
import {ArrowDownAZ, ArrowLeft, CalendarDays, ChevronRight, CircleUserRound, Flame, Gauge, MapPin, Plus, RefreshCw, Truck, Users, X} from 'lucide-react';
import {useDialogA11y} from './useDialogA11y';

const NIFC_QUERY='https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query';
const NIFC_ITEM='https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-incident-locations-current/about';
const OUT_FIELDS='OBJECTID,UniqueFireIdentifier,IncidentName,IncidentSize,PercentContained,TotalIncidentPersonnel,POOState,FireDiscoveryDateTime,ModifiedOnDateTime_dt,InitialLatitude,InitialLongitude';
const US_STATE_NAMES:Record<string,string>={
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia'
};

export type NifcIncident={
  id:string;
  name:string;
  acres:number|null;
  contained:number|null;
  personnel:number|null;
  state:string;
  discovered:number|null;
  updated:number|null;
  latitude:number;
  longitude:number;
};

export type FireResourceVehicle={
  id:string;unit:string;type:string;year:number;make:string;model:string;plate?:string;
  assignedFire?:{id:string;name:string;state:string};
  assignedCrew?:{id:string;name:string};
  motive?:{location:string;speed:string;updatedAt:string};
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
  const incidents:NifcIncident[]=[];
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
    const pageItems=(body.features??[]).map(parseIncident).filter((item):item is NifcIncident=>Boolean(item));
    incidents.push(...pageItems);
    if(!body.exceededTransferLimit||!pageItems.length)break;
    offset+=pageItems.length;
  }
  return incidents;
}

const states=feature(statesTopology as unknown as Topology,'states') as unknown as FeatureCollection;
const projection=geoAlbersUsa().fitExtent([[20,20],[880,540]],states);
const path=geoPath(projection);
const MAP_FRAME=[0,0,900,560] as const;

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

function useAnimatedViewBox(target:number[]){
  const [current,setCurrent]=useState<number[]>([...MAP_FRAME]);
  const currentRef=useRef(current);
  currentRef.current=current;
  const targetKey=target.join(',');
  useEffect(()=>{
    const destination=targetKey.split(',').map(Number);
    const start=[...currentRef.current];
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){setCurrent(destination);return}
    let frame=0;
    const started=performance.now();
    const animate=(now:number)=>{
      const progress=Math.min(1,(now-started)/320);
      const eased=1-Math.pow(1-progress,3);
      setCurrent(start.map((value,index)=>value+(destination[index]-value)*eased));
      if(progress<1)frame=requestAnimationFrame(animate);
    };
    frame=requestAnimationFrame(animate);
    return()=>cancelAnimationFrame(frame);
  },[targetKey]);
  return current;
}

export default function OperationsPage({assignedIncidentIds=[],resources=[],motiveEnabled=false,assignableVehicles=[],onAssignVehicle,onVehicleSelect}:{assignedIncidentIds?:string[];resources?:FireResourceVehicle[];motiveEnabled?:boolean;assignableVehicles?:FireResourceVehicle[];onAssignVehicle?:(vehicleId:string,fire:{id:string;name:string;state:string})=>void;onVehicleSelect?:(vehicleId:string)=>void}){
  const [incidents,setIncidents]=useState<NifcIncident[]>([]);
  const [showAll,setShowAll]=useState(false);
  const [selectedState,setSelectedState]=useState('');
  const [stateSort,setStateSort]=useState<'count'|'name'>('count');
  const [selected,setSelected]=useState<NifcIncident|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [request,setRequest]=useState(0);
  const mapRef=useRef<HTMLDivElement|null>(null);
  const [hovered,setHovered]=useState<NifcIncident|null>(null);
  const [tip,setTip]=useState<{x:number;y:number;flipX:boolean;flipY:boolean}|null>(null);
  const assignedSet=useMemo(()=>new Set(assignedIncidentIds),[assignedIncidentIds]);

  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');
    void fetchIncidents(controller.signal).then(data=>{setIncidents(data);setLoading(false)}).catch(fetchError=>{
      if(fetchError instanceof DOMException&&fetchError.name==='AbortError')return;
      setError('Current NIFC fire data could not be loaded. Check connection and try again.');setLoading(false);
    });
    return()=>controller.abort();
  },[request]);

  const scopedIncidents=showAll?incidents:incidents.filter(incident=>assignedSet.has(incident.id));
  const visible=showAll&&selectedState?scopedIncidents.filter(incident=>incident.state===selectedState):scopedIncidents;
  const sortedVisible=[...visible].sort((a,b)=>(b.acres??-1)-(a.acres??-1)||a.name.localeCompare(b.name));
  const statesByCount=useMemo(()=>{
    const counts=new Map<string,number>();
    incidents.forEach(incident=>{if(US_STATE_NAMES[incident.state])counts.set(incident.state,(counts.get(incident.state)??0)+1)});
    return [...counts].map(([code,count])=>({code,name:US_STATE_NAMES[code],count})).sort((a,b)=>stateSort==='name'?a.name.localeCompare(b.name):b.count-a.count||a.name.localeCompare(b.name));
  },[incidents,stateSort]);
  const targetViewBox=useMemo(()=>{
    if(selected){
      const point=projection([selected.longitude,selected.latitude]);
      if(point)return frameBounds([[point[0]-25,point[1]-25],[point[0]+25,point[1]+25]]);
    }
    if(selectedState){
      const stateFeature=states.features.find(state=>state.properties?.name===US_STATE_NAMES[selectedState]);
      if(stateFeature)return frameBounds(path.bounds(stateFeature));
    }
    return [...MAP_FRAME];
  },[selected,selectedState]);
  const viewBox=useAnimatedViewBox(targetViewBox);
  const markerScale=viewBox[2]/MAP_FRAME[2];
  const latestUpdate=incidents.reduce<number|null>((latest,incident)=>incident.updated&&(!latest||incident.updated>latest)?incident.updated:latest,null);
  const incidentResources=(incidentId:string)=>resources.filter(resource=>resource.assignedFire?.id===incidentId);
  const assignableForIncident=(incidentId:string)=>assignableVehicles.filter(vehicle=>vehicle.assignedFire?.id!==incidentId);
  const openVehicle=(vehicleId:string)=>{setSelected(null);onVehicleSelect?.(vehicleId)};
  const showFireTip=(incident:NifcIncident)=>{
    const map=mapRef.current;
    const svg=map?.querySelector('svg');
    if(!map||!svg)return;
    const point=projection([incident.longitude,incident.latitude]);
    const ctm=(svg as SVGSVGElement).getScreenCTM();
    if(!point||!ctm)return;
    const rect=map.getBoundingClientRect();
    const client=new DOMPoint(point[0],point[1]).matrixTransform(ctm);
    const x=client.x-rect.left;
    const y=client.y-rect.top;
    setHovered(incident);
    setTip({x,y,flipX:x>rect.width-210,flipY:y<74});
  };
  const hideFireTip=()=>{setHovered(null);setTip(null)};

  return <div className="page operations-page">
    <div className="page-heading operations-heading"><div><h1>Operations</h1><p>Active wildfire incidents reported by NIFC.</p></div><label className="fire-scope-toggle"><span>Show all fires</span><input type="checkbox" checked={showAll} onChange={event=>{setShowAll(event.target.checked);setSelectedState('');setSelected(null)}}/><i aria-hidden="true"/></label></div>
    <section className="operations-workspace" aria-label="Wildfire operations map and incident list">
      <div className="fire-map-panel">
        <header><div><b>{showAll?(selectedState?`${US_STATE_NAMES[selectedState]} fires`:'All active fires'):'Assigned fires'}</b><span>{loading?'Updating NIFC data':`${visible.length} ${visible.length===1?'incident':'incidents'}`}</span></div>{latestUpdate&&<small>Updated {formatRelative(latestUpdate)}</small>}</header>
        <div className="fire-map" ref={mapRef} onMouseLeave={hideFireTip} aria-label={`Map showing ${visible.length} wildfire incidents`}>
          <svg viewBox={viewBox.join(' ')} role="img" aria-labelledby="fire-map-title fire-map-desc">
            <title id="fire-map-title">United States active wildfire map</title>
            <desc id="fire-map-desc">Select a fire marker to open incident details.</desc>
            <g className="us-states">{states.features.map((state,index)=><path key={String(state.id??index)} d={path(state)??undefined}/>)}</g>
            <g className="fire-markers">{visible.map(incident=>{
              const point=projection([incident.longitude,incident.latitude]);
              if(!point)return null;
              const active=selected?.id===incident.id;
              const radius=Math.max(5,Math.min(11,5+Math.log10(Math.max(1,incident.acres??1))*1.5))*markerScale;
              const select=()=>setSelected(incident);
              return <g key={incident.id} className={active?'active':''} role="button" tabIndex={0} aria-label={`${incident.name}, ${formatAcres(incident.acres)} acres`} onClick={select} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select()}}} onMouseEnter={()=>showFireTip(incident)} onFocus={()=>showFireTip(incident)} onBlur={hideFireTip}>
                <circle className="fire-marker-hit" cx={point[0]} cy={point[1]} r={Math.max(14*markerScale,radius+5*markerScale)}/><circle className="fire-marker" cx={point[0]} cy={point[1]} r={radius}/>
              </g>;
            })}</g>
          </svg>
          {hovered&&tip&&<div className={`fire-tooltip${tip.flipX?' flip-x':''}${tip.flipY?' flip-y':''}`} style={{left:tip.x,top:tip.y}} role="tooltip"><b>{hovered.name}</b><dl><div><dt>Acres</dt><dd>{formatAcres(hovered.acres)}</dd></div><div><dt>Contained</dt><dd>{formatPercent(hovered.contained)}</dd></div><div><dt>Personnel</dt><dd>{formatNumber(hovered.personnel)}</dd></div></dl></div>}
          {loading&&<MapState icon={<RefreshCw className="spin"/>} title="Loading current fires" copy="Requesting active incident data from NIFC."/>}
          {!loading&&error&&<MapState icon={<Flame/>} title="NIFC data unavailable" copy={error} action={<button className="secondary" onClick={()=>setRequest(value=>value+1)}><RefreshCw/> Try again</button>}/>} 
          {!loading&&!error&&!visible.length&&<MapState icon={<MapPin/>} title={showAll?'No active fires reported':'No fires assigned yet'} copy={showAll?'NIFC is not reporting any active wildfire incidents.':'Assign a vehicle to an active fire from vehicle details. Use Show all fires to review current incidents.'}/>}
        </div>
        <footer><span><i/> Active wildfire</span><a href={NIFC_ITEM} target="_blank" rel="noreferrer">Source: NIFC WFIGS</a></footer>
      </div>
      <aside className="fire-list-panel" aria-label={showAll?'State fire counts':'Assigned incident list'}>
        {showAll?(selectedState?<><header className="selected-state-heading"><div><button type="button" onClick={()=>{setSelectedState('');setSelected(null)}}><ArrowLeft/> States</button><h2>{US_STATE_NAMES[selectedState]} fires</h2></div><span>{visible.length}</span></header><div className="fire-list">{sortedVisible.map(incident=><FireRow key={incident.id} incident={incident} onSelect={()=>setSelected(incident)}/>)}</div></>:<><header className="state-list-heading"><h2>States</h2><button className={stateSort==='name'?'active':''} type="button" aria-pressed={stateSort==='name'} onClick={()=>setStateSort(sort=>sort==='count'?'name':'count')} title={stateSort==='name'?'Sort by fire count':'Sort states A to Z'}><ArrowDownAZ/> A–Z</button></header><div className="fire-list state-list"><button className="state-row" onClick={()=>{setSelectedState('');setSelected(null)}}><span>All states</span><b>{incidents.length}</b><ChevronRight/></button>{statesByCount.map(state=><button key={state.code} className="state-row" onClick={()=>{setSelectedState(state.code);setSelected(null)}}><span><b>{state.name}</b><small>{state.code}</small></span><strong aria-label={`${state.count} ${state.count===1?'fire':'fires'}`}>{state.count}</strong><ChevronRight/></button>)}</div></>):<><header><h2>Assigned fires</h2><span>{visible.length}</span></header><div className="fire-list assigned-fire-list">{sortedVisible.map(incident=><AssignedFireGroup key={incident.id} incident={incident} resources={incidentResources(incident.id)} motiveEnabled={motiveEnabled} onSelect={()=>setSelected(incident)} onVehicleSelect={onVehicleSelect?openVehicle:undefined}/>)}</div></>}
      </aside>
    </section>
    {selected&&createPortal(<IncidentDetail incident={selected} resources={incidentResources(selected.id)} assignable={assignableForIncident(selected.id)} motiveEnabled={motiveEnabled} onAssignVehicle={onAssignVehicle?((vehicleId)=>onAssignVehicle(vehicleId,{id:selected.id,name:selected.name,state:selected.state})):undefined} onVehicleSelect={onVehicleSelect?openVehicle:undefined} onClose={()=>setSelected(null)}/>,document.body)}
  </div>;
}

function AssignedFireGroup({incident,resources,motiveEnabled,onSelect,onVehicleSelect}:{incident:NifcIncident;resources:FireResourceVehicle[];motiveEnabled:boolean;onSelect:()=>void;onVehicleSelect?:(vehicleId:string)=>void}){
  return <section className="assigned-fire-group" aria-label={`${incident.name} assigned resources`}><FireRow incident={incident} onSelect={onSelect}/><div className="assigned-resource-ledger"><div className="resource-ledger-heading"><span>{resources.length} assigned {resources.length===1?'vehicle':'vehicles'}</span></div>{resources.map(resource=><ResourceVehicleRow key={resource.id} resource={resource} motiveEnabled={motiveEnabled} onSelect={onVehicleSelect?()=>onVehicleSelect(resource.id):undefined}/>)}</div></section>;
}

function ResourceVehicleRow({resource,motiveEnabled,onSelect}:{resource:FireResourceVehicle;motiveEnabled:boolean;onSelect?:()=>void}){
  const content=<><span className="resource-vehicle-icon"><Truck/></span><span className="resource-vehicle-copy"><b>{resource.unit}</b><small>{resource.type} · {resource.year} {resource.make} {resource.model}{resource.plate?` · ${resource.plate}`:''}</small>{resource.assignedCrew&&<small><CircleUserRound/> {resource.assignedCrew.name}</small>}{motiveEnabled&&(resource.motive?<small className="resource-location"><i>Motive</i><MapPin/> {resource.motive.location}<span><Gauge/> {resource.motive.speed}</span><em>{resource.motive.updatedAt}</em></small>:<small className="resource-location unavailable"><MapPin/> Motive location unavailable</small>)}</span>{onSelect&&<ChevronRight/>}</>;
  return onSelect?<button type="button" className="resource-vehicle-row" onClick={onSelect}>{content}</button>:<div className="resource-vehicle-row">{content}</div>;
}

function FireRow({incident,onSelect}:{incident:NifcIncident;onSelect:()=>void}){
  return <button className="fire-row" onClick={onSelect}><span className="fire-row-mark"><Flame/></span><span className="fire-row-copy"><b>{incident.name}</b><small><MapPin/>{formatAcres(incident.acres)} acres</small></span><span className="fire-containment">{formatPercent(incident.contained)}<small>contained</small></span><ChevronRight/></button>;
}

function MapState({icon,title,copy,action}:{icon:React.ReactNode;title:string;copy:string;action?:React.ReactNode}){
  return <div className="fire-map-state"><span>{icon}</span><b>{title}</b><p>{copy}</p>{action}</div>;
}

function IncidentDetail({incident,resources,assignable,motiveEnabled,onVehicleSelect,onAssignVehicle,onClose}:{incident:NifcIncident;resources:FireResourceVehicle[];assignable:FireResourceVehicle[];motiveEnabled:boolean;onVehicleSelect?:(vehicleId:string)=>void;onAssignVehicle?:(vehicleId:string)=>void;onClose:()=>void}){
  const dialog=useDialogA11y(onClose);
  return <div className="overlay"><section ref={dialog.ref} className="drawer detail-drawer incident-drawer" role="dialog" aria-modal="true" aria-labelledby={dialog.titleId} tabIndex={-1}>
    <header><button className="back-mobile" onClick={onClose} aria-label="Back to operations"><ArrowLeft/><span>Back</span></button><div><h2 id={dialog.titleId}>{incident.name}</h2><p>{incident.state?`${incident.state} wildfire`:'Wildfire incident'}</p></div><button className="close" onClick={onClose} aria-label="Close incident details"><X/></button></header>
    <div className="incident-summary"><span className="incident-flame"><Flame/></span><div><span>Active wildfire</span><h3>{incident.name}</h3><p><MapPin/>{incident.state?US_STATE_NAMES[incident.state]??incident.state:'Location not reported'}</p></div></div>
    <IncidentLocationMap incident={incident}/>
    <dl className="incident-metrics"><div><dt>Acres</dt><dd>{formatAcres(incident.acres)}</dd></div><div><dt>Contained</dt><dd>{formatPercent(incident.contained)}</dd></div><div><dt>Personnel</dt><dd>{formatNumber(incident.personnel)}</dd></div></dl>
    <AssignedResources resources={resources} assignable={assignable} motiveEnabled={motiveEnabled} onAssignVehicle={onAssignVehicle} onVehicleSelect={onVehicleSelect}/>
    <div className="detail-section"><h4>Incident information</h4><dl className="details"><DetailLine icon={<CalendarDays/>} label="Discovered" value={formatDate(incident.discovered)}/><DetailLine icon={<RefreshCw/>} label="NIFC updated" value={formatDateTime(incident.updated)}/><DetailLine icon={<Users/>} label="Personnel" value={formatNumber(incident.personnel)}/></dl></div>
    <div className="incident-source"><p>Incident values come from NIFC WFIGS and may change as agencies update reports.</p><a href={NIFC_ITEM} target="_blank" rel="noreferrer">Open NIFC source</a></div>
  </section></div>;
}

function AssignedResources({resources,assignable,motiveEnabled,onAssignVehicle,onVehicleSelect}:{resources:FireResourceVehicle[];assignable:FireResourceVehicle[];motiveEnabled:boolean;onAssignVehicle?:(vehicleId:string)=>void;onVehicleSelect?:(vehicleId:string)=>void}){
  const crew=[...new Map(resources.flatMap(resource=>resource.assignedCrew?[resource.assignedCrew]:[]).map(member=>[member.id,member])).values()];
  return <div className="detail-section incident-resources"><div className="incident-resource-heading"><h4>Assigned resources</h4><span>{resources.length} {resources.length===1?'vehicle':'vehicles'} · {crew.length} crew</span></div>{resources.length?<><div className="incident-vehicle-list">{resources.map(resource=><ResourceVehicleRow key={resource.id} resource={resource} motiveEnabled={motiveEnabled} onSelect={onVehicleSelect?()=>onVehicleSelect(resource.id):undefined}/>)}</div>{crew.length>0&&<div className="incident-crew"><b>Crew on incident</b><div>{crew.map(member=><span key={member.id}><CircleUserRound/>{member.name}</span>)}</div></div>}</>:<p className="no-updates">No company vehicles or crew assigned.</p>}{onAssignVehicle&&(assignable.length>0)&&<div className="assign-vehicle-section"><div className="incident-resource-heading"><h4>Assign a vehicle</h4><span>{assignable.length} available</span></div><div className="incident-vehicle-list assign-vehicle-list">{assignable.map(vehicle=><button type="button" className="resource-vehicle-row assign-vehicle-row" key={vehicle.id} onClick={()=>onAssignVehicle(vehicle.id)}><span className="resource-vehicle-icon"><Plus/></span><span className="resource-vehicle-copy"><b>{vehicle.unit}</b><small>{vehicle.type} · {vehicle.year} {vehicle.make} {vehicle.model}</small>{vehicle.assignedCrew&&<small><CircleUserRound/> {vehicle.assignedCrew.name}</small>}<small className={vehicle.assignedFire?'assign-current-fire':''}>{vehicle.assignedFire?<><Flame/> Currently on {vehicle.assignedFire.name}</>:<>Ready to assign</>}</small></span><Plus/></button>)}</div></div>}</div>;
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
