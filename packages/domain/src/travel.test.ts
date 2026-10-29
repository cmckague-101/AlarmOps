import {describe,expect,it} from 'vitest';
import {airportRows} from './airports-data';
import {fedRoomsRestaurantsUrl,type FedRoomsHotel} from './hotels';
import {airportLabel,fedRoomsHotelDestination,flightSearchProblem,googleFlightsUrl,nearestAirport} from './travel';

const hotel:FedRoomsHotel={property_key:'k',name:'Marriott Dallas Allen',address:'777 Watters Creek Blvd',city:'Allen',state:'Texas',postal_code:'75013',country:'United States'};

describe('travel lookups',()=>{
  it('finds the nearest commercial airport',()=>{
    const airport=nearestAirport(airportRows,{latitude:40.5865,longitude:-122.3917});
    expect(airport?.code).toBe('RDD');
    expect(airportLabel(airport!)).toBe('RDD · Redding, CA');
    expect(nearestAirport([],{latitude:0,longitude:0})).toBeNull();
  });
  it('builds round-trip and one-way Google Flights searches',()=>{
    expect(googleFlightsUrl({from:'RDD',to:'Allen, Texas',depart:'2026-11-12',returnDate:'2026-11-19'})).toBe('https://www.google.com/travel/flights?q=Flights%20to%20Allen%2C%20Texas%20from%20RDD%20on%202026-11-12%20through%202026-11-19');
    expect(googleFlightsUrl({from:'SMF',to:'Boise, Idaho',depart:'2026-11-12'})).toBe('https://www.google.com/travel/flights?q=One%20way%20flights%20to%20Boise%2C%20Idaho%20from%20SMF%20on%202026-11-12');
  });
  it('validates flight searches',()=>{
    expect(flightSearchProblem({from:'',to:'BOI',depart:'2026-11-12'})).toMatch(/from/);
    expect(flightSearchProblem({from:'SMF',to:'BOI',depart:''})).toMatch(/departure/);
    expect(flightSearchProblem({from:'SMF',to:'BOI',depart:'2026-11-12',returnDate:'2026-11-10'})).toMatch(/on or after/);
    expect(flightSearchProblem({from:'SMF',to:'BOI',depart:'2026-11-12',returnDate:'2026-11-12'})).toBeNull();
  });
  it('uses the hotel city as a flight destination and searches restaurants near it',()=>{
    expect(fedRoomsHotelDestination(hotel)).toBe('Allen, Texas');
    expect(fedRoomsRestaurantsUrl(hotel)).toBe('https://www.google.com/maps/search/?api=1&query=restaurants%20near%20777%20Watters%20Creek%20Blvd%2C%20Allen%2C%20Texas%2C%2075013%2C%20United%20States');
    expect(fedRoomsRestaurantsUrl(hotel,'apple')).toMatch(/^https:\/\/maps\.apple\.com\/\?q=restaurants%20near/);
  });
});
