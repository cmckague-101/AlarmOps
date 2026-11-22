import { useEffect, useSyncExternalStore } from "react";
import type {
  Activity,
  AnnualQualificationRecord,
  AssignableUserRole,
  CrewCredential,
  CrewExperience,
  CrewMember,
  FireOpsUser,
  FleetIssue,
  MotiveCameraCapture,
  MotiveCameraCaptureRequest,
  MotiveConnection,
  MotiveVehicleSnapshot,
  NifcIncident,
  VehicleInspection,
  VehicleStatus,
} from "@fireops/domain";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { isDemoActive, supabase } from "@/lib/supabase";
import { useSession } from "@/providers/session-provider";
import { fleetDetailKey,getOfflineFleet,guardOfflineFleetWrite,projectOfflineFleet,refreshOfflineFleet,subscribeOfflineFleet,type FleetModelRecord } from './offline-fleet-model';
import type {DetailTarget} from './offline-detail-editor';
import type {SyncRecord} from '@fireops/domain';
import { onAppResume, refreshOnRejoin } from './app-resume';

export type FleetVehicleFile = {
  name: string;
  type: string | null;
  path: string | null;
};

export type FleetVehicleDocument = {
  inspectionDate?: string;
  id: string;
  name: string;
  file: FleetVehicleFile;
};

export type FleetVehicle = {
  id: string;
  name: string;
  type: string;
  status: string;
  location: string | null;
  detail: string | null;
  year: string | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  plate: string | null;
  assignedTo: string | null;
  assignedFire?: Pick<NifcIncident, "id" | "name" | "state">;
  motive?: MotiveVehicleSnapshot;
  notes: string | null;
  /** Free-text oil change target (e.g. "45,000 mi") and its YYYY-MM-DD due date. */
  nextOilChange?: string;
  nextOilChangeDue?: string;
  inspections: VehicleInspection[];
  photo: FleetVehicleFile | null;
  documents: FleetVehicleDocument[];
  files: { label: string; file: FleetVehicleFile }[];
  updatedAt: string | null;
  source: Record<string, unknown>;
};

export async function captureMotiveCameraImage(companyId:string,fleetVehicleId:string):Promise<MotiveCameraCapture> {
  if(!supabase)throw new Error("Company is unavailable.");
  const client=supabase;
  const invoke=async(body:Record<string,string>)=>{
    const {data,error}=await client.functions.invoke<MotiveCameraCaptureRequest>("motive-integration",{body:{companyId,...body}});
    if(error){
      const context=(error as {context?:Response}).context;
      const response=context instanceof Response?await context.clone().json().catch(()=>null) as {error?:string}|null:null;
      throw new Error(response?.error??"Motive camera image could not be captured.");
    }
    if(!data)throw new Error("Motive camera returned an invalid response.");
    return data;
  };
  let result=await invoke({action:"capture-image",fleetVehicleId});
  for(let attempt=0;result.status==="pending"&&attempt<30;attempt+=1){
    await new Promise(resolve=>setTimeout(resolve,2000));
    result=await invoke({action:"capture-status",fleetVehicleId,requestId:result.requestId,cameraType:result.cameraType});
  }
  if(result.status!=="ready")throw new Error("Motive camera is still processing the image. Try again shortly.");
  return result;
}

export type SharedFleetSnapshot = {
  vehicles: FleetVehicle[];
  issues: FleetIssue[];
  crew: CrewMember[];
  activities: Activity[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  pendingDetails?: Readonly<Record<string,string>>;
};

type FleetCollection = "vehicles" | "issues" | "crew" | "activities";
type VehicleRow = Record<string, unknown>;
type FleetRecordRow = {
  record_id: string;
  data: unknown;
  version: number;
  updated_at: string;
};
type FleetChangeResult = {
  collection: FleetCollection;
  event: "insert" | "update" | "delete";
  recordId: string;
  version: number;
};

const tables: Record<FleetCollection, string> = {
  vehicles: "fleet_vehicles",
  issues: "fleet_issues",
  crew: "fleet_crew",
  activities: "fleet_activities",
};
const versions: Record<FleetCollection, Map<string, number>> = {
  vehicles: new Map(),
  issues: new Map(),
  crew: new Map(),
  activities: new Map(),
};

let snapshot: SharedFleetSnapshot = {
  vehicles: [],
  issues: [],
  crew: [],
  activities: [],
  loading: true,
  refreshing: false,
  error: null,
};
let visibleSnapshot=snapshot;
const emptyFleet:SharedFleetSnapshot={vehicles:[],issues:[],crew:[],activities:[],loading:false,refreshing:false,error:null};
const loadingFleet:SharedFleetSnapshot={...emptyFleet,loading:true};
let activeCompanyId: string | null | undefined;
let activeUserId:string|null|undefined;
let activeRole:string|null|undefined;
const observedDeletes=new Map<string,string>();
let companyVersion = 0;
let channel: RealtimeChannel | null = null;
let request: Promise<void> | null = null;
let requestVersion = -1;
let refreshQueued = false;
let queuedRefreshShowsIndicator = false;
let fleetChangeSequence = 0;
const listeners = new Set<() => void>();
const readVersions=new WeakMap<object,{scope:number;revision:string;pending:boolean}>();
function rememberRead<T extends object>(record:T,revision:string,pending=false):T{readVersions.set(record,{scope:companyVersion,revision,pending});return record}
export function fleetReadVersion(record:{id:string},collection:'vehicles'|'issues'):number{
  const captured=readVersions.get(record);const current=versions[collection].get(record.id);
  if(!captured||captured.scope!==companyVersion||captured.pending)throw new Error('Unconfirmed or old-account data cannot be used for this action. Sync/review and reopen this record.');
  if(current===undefined||!Number.isSafeInteger(current)||captured.revision!==String(current))throw new Error('Record changed while this view was open. Refresh and reopen it before saving.');
  return current;
}

function text(row: VehicleRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function vehicleFile(value: unknown): FleetVehicleFile | null {
  if (!value || typeof value !== "object") return null;
  const row = value as VehicleRow;
  const name = text(row, "name");
  if (!name) return null;
  return { name, type: text(row, "type"), path: text(row, "path") };
}

function normalizeVehicle(row: VehicleRow): FleetVehicle {
  const payload =
    row.data && typeof row.data === "object"
      ? { ...row, ...(row.data as VehicleRow) }
      : row;
  const makeModel = [
    text(payload, "year"),
    text(payload, "make"),
    text(payload, "model"),
  ]
    .filter(Boolean)
    .join(" ");
  const name =
    text(payload, "unit", "name", "label", "vehicle_name", "call_sign") ??
    "Unnamed vehicle";
  const assignedTo = text(payload, "assignedTo", "assigned_to");
  const files = [
    ["VIPR checklist", vehicleFile(payload.viprChecklist)],
    ["DOT inspection", vehicleFile(payload.dotInspection)],
    ["Registration", vehicleFile(payload.registration)],
    ["Insurance", vehicleFile(payload.insurance)],
    ["Contract", vehicleFile(payload.contract)],
  ].flatMap(([label, file]) =>
    file ? [{ label: label as string, file: file as FleetVehicleFile }] : [],
  );
  const photo = vehicleFile(payload.photo);
  const documents = Array.isArray(payload.documents)
    ? payload.documents.flatMap((document) => {
        if (!document || typeof document !== "object") return [];
        const value = document as VehicleRow;
        const file = vehicleFile(value.file);
        return file
          ? [
              {
                id: text(value, "id") ?? createFleetId(),
                name: text(value, "name") ?? "Document",
                inspectionDate: text(value, "inspectionDate") ?? undefined,
                file,
              },
            ]
          : [];
      })
    : [];

  return {
    id: text(payload, "id", "record_id") ?? `${name}-${makeModel}`,
    name,
    type: text(payload, "type", "vehicle_type", "category") ?? "Vehicle",
    status: text(payload, "status", "readiness") === "Maintenance"
      ? "Out of service"
      : text(payload, "status", "readiness") ?? "Unknown",
    location: text(payload, "location", "current_location", "station_name"),
    detail: makeModel || text(payload, "description"),
    year: text(payload, "year"),
    make: text(payload, "make"),
    model: text(payload, "model"),
    vin: text(payload, "vin"),
    plate: text(payload, "plate"),
    assignedTo,
    assignedFire:
      payload.assignedFire && typeof payload.assignedFire === "object"
        ? (payload.assignedFire as Pick<NifcIncident, "id" | "name" | "state">)
        : undefined,
    motive:
      payload.motive && typeof payload.motive === "object"
        ? (payload.motive as MotiveVehicleSnapshot)
        : undefined,
    notes: text(payload, "notes"),
    nextOilChange: text(payload, "nextOilChange") ?? undefined,
    nextOilChangeDue: text(payload, "nextOilChangeDue") ?? undefined,
    inspections: Array.isArray(payload.inspections) ? payload.inspections as VehicleInspection[] : [],
    photo,
    documents,
    files: [
      ...files,
      ...documents.map((document) => ({
        label: document.name,
        file: document.file,
      })),
    ],
    updatedAt: text(
      payload,
      "updatedAt",
      "updated_at",
      "createdAt",
      "created_at",
    ),
    source:
      row.data && typeof row.data === "object"
        ? (row.data as VehicleRow)
        : payload,
  };
}

function records<T>(rows: FleetRecordRow[]): T[] {
  return rows.flatMap((row) =>
    row.data && typeof row.data === "object" ? [row.data as T] : [],
  );
}

function rebuildVisible(){
  const local=activeCompanyId&&activeUserId?getOfflineFleet({companyId:activeCompanyId,userId:activeUserId}):null;
  if(!local){visibleSnapshot=snapshot;return}
  const remote:FleetModelRecord[]=[
    ...snapshot.vehicles.map(vehicle=>({entityType:'vehicle' as const,entityId:vehicle.id,revision:revisionText(versions.vehicles.get(vehicle.id)),record:displayRecord(vehicle.source)})),
    ...snapshot.issues.map(issue=>({entityType:'issue' as const,entityId:issue.id,revision:revisionText(versions.issues.get(issue.id)),record:displayRecord(issue)})),
  ];
  const projected=projectOfflineFleet(remote,local,observedDeletes);
  const motive=new Map(snapshot.vehicles.map(vehicle=>[vehicle.id,vehicle.motive]));
  const vehicles=projected.records.filter(row=>row.entityType==='vehicle'&&row.record).map(row=>{const value=normalizeVehicle({data:row.record});return rememberRead({...value,motive:motive.get(value.id)??value.motive},row.revision,!!projected.pending[fleetDetailKey(row)])}).sort((a,b)=>a.name.localeCompare(b.name));
  const issues=projected.records.filter(row=>row.entityType==='issue'&&row.record).map(row=>{const value=row.record as unknown as FleetIssue;return rememberRead({...value,status:value.status??'Open',updates:value.updates??[]},row.revision,!!projected.pending[fleetDetailKey(row)])}).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  const available=local.loaded&&local.offline&&(vehicles.length>0||issues.length>0);
  visibleSnapshot={...snapshot,vehicles,issues,pendingDetails:projected.pending,...(available?{loading:false,error:null}:{})};
}
// Legacy payloads may still contain undefined optional fields; display their wire JSON, not a forged base.
function displayRecord(value:unknown):SyncRecord{return JSON.parse(JSON.stringify(value)) as SyncRecord}
const activityLoadLimit=100;
let motiveLoadSequence=0;
function revisionText(value:number|undefined){return value!==undefined&&Number.isSafeInteger(value)&&value>=0?String(value):'0'}
function emit(next: SharedFleetSnapshot) {
  snapshot = next;rebuildVisible();
  listeners.forEach((listener) => listener());
}
subscribeOfflineFleet(()=>{rebuildVisible();listeners.forEach(listener=>listener())});

function patchFleetRecord(
  collection: FleetCollection,
  event: "upsert" | "delete",
  recordId: string,
  data?: unknown,
  version?: number,
) {
  const currentVersion = versions[collection].get(recordId) ?? 0;
  if (version !== undefined && version < currentVersion) return;

  if (event === "delete") {
    if(collection==='vehicles'||collection==='issues')observedDeletes.set(`${collection==='vehicles'?'vehicle':'issue'}:${recordId}`,revisionText(version??versions[collection].get(recordId)));
    versions[collection].delete(recordId);
    emit({
      ...snapshot,
      [collection]: snapshot[collection].filter((record) => record.id !== recordId),
    });
    return;
  }
  if (!data || typeof data !== "object") return;
  if (version !== undefined) versions[collection].set(recordId, version);
  if(collection==='vehicles'||collection==='issues')observedDeletes.delete(`${collection==='vehicles'?'vehicle':'issue'}:${recordId}`);

  const value =
    collection === "vehicles"
      ? normalizeVehicle({ data } as VehicleRow)
      : collection === "issues"
        ? {
            ...(data as FleetIssue),
            status: (data as FleetIssue).status ?? "Open",
            updates: (data as FleetIssue).updates ?? [],
          }
        : data;
  if(collection==='vehicles'||collection==='issues')rememberRead(value as object,revisionText(version??currentVersion));
  const records = [
    value,
    ...snapshot[collection].filter((record) => record.id !== recordId),
  ];
  if (collection === "vehicles")
    (records as FleetVehicle[]).sort((a, b) => a.name.localeCompare(b.name));
  if (collection === "issues")
    (records as FleetIssue[]).sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  emit({ ...snapshot, [collection]: records });
}

export function createFleetId() {
  if (typeof globalThis.crypto?.randomUUID === "function")
    return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function detailTargets(records:readonly {collection:FleetCollection;record:{id:string}}[]):DetailTarget[]{
  return records.flatMap(({collection,record})=>{
    if(collection!=='vehicles'&&collection!=='issues')return [];
    const targets:DetailTarget[]=[{entityType:collection==='vehicles'?'vehicle':'issue',entityId:record.id}];
    const parent=(record as {vehicleId?:unknown}).vehicleId;
    if(collection==='issues'&&typeof parent==='string')targets.push({entityType:'vehicle',entityId:parent});
    return targets;
  });
}
async function guardFleetWrite(targets:DetailTarget[],version:number){
  if(!activeCompanyId||!activeUserId)throw new Error('Company resources are unavailable.');
  const scope={companyId:activeCompanyId,userId:activeUserId};
  const release=await guardOfflineFleetWrite(scope,targets,createFleetId());
  try{
    if(version!==companyVersion)throw new Error('Resources account changed. Reopen this screen.');
    const local=getOfflineFleet(scope);
    for(const target of targets){
      const cached=local?.records.find(row=>fleetDetailKey(row)===fleetDetailKey(target));
      const current=versions[target.entityType==='vehicle'?'vehicles':'issues'].get(target.entityId);
      if(cached&&(cached.record===null||BigInt(cached.revision)>BigInt(revisionText(current))))throw new Error('Saved data is newer than the online fleet snapshot. Refresh fleet before other actions.');
      if(current!==undefined&&!Number.isSafeInteger(current))throw new Error('This record revision requires the saved detail editor.');
    }
    return release;
  }catch(error){release();throw error}
}
async function applyFleetChanges(companyId:string,changes:unknown[],version:number){
  const client=supabase;if(!client)throw new Error('Company resources are unavailable.');
  let token:string|undefined;
  if(!isDemoActive()){
    const {data,error}=await client.auth.getSession();
    if(error||!data.session||data.session.user.id!==activeUserId||version!==companyVersion)throw new Error('Resources account changed. Reopen this screen.');
    token=data.session.access_token;
  }
  const request=client.rpc('apply_fleet_changes',{target_company_id:companyId,changes});
  return token?await request.setHeader('Authorization',`Bearer ${token}`):await request;
}
export function assertFleetRecordVersion(collection:FleetCollection,id:string,version:number|undefined){
  if(version===undefined||!Number.isSafeInteger(version)||versions[collection].get(id)!==version)throw new Error('Record changed while this form was open. Reopen the editor before saving.');
}
async function saveFleetRecords(records: { collection: FleetCollection; record: { id: string }; expectedVersion?:number }[]) {
  if (!supabase || !activeCompanyId)throw new Error('Company resources are unavailable.');
  const companyId=activeCompanyId;const version=companyVersion;
  const release=await guardFleetWrite(detailTargets(records),version);
  try{
    const changes=records.map(item=>{const {collection,record}=item;const captured='expectedVersion' in item;const expectedVersion=captured?item.expectedVersion:versions[collection].get(record.id);if(captured&&(expectedVersion===undefined||!Number.isSafeInteger(expectedVersion)))throw new Error('Record changed while this form was open. Reopen the editor before saving.');return {collection,event:expectedVersion===undefined?'insert':'update',recordId:record.id,data:record,...(expectedVersion===undefined?{}:{expectedVersion})}});
    const {data,error}=await applyFleetChanges(companyId,changes,version);
    if(error){
      if(error.code==='40001'||error.code==='PT409'){await refreshFleet({showIndicator:false});throw new Error('Record changed elsewhere. Latest resources data was loaded; reopen the editor before saving.')}
      throw new Error(error.message);
    }
    if(version!==companyVersion)throw new Error('Account changed while saving. Check the original account before retrying.');
    const savedRecords=new Map(records.map(({collection,record})=>[`${collection}:${record.id}`,record]));
    ((data??[]) as FleetChangeResult[]).forEach(result=>patchFleetRecord(result.collection,result.event==='delete'?'delete':'upsert',result.recordId,savedRecords.get(`${result.collection}:${result.recordId}`),result.version));
    refreshOfflineFleet();
  }finally{release()}
}

type CapturedFleetVersion={version:number|undefined;companyId:string|null;userId:string|null};
function assertCapturedScope(captured:CapturedFleetVersion|undefined){if(captured&&(captured.companyId!==activeCompanyId||captured.userId!==activeUserId))throw new Error('Resources account changed. Reopen this screen.')}
export async function saveFleetRecord<T extends { id: string }>(
  collection: FleetCollection,
  record: T,
  captured?:CapturedFleetVersion,
) {
  assertCapturedScope(captured);
  await saveFleetRecords([{ collection, record,...(captured?{expectedVersion:captured.version}:{}) }]);
}

export async function inviteCrewMember(
  companyId: string,
  details: { email: string; name: string; phone: string },
) {
  if (!supabase) throw new Error("Invitation service is unavailable.");
  const { data, error } = await supabase.functions.invoke("invite-company-member", {
    body: { companyId, ...details },
  });
  if (error) throw new Error((data as { error?: string } | null)?.error ?? error.message);
  await refreshFleet({ showIndicator: false });
}

export async function resendCrewInvitation(companyId: string, userId: string) {
  if (!supabase) throw new Error("Invitation service is unavailable.");
  const { data, error } = await supabase.functions.invoke<{ resent?: boolean }>(
    "invite-company-member",
    { body: { action: "resend", companyId, userId } },
  );
  if (error) {
    const context = (error as { context?: Response }).context;
    const body = context instanceof Response
      ? await context.clone().json().catch(() => null) as { error?: string } | null
      : null;
    throw new Error(body?.error ?? "Invitation could not be resent.");
  }
  if (!data?.resent) throw new Error("Invitation service returned an invalid response.");
}

export async function addMyCrewCredential(
  companyId: string,
  credential: CrewCredential,
) {
  if (!supabase) throw new Error("Qualifications are unavailable.");
  const { error } = await supabase.rpc("add_my_crew_credential", {
    target_company_id: companyId,
    credential,
  });
  if (error) throw new Error(error.message);
  await refreshFleet({ showIndicator: false });
}

export async function updateMyCrewCredential(companyId:string,credential:CrewCredential) {
  if(!supabase)throw new Error('Qualifications are unavailable.');
  const {error}=await supabase.rpc('update_my_crew_credential',{target_company_id:companyId,credential});
  if(error)throw new Error(error.message);
  await refreshFleet({showIndicator:false});
}

export async function deleteMyCrewCredential(companyId:string,credentialId:string) {
  if(!supabase)throw new Error('Qualifications are unavailable.');
  const {error}=await supabase.rpc('delete_my_crew_credential',{target_company_id:companyId,credential_id:credentialId});
  if(error)throw new Error(error.message);
  await refreshFleet({showIndicator:false});
}

export async function addMyCrewExperience(
  companyId: string,
  experience: CrewExperience,
) {
  if (!supabase) throw new Error("Qualifications are unavailable.");
  const { error } = await supabase.rpc("add_my_crew_experience", {
    target_company_id: companyId,
    experience,
  });
  if (error) throw new Error(error.message);
  await refreshFleet({ showIndicator: false });
}

export async function updateMyCrewExperience(companyId:string,experience:CrewExperience) {
  if(!supabase)throw new Error('Qualifications are unavailable.');
  const {error}=await supabase.rpc('update_my_crew_experience',{target_company_id:companyId,experience});
  if(error)throw new Error(error.message);
  await refreshFleet({showIndicator:false});
}

export async function deleteMyCrewExperience(companyId:string,experienceId:string) {
  if(!supabase)throw new Error('Qualifications are unavailable.');
  const {error}=await supabase.rpc('delete_my_crew_experience',{target_company_id:companyId,experience_id:experienceId});
  if(error)throw new Error(error.message);
  await refreshFleet({showIndicator:false});
}

export async function updateMyAnnualQualificationRecord(companyId:string,annualRecord:AnnualQualificationRecord) {
  if(!supabase)throw new Error('Qualifications are unavailable.');
  const {error}=await supabase.rpc('update_my_annual_qualification_record',{target_company_id:companyId,annual_record:annualRecord});
  if(error)throw new Error(error.message);
  await refreshFleet({showIndicator:false});
}

export async function saveCrewMember(
  member: CrewMember,
  user: FireOpsUser,
  detail: string,
) {
  const activity: Activity = {
    id: createFleetId(),
    action: `Credentials updated for ${member.name}`,
    detail,
    createdBy: user.name,
    createdById: user.id,
    createdAt: new Date().toISOString(),
    targetType: "crew",
    targetId: member.id,
    tone: "complete",
  };
  await saveFleetRecords([
    { collection: "crew", record: member },
    { collection: "activities", record: activity },
  ]);
}

const roleUpdateTimeoutMs=8000;

export async function updateCrewMemberRole(companyId:string,member:CrewMember,role:AssignableUserRole):Promise<CrewMember> {
  if(!supabase)throw new Error("Company is unavailable.");
  for(let attempt=0;attempt<2;attempt+=1){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),roleUpdateTimeoutMs);
    try{
      const result=await supabase.rpc("update_company_member_role",{target_company_id:companyId,target_user_id:member.id,new_role:role}).abortSignal(controller.signal);
      if(!result.error)return {...member,role};
      if(!controller.signal.aborted)throw new Error(result.error.message);
    }catch(error){
      if(!controller.signal.aborted)throw error;
    }finally{
      clearTimeout(timeout);
    }
  }
  throw new Error("Role update timed out. Check your connection and try again.");
}

export async function updateCrewMemberDetails(companyId:string,member:CrewMember,details:{name:string;email:string;phone:string}):Promise<CrewMember> {
  if(!supabase)throw new Error("Company is unavailable.");
  const {data,error}=await supabase.rpc("update_company_member_details",{target_company_id:companyId,target_user_id:member.id,member_name:details.name,member_email:details.email,member_phone:details.phone});
  if(error)throw new Error(error.message);
  return (data as {member?:CrewMember}|null)?.member??{...member,...details};
}

export async function removeCrewMember(companyId: string, userId: string) {
  if (isDemoActive()) throw new Error('Crew removal is disabled in demo mode. No real members were removed.');
  if (!supabase) throw new Error("Crew removal service is unavailable.");
  const { data: authData, error: authError } = await supabase.auth.refreshSession();
  if (authError || !authData.session) {
    throw new Error("Your session expired. Sign in again before removing a crew member.");
  }
  type RemovalResult = {
    removed?: boolean;
    accountDeleted?: boolean;
    accountCleanupFailed?: boolean;
    crewDeleted?: boolean;
    attributionChanges?: { collection: FleetCollection; record: { id: string }; version: number }[];
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const { data, error } = await supabase.functions.invoke<RemovalResult>("remove-company-member", {
      body: { companyId, userId },
      headers: { Authorization: `Bearer ${authData.session.access_token}` },
      signal: controller.signal,
    });
    if (error) {
      const context = (error as { context?: Response }).context;
      const body = context instanceof Response
        ? await context.clone().json().catch(() => null) as { error?: string } | null
        : null;
      throw new Error(body?.error ?? "Crew member could not be removed.");
    }
    if (!data?.removed) {
      throw new Error("Crew removal service returned an invalid response.");
    }
    for (const change of data.attributionChanges ?? []) {
      if (change.record?.id) patchFleetRecord(change.collection, "upsert", change.record.id, change.record, change.version);
    }
    if (data.crewDeleted) patchFleetRecord("crew", "delete", userId);
    void refreshFleet({ showIndicator: false });
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Crew removal timed out. Check your connection and try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadCrewSeatsUsed(companyId: string) {
  if (!supabase) throw new Error("Crew usage is unavailable.");
  const { data, error } = await supabase.rpc("company_crew_seats_used", {
    target_company_id: companyId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function deleteFleetVehicle(
  vehicle: FleetVehicle,
  linkedIssues: FleetIssue[],
  user: FireOpsUser,
) {
  if (!supabase || !activeCompanyId)
    throw new Error("Company resources are unavailable.");
  const version=companyVersion;
  const vehicleVersion = fleetReadVersion(vehicle,'vehicles');
  if (vehicleVersion === undefined)
    throw new Error("Vehicle changed elsewhere. Refresh and try again.");

  const issueChanges = linkedIssues.map((issue) => {
    const expectedVersion = versions.issues.get(issue.id);
    if (expectedVersion === undefined)
      throw new Error("Linked issues changed elsewhere. Refresh and try again.");
    return {
      collection: "issues",
      event: "delete",
      recordId: issue.id,
      expectedVersion,
    };
  });
  const activityRecord: Activity = {
    id: createFleetId(),
    action: `${vehicle.name} deleted from fleet`,
    detail: linkedIssues.length
      ? `${linkedIssues.length} linked ${linkedIssues.length === 1 ? "issue" : "issues"} also deleted`
      : "Vehicle record deleted",
    createdBy: user.name,
    createdById: user.id,
    createdAt: new Date().toISOString(),
    tone: "urgent",
  };
  const changes = [
    ...issueChanges,
    {
      collection: "vehicles",
      event: "delete",
      recordId: vehicle.id,
      expectedVersion: vehicleVersion,
    },
    {
      collection: "activities",
      event: "insert",
      recordId: activityRecord.id,
      data: activityRecord,
    },
  ];
  const companyId = activeCompanyId;
  const release=await guardFleetWrite([{entityType:'vehicle',entityId:vehicle.id},...linkedIssues.map(issue=>({entityType:'issue' as const,entityId:issue.id}))],version);
  try{
  const { data, error } = await applyFleetChanges(companyId,changes,version);
  if (error) {
    if (error.code === "40001" || error.code === "PT409") {
      await refreshFleet({ showIndicator: false });
      throw new Error("Resources changed elsewhere. Latest resources data was loaded; try again.");
    }
    throw new Error(error.message);
  }
  if(version!==companyVersion)throw new Error('Account changed while saving. Check the original account before retrying.');
  ((data ?? []) as FleetChangeResult[]).forEach((result) => {
    patchFleetRecord(
      result.collection,
      result.event === "delete" ? "delete" : "upsert",
      result.recordId,
      result.collection === "activities" ? activityRecord : undefined,
      result.version,
    );
  });
  refreshOfflineFleet();
  }finally{release()}
}

export async function saveFleetVehicleRecord(
  record: { id: string; unit: string; [key: string]: unknown },
  user: FireOpsUser,
  editing: boolean,
  captured?:CapturedFleetVersion,
) {
  assertCapturedScope(captured);
  const activityRecord: Activity = {
    id: createFleetId(),
    action: editing
      ? `${record.unit} details updated`
      : `${record.unit} added to fleet`,
    detail: editing ? "Vehicle record changed" : "Vehicle record created",
    createdBy: user.name,
    createdById: user.id,
    createdAt: new Date().toISOString(),
    targetType: "vehicle",
    targetId: record.id,
    tone: "complete",
  };
  const records = [
    { collection: "vehicles" as const, record,...(editing&&captured?{expectedVersion:captured.version}:{}) },
    { collection: "activities" as const, record: activityRecord },
  ];
  try {
    await saveFleetRecords(records);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isNetworkError =
      /fetch failed|network connection|network request failed/i.test(message);
    const isDuplicate = /duplicate key|23505/i.test(message);
    if (editing || (!isNetworkError && !isDuplicate) || !supabase || !activeCompanyId)
      throw error;

    // iOS can lose the RPC response after Supabase committed it. Confirm before
    // reporting failure so retrying cannot create a second vehicle or activity.
    const { data, error: verificationError } = await supabase
      .from("fleet_vehicles")
      .select("record_id")
      .eq("company_id", activeCompanyId)
      .eq("record_id", record.id)
      .maybeSingle();
    if (!verificationError && data) {
      await refreshFleet({ showIndicator: false });
      return;
    }
    if (isNetworkError)
      throw new Error(
        "Network connection was lost before the vehicle could be confirmed. Check your connection and try again.",
      );
    throw error;
  }
}

export async function updateFleetVehicle(
  vehicle: FleetVehicle,
  patch: {
    status?: VehicleStatus;
    assignedTo?: string;
    clearAssignment?: boolean;
    assignedFire?: Pick<NifcIncident, "id" | "name" | "state">;
    clearFireAssignment?: boolean;
  },
  user: FireOpsUser,
  activity: { action: string; detail: string; tone?: Activity["tone"] },
) {
  const expectedVersion=fleetReadVersion(vehicle,'vehicles');
  const record = {
    ...vehicle.source,
    id: vehicle.id,
    unit: vehicle.name,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.clearAssignment
      ? { assignedTo: undefined, assignedFire: undefined }
      : {}),
    ...(patch.assignedTo ? { assignedTo: patch.assignedTo } : {}),
    ...(patch.clearFireAssignment
      ? { assignedFire: undefined }
      : patch.assignedFire
        ? { assignedFire: patch.assignedFire }
        : {}),
  };
  const activityRecord: Activity = {
    id: createFleetId(),
    action: activity.action,
    detail: activity.detail,
    createdBy: user.name,
    createdById: user.id,
    createdAt: new Date().toISOString(),
    targetType: "vehicle",
    targetId: vehicle.id,
    tone: activity.tone,
  };
  await saveFleetRecords([
    { collection: "vehicles", record,expectedVersion },
    { collection: "activities", record: activityRecord },
  ]);
}

export async function saveFleetInspection(
  vehicle: FleetVehicle,
  inspection: VehicleInspection,
  user: FireOpsUser,
) {
  const expectedVersion=fleetReadVersion(vehicle,'vehicles');
  const failed = inspection.items.filter((item) => item.result === "Fail").length;
  const record = {
    ...vehicle.source,
    id: vehicle.id,
    unit: vehicle.name,
    inspections: [inspection, ...vehicle.inspections],
  };
  const activityRecord: Activity = {
    id: createFleetId(),
    action: `${vehicle.name} inspection completed`,
    detail: `${failed} failed checks · ${inspection.assignmentIncident || "No assignment / incident"}`,
    createdBy: user.name,
    createdById: user.id,
    createdAt: new Date().toISOString(),
    targetType: "vehicle",
    targetId: vehicle.id,
    tone: failed ? "urgent" : "complete",
  };
  await saveFleetRecords([
    { collection: "vehicles", record,expectedVersion },
    { collection: "activities", record: activityRecord },
  ]);
}

export async function deleteFleetInspection(
  vehicle: FleetVehicle,
  inspectionId: string,
  user: FireOpsUser,
) {
  if (user.role !== "owner" && user.role !== "admin")
    throw new Error("Only owners and admins can delete inspections.");
  const expectedVersion=fleetReadVersion(vehicle,'vehicles');
  const inspection = vehicle.inspections.find((item) => item.id === inspectionId);
  if (!inspection?.items.some((item) => item.result === "Fail"))
    throw new Error("Failed inspection could not be found. Refresh and try again.");
  const record = {
    ...vehicle.source,
    id: vehicle.id,
    inspections: vehicle.inspections.filter((item) => item.id !== inspectionId),
  };
  const activityRecord: Activity = {
    id: createFleetId(),
    action: `${vehicle.name} failed inspection deleted`,
    detail: `Inspection by ${inspection.inspectorName} · ${inspection.assignmentIncident || "No assignment / incident"}`,
    createdBy: user.name,
    createdById: user.id,
    createdAt: new Date().toISOString(),
    targetType: "vehicle",
    targetId: vehicle.id,
    tone: "urgent",
  };
  await saveFleetRecords([
    { collection: "vehicles", record,expectedVersion },
    { collection: "activities", record: activityRecord },
  ]);
}

export async function updateFleetVehicleFiles(
  vehicle: FleetVehicle,
  patch: {
    photo?: FleetVehicleFile | null;
    documents?: FleetVehicleDocument[];
  },
  user: FireOpsUser,
  activity: { action: string; detail: string },
) {
  const expectedVersion=fleetReadVersion(vehicle,'vehicles');
  const record = {
    ...vehicle.source,
    id: vehicle.id,
    unit: vehicle.name,
    ...(patch.photo !== undefined ? { photo: patch.photo ?? undefined } : {}),
    ...(patch.documents !== undefined ? { documents: patch.documents } : {}),
  };
  const activityRecord: Activity = {
    id: createFleetId(),
    action: activity.action,
    detail: activity.detail,
    createdBy: user.name,
    createdById: user.id,
    createdAt: new Date().toISOString(),
    targetType: "vehicle",
    targetId: vehicle.id,
    tone: "complete",
  };
  await saveFleetRecords([
    { collection: "vehicles", record,expectedVersion },
    { collection: "activities", record: activityRecord },
  ]);
}

export function refreshFleet(
  { showIndicator = true }: { showIndicator?: boolean } = {},
) {
  // Background sync must not reveal an off-screen iOS RefreshControl; doing so
  // can leave its expanded content inset behind when navigation returns.
  const hasData = snapshot.vehicles.length > 0 || snapshot.issues.length > 0;
  if (request && requestVersion === companyVersion) {
    refreshQueued = true;
    queuedRefreshShowsIndicator ||= showIndicator;
    if (showIndicator && hasData && !snapshot.refreshing) {
      emit({ ...snapshot, refreshing: true });
    }
    return request;
  }
  refreshQueued = false;
  queuedRefreshShowsIndicator = false;
  const version = companyVersion;
  const companyId = activeCompanyId;

  emit({
    ...snapshot,
    loading: !hasData,
    refreshing: showIndicator && hasData,
    error: null,
  });

  request = (async () => {
    if (!supabase) {
      emit({
        ...snapshot,
        loading: false,
        refreshing: false,
        error:
          "Resources could not load. Supabase is not configured for this build.",
      });
      return;
    }
    if (!companyId) {
      if (version === companyVersion)
        emit({ ...snapshot, loading: false, refreshing: false, error: null });
      return;
    }

    const client = supabase;
    const collections = Object.entries(tables) as [FleetCollection, string][];
    const changeSequenceAtStart = fleetChangeSequence;
    let results;
    // Motive sync calls an external API and can take seconds, so the fleet shows first
    // and Motive details are merged in when they arrive.
    const motiveRequest=client.functions.invoke<MotiveConnection>('motive-integration',{body:{companyId,action:'sync'}}).catch(error=>({data:null,error}));
    try {
      results = await Promise.all(collections.map(([collection, table]) => {
        const query=client
          .from(table)
          .select("record_id, data, version, updated_at")
          .eq("company_id", companyId)
          .order("updated_at", { ascending: false });
        // The activity log only grows and the dashboard shows the newest entries.
        return collection==='activities'?query.limit(activityLoadLimit):query;
      }));
    } catch (loadError) {
      if (version === companyVersion) {
        const message =
          loadError instanceof Error
            ? loadError.message
            : "Network request failed.";
        emit({
          ...snapshot,
          loading: false,
          refreshing: false,
          error: `Resources could not load. ${message}`,
        });
      }
      return;
    }
    if (version !== companyVersion) return;
    // Realtime may deliver a newer row while SELECT is in flight. Never let
    // that older response replace latest data or its optimistic-lock token.
    if (changeSequenceAtStart !== fleetChangeSequence) {
      refreshQueued = true;
      return;
    }

    const failed = results.find((result) => result.error);
    if (failed?.error) {
      emit({
        ...snapshot,
        loading: false,
        refreshing: false,
        error: `Resources could not load. ${failed.error.message}`,
      });
      return;
    }

    const loaded = Object.fromEntries(
      collections.map(([collection], index) => {
        const rows = (results[index].data ?? []) as FleetRecordRow[];
        versions[collection] = new Map(
          rows.map((row) => [row.record_id, row.version]),
        );
        return [collection, records(rows)];
      }),
    ) as Record<FleetCollection, unknown[]>;

    const vehicles = (results[0].data ?? [])
      .map((row) => normalizeVehicle(row as VehicleRow))
      .map(vehicle=>rememberRead(vehicle,revisionText(versions.vehicles.get(vehicle.id))))
      .sort((a, b) => a.name.localeCompare(b.name));
    const issues = (loaded.issues as FleetIssue[])
      .map((issue) => rememberRead({
        ...issue,
        status: issue.status ?? "Open",
        updates: issue.updates ?? [],
      },revisionText(versions.issues.get(issue.id))))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    emit({
      vehicles,
      issues,
      crew: loaded.crew as CrewMember[],
      activities: loaded.activities as Activity[],
      loading: false,
      refreshing: false,
      error: null,
    });
    refreshOfflineFleet();

    const motiveLoad=++motiveLoadSequence;
    void motiveRequest.then(motiveResult=>{
    if(version!==companyVersion||motiveLoad!==motiveLoadSequence||motiveResult.error||!motiveResult.data?.connected)return;
    const motiveSnapshots=motiveResult.data.vehicles??[];
    const motiveByFleetId=new Map(motiveSnapshots.filter(item=>item.fleetVehicleId).map(item=>[item.fleetVehicleId,item]));
    const motiveByVin=new Map(motiveSnapshots.map(item=>[item.vin.trim().toUpperCase(),item]));
    emit({...snapshot,vehicles:snapshot.vehicles.map(vehicle=>{
      const motive=motiveByFleetId.get(vehicle.id)??(vehicle.vin?motiveByVin.get(vehicle.vin.trim().toUpperCase()):undefined);
      if(!motive)return vehicle;
      // Keep the read version captured for this record so conflict checks still apply.
      const next={...vehicle,motive};const captured=readVersions.get(vehicle);if(captured)readVersions.set(next,captured);
      return next;
    })});
    });
  })().finally(() => {
    if (requestVersion !== version) return;
    request = null;
    if (refreshQueued && version === companyVersion) {
      const showIndicator = queuedRefreshShowsIndicator;
      refreshQueued = false;
      queuedRefreshShowsIndicator = false;
      void refreshFleet({ showIndicator });
    }
  });
  requestVersion = version;
  return request;
}

function selectCompany(companyId: string | null,userId:string|null,role:string|null) {
  if (companyId === activeCompanyId&&userId===activeUserId&&role===activeRole) return;
  activeCompanyId = companyId;activeUserId=userId;activeRole=role;
  observedDeletes.clear();Object.values(versions).forEach(map=>map.clear());
  companyVersion += 1;
  refreshQueued = false;
  queuedRefreshShowsIndicator = false;

  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  emit({
    vehicles: [],
    issues: [],
    crew: [],
    activities: [],
    loading: Boolean(companyId),
    refreshing: false,
    error: null,
  });
  if (!companyId || !supabase) return;

  const selectedVersion=companyVersion;
  channel = supabase.channel(`mobile-fleet:${companyId}`);
  (Object.entries(tables) as [FleetCollection, string][]).forEach(
    ([collection, table]) => {
      channel =
        channel?.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter: `company_id=eq.${companyId}`,
          },
          (payload) => {
            if (activeCompanyId !== companyId||companyVersion!==selectedVersion) return;
            fleetChangeSequence += 1;
            const row = (payload.eventType === "DELETE"
              ? payload.old
              : payload.new) as Partial<FleetRecordRow>;
            if (!row.record_id) return;
            patchFleetRecord(
              collection,
              payload.eventType === "DELETE" ? "delete" : "upsert",
              row.record_id,
              row.data,
              row.version,
            );
            if(collection==='vehicles'||collection==='issues')refreshOfflineFleet();
          },
        ) ?? null;
    },
  );
  channel?.subscribe(refreshOnRejoin(() => refreshFleet({ showIndicator: false })));
  void refreshFleet({ showIndicator: false });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFleetVehicles(companyId: string | null) {
  const {session,access}=useSession();
  const member=access.status==='ready'&&access.value?.kind==='member'&&access.value.user.id===session?.user.id?access.value:null;
  const userId=member?.user.id??null;const role=member?.user.role??null;const selectedCompany=member?companyId:null;
  useEffect(() => selectCompany(selectedCompany,userId,role), [selectedCompany,userId,role]);
  const getSnapshot=()=>{
    if(selectedCompany!==activeCompanyId||userId!==activeUserId||role!==activeRole)return selectedCompany?loadingFleet:emptyFleet;
    return visibleSnapshot;
  };
  return useSyncExternalStore(subscribe,getSnapshot,getSnapshot);
}

onAppResume(() => { if (activeCompanyId) void refreshFleet({ showIndicator: false }); });
