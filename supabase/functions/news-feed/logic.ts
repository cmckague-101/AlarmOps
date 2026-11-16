export type SamOpportunity={
  noticeId?:unknown;
  title?:unknown;
  solicitationNumber?:unknown;
  type?:unknown;
  fullParentPathName?:unknown;
  department?:unknown;
  subTier?:unknown;
  office?:unknown;
  postedDate?:unknown;
  responseDeadLine?:unknown;
  reponseDeadLine?:unknown;
  naicsCode?:unknown;
  typeOfSetAsideDescription?:unknown;
  setAside?:unknown;
  active?:unknown;
  placeOfPerformance?:unknown;
  uiLink?:unknown;
};

export type FleetCategory={label:string;terms:string[]};

const CATEGORY_TERMS:Record<string,string[]>={
  engine:['engine','engines','wildland engine','fire engine','pumper'],
  'water tender':['water tender','water tenders','water handling','tactical tender','support tender','water truck'],
  dozer:['dozer','dozers','bulldozer','heavy equipment','equipment with operator'],
  crew:['crew','crews','handcrew','hand crew'],
  ambulance:['ambulance','medical transport','ems'],
  bus:['bus','crew carrier','personnel transport'],
  'fuel tender':['fuel tender','fuel truck','mobile fueling'],
  excavator:['excavator','heavy equipment','equipment with operator'],
  skidder:['skidder','heavy equipment','equipment with operator'],
  tractor:['tractor','heavy equipment','equipment with operator'],
};

function text(value:unknown){return typeof value==='string'?value.trim():''}
function nullable(value:unknown){const valueText=text(value);return valueText||null}
function unique(values:string[]){return [...new Set(values)]}
function normalized(value:string){return value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}

export function fleetCategories(rows:Array<{data?:unknown}>):FleetCategory[]{
  const labels=rows.flatMap(row=>{
    if(!row.data||typeof row.data!=='object'||Array.isArray(row.data))return [];
    const data=row.data as Record<string,unknown>;
    const category=text(data.viprCategory)||text(data.type);
    return category?[category]:[];
  });
  return unique(labels).map(label=>{
    const key=normalized(label);
    const mapped=Object.entries(CATEGORY_TERMS).find(([name])=>key.includes(name))?.[1]??[];
    const own=key.split(' ').filter(term=>term.length>2&&!['type','unit'].includes(term));
    return {label,terms:unique([...mapped,...own])};
  });
}

export function matchedCategories(opportunity:SamOpportunity,categories:FleetCategory[]){
  const haystack=normalized([text(opportunity.title),text(opportunity.type),text(opportunity.office),text(opportunity.fullParentPathName)].join(' '));
  return categories.filter(category=>category.terms.some(term=>haystack.includes(normalized(term)))).map(category=>category.label);
}

function performance(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const place=value as Record<string,unknown>;
  const city=place.city&&typeof place.city==='object'&&!Array.isArray(place.city)?text((place.city as Record<string,unknown>).name):'';
  const state=place.state&&typeof place.state==='object'&&!Array.isArray(place.state)?text((place.state as Record<string,unknown>).code):'';
  return [city,state,text(place.zip)].filter(Boolean).join(', ')||null;
}

export function mapSamOpportunities(rows:SamOpportunity[],categories:FleetCategory[],limit=20){
  if(categories.length===0)return [];
  return rows.flatMap(row=>{
    const id=text(row.noticeId);
    const title=text(row.title);
    if(!id||!title||text(row.active).toLowerCase()==='no')return [];
    const matches=matchedCategories(row,categories);
    if(matches.length===0)return [];
    return [{
      id,
      title,
      solicitationNumber:nullable(row.solicitationNumber),
      noticeType:text(row.type)||'Opportunity',
      agency:text(row.fullParentPathName)||text(row.department)||text(row.subTier)||'Federal agency',
      office:nullable(row.office),
      postedAt:text(row.postedDate),
      responseDeadline:nullable(row.responseDeadLine)??nullable(row.reponseDeadLine),
      naicsCode:nullable(row.naicsCode),
      setAside:nullable(row.typeOfSetAsideDescription)??nullable(row.setAside),
      placeOfPerformance:performance(row.placeOfPerformance),
      matchedFleetCategories:matches,
      sourceUrl:`https://sam.gov/opp/${encodeURIComponent(id)}/view`,
    }];
  }).sort((left,right)=>Date.parse(right.postedAt)-Date.parse(left.postedAt)).slice(0,limit);
}

export function samSearchUrl(apiKey:string,today=new Date()){
  const from=new Date(today);
  from.setUTCDate(from.getUTCDate()-90);
  const format=(date:Date)=>`${String(date.getUTCMonth()+1).padStart(2,'0')}/${String(date.getUTCDate()).padStart(2,'0')}/${date.getUTCFullYear()}`;
  const url=new URL('https://api.sam.gov/opportunities/v2/search');
  url.searchParams.set('api_key',apiKey);
  url.searchParams.set('postedFrom',format(from));
  url.searchParams.set('postedTo',format(today));
  url.searchParams.set('organizationName','FOREST SERVICE');
  url.searchParams.set('limit','250');
  url.searchParams.set('offset','0');
  for(const type of ['o','k','p','r','s'])url.searchParams.append('ptype',type);
  return url;
}
