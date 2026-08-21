import {FireIncident, WeatherAlert} from '../data/mapTypes';

// Production adapters. Public endpoints and API keys belong in environment variables,
// never hard-coded into the shipped app.
export const feedConfig = {
  nifcFeatureServiceUrl: process.env.EXPO_PUBLIC_NIFC_FEATURE_SERVICE_URL || 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/ArcGIS/rest/services/IMSR_Incident_Locations_Most_Recent_View/FeatureServer/0',
  firmsMapKey: process.env.EXPO_PUBLIC_NASA_FIRMS_MAP_KEY || '',
};

type GeoJsonFeature = {
  geometry?: {type?: string; coordinates?: unknown};
  properties?: Record<string, unknown>;
};

export async function fetchNifcImsrIncidents(): Promise<FireIncident[]> {
  const fields=['OBJECTID','fire_name','incident_id','x100pct','post_date_isoformat','size','latitude','longitude'];
  const query=`${feedConfig.nifcFeatureServiceUrl}/query?where=${encodeURIComponent("IsLatest='x'")}&outFields=${fields.join(',')}&returnGeometry=true&outSR=4326&f=geojson`;
  const response=await fetch(query,{headers:{Accept:'application/geo+json'}});
  if(!response.ok)throw new Error(`NIFC request failed: ${response.status}`);
  const json:unknown=await response.json();
  if(!json||typeof json!=='object'||!Array.isArray((json as {features?:unknown}).features))throw new Error('NIFC response is invalid');
  return ((json as {features:GeoJsonFeature[]}).features).flatMap((feature,index)=>{
    const coordinates=feature.geometry?.coordinates;
    const properties=feature.properties||{};
    if(feature.geometry?.type!=='Point'||!Array.isArray(coordinates)||typeof coordinates[0]!=='number'||typeof coordinates[1]!=='number')return [];
    const id=stringValue(properties.incident_id)||stringValue(properties.OBJECTID)||`nifc-${index}`;
    return [{
      id,
      name:stringValue(properties.fire_name)||'Unnamed Incident',
      acres:numberValue(properties.size),
      containment:stringValue(properties.x100pct).toLowerCase()==='c'?100:0,
      updatedAt:imsrDate(properties.post_date_isoformat),
      coordinate:{latitude:coordinates[1],longitude:coordinates[0]},
      source:'NIFC/WFIGS' as const,
      status:stringValue(properties.x100pct).toLowerCase()==='c'?'Contained' as const:'Active' as const,
    }];
  });
}

function stringValue(value:unknown){return typeof value==='string'?value:typeof value==='number'?String(value):''}
function numberValue(value:unknown){const parsed=typeof value==='number'?value:Number(value);return Number.isFinite(parsed)?parsed:0}
function imsrDate(value:unknown){const raw=stringValue(value);return /^\d{8}$/.test(raw)?`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T07:30:00-06:00`:new Date().toISOString()}

export async function fetchNwsAlertsForPoint(latitude:number, longitude:number): Promise<WeatherAlert[]> {
  const url=`https://api.weather.gov/alerts/active?point=${latitude},${longitude}`;
  const response=await fetch(url,{headers:{Accept:'application/geo+json','User-Agent':'FireOps/0.3 (operations@firecollc.com)'}});
  if(!response.ok) throw new Error(`NWS request failed: ${response.status}`);
  const json=await response.json();
  return (json.features || []).slice(0,20).map((feature:any,index:number)=>({
    id:feature.id || `nws-${index}`,
    event:feature.properties?.event || 'Weather Alert',
    headline:feature.properties?.headline || feature.properties?.description || 'Active alert',
    severity:feature.properties?.severity || 'Unknown',
    area:feature.properties?.areaDesc || 'Selected area',
    coordinate:{latitude,longitude},
  }));
}

export function integrationStatus(){
  return {
    nifcConfigured:Boolean(feedConfig.nifcFeatureServiceUrl),
    firmsConfigured:Boolean(feedConfig.firmsMapKey),
    nwsConfigured:true,
  };
}
