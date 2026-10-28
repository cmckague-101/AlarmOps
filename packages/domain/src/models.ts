export type UserRole = 'owner' | 'admin' | 'shop_tech' | 'fire_fighter' | 'accounting';
export type AssignableUserRole = Exclude<UserRole, 'owner'>;

export const assignableUserRoles:ReadonlyArray<{value:AssignableUserRole;label:string}> = [
  {value:'admin',label:'Admin'},
  {value:'shop_tech',label:'Shop Tech'},
  {value:'fire_fighter',label:'Fire Fighter'},
  {value:'accounting',label:'Accounting'},
];

export function isCompanyManager(role:UserRole):boolean {
  return role==='owner'||role==='admin';
}

/** Payroll and invoice processing (review, approval, payment, customers) is owner/accounting only. */
export function canProcessFinance(role:UserRole):boolean {
  return role==='owner'||role==='accounting';
}

export function canOpenVehicleIssue(role:UserRole):boolean {
  return role!=='fire_fighter'&&role!=='accounting';
}

export function canInspectVehicle(role:UserRole):boolean {
  return role!=='fire_fighter'&&role!=='accounting';
}

export function userRoleLabel(role:UserRole):string {
  return role==='owner'?'Owner':assignableUserRoles.find(option=>option.value===role)?.label??role;
}
export type VehicleStatus = 'Ready' | 'Assigned' | 'Out of service';
export type IssuePriority = 'Low' | 'Medium' | 'High' | 'Critical';
export type IssueStatus = 'Open' | 'Resolved';

export type VehicleFile = {name:string;type:string;dataUrl:string;path?:string};
export type NamedDocument = {id:string;name:string;file:VehicleFile;inspectionDate?:string};
export type CredentialRecordType = 'Training'|'Qualification'|'License'|'Task Book'|'DOT Medical';
export type CrewCredential = {
  id:string;
  /** Display title. Legacy credentials only contain id, name, and file. */
  name:string;
  recordType?:CredentialRecordType;
  courseCode?:string;
  completionDate?:string;
  expirationDate?:string;
  provider?:string;
  file?:VehicleFile;
};
export type CrewExperience = {
  id:string;
  incident:string;
  position:string;
  days:string;
  file?:VehicleFile;
};
export type AnnualQualificationRecord = {
  rt130CompletionDate:string;
  rt130CurrencyDate:string;
  wctCompletionDate:string;
  wctCurrencyDate:string;
};
export type CrewMember = {
  id:string;name:string;email:string;phone:string;role:UserRole;status:'Active'|'Invited';
  credentials?:CrewCredential[];
  experiences?:CrewExperience[];
  /** One current annual record, replaced whenever annual dates are edited. */
  annualRecord?:AnnualQualificationRecord;
  /** Legacy single-credential fields retained while existing records migrate. */
  credential?:VehicleFile;credentialName?:string;
  joinedAt?:string;
};

export type NifcIncident = {
  id:string;name:string;acres:number|null;contained:number|null;personnel:number|null;state:string;
  discovered:number|null;updated:number|null;latitude:number;longitude:number;
};

export type NationalFireActivityRow = {
  gacc:string;preparednessLevel:number|null;incidents:number;cumulativeAcres:number;
  crews:number;engines:number;helicopters:number;totalPersonnel:number;
};
export type NationalFireActivity = {
  reportDate:string;fetchedAt:string;sourceUrl:string;areas:NationalFireActivityRow[];total:NationalFireActivityRow;
};

export type VehicleInspectionItemKind = 'pass_fail' | 'photo';
export const DEFAULT_VEHICLE_INSPECTION_ITEMS:ReadonlyArray<{label:string;kind:VehicleInspectionItemKind}> = [
  {label:'VIPR Inventory',kind:'pass_fail'},
  {label:'Damage to vehicle',kind:'pass_fail'},
  {label:'Light check, horn, washer fluid',kind:'pass_fail'},
  {label:'Tires',kind:'pass_fail'},
  {label:'Interior cleanliness',kind:'photo'},
];
export type VehicleInspectionTemplateItem = {id:string;label:string;position:number;kind:VehicleInspectionItemKind};
export type InspectionResult = 'Pass' | 'Fail';
export type VehicleInspectionItem = {
  id:string;label:string;kind?:VehicleInspectionItemKind;result?:InspectionResult;defectNotes?:string;photo?:VehicleFile;
};
export type VehicleInspection = {
  id:string;assignmentIncident:string;inspectorId:string;inspectorName:string;createdAt:string;items:VehicleInspectionItem[];
};

export type VehicleNote = {
  id:string;vehicleId:string;subject:string;body:string;createdBy:string;createdById:string;createdAt:string;updatedAt:string;
};

export type Vehicle = {
  id:string;unit:string;type:string;year:number;make:string;model:string;
  vin:string;plate:string;status:VehicleStatus;photo?:VehicleFile;contract?:VehicleFile;
  viprChecklist?:VehicleFile;registration?:VehicleFile;insurance?:VehicleFile;
  dotInspection?:VehicleFile;documents?:NamedDocument[];notes?:string;createdAt:string;assignedTo?:string;
  inspections?:VehicleInspection[];
  assignedFire?:Pick<NifcIncident,'id'|'name'|'state'>;
};

export type IssueUpdate = {id:string;text:string;createdBy:string;createdById?:string;createdAt:string};
export type FleetIssue = {
  id:string;vehicleId:string;title:string;description:string;priority:IssuePriority;
  status:IssueStatus;resolvedAt?:string;updates:IssueUpdate[];createdBy:string;createdById?:string;createdAt:string;
};
export type Activity = {
  id:string;action:string;detail:string;createdBy:string;createdById?:string;createdAt:string;
  targetType?:'vehicle'|'issue'|'crew';targetId?:string;tone?:'urgent'|'complete';
};

export type FireOpsUser = {id:string;name:string;role:UserRole};
export type CompanyInfo = {name:string;code:string;industry:string;phone?:string;location?:string;logo?:VehicleFile;crewInviteLimit:number;crewInvitedCount:number};
export type MotiveDiagnosticCode = {
  id:string;code:string;label:string;description?:string;status:'open'|'closed';type?:'constant'|'intermittent';
  firstObservedAt?:string;lastObservedAt?:string;occurrenceCount?:number;severity?:string;network?:string;
};
export type MotiveVehicleSnapshot = {
  vin:string;location:string;speed:string;updatedAt:string;fleetVehicleId?:string;motiveId?:string;entityType?:'vehicle'|'asset';latitude?:number;longitude?:number;
  diagnostics?:MotiveDiagnosticCode[];
  camera?:{status:'online'|'offline'|'unavailable';imageUrl?:string;capturedAt?:string};
};
export type MotiveConnection = {connected:boolean;configured?:boolean;clientIdLastFour?:string;connectedAt?:string;lastVerifiedAt?:string;tokenExpiresAt?:string;syncedAt?:string;matched?:number;unmatched?:number;duplicateVins?:string[];diagnosticsAvailable?:boolean;mock?:boolean;vehicles?:MotiveVehicleSnapshot[]};
export type MotiveCameraCapture = {imageUrl:string;capturedAt:string;expiresAt?:string;position:string};
export type MotiveCameraCaptureRequest =
  | {status:'pending';requestId:string;cameraType:'dashcam'|'omnicam';position:string;capturedAt?:string}
  | ({status:'ready'}&MotiveCameraCapture);
export type MotiveAuthorization = {authorizationUrl:string};
export type FleetSnapshot = {vehicles:Vehicle[];issues:FleetIssue[];crew:CrewMember[];activities:Activity[]};
export type FleetRemoteChange =
  | {collection:'vehicles';event:'upsert';record:Vehicle}
  | {collection:'vehicles';event:'delete';id:string}
  | {collection:'issues';event:'upsert';record:FleetIssue}
  | {collection:'issues';event:'delete';id:string}
  | {collection:'crew';event:'upsert';record:CrewMember}
  | {collection:'crew';event:'delete';id:string}
  | {collection:'activities';event:'upsert';record:Activity}
  | {collection:'activities';event:'delete';id:string};

export type CompanyDocument = {id:string;name:string;file:VehicleFile;createdAt:string;updatedAt:string;viewedAt?:string};
export type CommunicationReply = {id:string;body:string;createdBy:string;createdById:string;createdAt:string};
export type CommunicationThread = {
  id:string;subject:string;description:string;createdBy:string;createdById:string;createdByRole:UserRole;createdAt:string;
  replies:CommunicationReply[];seenAt?:string;isPrivate?:boolean;
};

export type TrainingSignup = {userId:string;userName:string;signedUpAt:string};
export type Training = {
  id:string;courseCode:string;courseTitle:string;date:string;location:string;instructor:string;capacity:number;
  information:string;createdAt:string;updatedAt:string;viewedAt?:string;signups:TrainingSignup[];
};
export type TrainingStage = 'scheduled'|'expired'|'removed';
export type InventoryCheckout = {userId:string;userName:string;quantity:number;checkedOutAt:string;updatedAt:string};
export type InventoryItem = {id:string;name:string;quantity:number;createdAt:string;updatedAt:string;checkouts:InventoryCheckout[]};

export type FireResourceVehicle = {
  id:string;unit:string;type:string;year:number;make:string;model:string;plate?:string;
  assignedFire?:{id:string;name:string;state:string};
  assignedCrew?:{id:string;name:string};
  motive?:Pick<MotiveVehicleSnapshot,'location'|'speed'|'updatedAt'|'latitude'|'longitude'>;
};

export type DashboardNotification = {
  id:string;source:'communications'|'documents'|'training'|'qualifications'|'payroll'|'invoices'|'tasks';title:string;detail:string;createdAt:string;unread:boolean;
};
