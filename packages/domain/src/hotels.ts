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
export const fedRoomsRestaurantsUrl=(hotel:FedRoomsHotel,provider:'google'|'apple'='google')=>{
  const q=encodeURIComponent(`restaurants near ${[hotel.address,hotel.city,hotel.state,hotel.postal_code,hotel.country].filter(Boolean).join(', ')}`);
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

// "Near me": reverse-geocoded place -> the same city/state filters a user would pick.
export type FedRoomsPlace={city:string|null;state:string|null;country:string|null;countryCode?:string|null};
const usStates:Record<string,string>={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',PR:'Puerto Rico',GU:'Guam',VI:'U.S. Virgin Islands'};
const same=(a:string|null|undefined,b:string|null|undefined)=>Boolean(a&&b&&a.trim().localeCompare(b.trim(),undefined,{sensitivity:'base'})===0);
// iOS geocoding returns state abbreviations ("CA"); GSA and Android use full names.
export const fedRoomsStateName=(value:string|null|undefined)=>value?usStates[value.trim().toUpperCase()]??value.trim():null;
const isUnitedStates=(place:FedRoomsPlace)=>place.countryCode?.toUpperCase()==='US'||/^(united states( of america)?|usa?)$/i.test(place.country?.trim()??'');

export function matchFedRoomsRegion(regions:FedRoomsRegion[],place:FedRoomsPlace){
  if(isUnitedStates(place)){const state=fedRoomsStateName(place.state);return regions.find(region=>region.country===fedRoomsUnitedStates&&same(region.state,state))??null}
  return regions.find(region=>same(region.country,place.country))??null;
}
export const matchFedRoomsCity=(cities:FedRoomsCity[],city:string|null|undefined)=>cities.find(item=>same(item.city,city))?.city??null;
export const fedRoomsPlaceLabel=(place:FedRoomsPlace)=>[place.city,isUnitedStates(place)?fedRoomsStateName(place.state):place.country].filter(Boolean).join(', ')||'your location';

// Browser reverse geocoding (no API key; CORS-enabled client endpoint).
export const fedRoomsReverseGeocodeUrl=(latitude:number,longitude:number)=>`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;
export const fedRoomsPlaceFromReverseGeocode=(data:{city?:string;locality?:string;principalSubdivision?:string;countryName?:string;countryCode?:string}):FedRoomsPlace=>({city:data.city||data.locality||null,state:data.principalSubdivision||null,country:data.countryName||null,countryCode:data.countryCode||null});
