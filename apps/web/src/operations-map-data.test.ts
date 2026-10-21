import {describe, expect, it} from 'vitest';
import type {FireResourceVehicle, NifcIncident} from '@fireops/domain';
import {incidentMapData, validMapCoordinates, vehicleMapData} from './operations-map-data';

const incident: NifcIncident = {
  id: 'fire-1', name: 'Test fire', acres: 1200, contained: 25, personnel: 80,
  state: 'CA', discovered: null, updated: null, latitude: 39, longitude: -121,
};
const vehicle: FireResourceVehicle = {
  id: 'truck-1', unit: 'Engine 1', type: 'Engine', year: 2024, make: 'Ford', model: 'F-550',
  motive: {latitude: 40, longitude: -122, location: 'California', speed: '0 mph', updatedAt: 'now'},
};

describe('operations map data', () => {
  it('uses longitude-first GeoJSON points and preserves incident ids for selection', () => {
    expect(incidentMapData([incident]).features[0]).toEqual({
      type: 'Feature', geometry: {type: 'Point', coordinates: [-121, 39]},
      properties: {id: 'fire-1', acres: 1200},
    });
  });

  it('omits invalid coordinates without excluding Alaska or Hawaii', () => {
    const features = incidentMapData([
      incident,
      {...incident, id: 'alaska', longitude: -150, latitude: 64},
      {...incident, id: 'hawaii', longitude: -155, latitude: 20},
      {...incident, longitude: NaN}, {...incident, latitude: 91},
    ]).features;
    expect(features.map(item => item.properties?.id)).toEqual(['fire-1', 'alaska', 'hawaii']);
  });

  it('sizes fires with missing or negative acreage safely', () => {
    expect(incidentMapData([{...incident, acres: null}, {...incident, acres: -10}]).features
      .map(item => item.properties?.acres)).toEqual([0, 0]);
  });

  it('preserves fleet labels and coordinates but does not send location descriptions', () => {
    expect(vehicleMapData([vehicle]).features[0]).toEqual({
      type: 'Feature', geometry: {type: 'Point', coordinates: [-122, 40]},
      properties: {id: 'truck-1', unit: 'Engine 1'},
    });
  });

  it('omits vehicles with unavailable or out-of-range GPS positions', () => {
    expect(vehicleMapData([
      vehicle, {...vehicle, motive: undefined},
      {...vehicle, motive: {...vehicle.motive!, latitude: undefined}},
      {...vehicle, motive: {...vehicle.motive!, longitude: 200}},
    ]).features).toHaveLength(1);
  });

  it('rejects non-numeric and infinite coordinates while accepting zero', () => {
    expect(validMapCoordinates(0, 0)).toBe(true);
    expect(validMapCoordinates('-121', 39)).toBe(false);
    expect(validMapCoordinates(-121, null)).toBe(false);
    expect(validMapCoordinates(Infinity, 39)).toBe(false);
  });
});
