import { FleetAsset, FleetInspection, FleetIssue, FleetWorkOrder, PartStock, ServiceSchedule } from './maintenanceTypes';

export const seedFleetAssets: FleetAsset[] = [
  {id:'a1',unit:'Engine 701',type:'Type 3 Engine',makeModel:'International 7400 / KME',year:2012,mileage:68420,hours:4822,status:'Assigned',nextServiceMileage:70000,nextServiceHours:5000,activeAssignment:'River Complex'},
  {id:'a2',unit:'Engine 704',type:'Type 3 Engine',makeModel:'Freightliner M2',year:2016,mileage:52110,hours:3910,status:'Ready',nextServiceMileage:55000,nextServiceHours:4000},
  {id:'a3',unit:'Tender 12',type:'Water Tender',makeModel:'Peterbilt 367',year:2014,mileage:118240,hours:6350,status:'Limited',nextServiceMileage:120000,nextServiceHours:6500},
  {id:'a4',unit:'Dozer 4',type:'Dozer',makeModel:'Caterpillar D7R',year:2008,mileage:0,hours:9870,status:'Out of Service',nextServiceHours:10000},
];

export const seedIssues: FleetIssue[] = [
  {id:'i1',assetId:'a3',title:'Rear Work Light Inoperative',description:'Right rear scene light does not illuminate.',priority:'Medium',status:'Open',source:'Inspection',reportedBy:'M. Torres',reportedAt:'2026-07-16T18:20:00Z',inspectionId:'in1'},
  {id:'i2',assetId:'a4',title:'Hydraulic Leak at Blade Lift Cylinder',description:'Visible fluid and pressure loss. Unit tagged out.',priority:'Critical',status:'Scheduled',source:'Driver',reportedBy:'J. Miller',reportedAt:'2026-07-15T09:10:00Z',workOrderId:'wo2'},
  {id:'i3',assetId:'a1',title:'Pump Primer Slow to Pull Vacuum',description:'Primer requires two cycles after extended use.',priority:'High',status:'Open',source:'Inspection',reportedBy:'C. Smith',reportedAt:'2026-07-17T02:45:00Z',inspectionId:'in2'},
];

export const seedWorkOrders: FleetWorkOrder[] = [
  {id:'wo1',number:'WO-1048',assetId:'a3',title:'Repair Rear Scene Light',priority:'Medium',status:'Open',vendorOrTechnician:'FireCo Shop',openedAt:'2026-07-17',dueAt:'2026-07-19',lines:[{id:'l1',task:'Diagnose wiring and replace lamp',laborHours:1.2,laborRate:55,partsCost:84,completed:false}],issueIds:['i1']},
  {id:'wo2',number:'WO-1047',assetId:'a4',title:'Repair Blade Lift Cylinder Leak',priority:'Critical',status:'Waiting Parts',vendorOrTechnician:'Western Hydraulic',openedAt:'2026-07-15',dueAt:'2026-07-22',lines:[{id:'l2',task:'Remove and reseal lift cylinder',laborHours:8,laborRate:125,partsCost:1260,completed:false}],issueIds:['i2']},
  {id:'wo3',number:'WO-1042',assetId:'a2',title:'500-Hour Service',priority:'Medium',status:'Completed',vendorOrTechnician:'FireCo Shop',openedAt:'2026-07-08',completedAt:'2026-07-09',odometer:52040,engineHours:3900,lines:[{id:'l3',task:'Engine oil and filters',laborHours:2.5,laborRate:55,partsCost:418,completed:true},{id:'l4',task:'Pump and driveline inspection',laborHours:1.5,laborRate:55,partsCost:0,completed:true}],issueIds:[]},
];

export const seedInspections: FleetInspection[] = [
  {id:'in1',assetId:'a3',type:'Post-Assignment',assignment:'East Ridge Fire',inspector:'M. Torres',submittedAt:'2026-07-16T18:20:00Z',odometer:118240,engineHours:6350,status:'Defects Found',signatureName:'Miguel Torres',items:[{id:'x1',section:'Lighting & Electrical',label:'Scene/work lights',result:'Fail',notes:'Right rear lamp does not work.'},{id:'x2',section:'Chassis',label:'Tires, wheels, and lug nuts',result:'Pass'},{id:'x3',section:'Fire Package',label:'Pump operation and primer',result:'Pass'}]},
  {id:'in2',assetId:'a1',type:'Post-Assignment',assignment:'River Complex',inspector:'C. Smith',submittedAt:'2026-07-17T02:45:00Z',odometer:68420,engineHours:4822,status:'Defects Found',signatureName:'Chris Smith',items:[{id:'x4',section:'Fire Package',label:'Pump operation and primer',result:'Fail',notes:'Primer is slow after long pumping period.'},{id:'x5',section:'Equipment',label:'Hose, fittings, nozzles, and tools',result:'Pass'},{id:'x6',section:'Cab & Safety',label:'Brakes, steering, warning devices',result:'Pass',createsOutOfService:true}]},
];

export const seedSchedules: ServiceSchedule[] = [
  {id:'s1',assetId:'a1',task:'Engine oil and filters',intervalMiles:5000,intervalHours:250,lastCompletedMileage:65000,lastCompletedHours:4600,dueMileage:70000,dueHours:4850},
  {id:'s2',assetId:'a1',task:'Pump service and test',intervalHours:500,lastCompletedHours:4500,dueHours:5000},
  {id:'s3',assetId:'a3',task:'Annual DOT inspection',intervalMiles:12000,lastCompletedMileage:108000,dueMileage:120000},
  {id:'s4',assetId:'a4',task:'Hydraulic system service',intervalHours:500,lastCompletedHours:9500,dueHours:10000},
];

export const seedParts: PartStock[] = [
  {id:'p1',sku:'FLT-3126',name:'CAT 3126 oil filter',quantity:6,reorderAt:3,unitCost:32.45,location:'Shop A-2'},
  {id:'p2',sku:'HYD-10M',name:'10 micron hydraulic filter',quantity:2,reorderAt:3,unitCost:89.20,location:'Shop B-4'},
  {id:'p3',sku:'LED-SCENE',name:'LED scene light',quantity:1,reorderAt:2,unitCost:84,location:'Electrical bin'},
];
