import {useEffect,useMemo,useState} from 'react';
import {BedDouble,ExternalLink,MapPin,RefreshCw,Search} from 'lucide-react';
import {supabase} from './supabase';
import {createDemoFedRoomsData,fedRoomsAddressLines,fedRoomsMapsUrl,fedRoomsRegionFromValue,fedRoomsRegionLabel,fedRoomsRegionValue,fedRoomsResultLimit,fedRoomsSearchFilter,fedRoomsSearchTerm,fedRoomsSourceUrl,fedRoomsWebSearchUrl,sortFedRoomsRegions,type FedRoomsCity,type FedRoomsHotel,type FedRoomsRegion} from '@fireops/domain';

const message=(error:unknown)=>error instanceof Error?error.message:'Hotel data could not be loaded.';
const {hotels:demoHotels,regions:demoRegions}=createDemoFedRoomsData();

export default function HotelsPage({demoMode=false}:{demoMode?:boolean}){
  const [regions,setRegions]=useState<FedRoomsRegion[]>(demoMode?sortFedRoomsRegions(demoRegions):[]);
  const [cities,setCities]=useState<FedRoomsCity[]>([]);
  const [hotels,setHotels]=useState<FedRoomsHotel[]>([]);
  const [regionValue,setRegionValue]=useState('');
  const [city,setCity]=useState('');
  const [query,setQuery]=useState('');
  const [term,setTerm]=useState('');
  const [loading,setLoading]=useState(!demoMode);
  const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  const region=regionValue?fedRoomsRegionFromValue(regionValue):null;
  const ready=Boolean(region||term.length>=2);

  useEffect(()=>{const timer=setTimeout(()=>setTerm(fedRoomsSearchTerm(query)),300);return()=>clearTimeout(timer)},[query]);

  useEffect(()=>{
    let active=true;
    if(demoMode||!supabase){setLoading(false);return}
    setLoading(true);setError('');
    void (async()=>{try{
      const {data,error:failure}=await supabase.from('fedrooms_hotel_regions').select('country,state,hotel_count,last_seen_at');
      if(!active)return;if(failure)throw failure;setRegions(sortFedRoomsRegions((data??[]) as FedRoomsRegion[]));
    }catch(failure){if(active)setError(message(failure))}finally{if(active)setLoading(false)}})();
    return()=>{active=false};
  },[demoMode,refresh]);

  useEffect(()=>{
    let active=true;setCities([]);setCity('');
    if(!region)return()=>{active=false};
    if(demoMode){setCities([...new Set(demoHotels.filter(hotel=>hotel.state===region.state).map(hotel=>hotel.city!))].sort().map(name=>({city:name,hotel_count:demoHotels.filter(hotel=>hotel.city===name).length})));return()=>{active=false}}
    if(!supabase)return()=>{active=false};
    void (async()=>{try{
      let request=supabase.from('fedrooms_hotel_cities').select('city,hotel_count').eq('country',region.country);
      request=region.state?request.eq('state',region.state):request.is('state',null);
      const {data,error:failure}=await request.order('city');
      if(!active)return;if(failure)throw failure;setCities((data??[]) as FedRoomsCity[]);
    }catch(failure){if(active)setError(message(failure))}})();
    return()=>{active=false};
  },[regionValue,demoMode,refresh]);

  useEffect(()=>{
    let active=true;setHotels([]);
    if(!ready)return()=>{active=false};
    if(demoMode){
      const needle=term.toLowerCase();
      setHotels(demoHotels.filter(hotel=>(!region||hotel.state===region.state)&&(!city||hotel.city===city)&&(!needle||[hotel.name,hotel.city,hotel.address].some(value=>value?.toLowerCase().includes(needle)))));
      return()=>{active=false};
    }
    if(!supabase)return()=>{active=false};
    setLoading(true);setError('');
    void (async()=>{try{
      let request=supabase.from('fedrooms_hotels').select('property_key,name,address,city,state,postal_code,country');
      if(region){request=request.eq('country',region.country);request=region.state?request.eq('state',region.state):request.is('state',null)}
      if(city)request=request.eq('city',city);
      if(term)request=request.or(fedRoomsSearchFilter(term));
      const {data,error:failure}=await request.order('name').limit(fedRoomsResultLimit+1);
      if(!active)return;if(failure)throw failure;setHotels((data??[]) as FedRoomsHotel[]);
    }catch(failure){if(active)setError(message(failure))}finally{if(active)setLoading(false)}})();
    return()=>{active=false};
  },[regionValue,city,term,demoMode,refresh]);

  const total=useMemo(()=>regions.reduce((sum,item)=>sum+item.hotel_count,0),[regions]);
  const updated=useMemo(()=>regions.reduce<string|null>((latest,item)=>item.last_seen_at&&(!latest||item.last_seen_at>latest)?item.last_seen_at:latest,null),[regions]);
  const shown=hotels.slice(0,fedRoomsResultLimit);

  return <div className="page dispatch-page hotels-page">
    <div className="page-heading"><div><h1>Hotels</h1><p>GSA FedRooms properties. Book through your travel system or the hotel directly.</p></div><button className="secondary dispatch-refresh" onClick={()=>setRefresh(value=>value+1)} disabled={loading||demoMode}><RefreshCw className={loading?'spin':''}/>Refresh</button></div>
    <section className="dispatch-filters" aria-label="Hotel filters">
      <label><span>Search</span><div className="hotels-search"><Search/><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Hotel, city, or address"/></div></label>
      <label><span>State or country</span><select value={regionValue} onChange={event=>setRegionValue(event.target.value)} disabled={!regions.length}><option value="">All</option>{regions.map(item=><option key={fedRoomsRegionValue(item)} value={fedRoomsRegionValue(item)}>{fedRoomsRegionLabel(item)} ({item.hotel_count})</option>)}</select></label>
      <label><span>City</span><select value={city} onChange={event=>setCity(event.target.value)} disabled={!cities.length}><option value="">All</option>{cities.map(item=><option key={item.city} value={item.city}>{item.city} ({item.hotel_count})</option>)}</select></label>
    </section>
    {error?<div className="dispatch-state error" role="alert"><b>Hotel data unavailable</b><span>{error}</span></div>:null}
    {!error&&!supabase&&!demoMode?<div className="dispatch-state"><b>Hotel data unavailable</b><span>Connect FireOps to Supabase to browse imported hotels.</span></div>:null}
    {!error&&(supabase||demoMode)&&!ready?<div className="dispatch-state"><b>{regions.length||loading?'Find a FedRooms hotel':'No hotels imported yet'}</b><span>{regions.length||loading?`Choose a state or country, or search by name. ${total?`${total.toLocaleString()} properties available.`:''}`:'Check again after the scheduled GSA import.'}</span></div>:null}
    {ready&&!error?<section className="dispatch-results" aria-busy={loading}>
      <header><div><h2>{city||(region?fedRoomsRegionLabel({...region,hotel_count:0}):'Search results')}</h2><p>{hotels.length>fedRoomsResultLimit?`First ${fedRoomsResultLimit} matches. Narrow your search to see more.`:`${hotels.length} ${hotels.length===1?'property':'properties'}`}</p></div>{demoMode?<span className="dispatch-warning">Demo data</span>:null}</header>
      <ul className="hotels-list">{shown.map(hotel=><li key={hotel.property_key}>
        <div><b>{hotel.name}</b>{fedRoomsAddressLines(hotel).map(line=><span key={line}>{line}</span>)}</div>
        <div className="hotels-actions"><a className="secondary compact" href={fedRoomsMapsUrl(hotel)} target="_blank" rel="noreferrer"><MapPin/>Map</a><a className="secondary compact" href={fedRoomsWebSearchUrl(hotel)} target="_blank" rel="noreferrer"><ExternalLink/>Search web</a></div>
      </li>)}</ul>
      {!hotels.length&&!loading?<div className="dispatch-empty"><BedDouble/><b>No hotels match</b></div>:null}
      <footer>{demoMode?'Fictional sample records for product demonstration. ':<>Source: GSA FedRooms accepted properties{updated?`, updated ${new Date(updated).toLocaleDateString()}`:''}. </>}<a href={fedRoomsSourceUrl} target="_blank" rel="noreferrer">Verify official source</a>. Rates and availability are not shown. FireOps is not affiliated with or endorsed by GSA.</footer>
    </section>:null}
  </div>;
}
