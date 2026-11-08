import {createDemoDispatchData,createDemoFedRoomsData,createDemoNationalFireActivity,createPayrollRows} from '@fireops/domain';

// Session-only PostgREST adapter. Never delegates to fetch or writes to device storage.
export const demoUser={id:'demo-owner',name:'Jordan Mitchell',role:'owner' as const};
export const demoCompany={id:'demo-company',name:'North Ridge Wildfire (Demo)',code:'DEMO-2048',industry:'Wildland fire contractor',phone:'(530) 555-0100',location:'Redding, CA',logoPath:null,crewInviteLimit:20};
type Row=Record<string,any>;
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));

function seed():Record<string,Row[]>{
  const now=new Date().toISOString();
  const year=new Date().getFullYear();
  const completionDate=`${year}-03-10`;
  const currencyDate=`${year+1}-03-10`;
  const record=(id:string,data:Row)=>({record_id:id,data:{id,...data},version:1,updated_at:now});
  const crew=[{...demoUser,email:'jordan@example.com',phone:'(530) 555-0100'},{id:'demo-crew-2',name:'Maya Torres',role:'fire_fighter',email:'maya@example.com',phone:'(530) 555-0102'},{id:'demo-crew-3',name:'Cole Bennett',role:'fire_fighter',email:'cole@example.com',phone:'(530) 555-0103'}];
  const dispatch=createDemoDispatchData();
  const fedRooms=createDemoFedRoomsData();
  const photo=(name:string)=>({name,type:'image/webp',path:`demo-fleet/${name}`});
  const rows:Record<string,Row[]>={
    usfs_geographic_areas:dispatch.areas.map(row=>({...row,is_active:true})),
    usfs_dispatch_centers:dispatch.centers.map(row=>({...row,geographic_area_id:1,is_active:true})),
    usfs_priority_lists:dispatch.lists.map(row=>({...row,dispatch_center_id:101,is_active:true})),
    usfs_dispatch_entries:Object.entries(dispatch.entries).flatMap(([listId,entries])=>entries.map(row=>({...row,priority_list_file_id:Number(listId)}))),
    fedrooms_hotels:fedRooms.hotels.map(row=>({...row})),
    fedrooms_hotel_regions:fedRooms.regions.map(row=>({...row})),
    fedrooms_hotel_cities:[...new Set(fedRooms.hotels.map(hotel=>`${hotel.state}|${hotel.city}`))].map(key=>{const [state,city]=key.split('|');return {country:'United States',state,city,hotel_count:fedRooms.hotels.filter(hotel=>hotel.state===state&&hotel.city===city).length}}),
    fleet_vehicles:[record('demo-engine',{unit:'Engine 701',type:'Type 3 Engine',status:'Ready',year:2019,make:'International',model:'HV',vin:'1HTMMMML9KH483201',photo:photo('engine-701.webp'),plate:'DEMO 701',location:'Redding, CA',inspections:[],documents:[],notes:'Sample engine — explore and edit freely.'}),record('demo-tender',{unit:'Tender 12',type:'Water Tender',status:'Assigned',year:2017,make:'Peterbilt',model:'367',vin:'1XPTD4EX8HD397122',photo:photo('tender-12.webp'),assignedTo:'Maya Torres',inspections:[],documents:[]}),record('demo-dozer',{unit:'Dozer 4',type:'Dozer',status:'Out of service',year:2014,make:'Caterpillar',model:'D7R',vin:'CAT00D7RJLGP01234',photo:photo('dozer-4.webp'),inspections:[],documents:[]})],
    fleet_crew:crew.map(member=>record(member.id,{...member,status:'Active',credentials:[{id:`${member.id}-fft2`,name:'Firefighter Type 2',recordType:'Qualification',courseCode:'FFT2',completionDate,provider:'North Ridge Training Center'}],experiences:[{id:`${member.id}-experience`,incident:'Pine Valley Fire (Demo)',position:'FFT2',days:'14'}],annualRecord:{rt130CompletionDate:completionDate,rt130CurrencyDate:currencyDate,wctCompletionDate:completionDate,wctCurrencyDate:currencyDate}})),
    fleet_issues:[record('demo-issue',{vehicleId:'demo-dozer',vehicleName:'Dozer 4',title:'Replace hydraulic hose',description:'Sample maintenance issue. Inspect the hose before returning to service.',priority:'High',status:'Open',updates:[],createdBy:demoUser.name,createdById:demoUser.id,createdAt:now})],
    fleet_activities:[record('demo-activity',{action:'Engine 701 ready for dispatch',detail:'Pre-season readiness check complete (Demo)',createdBy:demoUser.name,createdById:demoUser.id,createdAt:now,tone:'complete'})],
    company_vehicle_types:['Type 3 Engine','Water Tender','Dozer'].map((name,i)=>({id:`demo-type-${i}`,name})),
    company_vehicle_inspection_items:['Tires','Lights and horn','Fluid levels','Fire shelter and PPE'].map((label,position)=>({id:`demo-check-${position}`,label,position,kind:'pass_fail'})),
    company_inventory_items:[{id:'demo-radio',name:'Bendix King handheld radio',quantity:12},{id:'demo-shelter',name:'Fire shelter',quantity:18},{id:'demo-tool',name:'Pulaski tool',quantity:8}],
    company_trainings:[{id:'demo-training',course_code:'RT-130',course_title:'Annual Fireline Safety Refresher (Demo)',starts_at:new Date(Date.now()+7*86400000).toISOString(),location:'North Ridge Training Center',instructor:'Maya Torres',capacity:20,course_information:'Review LCES, fire shelter deployment, and incident safety.'}],
    communication_threads:[{id:'demo-thread',created_by_role:'owner',subject:'Welcome to the native demo',description:'Explore the fleet, add an issue, create a training, or send a sample reply. Everything stays in this demo session.',created_by:demoUser.id,created_by_name:demoUser.name}],
    company_audit_log:[{id:'demo-audit',actor_name:demoUser.name,description:'Completed pre-season fleet review (Demo)'}],
    invoice_customers:[{id:'demo-customer',name:'Pine Valley Fire District (Demo)'}],
    invoice_forms:[{id:'demo-invoice',created_by:demoUser.id,created_by_name:demoUser.name,invoice_number:`DEMO-${year}-1001`,invoice_date:now.slice(0,10),invoice_amount:12480,customer_id:'demo-customer',attachment:null,status:'submitted',submitted_at:now}],
    payroll_forms:[{id:'demo-payroll',created_by:'demo-crew-2',created_by_name:'Maya Torres',engine_number:'Engine 701',incidents:'Pine Valley Fire (Demo)',attachment:null,rows:createPayrollRows(`${year}-06-01`).map((row,index)=>({...row,hoursWorked:index<14?12:0,crewIds:index<14?['demo-crew-2']:[],notes:index<14?'Demo incident assignment':''})),status:'pending',submitted_at:now,approved_at:null,approved_by:null,rejection_notes:null,rejected_at:null,rejected_by:null}],
  };
  for(const list of Object.values(rows))for(const row of list)Object.assign(row,{company_id:demoCompany.id,created_at:now,updated_at:now});
  return rows;
}

export function createDemoBackend(companyId=demoCompany.id){
  let tables=seed();
  for(const rows of Object.values(tables))for(const row of rows)row.company_id=companyId;
  let active=true;
  let sequence=0;
  const listeners=new Set<(table:string,payload:Row)=>void>();
  const notify=(table:string,payload:Row={eventType:'UPDATE',new:{},old:{}})=>{for(const listener of listeners)listener(table,clone(payload))};
  const response=(data:unknown,status=200,extra:Record<string,string>={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...extra}});
  const error=(message:string)=>response({message,code:'DEMO_ONLY',error:message},400);
  const fetchDemo:typeof fetch=async(input,init)=>{
    if(!active)return error('This demo has ended. Start a new demo to continue.');
    const request=input instanceof Request?input:null;
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);
    const method=(init?.method??request?.method??'GET').toUpperCase();
    const raw=init?.body??(request?await request.text():null);
    const body=typeof raw==='string'&&raw?JSON.parse(raw):{};
    const headers=new Headers(init?.headers??request?.headers);
    if(url.pathname.startsWith('/functions/v1/')){
      const name=url.pathname.split('/').pop();
      if(name==='national-fire-activity')return response(createDemoNationalFireActivity());
      if(name==='motive-integration'&&['sync','status','disconnect'].includes(body.action))return response({connected:false,configured:false,mock:true});
      return error('This external action is disabled in demo mode. No invitations, feedback, or service requests are sent.');
    }
    if(!url.pathname.startsWith('/rest/v1/'))return error('File uploads, downloads, and account actions are disabled in demo mode.');
    const name=url.pathname.slice('/rest/v1/'.length);
    if(name.startsWith('rpc/')){
      const rpc=name.slice(4);
      if(rpc==='apply_fleet_changes'){
        if(!Array.isArray(body.changes))return error('Invalid demo fleet changes.');
        for(const change of body.changes){
          const table=`fleet_${change.collection}`;
          if(!['fleet_vehicles','fleet_crew','fleet_issues','fleet_activities'].includes(table))return error('Unknown demo collection.');
          const previous=tables[table]?.find(row=>row.record_id===change.recordId);
          if((change.event==='insert'&&previous)||(change.event!=='insert'&&previous?.version!==change.expectedVersion))return response({message:'Demo record changed. Refresh and try again.',code:'40001'},409);
        }
        const results=(body.changes as Row[]).map(change=>{
          const table=`fleet_${change.collection}`;
          const rows=tables[table]??=[];
          const previous=rows.find(row=>row.record_id===change.recordId);
          const version=(previous?.version??0)+1;
          tables[table]=rows.filter(row=>row.record_id!==change.recordId);
          if(change.event!=='delete')tables[table].push({company_id:companyId,record_id:change.recordId,data:clone(change.data),version,updated_at:new Date().toISOString()});
          notify(table,{eventType:change.event==='delete'?'DELETE':previous?'UPDATE':'INSERT',old:previous??{record_id:change.recordId},new:tables[table].find(row=>row.record_id===change.recordId)??{}});
          return {...change,version};
        });
        return response(results);
      }
      if(rpc==='checkout_inventory_item'||rpc==='checkin_inventory_item'){
        const item=tables.company_inventory_items.find(row=>row.id===body.target_item_id);
        if(!item)return error('Demo inventory item not found.');
        const rows=tables.company_inventory_checkouts??=[];
        const userId=body.borrower_user_id??demoUser.id;
        const existing=rows.find(row=>row.item_id===item.id&&row.user_id===userId);
        const quantity=Number(body.checkout_quantity??body.checkin_quantity);
        if(!Number.isInteger(quantity)||quantity<1)return error('Enter a positive whole quantity.');
        if(rpc==='checkout_inventory_item'){
          // quantity is on-hand stock: checkout lowers it, check-in restores it.
          if(quantity>item.quantity)return error('Not enough items available.');
          item.quantity-=quantity;
          if(existing)existing.quantity+=quantity;
          else rows.push({company_id:companyId,item_id:item.id,user_id:userId,user_name:demoUser.name,quantity,checked_out_at:new Date().toISOString(),updated_at:new Date().toISOString()});
        }else{
          if(!existing||existing.quantity<quantity)return error('Check-in exceeds checked-out quantity.');
          existing.quantity-=quantity;
          item.quantity+=quantity;
        }
        tables.company_inventory_checkouts=rows.filter(row=>row.quantity>0);
        notify('company_inventory_items');
        notify('company_inventory_checkouts');
        return response(null);
      }
      if(rpc==='update_company_member_role'||rpc==='update_company_member_details'||/^(add|update|delete)_my_crew_(credential|experience)$/.test(rpc)||rpc==='update_my_annual_qualification_record'){
        const row=tables.fleet_crew.find(row=>row.record_id===(body.target_user_id??demoUser.id));
        if(!row)return error('Demo crew member not found.');
        if(rpc==='update_company_member_role')row.data.role=body.new_role;
        else if(rpc==='update_company_member_details')Object.assign(row.data,{name:body.member_name,email:body.member_email,phone:body.member_phone});
        else if(rpc==='update_my_annual_qualification_record')row.data.annualRecord=body.annual_record;
        else{
          const key=rpc.endsWith('credential')?'credential':'experience';
          const collection=key==='credential'?'credentials':'experiences';
          const id=body[key]?.id??body[`${key}_id`];
          row.data[collection]=(row.data[collection]??[]).filter((record:Row)=>record.id!==id);
          if(!rpc.startsWith('delete'))row.data[collection].push(body[key]);
        }
        row.version+=1;
        notify('fleet_crew',{eventType:'UPDATE',new:row,old:{}});
        return response({member:row.data});
      }
      if(rpc==='company_crew_seats_used')return response(tables.fleet_crew.length);
      if(rpc==='update_company_profile')return response({name:body.company_name,phone:body.company_phone,location:body.company_location,logo_path:null});
      return error('This action is not available in demo mode. No real records were changed.');
    }
    if(name==='app_feedback')return error('Feedback is disabled in demo mode. Nothing was sent.');
    const rows=tables[name]??=[];
    const ilike=(cell:unknown,pattern:string)=>new RegExp(`^${pattern.split('*').map(part=>part.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('.*')}$`,'i').test(String(cell??''));
    const matches=(row:Row)=>[...url.searchParams].every(([key,filter])=>{
      if(['select','order','limit','offset','on_conflict'].includes(key))return true;
      if(key==='or')return filter.slice(1,-1).split(',').some(clause=>{const [column,op,...rest]=clause.split('.');return op==='ilike'&&ilike(row[column],rest.join('.'))});
      const dot=filter.indexOf('.');const op=filter.slice(0,dot);const value=filter.slice(dot+1);
      if(op==='eq')return String(row[key])===value;
      if(op==='ilike')return ilike(row[key],value);
      if(op==='is')return value==='null'?row[key]==null:String(row[key])===value;
      if(op==='in')return value.slice(1,-1).split(',').includes(String(row[key]));
      if(op==='gte')return String(row[key])>=value;
      if(op==='lte')return String(row[key])<=value;
      return false; // Unsupported filters must never broaden a mutation.
    });
    let result=rows.filter(matches);
    if(method==='POST'){
      const values=(Array.isArray(body)?body:[body]).map(value=>({id:`demo-new-${++sequence}`,company_id:companyId,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),...value}));
      const conflict=(url.searchParams.get('on_conflict')??'id').split(',');
      tables[name]=headers.get('prefer')?.includes('resolution=merge-duplicates')?rows.filter(row=>!values.some(value=>conflict.every(key=>row[key]===value[key]))).concat(values):rows.concat(values);
      result=values;
    }else if(method==='PATCH'){
      result.forEach(row=>Object.assign(row,body,{updated_at:new Date().toISOString()}));
    }else if(method==='DELETE')tables[name]=rows.filter(row=>!matches(row));
    else if(!['GET','HEAD'].includes(method))return error('Unsupported demo operation.');
    if(!['GET','HEAD'].includes(method))notify(name);
    const count=result.length;
    const order=url.searchParams.get('order');
    if(order){const [key,direction]=order.split('.');result=[...result].sort((a,b)=>String(a[key]??'').localeCompare(String(b[key]??''))*(direction==='desc'?-1:1))}
    const offset=Number(url.searchParams.get('offset')??0);const limit=Number(url.searchParams.get('limit')??result.length);
    result=result.slice(offset,offset+limit);
    if(method==='HEAD')return new Response(null,{status:200,headers:{'Content-Range':`0-${Math.max(0,count-1)}/${count}`}});
    const single=headers.get('accept')?.includes('application/vnd.pgrst.object+json');
    if(single&&result.length!==1)return response({message:'Demo record not found',code:'PGRST116',details:`The result contains ${result.length} rows`},406);
    return response(clone(single?result[0]:result),200,{'Content-Range':`0-${Math.max(0,count-1)}/${count}`});
  };
  return {fetch:fetchDemo,subscribe(listener:(table:string,payload:Row)=>void){listeners.add(listener);return()=>listeners.delete(listener)},dispose(){active=false;tables={};listeners.clear()}};
}
