import {createPayrollRows, type CommunicationThread, type CrewMember, type FireOpsUser, type InvoiceCustomer, type InvoiceForm, type PayrollForm, type Training, type InventoryItem, type VehicleInspection} from '@fireops/domain';

// Fictional, session-only fixtures. Never write these records to Supabase.
export function createDemoRecords(user:FireOpsUser,now=new Date()){
  const year=now.getFullYear();
  const timestamp=`${year}-06-22T12:00:00Z`;
  const customers:InvoiceCustomer[]=['Pine Valley Fire District (Demo)','Cedar Creek Incident Command (Demo)'].map((name,index)=>({id:`demo-customer-${index}`,companyId:'demo',name,createdAt:timestamp,updatedAt:timestamp}));
  const invoices:InvoiceForm[]=customers.map((customer,index)=>({id:`demo-invoice-${index}`,companyId:'demo',createdBy:user.id,createdByName:user.name,invoiceNumber:`DEMO-${year}-${1001+index}`,invoiceDate:`${year}-06-${20+index}`,invoiceAmount:index?18750:12480,customerId:customer.id,attachment:null,status:'submitted',submittedAt:timestamp,createdAt:timestamp,updatedAt:timestamp}));
  const payroll:PayrollForm[]=([ 'pending','approved'] as const).map((status,index)=>({id:`demo-payroll-${index}`,companyId:'demo',createdBy:'u2',createdByName:'Maya Torres',engineNumber:index?'Tender 12':'Engine 701',incidents:index?'Cedar Creek Fire (Demo)':'Pine Valley Fire (Demo)',attachment:null,rows:createPayrollRows(`${year}-06-01`).map((row,day)=>({...row,hoursWorked:day<14?(index?10:12):0,crewIds:day<14?['u2']:[],notes:day<14?'Demo incident assignment':''})),status,submittedAt:timestamp,approvedAt:index?timestamp:null,approvedBy:index?user.id:null,rejectionNotes:null,rejectedAt:null,rejectedBy:null,createdAt:timestamp,updatedAt:timestamp}));
  const createdAt=now.toISOString();
  const hoursAgo=(hours:number)=>new Date(now.getTime()-hours*3600000).toISOString();
  const threads:CommunicationThread[]=[
    {id:'demo-thread-1',subject:'Engine 701 — Pine Valley staging plan',description:'Demo assignment: meet at the yard at 0600 for a 0630 departure to Pine Valley staging. Bring your red card, line gear, and enough food and water for the first shift. Please confirm your gear is ready.',createdBy:user.name,createdById:user.id,createdByRole:user.role,createdAt:hoursAgo(4),replies:[
      {id:'demo-reply-1',body:'Radios are charged and the spare batteries are packed. I’ll be at the yard at 0545 for the pre-trip.',createdBy:'Maya Torres',createdById:'u2',createdAt:hoursAgo(3)},
      {id:'demo-reply-2',body:'Line gear and red card are ready. I’ll top off the drinking water before we roll out.',createdBy:'Cole Bennett',createdById:'u3',createdAt:hoursAgo(2)},
    ]},
    {id:'demo-thread-2',subject:'Annual refresher — gear and training reminders',description:'Our demo RT-130 refresher is on the training calendar at North Ridge Training Center. Sign up in Training and bring gloves, boots, and your practice shelter. We’ll review LCES and run shelter deployment drills.',createdBy:user.name,createdById:user.id,createdByRole:user.role,createdAt:hoursAgo(26),replies:[
      {id:'demo-reply-3',body:'I’m signed up. Do we have practice shelters available at the training center?',createdBy:'Cole Bennett',createdById:'u3',createdAt:hoursAgo(25)},
      {id:'demo-reply-4',body:'Yes, I’ll bring the training shelters and set up the deployment stations. Please bring your own gloves and eye protection.',createdBy:'Maya Torres',createdById:'u2',createdAt:hoursAgo(24)},
    ]},
  ];
  const trainings:Training[]=[{id:'demo-training-1',courseCode:'RT-130',courseTitle:'Annual Fireline Safety Refresher (Demo)',date:new Date(now.getTime()+7*86400000).toISOString(),location:'North Ridge Training Center',instructor:'Maya Torres',capacity:20,information:'Review fire shelter deployment, LCES, and incident safety scenarios.',createdAt,updatedAt:createdAt,signups:[{userId:'u2',userName:'Maya Torres',signedUpAt:createdAt}]}];
  const inventory:InventoryItem[]=['Bendix King handheld radio','Fire shelter','Pulaski tool','1½-inch hose bundle'].map((name,index)=>({id:`demo-inventory-${index}`,name,quantity:[12,18,8,24][index],createdAt,updatedAt:createdAt,checkouts:index===0?[{userId:'u2',userName:'Maya Torres',quantity:2,checkedOutAt:createdAt,updatedAt:createdAt}]:[]}));
  const inspections:VehicleInspection[]=['Left rear tire tread below service limit.','Right headlight inoperative; replace bulb before dispatch.'].map((defectNotes,index)=>({id:`demo-inspection-${index}`,assignmentIncident:'Pre-season readiness (Demo)',inspectorId:index?'u3':'u2',inspectorName:index?'Cole Bennett':'Maya Torres',createdAt:new Date(now.getTime()-(index+1)*86400000).toISOString(),items:[{id:`demo-check-${index}`,label:index?'Light check, horn, washer fluid':'Tires',kind:'pass_fail',result:'Fail',defectNotes},{id:`demo-pass-${index}`,label:'VIPR Inventory',kind:'pass_fail',result:'Pass'}]}));
  const auditLogs=[
    {actor_name:user.name,description:'Scheduled Annual Fireline Safety Refresher (Demo).'},
    {actor_name:'Cole Bennett',description:'Recorded a failed inspection for Tender 12: right headlight inoperative.'},
    {actor_name:'Maya Torres',description:'Checked out 2 Bendix King handheld radios.'},
    {actor_name:'Maya Torres',description:'Recorded a failed inspection for Engine 701: tire tread below service limit.'},
    {actor_name:user.name,description:'Approved payroll for Cedar Creek Fire (Demo).'},
  ].map((entry,index)=>({...entry,id:`demo-audit-${index}`,created_at:new Date(now.getTime()-(index+1)*3600000).toISOString()}));
  return {customers,invoices,payroll,threads,trainings,inventory,inspections,auditLogs};
}

export function demoQualifications(year=new Date().getFullYear()):Pick<CrewMember,'credentials'|'experiences'|'annualRecord'>{
  const completionDate=`${year}-03-10`;
  const expirationDate=`${year+1}-03-10`;
  return {
    credentials:[
      {id:'demo-fft1',name:'Firefighter Type 1',recordType:'Qualification',courseCode:'FFT1'},
      {id:'demo-engt',name:'Engine Boss Task Book',recordType:'Task Book',courseCode:'ENGB'},
      {id:'demo-s130',name:'Firefighter Training',recordType:'Training',courseCode:'S-130'},
      {id:'demo-s190',name:'Introduction to Wildland Fire Behavior',recordType:'Training',courseCode:'S-190'},
      {id:'demo-cdl',name:'Commercial Driver License (Demo)',recordType:'License',courseCode:'CDL-B'},
      {id:'demo-medical',name:'Medical Examiner Certificate (Demo)',recordType:'DOT Medical',courseCode:'DOT'},
      {id:'demo-radio',name:'Radio Communications (Demo)'},
    ].map(credential=>({...credential,completionDate,expirationDate,provider:'North Ridge Training Center (Demo)'})) as CrewMember['credentials'],
    experiences:[{id:'demo-experience-1',incident:'Pine Valley Fire (Demo)',position:'FFT1',days:'14'},{id:'demo-experience-2',incident:'Cedar Creek Fire (Demo)',position:'ENGB Trainee',days:'10'}],
    annualRecord:{rt130CompletionDate:completionDate,rt130CurrencyDate:expirationDate,wctCompletionDate:completionDate,wctCurrencyDate:expirationDate},
  };
}
