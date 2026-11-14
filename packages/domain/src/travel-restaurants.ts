/**
 * Travel → Restaurants: search for places to eat near a city or address.
 * Live search uses OpenStreetMap (Nominatim to look up the place, Overpass for nearby food spots); no API key.
 * Demo mode uses the fictional list below, placed in the same cities as the demo FedRooms hotels.
 */

export type TravelRestaurant={
  id:string;
  name:string;
  cuisine?:string;
  address?:string;
  city?:string;
  amenity?:string;
  lat:number;
  lon:number;
};

export type TravelPlace={lat:number;lon:number;label:string};

export const restaurantResultLimit=12;
export const restaurantSearchRadiusMeters=2500;
const overpassUrl='https://overpass-api.de/api/interpreter';
const nominatimSearchUrl='https://nominatim.openstreetmap.org/search';

export const demoRestaurants:readonly TravelRestaurant[]=[
  {id:'demo-r1',name:'Trailhead Kitchen',cuisine:'American',address:'1620 Hilltop Dr, Redding, CA',city:'Redding',amenity:'restaurant',lat:40.5835,lon:-122.3601},
  {id:'demo-r2',name:'Smoke Shift BBQ',cuisine:'BBQ',address:'2775 Bechelli Ln, Redding, CA',city:'Redding',amenity:'restaurant',lat:40.5627,lon:-122.3613},
  {id:'demo-r3',name:'Base Camp Coffee',cuisine:'Coffee',address:'1450 Market St, Redding, CA',city:'Redding',amenity:'cafe',lat:40.5862,lon:-122.3917},
  {id:'demo-r4',name:'High Desert Tacos',cuisine:'Mexican',address:'2130 Larkspur Ln, Redding, CA',city:'Redding',amenity:'fast_food',lat:40.5871,lon:-122.3570},
  {id:'demo-r5',name:'Rogue Valley Grill',cuisine:'American',address:'1480 Delta Waters Rd, Medford, OR',city:'Medford',amenity:'restaurant',lat:42.3530,lon:-122.8540},
  {id:'demo-r6',name:'Table Rock Noodles',cuisine:'Asian',address:'215 E Main St, Medford, OR',city:'Medford',amenity:'restaurant',lat:42.3266,lon:-122.8718},
  {id:'demo-r7',name:'River Bend Cafe',cuisine:'Cafe',address:'402 S 13th St, Boise, ID',city:'Boise',amenity:'cafe',lat:43.6135,lon:-116.2080},
  {id:'demo-r8',name:'Capitol Pizza Co.',cuisine:'Pizza',address:'88 Capitol Blvd, Boise, ID',city:'Boise',amenity:'restaurant',lat:43.6150,lon:-116.2023},
];

const amenityLabel=(amenity?:string)=>amenity==='cafe'?'Cafe':amenity==='fast_food'?'Fast food':amenity==='bar'?'Bar':'Restaurant';

/** "Restaurant · BBQ" style label. */
export const restaurantKind=(item:TravelRestaurant)=>[amenityLabel(item.amenity),item.cuisine].filter(Boolean).join(' · ');

export const restaurantMapsUrl=(item:TravelRestaurant)=>{
  const query=item.address?`${item.name}, ${item.address}`:`${item.lat},${item.lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
};

/**
 * Demo search. A query that names a demo city (for example a hotel address "2900 Bechelli Ln, Redding, California")
 * returns that city's places; otherwise it matches name, cuisine, or address text. Empty shows everything.
 */
export function filterDemoRestaurants(query:string,limit=restaurantResultLimit):TravelRestaurant[]{
  const term=query.trim().toLowerCase();
  if(!term)return demoRestaurants.slice(0,limit);
  const byCity=demoRestaurants.filter(item=>item.city&&term.includes(item.city.toLowerCase()));
  if(byCity.length)return byCity.slice(0,limit);
  return demoRestaurants.filter(item=>[item.name,item.cuisine,item.address,amenityLabel(item.amenity)].filter(Boolean).join(' ').toLowerCase().includes(term)).slice(0,limit);
}

type OverpassElement={type:string;id:number;lat?:number;lon?:number;center?:{lat:number;lon:number};tags?:Record<string,string>};

const formatAddress=(tags:Record<string,string>|undefined)=>{
  if(!tags)return undefined;
  if(tags['addr:full'])return tags['addr:full'];
  const line=[tags['addr:housenumber'],tags['addr:street']].filter(Boolean).join(' ');
  const city=[tags['addr:city'],tags['addr:state'],tags['addr:postcode']].filter(Boolean).join(', ');
  return [line,city].filter(Boolean).join(', ')||undefined;
};

/** Named food places from an Overpass response, de-duplicated and capped. */
export function restaurantsFromOverpass(elements:readonly OverpassElement[],limit=restaurantResultLimit):TravelRestaurant[]{
  const seen=new Set<string>();
  const items:TravelRestaurant[]=[];
  for(const element of elements){
    const name=element.tags?.name?.trim();
    const lat=element.lat??element.center?.lat;
    const lon=element.lon??element.center?.lon;
    const id=`${element.type}/${element.id}`;
    if(!name||typeof lat!=='number'||typeof lon!=='number'||seen.has(id))continue;
    seen.add(id);
    items.push({id,name,cuisine:element.tags?.cuisine?.replace(/_/g,' ').replace(/;/g,', '),address:formatAddress(element.tags),city:element.tags?.['addr:city'],amenity:element.tags?.amenity,lat,lon});
    if(items.length>=limit)break;
  }
  return items;
}

export const restaurantOverpassQuery=(lat:number,lon:number,radiusMeters=restaurantSearchRadiusMeters)=>
  `[out:json][timeout:25];nwr["amenity"~"^(restaurant|cafe|fast_food|bar)$"](around:${radiusMeters},${lat},${lon});out center tags ${restaurantResultLimit*3};`;

/** Look up a city or address. `headers` lets native apps identify themselves to Nominatim. */
export async function geocodeTravelPlace(query:string,headers:Record<string,string>={}):Promise<TravelPlace>{
  const term=query.trim();
  if(term.length<2)throw new Error('Enter a city or address to search near.');
  const response=await fetch(`${nominatimSearchUrl}?format=json&limit=1&q=${encodeURIComponent(term)}`,{headers:{Accept:'application/json',...headers}});
  if(!response.ok)throw new Error('That place could not be looked up. Try a city name or address.');
  const rows=await response.json() as Array<{lat:string;lon:string;display_name?:string}>;
  const hit=rows[0];
  if(!hit)throw new Error('No matching place found. Try a different city or address.');
  return {lat:Number(hit.lat),lon:Number(hit.lon),label:hit.display_name??term};
}

export async function searchRestaurantsNear(lat:number,lon:number,headers:Record<string,string>={}):Promise<TravelRestaurant[]>{
  const response=await fetch(overpassUrl,{
    method:'POST',
    headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded;charset=UTF-8',...headers},
    body:`data=${encodeURIComponent(restaurantOverpassQuery(lat,lon))}`,
  });
  if(!response.ok)throw new Error('Restaurant search is temporarily unavailable. Try again in a moment.');
  const payload=await response.json() as {elements?:OverpassElement[]};
  return restaurantsFromOverpass(payload.elements??[]);
}
