import {isCompanyManager,type UserRole,type Vehicle} from './models';

// Send to VIPR: map Fleet units onto the fields a VIPR bid/quote asks for and
// build a plain-text bid package to copy from beside VIPR. VIPR has no public
// import API, so nothing is uploaded; the user submits every quote in VIPR.

/** VIPR resource categories a unit can be bid as (one per unit). */
export const viprCategories=[
  'Engine','Water Tender','Dozer','Tractor Plow','Crew Carrier','Excavator','Masticator',
  'Fuel Tender','Potable Water Tender','Gray Water Truck','Mechanic Service Truck','Lowboy','Pickup / Utility','Support',
] as const;
export type ViprCategory=typeof viprCategories[number];
export const isViprCategory=(value:unknown):value is ViprCategory=>typeof value==='string'&&(viprCategories as readonly string[]).includes(value);

/** NWCG engine types. */
export const viprEngineTypes=['Type 1','Type 2','Type 3','Type 4','Type 5','Type 6','Type 7'] as const;
export type ViprEngineType=typeof viprEngineTypes[number];
export const isViprEngineType=(value:unknown):value is ViprEngineType=>typeof value==='string'&&(viprEngineTypes as readonly string[]).includes(value);

/** Numeric VIPR fields stored in fleet_vehicles.data, with the limits the server enforces. */
export const viprNumberFields={
  pumpGpm:{label:'Pump flow',unit:'gpm',max:5000,decimals:0},
  pumpPsi:{label:'Pump pressure',unit:'psi',max:1000,decimals:0},
  tankGallons:{label:'Tank capacity',unit:'gal',max:20000,decimals:0},
  gvwrLbs:{label:'GVWR',unit:'lbs',max:200000,decimals:0},
  dailyRate:{label:'Daily rate',unit:'$/day',max:100000,decimals:2},
} as const;
export type ViprNumberField=keyof typeof viprNumberFields;
export const viprVehicleFields=['viprCategory','engineType',...Object.keys(viprNumberFields) as ViprNumberField[]] as const;
export type ViprVehicleFields=Pick<Vehicle,'viprCategory'|'engineType'|ViprNumberField>;

/** Owners and admins may build bid packages. */
export const canSendToVipr=(role:UserRole)=>isCompanyManager(role);

/** Category guess from the FireOps vehicle type, used until an owner sets one. */
export function guessViprCategory(type:string):ViprCategory{
  const t=type.toLowerCase();
  if(t.includes('dozer'))return 'Dozer';
  if(t.includes('plow'))return 'Tractor Plow';
  if(t.includes('excavator'))return 'Excavator';
  if(t.includes('masticator'))return 'Masticator';
  if(t.includes('fuel'))return 'Fuel Tender';
  if(t.includes('potable'))return 'Potable Water Tender';
  if(t.includes('gray')||t.includes('grey'))return 'Gray Water Truck';
  if(t.includes('tender')||t.includes('water'))return 'Water Tender';
  if(t.includes('engine'))return 'Engine';
  if(t.includes('crew'))return 'Crew Carrier';
  if(t.includes('mechanic')||t.includes('service truck'))return 'Mechanic Service Truck';
  if(t.includes('lowboy'))return 'Lowboy';
  if(t.includes('pickup')||t.includes('utility'))return 'Pickup / Utility';
  return 'Support';
}

/** The unit's VIPR category: the owner's choice, or a guess from its type. */
export function viprCategoryFor(vehicle:Pick<Vehicle,'type'|'viprCategory'>):{category:ViprCategory;guessed:boolean}{
  return isViprCategory(vehicle.viprCategory)?{category:vehicle.viprCategory,guessed:false}:{category:guessViprCategory(vehicle.type),guessed:true};
}

/** Engine type: the owner's choice, or read from a type like "Type 3 Engine". */
export function engineTypeFor(vehicle:Pick<Vehicle,'type'|'engineType'>):{engineType?:ViprEngineType;guessed:boolean}{
  if(isViprEngineType(vehicle.engineType))return {engineType:vehicle.engineType,guessed:false};
  const match=/\btype\s*([1-7])\b/i.exec(vehicle.type);
  return match?{engineType:`Type ${match[1]}` as ViprEngineType,guessed:true}:{guessed:false};
}

const pumpCategories:readonly ViprCategory[]=['Engine','Water Tender'];
const tankCategories:readonly ViprCategory[]=['Engine','Water Tender','Fuel Tender','Potable Water Tender','Gray Water Truck'];
export const viprCategoryHasPump=(category:ViprCategory)=>pumpCategories.includes(category);
export const viprCategoryHasTank=(category:ViprCategory)=>tankCategories.includes(category);

export type ViprFieldStatus='mapped'|'missing'|'check';
export type ViprMappedField={key:string;fireops:string;value:string;vipr:string;status:ViprFieldStatus};

const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const grouped=(value:number)=>value.toLocaleString('en-US',{maximumFractionDigits:2});
export const formatViprMoney=(value:number)=>`$${value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

/** Fleet fields mapped to VIPR fields, in VIPR order. Missing = required for the category. */
export function viprFieldsFor(vehicle:Vehicle):ViprMappedField[]{
  const {category,guessed}=viprCategoryFor(vehicle);
  const fields:ViprMappedField[]=[
    {key:'unit',fireops:'Unit number',value:vehicle.unit,vipr:'Resource ID',status:'mapped'},
    {key:'category',fireops:guessed?'Type (guessed)':'VIPR category',value:category,vipr:'VIPR category',status:guessed?'check':'mapped'},
  ];
  if(category==='Engine'){
    const engine=engineTypeFor(vehicle);
    fields.push({key:'engineType',fireops:engine.guessed?'Type (guessed)':'Engine type',value:engine.engineType??'—',vipr:'Engine type',status:!engine.engineType?'missing':engine.guessed?'check':'mapped'});
  }
  fields.push(
    {key:'vin',fireops:'VIN',value:vehicle.vin||'—',vipr:'VIN',status:vehicle.vin?'mapped':'missing'},
    {key:'makeModelYear',fireops:'Make / model / year',value:[vehicle.year||'',vehicle.make,vehicle.model].join(' ').trim()||'—',vipr:'Make / model / year',status:vehicle.make&&vehicle.model&&vehicle.year?'mapped':'missing'},
    {key:'plate',fireops:'Plate',value:vehicle.plate||'—',vipr:'License plate',status:vehicle.plate?'mapped':'check'},
  );
  if(viprCategoryHasPump(category)){
    const ok=positive(vehicle.pumpGpm)&&positive(vehicle.pumpPsi);
    fields.push({key:'pump',fireops:'Pump (gpm @ psi)',value:ok?`${grouped(vehicle.pumpGpm!)} gpm @ ${grouped(vehicle.pumpPsi!)} psi`:'—',vipr:'Pump capacity',status:ok?'mapped':'missing'});
  }
  if(viprCategoryHasTank(category))
    fields.push({key:'tank',fireops:'Tank (gal)',value:positive(vehicle.tankGallons)?`${grouped(vehicle.tankGallons)} gal`:'—',vipr:'Tank capacity',status:positive(vehicle.tankGallons)?'mapped':'missing'});
  fields.push(
    {key:'gvwr',fireops:'GVWR (lbs)',value:positive(vehicle.gvwrLbs)?`${grouped(vehicle.gvwrLbs)} lbs`:'—',vipr:'GVWR',status:positive(vehicle.gvwrLbs)?'mapped':'check'},
    {key:'dailyRate',fireops:'Daily rate',value:positive(vehicle.dailyRate)?formatViprMoney(vehicle.dailyRate):'—',vipr:'Daily rate',status:positive(vehicle.dailyRate)?'mapped':'check'},
    {key:'status',fireops:'Status',value:vehicle.status,vipr:'Availability',status:'mapped'},
  );
  return fields;
}

/** Out-of-service units can't be bid until they are fixed in Fleet. */
export const isViprBlocked=(vehicle:Pick<Vehicle,'status'>)=>vehicle.status==='Out of service';
export function viprSelectableVehicles<T extends Pick<Vehicle,'status'>>(vehicles:readonly T[]){
  return {selectable:vehicles.filter(vehicle=>!isViprBlocked(vehicle)),blocked:vehicles.filter(isViprBlocked)};
}

export function viprExportSummary(vehicles:readonly Vehicle[]){
  const fields=vehicles.flatMap(viprFieldsFor);
  return {
    units:vehicles.length,
    total:fields.length,
    mapped:fields.filter(field=>field.status==='mapped').length,
    missing:fields.filter(field=>field.status==='missing').length,
    check:fields.filter(field=>field.status==='check').length,
  };
}

const dateKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const viprBidPackageFileName=(date=new Date())=>`fireops-vipr-bid-package-${dateKey(date)}.txt`;

/** Plain-text bid package, one block per unit in VIPR field order. */
export function viprBidPackageText(vehicles:readonly Vehicle[],options:{companyName?:string;generatedAt?:Date}={}):string{
  const generatedAt=options.generatedAt??new Date();
  return [
    'FireOps → VIPR bid package',
    ...(options.companyName?[`Company: ${options.companyName}`]:[]),
    `Generated: ${dateKey(generatedAt)}`,
    `Units: ${vehicles.length}`,
    'VIPR has no public import API. Paste values into VIPR in your own session.',
    '',
    ...vehicles.flatMap(vehicle=>{
      const fields=viprFieldsFor(vehicle);
      return [
        `=== ${vehicle.unit} · ${viprCategoryFor(vehicle).category} ===`,
        ...fields.map(field=>`${field.vipr}: ${field.value}${field.status==='missing'?' (missing — fill in Fleet)':field.status==='check'?' (check)':''}`),
        '',
      ];
    }),
  ].join('\n');
}

/** Parses a VIPR number input; '' clears it. Returns an error message for bad input. */
export function parseViprNumber(field:ViprNumberField,text:string):{value?:number;error?:string}{
  const trimmed=text.replace(/[$,\s]/g,'');
  if(!trimmed)return {};
  const {label,max,decimals}=viprNumberFields[field];
  const pattern=decimals?/^\d+(\.\d{1,2})?$/:/^\d+$/;
  const value=Number(trimmed);
  if(!pattern.test(trimmed)||!Number.isFinite(value))return {error:`${label} must be a ${decimals?'number with up to 2 decimals':'whole number'}`};
  if(value<=0||value>max)return {error:`${label} must be between 1 and ${max.toLocaleString('en-US')}`};
  return {value};
}

export type ViprFormValues={viprCategory:string;engineType:string}&Record<ViprNumberField,string>;
export const viprFormValues=(vehicle?:Partial<ViprVehicleFields>):ViprFormValues=>({
  viprCategory:isViprCategory(vehicle?.viprCategory)?vehicle.viprCategory:'',
  engineType:isViprEngineType(vehicle?.engineType)?vehicle.engineType:'',
  ...Object.fromEntries((Object.keys(viprNumberFields) as ViprNumberField[]).map(field=>[field,positive(vehicle?.[field])?String(vehicle[field]):''])) as Record<ViprNumberField,string>,
});

/** Validates the VIPR section of the vehicle form; empty values clear a field. */
export function parseViprForm(values:ViprFormValues):{fields:{[K in keyof ViprVehicleFields]:ViprVehicleFields[K]|undefined};errors:Partial<Record<keyof ViprFormValues,string>>}{
  const errors:Partial<Record<keyof ViprFormValues,string>>={};
  const fields={} as {[K in keyof ViprVehicleFields]:ViprVehicleFields[K]|undefined};
  if(values.viprCategory&&!isViprCategory(values.viprCategory))errors.viprCategory='Choose a VIPR category';
  fields.viprCategory=isViprCategory(values.viprCategory)?values.viprCategory:undefined;
  if(values.engineType&&!isViprEngineType(values.engineType))errors.engineType='Choose an engine type';
  fields.engineType=isViprEngineType(values.engineType)?values.engineType:undefined;
  for(const field of Object.keys(viprNumberFields) as ViprNumberField[]){
    const parsed=parseViprNumber(field,values[field]);
    if(parsed.error)errors[field]=parsed.error;
    fields[field]=parsed.value;
  }
  return {fields,errors};
}
