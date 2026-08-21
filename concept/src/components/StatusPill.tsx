import React from 'react';
import {StatusBadge, StatusTone} from './StatusBadge';

export function StatusPill({ status }: { status: string }) {
  return <StatusBadge label={status} tone={getTone(status)}/>;
}

function getTone(status: string): StatusTone {
  if (['Paid', 'Approved', 'Available', 'Active', 'Ready', 'Completed', 'Passed'].includes(status)) return 'success';
  if (['Maintenance', 'Suspended', 'Critical', 'Out of Service', 'Rejected'].includes(status)) return 'critical';
  if (['Assigned', 'In Progress', 'Sent'].includes(status)) return 'info';
  if (['Pending', 'Invited', 'Open', 'Waiting Parts', 'Limited'].includes(status)) return 'warning';
  return 'neutral';
}
