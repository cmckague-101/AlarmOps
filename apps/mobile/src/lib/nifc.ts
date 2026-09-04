import type { NifcIncident } from "@fireops/domain";

const NIFC_QUERY =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query";
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

type ArcGisFeature = {
  attributes: Record<string, string | number | null>;
  geometry?: { x: number; y: number };
};

type ArcGisResponse = {
  features?: ArcGisFeature[];
  exceededTransferLimit?: boolean;
  error?: { message?: string };
};

function nullableNumber(value: unknown) {
  return value === null || value === undefined || value === ""
    ? null
    : Number(value);
}

function parseIncident(item: ArcGisFeature): NifcIncident | null {
  const attributes = item.attributes;
  const latitude = Number(item.geometry?.y ?? attributes.InitialLatitude);
  const longitude = Number(item.geometry?.x ?? attributes.InitialLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    id: String(attributes.UniqueFireIdentifier ?? attributes.OBJECTID),
    name: String(attributes.IncidentName ?? "Unnamed incident"),
    acres: nullableNumber(attributes.IncidentSize),
    contained: nullableNumber(attributes.PercentContained),
    personnel: nullableNumber(attributes.TotalIncidentPersonnel),
    state: String(attributes.POOState ?? "").replace(/^US-/, ""),
    discovered: nullableNumber(attributes.FireDiscoveryDateTime),
    updated: nullableNumber(attributes.ModifiedOnDateTime_dt),
    latitude,
    longitude,
  };
}

export async function fetchNifcIncidents(signal: AbortSignal) {
  const incidents: NifcIncident[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      f: "json",
      where: "IncidentTypeCategory='WF' AND FireOutDateTime IS NULL",
      outFields:
        "OBJECTID,UniqueFireIdentifier,IncidentName,IncidentSize,PercentContained,TotalIncidentPersonnel,POOState,FireDiscoveryDateTime,ModifiedOnDateTime_dt,InitialLatitude,InitialLongitude",
      returnGeometry: "true",
      outSR: "4326",
      orderByFields: "ModifiedOnDateTime_dt DESC",
      resultOffset: String(page * PAGE_SIZE),
      resultRecordCount: String(PAGE_SIZE),
    });
    const response = await fetch(`${NIFC_QUERY}?${params}`, { signal });
    if (!response.ok)
      throw new Error(`NIFC request failed with ${response.status}`);
    const body = (await response.json()) as ArcGisResponse;
    if (body.error)
      throw new Error(body.error.message ?? "NIFC returned an error");
    incidents.push(
      ...(body.features ?? [])
        .map(parseIncident)
        .filter((item): item is NifcIncident => Boolean(item)),
    );
    if (
      !body.exceededTransferLimit ||
      (body.features?.length ?? 0) < PAGE_SIZE
    )
      break;
  }
  return incidents;
}
