import type {FeatureCollection, Point} from 'geojson';
import type {FireResourceVehicle, NifcIncident} from '@fireops/domain';

export const NATIONAL_BOUNDS: [[number, number], [number, number]] = [[-125, 24], [-66, 50]];

export function validMapCoordinates(longitude: unknown, latitude: unknown): boolean {
  return typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    && typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90;
}

export function incidentMapData(incidents: NifcIncident[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: incidents.filter(item => validMapCoordinates(item.longitude, item.latitude)).map(item => ({
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [item.longitude, item.latitude]},
      properties: {id: item.id, acres: Math.max(0, item.acres ?? 0)},
    })),
  };
}

export function vehicleMapData(vehicles: FireResourceVehicle[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: vehicles.filter(item => validMapCoordinates(item.motive?.longitude, item.motive?.latitude)).map(item => ({
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [item.motive!.longitude!, item.motive!.latitude!]},
      properties: {id: item.id, unit: item.unit},
    })),
  };
}
