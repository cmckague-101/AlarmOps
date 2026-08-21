export type Coordinate = { latitude: number; longitude: number };
export type FireIncident = {
  id: string;
  name: string;
  acres: number;
  containment: number;
  updatedAt: string;
  coordinate: Coordinate;
  source: 'NIFC/WFIGS' | 'Demo';
  status: 'Active' | 'Contained';
  personnel?: number;
};
export type FirePerimeter = { id: string; incidentId: string; coordinates: Coordinate[] };
export type HeatDetection = { id: string; coordinate: Coordinate; confidence: 'low' | 'nominal' | 'high'; detectedAt: string };
export type WeatherAlert = { id: string; event: string; headline: string; severity: string; area: string; coordinate: Coordinate };
export type ResourceCrewMember = {
  id: string;
  name: string;
  role: string;
  qualifications: string[];
  status: 'On duty' | 'Resting' | 'Traveling';
};
export type CompanyResource = {
  id: string;
  unit: string;
  type: string;
  coordinate: Coordinate;
  status: 'Assigned' | 'Available' | 'Maintenance';
  incidentId?: string;
  callSign?: string;
  lastLocationUpdate?: string;
  readiness?: number;
  crew: ResourceCrewMember[];
};
export type ResourceIssue = {
  id: string;
  resourceId: string;
  category: 'Mechanical' | 'Safety' | 'Equipment' | 'Supplies' | 'Other';
  priority: 'Low' | 'Medium' | 'High' | 'Out of service';
  description: string;
  reportedBy: string;
  reportedAt: string;
  status: 'Open' | 'Resolved';
};
export type MapLayerKey = 'incidents' | 'perimeters' | 'heat' | 'weather' | 'resources' | 'water' | 'facilities';
