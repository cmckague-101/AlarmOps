import {canViewCrewRoster,crewCredentials,isCompanyManager,userRoleLabel,type CrewMember,type UserRole} from '@fireops/domain';

/** Only company managers with roster access can build personnel manifests. */
export function canCreateCrewManifest(role:UserRole):boolean{
  return isCompanyManager(role)&&canViewCrewRoster(role);
}

export type ManifestMedicMark='emt'|'medic'|null;

export type CrewManifestPerson={
  id:string;
  lineNumber:number;
  name:string;
  sex:'M'|'F'|'';
  position:string;
  additionalQuals:string[];
  notes:string;
  phone:string;
  email:string;
  roleLabel:string;
  dob:string;
  truckAssignment:string;
  callSign:string;
  medicMark:ManifestMedicMark;
  source:'demo'|'roster'|'manual';
};

export type ManifestStaffAssignment={
  personId:string;
  name:string;
  phone:string;
};

export type ManifestDispatchCenter={
  id:string;
  name:string;
  phone:string;
};

/** Fleet option for Vehicles picker (Fleet ID / make / model / VIN / plate). */
export type ManifestFleetVehicle={
  id:string;
  firNumber:string;
  make:string;
  model:string;
  vin:string;
  plate:string;
};

/** Selected vehicle — fleet identity locked when fromFleet; notes always freeform. */
export type ManifestSelectedVehicle={
  id:string;
  vehicleId:string;
  firNumber:string;
  make:string;
  model:string;
  vin:string;
  plate:string;
  notes:string;
  fromFleet:boolean;
};

export type CrewManifestDocument={
  id:string;
  title:string;
  moduleName:string;
  incidentLabel:string;
  preparedAt:string;
  sheetNotes:string;
  vehicles:ManifestSelectedVehicle[];
  people:CrewManifestPerson[];
  handCrewCoordinator:ManifestStaffAssignment;
  firecoGm:ManifestStaffAssignment;
  dispatchCenters:ManifestDispatchCenter[];
  selectedDispatchCenterId:string;
};

export type ManifestCompanyStamp={
  name:string;
  phone?:string;
  location?:string;
  ownerName?:string;
  ownerEmail?:string;
  logoDataUrl?:string;
};

/** Operational assignment on the sheet — independent from qualification codes. */
export const MANIFEST_POSITION_OPTIONS=[
  'Crew Supervisor',
  'Assistant Crew Supervisor',
  'Squad Boss',
  'Saw Squad Boss',
  'Dig Squad Boss',
  'First Saw',
  'Second Saw',
  'Dig',
] as const;

export const DEMO_MANIFEST_FLEET:ManifestFleetVehicle[]=[
  {id:'demo-fleet-overhead',firNumber:'Overhead Rig',make:'Ford',model:'F-350',vin:'1FTFW1E58MFC48941',plate:'48941'},
  {id:'demo-fleet-dig',firNumber:'Dig Crew Carrier',make:'Ford',model:'F-550',vin:'1FTEX1C87AFD12684',plate:'T612684'},
  {id:'demo-fleet-saw',firNumber:'Saw Crew Carrier',make:'Ford',model:'F-550',vin:'1FTEX1C89AFD12685',plate:'T612685'},
];

/** No operational contact is assigned until explicitly selected. */
export const DEFAULT_HAND_CREW_COORDINATOR:ManifestStaffAssignment={
  personId:'',
  name:'',
  phone:'',
};

export const DEFAULT_FIRECO_GM:ManifestStaffAssignment={
  personId:'default-fireco-gm',
  name:'Clint McCaig',
  phone:'(208) 861-7464',
};

export const DEFAULT_DISPATCH_CENTERS:ManifestDispatchCenter[]=[
  {id:'dispatch-boise',name:'Boise Dispatch',phone:'(208) 384-3400'},
];

function createId(prefix:string){
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
}

export function toManifestFleetVehicle(vehicle:{
  id:string;
  name?:string|null;
  unit?:string|null;
  make?:string|null;
  model?:string|null;
  vin?:string|null;
  plate?:string|null;
}):ManifestFleetVehicle{
  return {
    id:vehicle.id,
    firNumber:(vehicle.unit||vehicle.name||'').trim(),
    make:vehicle.make||'',
    model:vehicle.model||'',
    vin:vehicle.vin||'',
    plate:vehicle.plate||'',
  };
}

export function fleetOptionsForManifest(
  fleet:readonly ManifestFleetVehicle[],
  includeDemoFleet:boolean,
):ManifestFleetVehicle[]{
  const byId=new Map<string,ManifestFleetVehicle>();
  for(const vehicle of fleet)byId.set(vehicle.id,vehicle);
  if(includeDemoFleet){
    for(const vehicle of DEMO_MANIFEST_FLEET){
      if(!byId.has(vehicle.id))byId.set(vehicle.id,vehicle);
    }
  }
  return [...byId.values()].sort((a,b)=>a.firNumber.localeCompare(b.firNumber));
}

export function manifestVehicleFromFleet(
  vehicle:ManifestFleetVehicle,
  notes='',
):ManifestSelectedVehicle{
  return {
    id:createId('mv'),
    vehicleId:vehicle.id,
    firNumber:vehicle.firNumber,
    make:vehicle.make,
    model:vehicle.model,
    vin:vehicle.vin,
    plate:vehicle.plate,
    notes,
    fromFleet:true,
  };
}

export function addManifestVehicle(
  selected:ManifestSelectedVehicle[],
  vehicle:ManifestFleetVehicle,
  notes='',
):ManifestSelectedVehicle[]|null{
  if(selected.some(item=>item.vehicleId===vehicle.id))return null;
  return [...selected,manifestVehicleFromFleet(vehicle,notes)];
}

export function createBlankManifestVehicle():ManifestSelectedVehicle{
  return {
    id:createId('mv'),
    vehicleId:'',
    firNumber:'',
    make:'',
    model:'',
    vin:'',
    plate:'',
    notes:'',
    fromFleet:false,
  };
}

/** Notes always freeform; identity fields only patchable when not from fleet. */
export function patchManifestVehicle(
  selected:ManifestSelectedVehicle[],
  rowId:string,
  patch:Partial<Pick<ManifestSelectedVehicle,'notes'|'firNumber'|'make'|'model'|'vin'|'plate'>>,
):ManifestSelectedVehicle[]{
  return selected.map(item=>{
    if(item.id!==rowId)return item;
    if(item.fromFleet)return {...item,notes:patch.notes??item.notes};
    return {...item,...patch};
  });
}

export function removeManifestVehicle(
  selected:ManifestSelectedVehicle[],
  rowId:string,
):ManifestSelectedVehicle[]{
  return selected.filter(item=>item.id!==rowId);
}

export function createBlankManifestPerson(lineNumber:number):CrewManifestPerson{
  return {
    id:createId('person'),
    lineNumber,
    name:'',
    sex:'',
    position:'Dig',
    additionalQuals:[],
    notes:'',
    phone:'',
    email:'',
    roleLabel:'Manual',
    dob:'',
    truckAssignment:'',
    callSign:'',
    medicMark:null,
    source:'manual',
  };
}

/** Name/DOB locked for roster and demo rows; manual Add Person stays editable. */
export function isManifestPersonIdentityLocked(person:CrewManifestPerson):boolean{
  return person.source==='roster'||person.source==='demo';
}

/** Filled Ashley NF RX / FIRECO Module sample. */
export function createAshleyNfRxDemoManifest(now=new Date()):CrewManifestDocument{
  const people:CrewManifestPerson[]=[
    {id:'demo-sloan',lineNumber:1,name:'Jesse Sloan',sex:'M',position:'Crew Supervisor',additionalQuals:['DIVS','CRWB','FIRB','ENGB','RXB3','FAL1','ICT3'],notes:'',phone:'(541) 337-3946',email:'',roleLabel:'Resource Boss',dob:'03/14/1984',truckAssignment:'Overhead Rig · LIC 48941',callSign:'Sloan',medicMark:null,source:'demo'},
    {id:'demo-hanson',lineNumber:2,name:'Chris Hanson Sr',sex:'M',position:'Assistant Crew Supervisor',additionalQuals:['STEN','FIRB','HEQB','FAL3','ICT5'],notes:'',phone:'(817) 771-3138',email:'',roleLabel:'Resource Boss',dob:'11/02/1979',truckAssignment:'Dig Rig · LIC T612684',callSign:'Hanson Sr',medicMark:null,source:'demo'},
    {id:'demo-nail',lineNumber:3,name:'Tyler Nail',sex:'M',position:'Saw Squad Boss',additionalQuals:['ENGB','Faller'],notes:'',phone:'(541) 606-5118',email:'',roleLabel:'Firefighter',dob:'07/22/1991',truckAssignment:'Saw Rig · LIC T612685',callSign:'Nail',medicMark:null,source:'demo'},
    {id:'demo-scheibel',lineNumber:4,name:'David Scheibel',sex:'M',position:'First Saw',additionalQuals:['Faller (Trainee)'],notes:'',phone:'(208) 810-3478',email:'',roleLabel:'Firefighter',dob:'01/09/1996',truckAssignment:'Saw Rig · LIC T612685',callSign:'Scheibel',medicMark:null,source:'demo'},
    {id:'demo-cole',lineNumber:5,name:'Kenny Cole',sex:'M',position:'Second Saw',additionalQuals:['ENGB','Faller'],notes:'',phone:'(541) 606-5118',email:'',roleLabel:'Firefighter',dob:'05/30/1993',truckAssignment:'Saw Rig · LIC T612685',callSign:'Cole',medicMark:null,source:'demo'},
    {id:'demo-mcallister',lineNumber:6,name:'Camden McAllister',sex:'M',position:'Second Saw',additionalQuals:['ENGB','Faller'],notes:'',phone:'(208) 863-3633',email:'',roleLabel:'Firefighter',dob:'09/18/1994',truckAssignment:'Saw Rig · LIC T612685',callSign:'McAllister',medicMark:null,source:'demo'},
    {id:'demo-ciancia',lineNumber:7,name:'Micah Ciancia',sex:'M',position:'Dig',additionalQuals:[],notes:'',phone:'(208) 789-5808',email:'',roleLabel:'Firefighter',dob:'12/04/1998',truckAssignment:'Dig Rig · LIC T612684',callSign:'Ciancia',medicMark:null,source:'demo'},
    {id:'demo-prescott',lineNumber:8,name:'Casey Prescott',sex:'M',position:'Dig',additionalQuals:[],notes:'',phone:'(208) 899-5929',email:'',roleLabel:'Firefighter',dob:'04/11/1997',truckAssignment:'Dig Rig · LIC T612684',callSign:'Prescott',medicMark:null,source:'demo'},
    {id:'demo-arreola',lineNumber:9,name:'Zac Arreola',sex:'M',position:'Dig',additionalQuals:[],notes:'Main Crew Medic ++',phone:'(831) 744-3815',email:'',roleLabel:'Firefighter',dob:'08/27/1995',truckAssignment:'Dig Rig · LIC T612684',callSign:'Arreola',medicMark:'medic',source:'demo'},
    {id:'demo-shananhan',lineNumber:10,name:'Tim Shananhan',sex:'M',position:'Dig',additionalQuals:[],notes:'EMT +',phone:'(908) 566-5749',email:'',roleLabel:'Firefighter',dob:'02/16/1999',truckAssignment:'Dig Rig · LIC T612684',callSign:'Shananhan',medicMark:'emt',source:'demo'},
  ];
  const [overhead,dig,saw]=DEMO_MANIFEST_FLEET;
  return {
    id:`manifest-demo-${now.toISOString().slice(0,10)}`,
    title:'Internal Roster & Org Chart',
    moduleName:'FIRECO MODULE',
    incidentLabel:'Ashley NF RX Support — 2026',
    preparedAt:now.toISOString(),
    sheetNotes:'Ashley NF RX Support — dig and saw modules staged out of Boise.',
    vehicles:[
      {id:'mv-overhead',vehicleId:overhead!.id,firNumber:overhead!.firNumber,make:overhead!.make,model:overhead!.model,vin:overhead!.vin,plate:overhead!.plate,notes:'Overhead Rig',fromFleet:true},
      {id:'mv-dig',vehicleId:dig!.id,firNumber:dig!.firNumber,make:dig!.make,model:dig!.model,vin:dig!.vin,plate:dig!.plate,notes:'Dig Rig',fromFleet:true},
      {id:'mv-saw',vehicleId:saw!.id,firNumber:saw!.firNumber,make:saw!.make,model:saw!.model,vin:saw!.vin,plate:saw!.plate,notes:'Saw Rig',fromFleet:true},
    ],
    people,
    handCrewCoordinator:{...DEFAULT_HAND_CREW_COORDINATOR},
    firecoGm:{...DEFAULT_FIRECO_GM},
    dispatchCenters:[],
    selectedDispatchCenterId:'',
  };
}

function positionFromMember(member:CrewMember):string{
  if(member.role==='resource_boss')return 'Crew Supervisor';
  if(member.role==='owner'||member.role==='admin')return 'Crew Supervisor';
  return 'Dig';
}

function medicMarkFromMember(member:CrewMember):ManifestMedicMark{
  const blob=[member.credentialName??'',...crewCredentials(member).map(item=>`${item.name} ${item.courseCode??''}`)].join(' ').toLowerCase();
  if(/\bmedic\b|\bemt[- ]?p\b|\bparamedic\b/.test(blob))return 'medic';
  if(/\bemt\b|\bfirst aid\b/.test(blob))return 'emt';
  return null;
}

export function manifestPersonFromCrewMember(member:CrewMember,lineNumber:number):CrewManifestPerson{
  const credentials=crewCredentials(member);
  const additionalQuals=credentials
    .map(item=>(item.courseCode||item.name).trim())
    .filter(Boolean);
  const notesParts=[
    member.status==='Invited'?'Invite pending':'',
    credentials.length?`${credentials.length} credential${credentials.length===1?'':'s'} on file`:'No credentials on file',
  ].filter(Boolean);
  return {
    id:member.id,
    lineNumber,
    name:member.name,
    sex:'',
    position:positionFromMember(member),
    additionalQuals,
    notes:notesParts.join(' · '),
    phone:member.phone||'',
    email:member.email||'',
    roleLabel:userRoleLabel(member.role),
    dob:'',
    truckAssignment:'',
    callSign:'',
    medicMark:medicMarkFromMember(member),
    source:'roster',
  };
}

export function emptyCrewManifest(companyName:string,now=new Date()):CrewManifestDocument{
  return {
    id:`manifest-${now.getTime()}`,
    title:'Internal Roster & Org Chart',
    moduleName:companyName.trim()||'FIRECO MODULE',
    incidentLabel:'',
    preparedAt:now.toISOString(),
    sheetNotes:'',
    vehicles:[],
    people:[],
    handCrewCoordinator:{...DEFAULT_HAND_CREW_COORDINATOR},
    firecoGm:{...DEFAULT_FIRECO_GM},
    dispatchCenters:[],
    selectedDispatchCenterId:'',
  };
}

/** True when coordinator and dispatch have been explicitly chosen. */
export function hasManifestContacts(manifest:CrewManifestDocument):boolean{
  const coordinatorReady=Boolean(manifest.handCrewCoordinator.personId||manifest.handCrewCoordinator.name.trim());
  return coordinatorReady&&Boolean(selectedDispatchCenter(manifest));
}

export function renumberManifestPeople(people:CrewManifestPerson[]):CrewManifestPerson[]{
  return people.map((person,index)=>({...person,lineNumber:index+1}));
}

export function medicMarkLabel(mark:ManifestMedicMark):string{
  if(mark==='medic')return 'Main Crew Medic ++';
  if(mark==='emt')return 'EMT +';
  return '';
}

/** EMT column: Y when EMT/medic; blank otherwise — never N or Yes. */
export function emtColumnValue(mark:ManifestMedicMark):string{
  return mark==='emt'||mark==='medic'?'Y':'';
}

export function assignmentFromCrewMember(member:CrewMember):ManifestStaffAssignment{
  return {personId:member.id,name:member.name,phone:member.phone||''};
}

export function selectedDispatchCenter(manifest:CrewManifestDocument):ManifestDispatchCenter|undefined{
  return manifest.dispatchCenters.find(center=>center.id===manifest.selectedDispatchCenterId);
}

export function addDispatchCenter(
  centers:ManifestDispatchCenter[],
  input:{name:string;phone?:string},
):{centers:ManifestDispatchCenter[];added:ManifestDispatchCenter}|null{
  const name=input.name.trim();
  if(!name)return null;
  if(centers.some(center=>center.name.toLocaleLowerCase()===name.toLocaleLowerCase()))return null;
  const added:ManifestDispatchCenter={
    id:createId('dispatch'),
    name,
    phone:(input.phone??'').trim(),
  };
  return {centers:[...centers,added],added};
}

export function staffAssignmentOptions(
  crew:CrewMember[],
  current:ManifestStaffAssignment,
):ManifestStaffAssignment[]{
  const fromCrew=crew
    .slice()
    .sort((a,b)=>a.name.localeCompare(b.name))
    .map(assignmentFromCrewMember);
  if(!current.personId&&!current.name.trim())return fromCrew;
  if(!fromCrew.some(option=>option.personId===current.personId||option.name===current.name)){
    return [current,...fromCrew];
  }
  return fromCrew.map(option=>option.personId===current.personId?current:option);
}

export function buildManifestShareText(
  manifest:CrewManifestDocument,
  company:ManifestCompanyStamp,
):{subject:string;body:string}{
  const dispatch=selectedDispatchCenter(manifest);
  const companyLine=[
    company.name,
    company.ownerName,
    company.phone,
    company.ownerEmail,
    company.location,
  ].filter(Boolean).join(' · ');
  const peopleLines=manifest.people.map(person=>{
    const quals=person.additionalQuals.join(', ')||'—';
    const emt=emtColumnValue(person.medicMark)||'—';
    return `${person.lineNumber}. ${person.name||'—'} · DOB ${person.dob||'—'} · M/F ${person.sex||'—'} · ${person.position||'—'} · EMT ${emt} · ${person.phone||'—'} · quals ${quals} · Notes: ${[person.notes,medicMarkLabel(person.medicMark)].filter(Boolean).join(' · ')||'—'}`;
  });
  const vehicleLines=manifest.vehicles.map(vehicle=>{
    const id=vehicle.firNumber||'—';
    const unit=[vehicle.make,vehicle.model].filter(Boolean).join(' ')||'—';
    return `${id} · ${unit} · VIN ${vehicle.vin||'—'} · plate ${vehicle.plate||'—'} · ${vehicle.notes||'—'}`;
  });
  const subject=`${company.name||'FireCo'} personnel manifest${manifest.incidentLabel?` — ${manifest.incidentLabel}`:''}`;
  const body=[
    companyLine,
    '',
    manifest.moduleName,
    manifest.title,
    manifest.incidentLabel||'Crew personnel manifest',
    `Prepared ${new Date(manifest.preparedAt).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}`,
    '',
    'Personnel',
    ...(peopleLines.length?peopleLines:['(none)']),
    '',
    'Vehicles',
    ...(vehicleLines.length?vehicleLines:['(none)']),
    '',
    `Crew Coordinator: ${manifest.handCrewCoordinator.name}${manifest.handCrewCoordinator.phone?` · ${manifest.handCrewCoordinator.phone}`:''}`,
    `Dispatch Center: ${dispatch?.name||'—'}${dispatch?.phone?` · ${dispatch.phone}`:''}`,
    manifest.sheetNotes?`\nManifest Notes\n${manifest.sheetNotes}`:'',
  ].filter(line=>line!==undefined).join('\n').trim();
  return {subject,body};
}
