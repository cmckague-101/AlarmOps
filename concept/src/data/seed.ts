import { EquipmentRecord, InvoiceRecord, PayrollRecord } from './types';

export const seedPayroll: PayrollRecord[] = [
  { id: 'p1', employee: 'John Smith', assignment: 'Walker Fire', period: 'Jul 1–14', hours: 80, days: 10, status: 'Pending', submittedAt: '2026-07-14' },
  { id: 'p2', employee: 'David Brown', assignment: 'Walker Fire', period: 'Jun 17–30', hours: 96, days: 12, status: 'Approved', submittedAt: '2026-06-30' },
  { id: 'p3', employee: 'Mike Johnson', assignment: 'Pine Creek Fire', period: 'Jun 3–16', hours: 88, days: 11, status: 'Paid', submittedAt: '2026-06-16' }
];

export const seedInvoices: InvoiceRecord[] = [
  { id: 'i1', vendor: 'Caterpillar', date: '2026-07-16', amount: 2450, category: 'Repair', status: 'Pending' },
  { id: 'i2', vendor: 'Pacific Fuel', date: '2026-07-15', amount: 5230.75, category: 'Fuel', status: 'Pending' },
  { id: 'i3', vendor: 'NAPA Auto Parts', date: '2026-07-14', amount: 1125.3, category: 'Parts', status: 'Paid' }
];

export const seedEquipment: EquipmentRecord[] = [
  { id: 'e1', unit: 'Engine 701', type: 'Type 3 Engine', hours: 4822, nextService: 5000, status: 'Assigned' },
  { id: 'e2', unit: 'Engine 702', type: 'Type 3 Engine', hours: 3912, nextService: 4000, status: 'Available' },
  { id: 'e3', unit: 'Dozer D7-01', type: 'Caterpillar D7', hours: 6145, nextService: 6200, status: 'Available' },
  { id: 'e4', unit: 'Water Tender 12', type: 'Water Tender', hours: 2250, nextService: 2250, status: 'Maintenance' }
];
