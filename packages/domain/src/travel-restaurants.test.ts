import {describe,expect,it} from 'vitest';
import {createDemoFedRoomsData} from './hotels';
import {filterDemoRestaurants,restaurantKind,restaurantMapsUrl,restaurantOverpassQuery,restaurantsFromOverpass} from './travel-restaurants';

describe('travel restaurants',()=>{
  it('finds demo restaurants for every demo hotel address',()=>{
    for(const hotel of createDemoFedRoomsData().hotels){
      const results=filterDemoRestaurants([hotel.address,hotel.city,hotel.state].filter(Boolean).join(', '));
      expect(results.length).toBeGreaterThan(0);
      expect(results.every(item=>item.city===hotel.city)).toBe(true);
    }
  });

  it('matches demo restaurants by cuisine or name and shows all for an empty search',()=>{
    expect(filterDemoRestaurants('BBQ').map(item=>item.name)).toEqual(['Smoke Shift BBQ']);
    expect(filterDemoRestaurants('').length).toBeGreaterThan(4);
    expect(filterDemoRestaurants('zzz')).toEqual([]);
  });

  it('builds a kind label and a maps link',()=>{
    const [first]=filterDemoRestaurants('Redding');
    expect(restaurantKind(first!)).toBe('Restaurant · American');
    expect(restaurantMapsUrl(first!)).toContain('google.com/maps/search');
    expect(restaurantMapsUrl(first!)).toContain(encodeURIComponent('Trailhead Kitchen'));
  });

  it('keeps named places with coordinates from Overpass, once each, with a readable address',()=>{
    const items=restaurantsFromOverpass([
      {type:'node',id:1,lat:40,lon:-122,tags:{name:'Diner',amenity:'restaurant',cuisine:'american;burger','addr:housenumber':'12','addr:street':'Main St','addr:city':'Redding','addr:state':'CA'}},
      {type:'node',id:1,lat:40,lon:-122,tags:{name:'Diner'}},
      {type:'way',id:2,center:{lat:40.1,lon:-122.1},tags:{name:'Cafe Two',amenity:'cafe'}},
      {type:'node',id:3,lat:40,lon:-122,tags:{amenity:'restaurant'}},
      {type:'node',id:4,tags:{name:'No location'}},
    ]);
    expect(items.map(item=>item.name)).toEqual(['Diner','Cafe Two']);
    expect(items[0]).toMatchObject({address:'12 Main St, Redding, CA',cuisine:'american, burger',city:'Redding'});
    expect(items[1]).toMatchObject({lat:40.1,lon:-122.1});
  });

  it('asks Overpass only for food places around the point',()=>{
    const query=restaurantOverpassQuery(40.5,-122.4);
    expect(query).toContain('around:2500,40.5,-122.4');
    expect(query).toContain('restaurant|cafe|fast_food|bar');
  });
});
