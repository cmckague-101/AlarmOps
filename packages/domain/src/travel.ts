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
