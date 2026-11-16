import type {NationalFireActivity,NationalFireActivityRow} from './models';

// Fictional, deterministic fixtures shared by web and native demos. Never official data.
export function createDemoNationalFireActivity():NationalFireActivity{
  const samples:[string,number,number,number,number,number][]=[
    ['AICC',4,3,8,4,210],['NWCC',12,18,42,12,1460],['ONCC',9,24,56,14,2180],
    ['OSCC',6,12,34,8,970],['NRCC',8,16,28,9,1130],['GBCC',7,14,31,7,1020],
    ['SWCC',5,10,22,6,780],['RMCC',4,8,19,5,620],['EACC',2,2,7,1,140],['SACC',3,4,11,2,290],
  ];
  const areas:NationalFireActivityRow[]=samples.map(([gacc,incidents,crews,engines,helicopters,totalPersonnel])=>({gacc,incidents,crews,engines,helicopters,totalPersonnel,preparednessLevel:3,cumulativeAcres:incidents*1250}));
  const total=areas.reduce((sum,area)=>({...sum,incidents:sum.incidents+area.incidents,crews:sum.crews+area.crews,engines:sum.engines+area.engines,helicopters:sum.helicopters+area.helicopters,totalPersonnel:sum.totalPersonnel+area.totalPersonnel,cumulativeAcres:sum.cumulativeAcres+area.cumulativeAcres}),{gacc:'TOTAL',incidents:0,crews:0,engines:0,helicopters:0,totalPersonnel:0,cumulativeAcres:0,preparednessLevel:3});
  return {reportDate:'June 22, 2026 (Demo)',fetchedAt:'2026-06-22T12:00:00Z',sourceUrl:'',areas,total,nationalPreparednessLevel:2,largeFireCount:14,redFlagCount:3};
}

export type DemoDispatchEntry={rank:number;company_name:string|null;equipment_location:string|null;vin:string|null;cafs:string|null;daily_rate:number|null;rate_status:'matched'|'not_found'|'ambiguous'};
export function createDemoDispatchData(){
  const areas=[{id:1,name:'Northern California'}];
  const centers=[{id:101,name:'Redding Interagency Command Center'}];
  const lists=[
    {file_id:1001,name:'2026 Type 3 Engines',resource_type:'Type 3 Engines',published_at:'2026-05-14T16:00:00Z',synced_at:'2026-05-14T16:15:00Z',sync_status:'complete' as const},
    {file_id:1002,name:'2026 Water Tenders',resource_type:'Water Tenders',published_at:'2026-05-12T16:00:00Z',synced_at:'2026-05-12T16:12:00Z',sync_status:'complete' as const},
  ];
  const entries:Record<string,DemoDispatchEntry[]>={
    '1001':[
      {rank:1,company_name:'North Ridge Wildfire',equipment_location:'Redding, CA',vin:'1HTMMMML9KH483201',cafs:'Yes',daily_rate:2840,rate_status:'matched'},
      {rank:2,company_name:'Summit Fire Resources',equipment_location:'Medford, OR',vin:'1FVACWDT7GHGX4821',cafs:'Yes',daily_rate:2715,rate_status:'matched'},
      {rank:3,company_name:'Cascade Response LLC',equipment_location:'Red Bluff, CA',vin:'3ALACWDT4HDJG5192',cafs:'No',daily_rate:2495,rate_status:'matched'},
      {rank:4,company_name:'Sierra Wildland Services',equipment_location:'Chico, CA',vin:'1HTMMMML2LH219847',cafs:'Yes',daily_rate:null,rate_status:'ambiguous'},
    ],
    '1002':[
      {rank:1,company_name:'North Ridge Wildfire',equipment_location:'Redding, CA',vin:'1XPTD4EX8HD397122',cafs:'Not reported',daily_rate:3180,rate_status:'matched'},
      {rank:2,company_name:'Shasta Water Support',equipment_location:'Anderson, CA',vin:'1NPXLP0X4KD612483',cafs:'Not reported',daily_rate:3060,rate_status:'matched'},
      {rank:3,company_name:'Pacific Fire Logistics',equipment_location:'Yreka, CA',vin:'2FZHAZCV8YAJ84721',cafs:'Not reported',daily_rate:null,rate_status:'not_found'},
    ],
  };
  return {areas,centers,lists,entries};
}
