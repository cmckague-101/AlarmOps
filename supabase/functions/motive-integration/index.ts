import { createClient } from 'npm:@supabase/supabase-js@2.112.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const motiveScopes = [
  'companies.read',
  'vehicles.read',
  'assets.read',
  'locations.vehicle_locations_list',
  'locations.vehicle_locations_single',
  'locations.asset_locations',
  'fault_codes.read',
  'camera_connections.read',
].join(' ');

// Database types are not generated for Edge Functions; keep service client schema-dynamic.
type AdminClient = any;
type EncryptedValue = {encrypted: string; iv: string};
type MotiveIntegration = {
  encrypted_client_id:string;client_id_iv:string;encrypted_client_secret:string;client_secret_iv:string;
  encrypted_access_token:string|null;access_token_iv:string|null;encrypted_refresh_token:string|null;refresh_token_iv:string|null;token_expires_at:string|null;
  last_sync_at:string|null;sync_snapshot:Record<string,unknown>|null;
};
type MotiveDiagnosticCode = {
  id:string;code:string;label:string;description?:string;status:'open'|'closed';type?:'constant'|'intermittent';
  firstObservedAt?:string;lastObservedAt?:string;occurrenceCount?:number;severity?:string;network?:string;
};
type MotiveEntity = {id:string;type:'vehicle'|'asset';vin:string;location:string;speed:string;updatedAt:string;latitude?:number;longitude?:number;odometerMiles?:number;diagnostics?:MotiveDiagnosticCode[]};
type MotiveCaptureResponse = {
  request_id?:string|number;camera_type?:string;position?:string;status?:string;failure_reason?:string;created_at?:string;
  error?:string|{message?:string};message?:string;errors?:Array<string|{message?:string}>;
  vehicle?:{id?:string|number}|null;asset?:{id?:string|number}|null;
  images?:Record<string,{url?:string;expires_at?:string}>;
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {...corsHeaders, 'Content-Type': 'application/json'},
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(secret: string, usages: KeyUsage[]) {
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = base64ToBytes(secret); }
  catch { throw new Error('MOTIVE_ENCRYPTION_KEY must be base64 encoded.'); }
  if (raw.byteLength !== 32) throw new Error('MOTIVE_ENCRYPTION_KEY must decode to 32 bytes.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages);
}

async function encryptValue(value: string, secret: string): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, new TextEncoder().encode(value));
  return {encrypted: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv)};
}

async function decryptValue(encrypted: string, iv: string, secret: string) {
  const key = await encryptionKey(secret, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({name: 'AES-GCM', iv: base64ToBytes(iv)}, key, base64ToBytes(encrypted));
  return new TextDecoder().decode(decrypted);
}

function redirectWithResult(returnTo: string, values: Record<string, string>) {
  const url = new URL(returnTo);
  Object.entries(values).forEach(([key, value]) => url.searchParams.set(key, value));
  return Response.redirect(url.toString(), 302);
}

function validReturnTo(value: string, request: Request) {
  try {
    const target = new URL(value);
    if (target.protocol === 'fireops:' && target.hostname === 'settings') return target.toString();
    const requestOrigin = request.headers.get('Origin');
    if (requestOrigin && (target.protocol === 'https:' || target.protocol === 'http:') && target.origin === requestOrigin) return target.toString();
    const allowed = (Deno.env.get('MOTIVE_ALLOWED_RETURN_URLS') ?? '').split(',').map(item => item.trim()).filter(Boolean);
    return allowed.some(item => target.toString().startsWith(item)) ? target.toString() : '';
  } catch {
    return '';
  }
}

async function companyAccess(admin: AdminClient, companyId: string, userId: string, ownerOnly: boolean) {
  let memberQuery = admin.from('company_members').select('user_id').eq('company_id', companyId).eq('user_id', userId);
  if (ownerOnly) memberQuery = memberQuery.eq('role', 'owner');
  const [{data: membership, error: memberError}, {data: scopedAdmin, error: adminError}] = await Promise.all([
    memberQuery.maybeSingle(),
    admin.from('system_admin_company_access').select('user_id').eq('company_id', companyId).eq('user_id', userId).gt('expires_at', new Date().toISOString()).maybeSingle(),
  ]);
  if (memberError || adminError) throw new Error('Motive access could not be verified.');
  return Boolean(membership || scopedAdmin);
}

async function refreshAccessToken(admin:AdminClient,companyId:string,integration:MotiveIntegration,encryptionSecret:string,redirectUri:string) {
  if (!integration.encrypted_refresh_token || !integration.refresh_token_iv) throw new Error('Motive refresh token is unavailable. Reconnect Motive.');
  const [clientId,clientSecret,refreshToken]=await Promise.all([
    decryptValue(integration.encrypted_client_id,integration.client_id_iv,encryptionSecret),
    decryptValue(integration.encrypted_client_secret,integration.client_secret_iv,encryptionSecret),
    decryptValue(integration.encrypted_refresh_token,integration.refresh_token_iv,encryptionSecret),
  ]);
  const response=await fetch('https://api.gomotive.com/oauth/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
    body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken,redirect_uri:redirectUri,client_id:clientId,client_secret:clientSecret}),signal:AbortSignal.timeout(12000),
  });
  const body=await response.json().catch(()=>null) as {access_token?:string;refresh_token?:string;expires_in?:number}|null;
  if(!response.ok||!body?.access_token)throw new Error('Motive session expired. Reconnect Motive.');
  const access=await encryptValue(body.access_token,encryptionSecret);
  const rotated=body.refresh_token?await encryptValue(body.refresh_token,encryptionSecret):null;
  const expiresAt=new Date(Date.now()+Math.max(60,Number(body.expires_in)||7200)*1000).toISOString();
  const update:Record<string,unknown>={encrypted_access_token:access.encrypted,access_token_iv:access.iv,token_expires_at:expiresAt,last_verified_at:new Date().toISOString()};
  if(rotated){update.encrypted_refresh_token=rotated.encrypted;update.refresh_token_iv=rotated.iv;}
  const {error}=await admin.from('company_motive_integrations').update(update).eq('company_id',companyId);
  if(error)throw new Error('Refreshed Motive session could not be saved.');
  return body.access_token;
}

async function accessToken(admin:AdminClient,companyId:string,integration:MotiveIntegration,encryptionSecret:string,redirectUri:string){
  if(integration.encrypted_access_token&&integration.access_token_iv&&integration.token_expires_at&&Date.parse(integration.token_expires_at)>Date.now()+60_000){
    return decryptValue(integration.encrypted_access_token,integration.access_token_iv,encryptionSecret);
  }
  return refreshAccessToken(admin,companyId,integration,encryptionSecret,redirectUri);
}

async function motivePages(path:string,token:string,key:'vehicles'|'assets'){
  const records:unknown[]=[];
  for(let page=1;page<=100;page+=1){
    const url=new URL(`https://api.gomotive.com${path}`);url.searchParams.set('per_page','100');url.searchParams.set('page_no',String(page));
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(15000)});
    if(!response.ok){const error=new Error(response.status===403?'Motive permission missing. Enable required OAuth scopes, then reconnect.':`Motive API request failed (${response.status}).`) as Error&{status?:number};error.status=response.status;throw error;}
    const body=await response.json() as Record<string,unknown>;
    const pageRecords=Array.isArray(body[key])?body[key] as unknown[]:[];records.push(...pageRecords);
    const pagination=body.pagination as {total?:number}|undefined;
    if(!pageRecords.length||records.length>=Number(pagination?.total??records.length))break;
  }
  return records;
}

function normalizedVin(value:unknown){return typeof value==='string'?value.trim().toUpperCase():'';}
function finiteNumber(value:unknown){const parsed=Number(value);return Number.isFinite(parsed)?parsed:undefined;}
function optionalText(value:unknown){return typeof value==='string'&&value.trim()?value.trim():undefined;}
async function motiveFaultCodes(token:string){
  const records:unknown[]=[];
  for(let page=1;page<=100;page+=1){
    const url=new URL('https://api.gomotive.com/v1/fault_codes');url.searchParams.set('status','open');url.searchParams.set('per_page','100');url.searchParams.set('page_no',String(page));
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(15000)});
    if(!response.ok){const error=new Error(response.status===403?'Motive diagnostic-code permission missing. Reconnect Motive to authorize fault codes.':`Motive diagnostic-code request failed (${response.status}).`) as Error&{status?:number};error.status=response.status;throw error;}
    const body=await response.json() as Record<string,unknown>;const pageRecords=Array.isArray(body.fault_codes)?body.fault_codes:[];records.push(...pageRecords);
    if(!pageRecords.length||records.length>=Number(body.total??records.length))break;
  }
  return records;
}
function diagnosticsByVehicle(rows:unknown[]){
  const byVehicleId=new Map<string,MotiveDiagnosticCode[]>();const byVin=new Map<string,MotiveDiagnosticCode[]>();
  for(const row of rows){
    const fault=(row as {fault_code?:Record<string,unknown>})?.fault_code;if(!fault||fault.status!=='open')continue;
    const vehicle=fault.vehicle as Record<string,unknown>|null|undefined;const vehicleId=vehicle?.id==null?'':String(vehicle.id);const vin=normalizedVin(vehicle?.vin);const code=optionalText(fault.code)??optionalText(fault.code_label);if(!code||(!vehicleId&&!vin))continue;
    const type=fault.type==='constant'||fault.type==='intermittent'?fault.type:undefined;const occurrenceCount=finiteNumber(fault.occurrence_count)??finiteNumber(fault.num_observations);
    const diagnostic:MotiveDiagnosticCode={id:String(fault.id??`${vehicleId}:${code}`),code,label:optionalText(fault.code_label)??code,status:'open',...(optionalText(fault.code_description)?{description:optionalText(fault.code_description)}:{}),...(type?{type}:{}),...(optionalText(fault.first_observed_at)?{firstObservedAt:optionalText(fault.first_observed_at)}:{}),...(optionalText(fault.last_observed_at)?{lastObservedAt:optionalText(fault.last_observed_at)}:{}),...(occurrenceCount===undefined?{}:{occurrenceCount}),...(optionalText(fault.dtc_severity)?{severity:optionalText(fault.dtc_severity)}:{}),...(optionalText(fault.network)?{network:optionalText(fault.network)}:{})};
    if(vehicleId)byVehicleId.set(vehicleId,[...(byVehicleId.get(vehicleId)??[]),diagnostic]);if(vin)byVin.set(vin,[...(byVin.get(vin)??[]),diagnostic]);
  }
  return {byVehicleId,byVin};
}
function odometerMilesFrom(source:Record<string,unknown>|null|undefined){
  if(!source)return undefined;
  const miles=finiteNumber(source.odometer_mi)??finiteNumber(source.odometer_miles)??finiteNumber(source.odometer);
  if(miles!==undefined)return miles;
  const meters=finiteNumber(source.odometer_in_meters)??finiteNumber(source.odometer_meters);
  return meters===undefined?undefined:meters/1609.344;
}
function motiveEntities(vehicleRows:unknown[],assetRows:unknown[]):MotiveEntity[]{
  const vehicles=vehicleRows.flatMap(row=>{const vehicle=(row as {vehicle?:Record<string,unknown>})?.vehicle;if(!vehicle)return[];const vin=normalizedVin(vehicle.vin);if(!vin)return[];const location=vehicle.current_location as Record<string,unknown>|null|undefined;const latitude=finiteNumber(location?.lat);const longitude=finiteNumber(location?.lon);const speed=finiteNumber(location?.speed);const odometerMiles=odometerMilesFrom(location)??odometerMilesFrom(vehicle);return [{id:String(vehicle.id),type:'vehicle' as const,vin,location:typeof location?.description==='string'&&location.description.trim()?location.description:'Location unavailable',speed:speed===undefined?'Speed unavailable':`${Math.round(speed)} mph`,updatedAt:typeof location?.located_at==='string'?location.located_at:String(vehicle.updated_at??new Date().toISOString()),...(latitude===undefined?{}:{latitude}),...(longitude===undefined?{}:{longitude}),...(odometerMiles===undefined?{}:{odometerMiles})}];});
  const assets=assetRows.flatMap(row=>{const asset=(row as {asset?:Record<string,unknown>})?.asset;if(!asset)return[];const vin=normalizedVin(asset.vin);if(!vin)return[];const gateway=asset.asset_gateway as Record<string,unknown>|null|undefined;const location=gateway?.last_location as Record<string,unknown>|null|undefined;const latitude=finiteNumber(location?.lat);const longitude=finiteNumber(location?.lon);const kph=finiteNumber(location?.ground_speed_kph);const odometerMiles=odometerMilesFrom(location)??odometerMilesFrom(gateway)??odometerMilesFrom(asset);return [{id:String(asset.id),type:'asset' as const,vin,location:typeof location?.address==='string'&&location.address.trim()?location.address:'Location unavailable',speed:kph===undefined?'Speed unavailable':`${Math.round(kph*0.621371)} mph`,updatedAt:typeof location?.located_at==='string'?location.located_at:new Date().toISOString(),...(latitude===undefined?{}:{latitude}),...(longitude===undefined?{}:{longitude}),...(odometerMiles===undefined?{}:{odometerMiles})}];});
  return [...vehicles,...assets];
}

async function motiveRequest(path:string,init:RequestInit,token:string){
  return fetch(`https://api.gomotive.com${path}`,{
    ...init,
    headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(init.headers??{})},
    signal:AbortSignal.timeout(15000),
  });
}

async function integrationWithToken(admin:AdminClient,companyId:string,encryptionSecret:string,redirectUri:string){
  const {data:integration,error}=await admin.from('company_motive_integrations').select('encrypted_client_id,client_id_iv,encrypted_client_secret,client_secret_iv,encrypted_access_token,access_token_iv,encrypted_refresh_token,refresh_token_iv,token_expires_at,last_sync_at,sync_snapshot').eq('company_id',companyId).maybeSingle();
  if(error)throw new Error('Motive connection could not be loaded.');
  if(!integration?.encrypted_access_token)throw new Error('Motive is not connected.');
  return {integration:integration as MotiveIntegration,token:await accessToken(admin,companyId,integration as MotiveIntegration,encryptionSecret,redirectUri)};
}

async function mappedMotiveEntity(admin:AdminClient,companyId:string,fleetVehicleId:string){
  const {data,error}=await admin.from('company_motive_vehicle_mappings').select('motive_entity_type,motive_entity_id').eq('company_id',companyId).eq('fleet_vehicle_id',fleetVehicleId).maybeSingle();
  if(error)throw new Error('Motive vehicle mapping could not be loaded.');
  if(!data)throw new Error('This vehicle is not matched to Motive. Sync fleet data and verify its VIN.');
  return {type:data.motive_entity_type as 'vehicle'|'asset',id:String(data.motive_entity_id)};
}

function motiveCaptureError(response:Response,result:MotiveCaptureResponse|null){
  const detail=typeof result?.error==='string'?result.error:result?.error?.message??result?.message??result?.errors?.map(error=>typeof error==='string'?error:error.message).find(Boolean);
  console.error('Motive image capture request rejected:',{status:response.status,detail:detail??'No error detail returned'});
  if(response.status===403)return 'Motive denied camera capture. The connected OAuth token does not have access to the Image Capture API; verify the endpoint authentication requirements with Motive API support.';
  return detail?.trim()||`Motive could not start the camera capture (${response.status}).`;
}

async function captureMotiveImage(admin:AdminClient,companyId:string,fleetVehicleId:string,encryptionSecret:string,redirectUri:string){
  const entity=await mappedMotiveEntity(admin,companyId,fleetVehicleId);
  if(!/^\d+$/.test(entity.id))throw new Error('Motive vehicle mapping is invalid. Sync fleet data again.');
  const {integration,token:initialToken}=await integrationWithToken(admin,companyId,encryptionSecret,redirectUri);
  const position=entity.type==='vehicle'?'front_facing':'side_left';
  const body={position,...(entity.type==='vehicle'?{vehicle_id:Number(entity.id)}:{asset_id:Number(entity.id)})};
  let token=initialToken;
  let response=await motiveRequest('/v1/image_captures',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},token);
  if(response.status===401){token=await refreshAccessToken(admin,companyId,integration,encryptionSecret,redirectUri);response=await motiveRequest('/v1/image_captures',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},token);}
  const result=await response.json().catch(()=>null) as MotiveCaptureResponse|null;
  if(!response.ok)throw new Error(motiveCaptureError(response,result));
  if(!result?.request_id||!result.camera_type)throw new Error('Motive returned an invalid camera capture response.');
  return {status:'pending',requestId:String(result.request_id),cameraType:result.camera_type,position:result.position??position,capturedAt:result.created_at??new Date().toISOString()};
}

async function motiveCaptureStatus(admin:AdminClient,companyId:string,fleetVehicleId:string,requestId:string,cameraType:string,encryptionSecret:string,redirectUri:string){
  const entity=await mappedMotiveEntity(admin,companyId,fleetVehicleId);
  const {integration,token:initialToken}=await integrationWithToken(admin,companyId,encryptionSecret,redirectUri);
  const path=`/v1/image_captures/${encodeURIComponent(cameraType)}/${encodeURIComponent(requestId)}`;
  let response=await motiveRequest(path,{method:'GET'},initialToken);
  if(response.status===401){const token=await refreshAccessToken(admin,companyId,integration,encryptionSecret,redirectUri);response=await motiveRequest(path,{method:'GET'},token);}
  const result=await response.json().catch(()=>null) as MotiveCaptureResponse|null;
  const returnedId=String(entity.type==='vehicle'?result?.vehicle?.id??'':result?.asset?.id??'');
  if(returnedId!==entity.id)throw new Error('Motive camera response did not match this vehicle.');
  if(result?.status==='pending')return {status:'pending',requestId,cameraType,position:result.position??'front_facing',capturedAt:result.created_at};
  if(!response.ok||result?.status==='failed')throw new Error(result?.failure_reason||'Motive camera capture failed.');
  const position=result?.position??'front_facing';
  const image=result?.images?.[position]??Object.values(result?.images??{})[0];
  if(result?.status!=='success'||!image?.url)throw new Error('Motive returned an invalid camera image.');
  return {status:'ready',imageUrl:image.url,expiresAt:image.expires_at,position,capturedAt:result.created_at??new Date().toISOString()};
}

async function syncFleet(admin:AdminClient,companyId:string,encryptionSecret:string,redirectUri:string){
  const {data:integration,error:integrationError}=await admin.from('company_motive_integrations').select('encrypted_client_id,client_id_iv,encrypted_client_secret,client_secret_iv,encrypted_access_token,access_token_iv,encrypted_refresh_token,refresh_token_iv,token_expires_at,last_sync_at,sync_snapshot').eq('company_id',companyId).maybeSingle();
  if(integrationError)throw new Error('Motive connection could not be loaded.');
  if(!integration?.encrypted_access_token)return {connected:false,vehicles:[],matched:0,unmatched:0,duplicateVins:[]};
  if(integration.last_sync_at&&integration.sync_snapshot&&Date.parse(integration.last_sync_at)>Date.now()-60_000)return integration.sync_snapshot;
  let token=await accessToken(admin,companyId,integration as MotiveIntegration,encryptionSecret,redirectUri);
  let rows:[unknown[],unknown[]];
  try{rows=await Promise.all([motivePages('/v1/vehicle_locations',token,'vehicles'),motivePages('/v1/asset_locations',token,'assets')]);}
  catch(error){if((error as {status?:number}).status!==401)throw error;token=await refreshAccessToken(admin,companyId,integration as MotiveIntegration,encryptionSecret,redirectUri);rows=await Promise.all([motivePages('/v1/vehicle_locations',token,'vehicles'),motivePages('/v1/asset_locations',token,'assets')]);}
  let faultRows:unknown[]=[];let diagnosticsAvailable=true;let faultError:unknown;
  try{faultRows=await motiveFaultCodes(token);}catch(error){
    if((error as {status?:number}).status===401){token=await refreshAccessToken(admin,companyId,integration as MotiveIntegration,encryptionSecret,redirectUri);try{faultRows=await motiveFaultCodes(token);}catch(retryError){faultError=retryError;}}
    else faultError=error;
  }
  if(faultError){if((faultError as {status?:number}).status===403){diagnosticsAvailable=false;console.warn('Motive fault-code scope is unavailable; reconnect integration to grant fault_codes.read.');}else throw faultError;}
  const diagnostics=diagnosticsByVehicle(faultRows);
  const entities=motiveEntities(rows[0],rows[1]).map(entity=>entity.type==='vehicle'&&diagnosticsAvailable?{...entity,diagnostics:diagnostics.byVehicleId.get(entity.id)??diagnostics.byVin.get(entity.vin)??[]}:entity);
  const {data:fleetRows,error:fleetError}=await admin.from('fleet_vehicles').select('record_id,data').eq('company_id',companyId);
  if(fleetError)throw new Error('FireOps vehicles could not be matched.');
  const fleetByVin=new Map<string,{record_id:string;data:Record<string,unknown>}[]>();
  for(const row of fleetRows??[]){const vin=normalizedVin(row.data?.vin);if(!vin)continue;fleetByVin.set(vin,[...(fleetByVin.get(vin)??[]),row]);}
  const motiveByVin=new Map<string,MotiveEntity[]>();for(const entity of entities)motiveByVin.set(entity.vin,[...(motiveByVin.get(entity.vin)??[]),entity]);
  const duplicateVins=[...motiveByVin].filter(([,items])=>items.length!==1).map(([vin])=>vin);
  const snapshots:(MotiveEntity&{fleetVehicleId:string;motiveId:string;entityType:'vehicle'|'asset'})[]=[];const mappings:Record<string,unknown>[]=[];
  for(const [vin,fleet] of fleetByVin){const motive=motiveByVin.get(vin);if(fleet.length!==1||motive?.length!==1)continue;const entity=motive[0];snapshots.push({...entity,motiveId:entity.id,entityType:entity.type,fleetVehicleId:fleet[0].record_id});mappings.push({company_id:companyId,fleet_vehicle_id:fleet[0].record_id,motive_entity_type:entity.type,motive_entity_id:entity.id,vin,matched_at:new Date().toISOString()});}
  if(mappings.length){
    const {error}=await admin.from('company_motive_vehicle_mappings').upsert(mappings,{onConflict:'company_id,fleet_vehicle_id'});if(error)throw new Error('Motive vehicle matches could not be saved.');
    await admin.from('company_motive_vehicle_mappings').delete().eq('company_id',companyId).not('fleet_vehicle_id','in',`(${mappings.map(item=>item.fleet_vehicle_id).join(',')})`);
  }else await admin.from('company_motive_vehicle_mappings').delete().eq('company_id',companyId);
  const syncedAt=new Date().toISOString();
  const snapshot={connected:true,vehicles:snapshots,matched:snapshots.length,unmatched:[...fleetByVin.values()].reduce((sum,items)=>sum+items.length,0)-snapshots.length,duplicateVins,diagnosticsAvailable,syncedAt};
  await admin.from('company_motive_integrations').update({last_verified_at:syncedAt,last_sync_at:syncedAt,sync_snapshot:snapshot}).eq('company_id',companyId);
  return snapshot;
}

async function handleCallback(request: Request, admin: AdminClient, encryptionSecret: string, redirectUri: string) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(state)) return jsonResponse(400, {error: 'OAuth state is invalid.'});

  const {data: pending, error: stateError} = await admin.from('company_motive_oauth_states')
    .delete().eq('state', state).gt('expires_at', new Date().toISOString())
    .select('company_id,user_id,return_to').maybeSingle();
  if (stateError || !pending) return jsonResponse(400, {error: 'OAuth request expired or was already used.'});

  const motiveError = url.searchParams.get('error');
  if (motiveError) return redirectWithResult(pending.return_to, {motive: 'error', motive_error: 'Motive authorization was denied.'});
  const code = url.searchParams.get('code') ?? '';
  if (!code) return redirectWithResult(pending.return_to, {motive: 'error', motive_error: 'Motive did not return an authorization code.'});

  const {data: integration, error: integrationError} = await admin.from('company_motive_integrations')
    .select('encrypted_client_id,client_id_iv,encrypted_client_secret,client_secret_iv')
    .eq('company_id', pending.company_id).maybeSingle();
  if (integrationError || !integration) return redirectWithResult(pending.return_to, {motive: 'error', motive_error: 'Motive credentials are no longer configured.'});

  try {
    const [clientId, clientSecret] = await Promise.all([
      decryptValue(integration.encrypted_client_id, integration.client_id_iv, encryptionSecret),
      decryptValue(integration.encrypted_client_secret, integration.client_secret_iv, encryptionSecret),
    ]);
    const tokenResponse = await fetch('https://api.gomotive.com/oauth/token', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json'},
      body: new URLSearchParams({grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret}),
      signal: AbortSignal.timeout(12000),
    });
    const tokenBody = await tokenResponse.json().catch(() => null) as {access_token?: string;refresh_token?: string;expires_in?: number;scope?: string}|null;
    if (!tokenResponse.ok || !tokenBody?.access_token || !tokenBody.refresh_token) {
      console.error('Motive token exchange failed with status:', tokenResponse.status);
      return redirectWithResult(pending.return_to, {motive: 'error', motive_error: 'Motive could not complete authorization. Try again.'});
    }
    const [accessToken, refreshToken] = await Promise.all([
      encryptValue(tokenBody.access_token, encryptionSecret),
      encryptValue(tokenBody.refresh_token, encryptionSecret),
    ]);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Math.max(60, Number(tokenBody.expires_in) || 7200) * 1000).toISOString();
    const {error: saveError} = await admin.from('company_motive_integrations').update({
      encrypted_access_token: accessToken.encrypted,
      access_token_iv: accessToken.iv,
      encrypted_refresh_token: refreshToken.encrypted,
      refresh_token_iv: refreshToken.iv,
      token_expires_at: expiresAt,
      scopes: tokenBody.scope || motiveScopes,
      connected_at: now.toISOString(),
      last_verified_at: now.toISOString(),
      updated_by: pending.user_id,
    }).eq('company_id', pending.company_id);
    if (saveError) throw saveError;
    return redirectWithResult(pending.return_to, {motive: 'connected'});
  } catch (error) {
    console.error('Motive OAuth callback failed:', error);
    return redirectWithResult(pending.return_to, {motive: 'error', motive_error: 'Motive connection could not be saved. Try again.'});
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders});

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionSecret = Deno.env.get('MOTIVE_ENCRYPTION_KEY');
  const redirectUri = Deno.env.get('MOTIVE_REDIRECT_URI');
  if (!supabaseUrl || !serviceRoleKey || !encryptionSecret || !redirectUri) {
    console.error('Missing Motive integration environment configuration.');
    return jsonResponse(500, {error: 'Motive integration is not configured.'});
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {auth: {autoRefreshToken: false, persistSession: false}});
  if (request.method === 'GET') return handleCallback(request, admin, encryptionSecret, redirectUri);
  if (request.method !== 'POST') return jsonResponse(405, {error: 'Method not allowed.'});

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return jsonResponse(401, {error: 'Authentication required.'});
  const {data: userResult, error: userError} = await admin.auth.getUser(token);
  const actor = userResult.user;
  if (userError || !actor) return jsonResponse(401, {error: 'Session is invalid or expired.'});

  let input: {companyId?: string;action?: string;clientId?: string;clientSecret?: string;returnTo?: string;fleetVehicleId?:string;requestId?:string;cameraType?:string};
  try { input = await request.json(); }
  catch { return jsonResponse(400, {error: 'Invalid request body.'}); }

  const companyId = input.companyId?.trim() ?? '';
  const action = input.action ?? 'status';
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return jsonResponse(400, {error: 'Company is invalid.'});
  if (!['status', 'sync', 'capture-image', 'capture-status', 'connect', 'disconnect'].includes(action)) return jsonResponse(400, {error: 'Action is invalid.'});
  try {
    const ownerOnly=!['sync','capture-image','capture-status'].includes(action);
    if (!await companyAccess(admin, companyId, actor.id, ownerOnly)) return jsonResponse(403, {error: ownerOnly?'Company owner access required.':'Company membership required.'});
  } catch {
    return jsonResponse(500, {error: 'Motive access could not be verified.'});
  }

  if(action==='sync'){
    try{return jsonResponse(200,await syncFleet(admin,companyId,encryptionSecret,redirectUri));}
    catch(error){console.error('Motive fleet sync failed:',error);return jsonResponse(502,{error:error instanceof Error?error.message:'Motive fleet could not be synchronized.'});}
  }

  if(action==='capture-image'||action==='capture-status'){
    const fleetVehicleId=input.fleetVehicleId?.trim()??'';
    if(!/^[0-9a-f-]{36}$/i.test(fleetVehicleId))return jsonResponse(400,{error:'Vehicle is invalid.'});
    try{
      if(action==='capture-image')return jsonResponse(200,await captureMotiveImage(admin,companyId,fleetVehicleId,encryptionSecret,redirectUri));
      const requestId=input.requestId?.trim()??'';const cameraType=input.cameraType?.trim()??'';
      if(!/^\d+$/.test(requestId)||!['dashcam','omnicam'].includes(cameraType))return jsonResponse(400,{error:'Camera capture request is invalid.'});
      return jsonResponse(200,await motiveCaptureStatus(admin,companyId,fleetVehicleId,requestId,cameraType,encryptionSecret,redirectUri));
    }catch(error){console.error('Motive camera capture failed:',error);return jsonResponse(502,{error:error instanceof Error?error.message:'Motive camera image could not be captured.'});}
  }

  if (action === 'status') {
    const {data, error} = await admin.from('company_motive_integrations')
      .select('client_id_last_four,encrypted_access_token,connected_at,last_verified_at,token_expires_at').eq('company_id', companyId).maybeSingle();
    if (error) return jsonResponse(500, {error: 'Motive connection status could not be loaded.'});
    return jsonResponse(200, {
      configured: Boolean(data),
      connected: Boolean(data?.encrypted_access_token),
      clientIdLastFour: data?.client_id_last_four,
      connectedAt: data?.connected_at,
      lastVerifiedAt: data?.last_verified_at,
      tokenExpiresAt: data?.token_expires_at,
    });
  }

  if (action === 'disconnect') {
    const [{error}, {error: stateDeleteError}] = await Promise.all([
      admin.from('company_motive_integrations').delete().eq('company_id', companyId),
      admin.from('company_motive_oauth_states').delete().eq('company_id', companyId),
    ]);
    if (error || stateDeleteError) return jsonResponse(500, {error: 'Motive connection could not be removed.'});
    return jsonResponse(200, {connected: false, configured: false});
  }

  const clientId = input.clientId?.trim() ?? '';
  const clientSecret = input.clientSecret?.trim() ?? '';
  const returnTo = validReturnTo(input.returnTo?.trim() ?? '', request);
  if (clientId.length < 8 || clientId.length > 512 || /\s/.test(clientId)) return jsonResponse(400, {error: 'Enter a valid Motive client ID.'});
  if (clientSecret.length < 8 || clientSecret.length > 1024) return jsonResponse(400, {error: 'Enter a valid Motive client secret.'});
  if (!returnTo) return jsonResponse(400, {error: 'OAuth return URL is invalid.'});

  try {
    const [encryptedClientId, encryptedClientSecret] = await Promise.all([
      encryptValue(clientId, encryptionSecret),
      encryptValue(clientSecret, encryptionSecret),
    ]);
    const now = new Date().toISOString();
    const {error: saveError} = await admin.from('company_motive_integrations').upsert({
      company_id: companyId,
      encrypted_client_id: encryptedClientId.encrypted,
      client_id_iv: encryptedClientId.iv,
      encrypted_client_secret: encryptedClientSecret.encrypted,
      client_secret_iv: encryptedClientSecret.iv,
      client_id_last_four: clientId.slice(-4),
      encrypted_access_token: null,
      access_token_iv: null,
      encrypted_refresh_token: null,
      refresh_token_iv: null,
      token_expires_at: null,
      scopes: motiveScopes,
      connected_at: null,
      last_verified_at: null,
      last_sync_at: null,
      sync_snapshot: null,
      updated_by: actor.id,
    });
    if (saveError) throw saveError;

    await admin.from('company_motive_oauth_states').delete().eq('company_id', companyId);
    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const {error: stateError} = await admin.from('company_motive_oauth_states').insert({state, company_id: companyId, user_id: actor.id, return_to: returnTo, expires_at: expiresAt});
    if (stateError) throw stateError;

    const authorizationUrl = new URL('https://gomotive.com/oauth/authorize');
    authorizationUrl.search = new URLSearchParams({client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: motiveScopes, state}).toString();
    return jsonResponse(200, {authorizationUrl: authorizationUrl.toString()});
  } catch (error) {
    console.error('Motive OAuth setup failed:', error);
    return jsonResponse(500, {error: 'Motive authorization could not be started.'});
  }
});
