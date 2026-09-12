export type ActivityRow = {
  gacc: string;
  preparednessLevel: number | null;
  incidents: number;
  cumulativeAcres: number;
  crews: number;
  engines: number;
  helicopters: number;
  totalPersonnel: number;
};

const SOURCE_URL = 'https://www.nifc.gov/nicc-files/sitreprt.pdf';
const ROW = /^(AICC|NWCC|ONCC|OSCC|NRCC|GBCC|SWCC|RMCC|EACC|SACC|Total)\s+(\d+|---)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/gm;

function number(value: string) {
  return Number(value.replaceAll(',', ''));
}

export function parseNationalFireActivity(text: string, fetchedAt = new Date().toISOString()) {
  const normalized = text.replaceAll('\u00a0', ' ');
  const start = normalized.indexOf('Active Incident Resource Summary');
  const end = normalized.indexOf('Fire Activity and Teams Assigned Totals', start);
  if (start < 0 || end < 0) throw new Error('Active Incident Resource Summary was not found.');

  const section = normalized.slice(start, end);
  const rows: ActivityRow[] = Array.from(section.matchAll(ROW), match => ({
    gacc: match[1],
    preparednessLevel: match[2] === '---' ? null : number(match[2]),
    incidents: number(match[3]),
    cumulativeAcres: number(match[4]),
    crews: number(match[5]),
    engines: number(match[6]),
    helicopters: number(match[7]),
    totalPersonnel: number(match[8]),
  }));
  const total = rows.find(row => row.gacc === 'Total');
  const areas = rows.filter(row => row.gacc !== 'Total');
  if (!total || areas.length === 0) throw new Error('Active incident resource table could not be read.');

  const reportDate = normalized.match(/Incident Management Situation Report\s*\n([^\n]+)/)?.[1]?.trim();
  if (!reportDate) throw new Error('Situation report date could not be read.');
  return {reportDate, fetchedAt, sourceUrl: SOURCE_URL, areas, total};
}
