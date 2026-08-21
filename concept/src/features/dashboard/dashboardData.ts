import {StatusTone} from '../../components/StatusBadge';

export type OperationalMetric = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: StatusTone;
  icon: 'flame' | 'people' | 'car' | 'warning';
};

export type RequiredAction = {
  id: string;
  title: string;
  detail: string;
  due: string;
  tone: StatusTone;
};

export type OperationalActivity = {
  id: string;
  title: string;
  detail: string;
  time: string;
  tone: StatusTone;
};

export const operationalMetrics: OperationalMetric[] = [
  {id: 'incidents', label: 'Active Incidents', value: '4', detail: '2 priority incidents', tone: 'critical', icon: 'flame'},
  {id: 'personnel', label: 'Assigned Personnel', value: '27', detail: '5 crews deployed', tone: 'success', icon: 'people'},
  {id: 'resources', label: 'Assigned Resources', value: '11', detail: '6 available', tone: 'info', icon: 'car'},
  {id: 'alerts', label: 'Needs Attention', value: '5', detail: '2 critical alerts', tone: 'warning', icon: 'warning'},
];

export const requiredActions: RequiredAction[] = [
  {id: 'tender-service', title: 'Tender 12 Service Overdue', detail: 'Unit is limited until the pump inspection is completed.', due: 'Due now', tone: 'critical'},
  {id: 'crew-ack', title: 'Morning Briefing Acknowledgements', detail: 'Three assigned personnel have not acknowledged the 0700 briefing.', due: 'Before 06:45', tone: 'warning'},
  {id: 'credential-review', title: 'Review Expiring Credentials', detail: 'Three qualifications expire within the next 30 days.', due: 'This week', tone: 'info'},
];

export const recentActivity: OperationalActivity[] = [
  {id: 'activity-1', title: 'Engine 701 Status Updated', detail: 'Staged at Division Alpha · Walker Fire', time: '8 min ago', tone: 'success'},
  {id: 'activity-2', title: 'Critical Fleet Issue Reported', detail: 'Dozer 4 · Hydraulic Leak at Blade Lift Cylinder', time: '24 min ago', tone: 'critical'},
  {id: 'activity-3', title: 'Crew Assignment Confirmed', detail: 'Five personnel assigned to Engine 704', time: '41 min ago', tone: 'info'},
  {id: 'activity-4', title: 'Red Flag Warning Updated', detail: 'Boise and Payette Fire Weather Zones', time: '1 hr ago', tone: 'warning'},
];
