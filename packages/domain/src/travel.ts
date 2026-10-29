// Travel lookups that open Google with a prefilled search; nothing is booked in FireOps.
import {fedRoomsStateName,fedRoomsUnitedStates,type FedRoomsHotel} from './hotels';

export type Airport={code:string;name:string;city:string;region:string;country:string;latitude:number;longitude:number;large:boolean};
export type AirportRow=[string,string,string,string,string,number,number,0|1];
export type FlightSearch={from:string;to:string;depart:string;returnDate?:string|null};

const radians=(degrees:number)=>degrees*Math.PI/180;
export function distanceKm(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){
  const dLat=radians(b.latitude-a.latitude),dLon=radians(b.longitude-a.longitude);
  const h=Math.sin(dLat/2)**2+Math.cos(radians(a.latitude))*Math.cos(radians(b.latitude))*Math.sin(dLon/2)**2;
  return 6371*2*Math.asin(Math.sqrt(h));
}

// Rows come from the lazily imported '@fireops/domain/airports-data' (about 250 KB).
export function nearestAirport(rows:AirportRow[],position:{latitude:number;longitude:number}):Airport&{distanceKm:number}|null{
  let best:AirportRow|null=null,bestDistance=Infinity;
  for(const row of rows){
    const distance=distanceKm(position,{latitude:row[5],longitude:row[6]});
    if(distance<bestDistance){best=row;bestDistance=distance}
  }
  if(!best)return null;
  const [code,name,city,region,country,latitude,longitude,large]=best;
  return {code,name,city,region,country,latitude,longitude,large:large===1,distanceKm:bestDistance};
}
export const airportLabel=(airport:Airport)=>`${airport.code} · ${airport.city||airport.name}${airport.country==='US'?`, ${airport.region}`:''}`;

// Google Flights accepts airport codes or place names ("Allen, Texas" resolves to DFW).
export const fedRoomsHotelDestination=(hotel:FedRoomsHotel)=>[hotel.city,hotel.country===fedRoomsUnitedStates?fedRoomsStateName(hotel.state):hotel.country].filter(Boolean).join(', ');

export const isIsoDate=(value:string|null|undefined)=>Boolean(value&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
export function flightSearchProblem(search:FlightSearch){
  if(!search.from.trim())return 'Enter where you are flying from.';
  if(!search.to.trim())return 'Enter where you are flying to.';
  if(!isIsoDate(search.depart))return 'Choose a departure date.';
  if(search.returnDate&&!isIsoDate(search.returnDate))return 'Choose a valid return date.';
  if(search.returnDate&&search.returnDate<search.depart)return 'Return date must be on or after the departure date.';
  return null;
}
export function googleFlightsUrl(search:FlightSearch){
  const from=search.from.trim(),to=search.to.trim();
  const q=search.returnDate?`Flights to ${to} from ${from} on ${search.depart} through ${search.returnDate}`:`One way flights to ${to} from ${from} on ${search.depart}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

// Type-ahead for the From/To fields. Matches code, city, airport name and US state
// ("idaho" -> BOI), and tolerates small misspellings ("albequerque" -> ABQ).
const fold=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function withinOneEdit(a:string,b:string){
  if(Math.abs(a.length-b.length)>1)return false;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length){
    if(a[i]===b[j]){i++;j++;continue}
    if(++edits>1)return false;
    if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++}
  }
  return edits+(a.length-i)+(b.length-j)<=1;
}
function editDistance(a:string,b:string){
  const row=Array.from({length:b.length+1},(_,index)=>index);
  for(let i=1;i<=a.length;i++){
    let previous=row[0];row[0]=i;
    for(let j=1;j<=b.length;j++){const current=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=current}
  }
  return row[b.length];
}
function airportScore(row:AirportRow,query:string){
  const [code,name,city,region,country]=row;
  const lowerCode=code.toLowerCase(),lowerCity=fold(city),lowerName=fold(name);
  const state=country==='US'?fold(fedRoomsStateName(region)??''):'';
  if(lowerCode===query)return 100;
  if(query.length<=3&&lowerCode.startsWith(query))return 80;
  if(lowerCity===query)return 90;
  if(lowerCity.startsWith(query))return 75;
  const words=`${lowerCity} ${lowerName}`.split(/[^a-z0-9]+/).filter(Boolean);
  if(words.some(word=>word.startsWith(query)))return 60;
  if(state&&(state===query||(query.length>=4&&state.startsWith(query))))return 50;
  if(query.length>=3&&(lowerCity.includes(query)||lowerName.includes(query)))return 40;
  if(query.length>=4){
    const prefix=(word:string)=>word.slice(0,query.length);
    if([lowerCity,...words].some(word=>withinOneEdit(prefix(word),query)))return 30;
    if(query.length>=6&&[lowerCity,...words].some(word=>editDistance(word,query)<=2))return 20;
  }
  return 0;
}
export function searchAirports(rows:AirportRow[],input:string,limit=8):Airport[]{
  const query=fold(input.trim()).replace(/\s+/g,' ');
  if(query.length<2)return [];
  return rows
    .map(row=>({row,score:airportScore(row,query)}))
    .filter(match=>match.score>0)
    .sort((a,b)=>b.score-a.score||b.row[7]-a.row[7]||a.row[0].localeCompare(b.row[0]))
    .slice(0,limit)
    .map(({row:[code,name,city,region,country,latitude,longitude,large]})=>({code,name,city,region,country,latitude,longitude,large:large===1}));
}
