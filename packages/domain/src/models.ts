export type UserRole = 'owner' | 'member';
export type VehicleStatus = 'Ready' | 'Assigned' | 'Maintenance' | 'Out of service';
export type IssuePriority = 'Low' | 'Medium' | 'High' | 'Critical';
export type IssueStatus = 'Open' | 'Resolved';

export type VehicleFile = {name:string;type:string;dataUrl:string;path?:string};
export type NamedDocument = {id:string;name:string;file:VehicleFile};
export type CrewCredential = NamedDocument;
export type CrewMember = {
  id:string;name:string;email:string;phone:string;role:UserRole;status:'Active'|'Invited';
  credentials?:CrewCredential[];
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

export type Vehicle = {
  id:string;unit:string;type:string;year:number;make:string;model:string;
  vin:string;plate:string;status:VehicleStatus;photo?:VehicleFile;contract?:VehicleFile;
  viprChecklist?:VehicleFile;registration?:VehicleFile;insurance?:VehicleFile;
  dotInspection?:VehicleFile;documents?:NamedDocument[];notes?:string;createdAt:string;assignedTo?:string;
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
export type CompanyInfo = {name:string;code:string;industry:string;crewInviteLimit:number;crewInvitedCount:number};
export type MotiveVehicleSnapshot = {
  vin:string;location:string;speed:string;updatedAt:string;
  camera?:{status:'online'|'offline'|'unavailable';imageUrl?:string;capturedAt?:string};
};
export type MotiveConnection = {connected:boolean;lastFour?:string;connectedAt?:string;lastVerifiedAt?:string;mock?:boolean;vehicles?:MotiveVehicleSnapshot[]};
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
  replies:CommunicationReply[];seenAt?:string;
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
  motive?:{location:string;speed:string;updatedAt:string};
};

export type DashboardNotification = {
  id:string;source:'communications'|'documents'|'training';title:string;detail:string;createdAt:string;unread:boolean;
};
