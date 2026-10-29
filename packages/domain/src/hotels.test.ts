import {describe,expect,it} from 'vitest';
import {fedRoomsAddressLines,fedRoomsMapsUrl,fedRoomsRegionFromValue,fedRoomsRegionLabel,fedRoomsRegionValue,fedRoomsSearchTerm,fedRoomsWebSearchUrl,sortFedRoomsRegions,type FedRoomsHotel} from './hotels';

const hotel:FedRoomsHotel={property_key:'k',name:'Courtyard Redding',address:'2900 Bechelli Ln',city:'Redding',state:'California',postal_code:'96002',country:'United States'};
const kuwait:FedRoomsHotel={property_key:'q',name:'GRAND HYATT KUWAIT',address:'360 MALL',city:'Kuwait City',state:null,postal_code:'47451',country:'Kuwait'};

describe('FedRooms hotels',()=>{
  it('lists US states before other countries',()=>{
    const sorted=sortFedRoomsRegions([{country:'Kuwait',state:null,hotel_count:1},{country:'United States',state:'Texas',hotel_count:3},{country:'United States',state:'Alaska',hotel_count:2}]);
    expect(sorted.map(fedRoomsRegionLabel)).toEqual(['Alaska','Texas','Kuwait']);
  });
  it('round-trips region values, including a missing state',()=>{
    expect(fedRoomsRegionFromValue(fedRoomsRegionValue({country:'Kuwait',state:null}))).toEqual({country:'Kuwait',state:null});
    expect(fedRoomsRegionFromValue('nope')).toBeNull();
  });
  it('strips characters that break PostgREST filters',()=>expect(fedRoomsSearchTerm(' Hilton, (Boise)* ')).toBe('Hilton Boise'));
  it('formats US and international addresses',()=>{
    expect(fedRoomsAddressLines(hotel)).toEqual(['2900 Bechelli Ln','Redding, California 96002']);
    expect(fedRoomsAddressLines(kuwait)).toEqual(['360 MALL','Kuwait City, 47451','Kuwait']);
  });
  it('builds maps and web search links',()=>{
    expect(fedRoomsMapsUrl(hotel)).toBe('https://www.google.com/maps/search/?api=1&query=Courtyard%20Redding%2C%202900%20Bechelli%20Ln%2C%20Redding%2C%20California%2C%2096002%2C%20United%20States');
    expect(fedRoomsMapsUrl(hotel,'apple')).toMatch(/^https:\/\/maps\.apple\.com\/\?q=Courtyard/);
    expect(fedRoomsWebSearchUrl(kuwait)).toBe('https://www.google.com/search?q=GRAND%20HYATT%20KUWAIT%2C%20Kuwait%20City%2C%20Kuwait');
  });
});
