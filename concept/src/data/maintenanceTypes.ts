export type MaintenancePriority = 'Low' | 'Medium' | 'High' | 'Critical';
export type WorkOrderStatus = 'Draft' | 'Open' | 'In Progress' | 'Waiting Parts' | 'Completed';
export type IssueStatus = 'Open' | 'Scheduled' | 'Resolved';
export type InspectionType = 'Pre-Trip' | 'Post-Trip' | 'Post-Assignment' | 'Weekly' | 'Annual';

export type FleetAsset = {
  id: string;
  unit: string;
  type: string;
  makeModel: string;
  year: number;
  mileage: number;
  hours: number;
  status: 'Ready' | 'Assigned' | 'Limited' | 'Out of Service';
  nextServiceMileage?: number;
  nextServiceHours?: number;
  activeAssignment?: string;
};

export type FleetIssue = {
  id: string;
  assetId: string;
  title: string;
  description: string;
  priority: MaintenancePriority;
  status: IssueStatus;
  source: 'Inspection' | 'Driver' | 'Shop' | 'Telematics';
  reportedBy: string;
  reportedAt: string;
  photoUri?: string;
  inspectionId?: string;
  workOrderId?: string;
};

export type WorkOrderLine = {
  id: string;
  task: string;
  laborHours: number;
  laborRate: number;
  partsCost: number;
  completed: boolean;
};

export type FleetWorkOrder = {
  id: string;
  number: string;
  assetId: string;
  title: string;
  priority: MaintenancePriority;
  status: WorkOrderStatus;
  vendorOrTechnician: string;
  openedAt: string;
  dueAt?: string;
  completedAt?: string;
  odometer?: number;
  engineHours?: number;
  lines: WorkOrderLine[];
  notes?: string;
  issueIds: string[];
};

export type InspectionItem = {
  id: string;
  section: string;
  label: string;
  result: 'Pass' | 'Fail' | 'N/A';
  notes?: string;
  photoUri?: string;
  createsOutOfService?: boolean;
};

export type FleetInspection = {
  id: string;
  assetId: string;
  type: InspectionType;
  assignment?: string;
  inspector: string;
  submittedAt: string;
  odometer?: number;
  engineHours?: number;
  status: 'Passed' | 'Defects Found' | 'Out of Service';
  items: InspectionItem[];
  signatureName: string;
};

export type ServiceSchedule = {
  id: string;
  assetId: string;
  task: string;
  intervalMiles?: number;
  intervalHours?: number;
  lastCompletedMileage?: number;
  lastCompletedHours?: number;
  dueMileage?: number;
  dueHours?: number;
};

export type PartStock = {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  reorderAt: number;
  unitCost: number;
  location: string;
};
