import {authedAdmin,isUuid,json,memberRole} from '../_shared/fireops-edge.ts';
import {fleetCategories,mapSamOpportunities,samSearchUrl,type SamOpportunity} from './logic.ts';

const SOURCE_URL='https://sam.gov/opportunities';
const CACHE_MS=15*60*1000;
const cache=new Map<string,{expiresAt:number;value:Record<string,unknown>}>();

Deno.serve(async request=>{
  const auth=await authedAdmin(request);
  if(!auth.ok)return auth.response;
  const {actor,admin,body}=auth;
  const companyId=String(body.companyId??'');
  if(!isUuid(companyId))return json(400,{error:'Company is invalid.'});
  if(!await memberRole(admin,companyId,actor.id))return json(403,{error:'Company access is required.'});

  const cached=cache.get(companyId);
  if(cached&&cached.expiresAt>Date.now())return json(200,cached.value);
  const apiKey=Deno.env.get('SAM_GOV_API_KEY')?.trim();
  if(!apiKey)return json(503,{error:'SAM.gov integration is not configured.'});

  const {data:vehicleRows,error:vehicleError}=await admin.from('fleet_vehicles').select('data').eq('company_id',companyId).limit(1000);
  if(vehicleError){console.error('News feed fleet lookup failed',vehicleError);return json(502,{error:'Fleet categories could not be loaded.'})}
  const categories=fleetCategories(vehicleRows??[]);

  try{
    const response=await fetch(samSearchUrl(apiKey),{
      headers:{Accept:'application/json','User-Agent':'FireOps/1.0 contracting news'},
      signal:AbortSignal.timeout(15000),
    });
    if(!response.ok)throw new Error(`SAM.gov returned ${response.status}.`);
    const payload=await response.json() as {opportunitiesData?:SamOpportunity[]};
    const value={
      fetchedAt:new Date().toISOString(),
      fleetCategories:categories.map(category=>category.label),
      sourceUrl:SOURCE_URL,
      opportunities:mapSamOpportunities(Array.isArray(payload.opportunitiesData)?payload.opportunitiesData:[],categories),
    };
    cache.set(companyId,{value,expiresAt:Date.now()+CACHE_MS});
    return json(200,value);
  }catch(error){
    console.error('SAM.gov news feed failed',error);
    return json(502,{error:'Contracting opportunities could not be loaded from SAM.gov. Try again shortly.'});
  }
});
