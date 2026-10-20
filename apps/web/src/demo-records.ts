import {createPayrollRows, type CrewMember, type FireOpsUser, type InvoiceCustomer, type InvoiceForm, type PayrollForm} from '@fireops/domain';

// Fictional, session-only fixtures. Never write these records to Supabase.
export function createDemoRecords(user:FireOpsUser,now=new Date()){
  const year=now.getFullYear();
  const timestamp=`${year}-06-22T12:00:00Z`;
  const customers:InvoiceCustomer[]=['Pine Valley Fire District (Demo)','Cedar Creek Incident Command (Demo)'].map((name,index)=>({id:`demo-customer-${index}`,companyId:'demo',name,createdAt:timestamp,updatedAt:timestamp}));
  const invoices:InvoiceForm[]=customers.map((customer,index)=>({id:`demo-invoice-${index}`,companyId:'demo',createdBy:user.id,createdByName:user.name,invoiceNumber:`DEMO-${year}-${1001+index}`,invoiceDate:`${year}-06-${20+index}`,invoiceAmount:index?18750:12480,customerId:customer.id,attachment:null,status:'submitted',submittedAt:timestamp,createdAt:timestamp,updatedAt:timestamp}));
  const payroll:PayrollForm[]=([ 'pending','approved'] as const).map((status,index)=>({id:`demo-payroll-${index}`,companyId:'demo',createdBy:'u2',createdByName:'Maya Torres',engineNumber:index?'Tender 12':'Engine 701',incidents:index?'Cedar Creek Fire (Demo)':'Pine Valley Fire (Demo)',attachment:null,rows:createPayrollRows(`${year}-06-01`).map((row,day)=>({...row,hoursWorked:day<14?(index?10:12):0,crewIds:day<14?['u2']:[],notes:day<14?'Demo incident assignment':''})),status,submittedAt:timestamp,approvedAt:index?timestamp:null,approvedBy:index?user.id:null,rejectionNotes:null,rejectedAt:null,rejectedBy:null,createdAt:timestamp,updatedAt:timestamp}));
  return {customers,invoices,payroll};
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
