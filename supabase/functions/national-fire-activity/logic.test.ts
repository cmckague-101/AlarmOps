import {assertEquals, assertThrows} from 'jsr:@std/assert@1';
import {activeRedFlagCount,parseNationalFireActivity} from './logic.ts';

const report = `Incident Management Situation Report
Friday September 11, 2026 – 0730 MDT
National Preparedness Level 3
Active Incident Resource Summary
GACC PL Incidents Cumulative
Acres Crews Engines Helicopters Total
Personnel Change in Personnel
AICC 1 1 7,335 1 1 0 31 0
NWCC 3 31 2,028,965 106 195 30 5,990 -153
Total --- 32 2,036,300 107 196 30 6,021 -153
Fire Activity and Teams Assigned Totals`;

Deno.test('parses first-page active incident resource summary', () => {
  const result = parseNationalFireActivity(report, '2026-09-12T00:00:00.000Z');
  assertEquals(result.reportDate, 'Friday September 11, 2026 – 0730 MDT');
  assertEquals(result.areas[1], {
    gacc: 'NWCC', preparednessLevel: 3, incidents: 31, cumulativeAcres: 2028965,
    crews: 106, engines: 195, helicopters: 30, totalPersonnel: 5990,
  });
  assertEquals(result.total.totalPersonnel, 6021);
  assertEquals(result.total.preparednessLevel, null);
  assertEquals(result.nationalPreparednessLevel,3);
  assertEquals(result.largeFireCount,32);
});

Deno.test('counts active NWS red flag warning features',()=>{
  assertEquals(activeRedFlagCount({features:[{id:'one'},{id:'two'}]}),2);
  assertEquals(activeRedFlagCount({features:null}),null);
});

Deno.test('rejects reports without resource summary', () => {
  assertThrows(() => parseNationalFireActivity('unrelated report'), Error, 'Active Incident Resource Summary');
});
