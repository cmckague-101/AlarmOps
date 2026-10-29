// GSA FedRooms accepted properties, imported daily by jobs/fedrooms-hotels.
export type FedRoomsHotel={property_key:string;name:string;address:string|null;city:string|null;state:string|null;postal_code:string|null;country:string};
export type FedRoomsRegion={country:string;state:string|null;hotel_count:number;last_seen_at?:string|null};
export type FedRoomsCity={city:string;hotel_count:number};

export const fedRoomsSourceUrl='https://www.gsa.gov/travel/hotels-fedrooms';
export const fedRoomsResultLimit=200;
export const fedRoomsUnitedStates='United States';

// US states first (by name), then other countries. Value round-trips through regionFromValue.
export function sortFedRoomsRegions(regions:FedRoomsRegion[]){
  const label=(region:FedRoomsRegion)=>region.country===fedRoomsUnitedStates?region.state??fedRoomsUnitedStates:region.country;
  return [...regions].sort((a,b)=>Number(a.country!==fedRoomsUnitedStates)-Number(b.country!==fedRoomsUnitedStates)||label(a).localeCompare(label(b)));
}
export const fedRoomsRegionLabel=(region:FedRoomsRegion)=>region.country===fedRoomsUnitedStates?region.state??'United States (no state)':region.state?`${region.state}, ${region.country}`:region.country;
export const fedRoomsRegionValue=(region:Pick<FedRoomsRegion,'country'|'state'>)=>JSON.stringify([region.country,region.state]);
export function fedRoomsRegionFromValue(value:string):Pick<FedRoomsRegion,'country'|'state'>|null{
  try{const [country,state]=JSON.parse(value) as [string,string|null];return typeof country==='string'?{country,state:state??null}:null}catch{return null}
}

// Characters that break PostgREST or()/ilike filter syntax are dropped.
export const fedRoomsSearchTerm=(value:string)=>value.replace(/[,()*%\\:."]/g,' ').replace(/\s+/g,' ').trim();
export const fedRoomsSearchFilter=(term:string)=>`name.ilike.*${term}*,city.ilike.*${term}*,address.ilike.*${term}*`;

export const fedRoomsAddressLines=(hotel:FedRoomsHotel)=>[
  hotel.address,
  [hotel.city,[hotel.state,hotel.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  hotel.country===fedRoomsUnitedStates?null:hotel.country,
].filter((line):line is string=>Boolean(line));

const query=(hotel:FedRoomsHotel,parts:(string|null)[])=>encodeURIComponent([hotel.name,...parts].filter(Boolean).join(', '));
export const fedRoomsMapsUrl=(hotel:FedRoomsHotel,provider:'google'|'apple'='google')=>{
  const q=query(hotel,[hotel.address,hotel.city,hotel.state,hotel.postal_code,hotel.country]);
  return provider==='apple'?`https://maps.apple.com/?q=${q}`:`https://www.google.com/maps/search/?api=1&query=${q}`;
};
export const fedRoomsWebSearchUrl=(hotel:FedRoomsHotel)=>`https://www.google.com/search?q=${query(hotel,[hotel.city,hotel.state??hotel.country])}`;

export function createDemoFedRoomsData(){
  const hotels:FedRoomsHotel[]=[
    {property_key:'demo-1',name:'Courtyard Redding',address:'2900 Bechelli Ln',city:'Redding',state:'California',postal_code:'96002',country:fedRoomsUnitedStates},
    {property_key:'demo-2',name:'Hampton Inn & Suites Redding',address:'2160 Larkspur Ln',city:'Redding',state:'California',postal_code:'96002',country:fedRoomsUnitedStates},
    {property_key:'demo-3',name:'Residence Inn Medford',address:'1501 Delta Waters Rd',city:'Medford',state:'Oregon',postal_code:'97504',country:fedRoomsUnitedStates},
    {property_key:'demo-4',name:'Hilton Garden Inn Boise Downtown',address:'348 S 13th St',city:'Boise',state:'Idaho',postal_code:'83702',country:fedRoomsUnitedStates},
  ];
  const regions:FedRoomsRegion[]=[...new Set(hotels.map(hotel=>hotel.state))].map(state=>({country:fedRoomsUnitedStates,state,hotel_count:hotels.filter(hotel=>hotel.state===state).length}));
  return {hotels,regions};
}
