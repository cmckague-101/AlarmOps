export type NifcAreaSummary = {
  area: string;
  largeFires: number;
};

export type NifcSituationSummary = {
  reportDate: string;
  preparednessLevel: number;
  activeIncidents: number;
  crewsCommitted: number;
  enginesCommitted: number;
  helicoptersCommitted: number;
  personnelCommitted: number;
  largeFires: number;
  areas: NifcAreaSummary[];
  sourceUrl: string;
};

const CURRENT_IMSR_URL = 'https://www.nifc.gov/nicc-files/sitreprt.pdf';

// Offline fallback from the official NICC IMSR published July 17, 2026.
// A production transformer can expose the current PDF as validated JSON through
// EXPO_PUBLIC_NIFC_DAILY_SUMMARY_URL, keeping PDF parsing off field devices.
export const fallbackNifcSituation: NifcSituationSummary = {
  reportDate: '2026-07-17T07:30:00-06:00',
  preparednessLevel: 4,
  activeIncidents: 97,
  crewsCommitted: 372,
  enginesCommitted: 1024,
  helicoptersCommitted: 140,
  personnelCommitted: 17482,
  largeFires: 68,
  areas: [
    {area: 'Northwest', largeFires: 23},
    {area: 'Southern', largeFires: 8},
    {area: 'Alaska', largeFires: 8},
    {area: 'Rocky Mountain', largeFires: 7},
    {area: 'Eastern', largeFires: 6},
    {area: 'Great Basin', largeFires: 6},
    {area: 'Northern California', largeFires: 4},
    {area: 'Southern California', largeFires: 2},
    {area: 'Northern Rockies', largeFires: 2},
    {area: 'Southwest', largeFires: 2},
  ],
  sourceUrl: CURRENT_IMSR_URL,
};

export async function fetchNifcSituation(): Promise<NifcSituationSummary> {
  const endpoint = process.env.EXPO_PUBLIC_NIFC_DAILY_SUMMARY_URL;
  if (!endpoint) return fallbackNifcSituation;

  const response = await fetch(endpoint, {headers: {Accept: 'application/json'}});
  if (!response.ok) throw new Error(`NIFC summary request failed: ${response.status}`);
  const value: unknown = await response.json();
  if (!isNifcSituationSummary(value)) throw new Error('NIFC summary response is invalid');
  return value;
}

function isNifcSituationSummary(value: unknown): value is NifcSituationSummary {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<NifcSituationSummary>;
  return typeof item.reportDate === 'string'
    && typeof item.preparednessLevel === 'number'
    && item.preparednessLevel >= 1
    && item.preparednessLevel <= 5
    && typeof item.activeIncidents === 'number'
    && typeof item.crewsCommitted === 'number'
    && typeof item.enginesCommitted === 'number'
    && typeof item.helicoptersCommitted === 'number'
    && typeof item.personnelCommitted === 'number'
    && typeof item.largeFires === 'number'
    && typeof item.sourceUrl === 'string'
    && Array.isArray(item.areas)
    && item.areas.every(area => typeof area?.area === 'string' && typeof area?.largeFires === 'number');
}
