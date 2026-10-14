export type PayrollStatus = 'draft' | 'pending' | 'approved';

export type PayrollDay = {
  date: string;
  hoursWorked: number;
  crewIds: string[];
  notes: string;
};

export type PayrollAttachment = {
  name: string;
  mimeType: string;
  byteSize: number;
  storagePath: string;
};

export type PayrollForm = {
  id: string;
  companyId: string;
  createdBy: string;
  createdByName: string;
  engineNumber: string;
  incidents: string;
  attachment: PayrollAttachment | null;
  rows: PayrollDay[];
  status: PayrollStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addPayrollDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return localIsoDate(date);
}

export function payrollDayName(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(year, month - 1, day));
}

export function createPayrollRows(start = ''): PayrollDay[] {
  return Array.from({ length: 21 }, (_, index) => ({
    date: start ? addPayrollDays(start, index) : '',
    hoursWorked: 0,
    crewIds: [],
    notes: '',
  }));
}

export function updatePayrollDate(rows: PayrollDay[], index: number, date: string) {
  return rows.map((row, rowIndex) => rowIndex < index ? row : { ...row, date: date ? addPayrollDays(date, rowIndex - index) : '' });
}

export function updatePayrollCrew(rows: PayrollDay[], index: number, crewIds: string[]) {
  const unique = [...new Set(crewIds)];
  return rows.map((row, rowIndex) => rowIndex < index ? row : { ...row, crewIds: unique });
}

export function payrollTotals(rows: PayrollDay[]) {
  const weekly = new Map<string, number>();
  let totalDays = 0;
  let totalHours = 0;
  for (const row of rows) {
    const hours = Math.max(0, Number(row.hoursWorked) || 0);
    if (hours > 0) totalDays += 1;
    totalHours += hours;
    if (!row.date) continue;
    const [year, month, day] = row.date.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
    const key = localIsoDate(date);
    weekly.set(key, (weekly.get(key) ?? 0) + hours);
  }
  const overtimeHours = [...weekly.values()].reduce((sum, hours) => sum + Math.max(0, hours - 40), 0);
  return { totalDays, totalHours, overtimeHours, regularHours: totalHours - overtimeHours };
}

export function payrollCrewIds(rows: PayrollDay[]) {
  return [...new Set(rows.flatMap(row => row.crewIds))];
}

export function payrollCrewTotals(rows: PayrollDay[]) {
  return payrollCrewIds(rows).map(crewId => ({
    crewId,
    ...payrollTotals(rows.filter(row => row.crewIds.includes(crewId))),
  }));
}
