import {payrollTotals} from './payroll';

/**
 * Alarmco operations: customers, sites, quotes, jobs, NFPA 72-style inspections, and billing.
 * Money is stored in dollars and rounded to cents. Dates are YYYY-MM-DD local calendar dates.
 * Weekly overtime uses the same Monday–Sunday workweek as FireOps payroll (hours over 40).
 */

export const ALARMCO = {
  name: 'Alarmco, Inc.',
  city: 'Boise, Idaho',
  certifications: 'SBA-certified WOSB / EDWOSB',
  phone: '(208) 555-0140',
} as const;

export const JOB_STATUSES = ['scheduled', 'dispatched', 'in_progress', 'complete', 'invoiced'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_KINDS = ['install', 'service', 'inspection'] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const MONITORING_STATUSES = ['monitored', 'unmonitored', 'suspended'] as const;
export type MonitoringStatus = (typeof MONITORING_STATUSES)[number];
export const SYSTEM_KINDS = ['fire_alarm', 'security', 'access_control', 'cameras', 'low_voltage'] as const;
export type SystemKind = (typeof SYSTEM_KINDS)[number];
export type ChecklistResult = 'pass' | 'fail' | 'na' | 'pending';
export type DeficiencyStatus = 'open' | 'corrected';
export type InvoiceSource = 'job' | 'monitoring';
export type AlarmInvoiceStatus = 'unpaid' | 'paid';

export type AlarmCustomer = {
  id: string;
  name: string;
  accountNumber: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
};

export type AlarmSite = {
  id: string;
  customerId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  monitoringStatus: MonitoringStatus;
  contractNumber: string;
  monthlyMonitoring: number;
  contractStart: string;
  contractEnd: string;
};

export type InstalledSystem = {
  id: string;
  siteId: string;
  kind: SystemKind;
  name: string;
  deviceCount: number;
  location: string;
};

export type QuoteLine = {
  id: string;
  description: string;
  kind: 'device' | 'labor';
  quantity: number;
  unitPrice: number;
};

export type AlarmQuote = {
  id: string;
  number: string;
  customerId: string;
  siteId: string;
  kind: JobKind;
  status: QuoteStatus;
  title: string;
  lines: QuoteLine[];
  createdOn: string;
  validUntil: string;
  jobId?: string;
};

export type AlarmJob = {
  id: string;
  number: string;
  customerId: string;
  siteId: string;
  quoteId?: string;
  kind: JobKind;
  status: JobStatus;
  title: string;
  assignedTechId: string;
  scheduledOn: string;
  notes: string;
  billableAmount?: number;
};

export type ChecklistItem = {
  id: string;
  section: string;
  prompt: string;
  result: ChecklistResult;
  notes: string;
};

export type Deficiency = {
  id: string;
  itemId: string;
  description: string;
  status: DeficiencyStatus;
  dueOn: string;
};

export type AlarmInspection = {
  id: string;
  number: string;
  siteId: string;
  jobId?: string;
  inspectorId: string;
  inspectedOn: string;
  frequencyMonths: number;
  nextDue: string;
  items: ChecklistItem[];
  deficiencies: Deficiency[];
};

export type AlarmInvoiceLine = {description: string; amount: number};

export type AlarmInvoice = {
  id: string;
  number: string;
  customerId: string;
  siteId?: string;
  source: InvoiceSource;
  jobId?: string;
  status: AlarmInvoiceStatus;
  issuedOn: string;
  dueOn: string;
  lines: AlarmInvoiceLine[];
  paidOn?: string;
};

export type TechCertification = {id: string; name: string; issuer: string; expiresOn: string};
export type TechTimeOff = {id: string; techId: string; start: string; end: string; reason: string};
export type AlarmTech = {id: string; name: string; title: string; phone: string; email: string; skills: string[]; certifications: TechCertification[]; vehicleId: string};

export type TimeEntry = {
  id: string;
  techId: string;
  jobId?: string;
  date: string;
  hours: number;
  notes: string;
};

export type AlarmBook = {
  customers: AlarmCustomer[];
  sites: AlarmSite[];
  systems: InstalledSystem[];
  quotes: AlarmQuote[];
  jobs: AlarmJob[];
  inspections: AlarmInspection[];
  invoices: AlarmInvoice[];
  techs: AlarmTech[];
  timeEntries: TimeEntry[];
  timeOff: TechTimeOff[];
};

export class AlarmOpsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlarmOpsError';
  }
}

const JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  scheduled: ['dispatched', 'in_progress'],
  dispatched: ['in_progress'],
  in_progress: ['complete'],
  complete: ['invoiced'],
  invoiced: [],
};

const NFPA_PROMPTS: readonly {section: string; prompt: string}[] = [
  {section: 'Control unit', prompt: 'Control unit is powered and shows no trouble or supervisory signals'},
  {section: 'Power', prompt: 'Primary power and battery standby were tested'},
  {section: 'Initiating devices', prompt: 'Sampled smoke and heat detectors alarmed and cleared'},
  {section: 'Initiating devices', prompt: 'Manual pull stations operate and reset'},
  {section: 'Notification', prompt: 'Horns and strobes operate throughout the occupied floors'},
  {section: 'Monitoring', prompt: 'The communicator reached the central station and was acknowledged'},
  {section: 'Supervisory', prompt: 'Sprinkler and duct supervisory devices report to the panel'},
  {section: 'Documentation', prompt: 'As-built drawings and the previous report are on site'},
];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const jobStatusLabel: Record<JobStatus, string> = {
  scheduled: 'Scheduled',
  dispatched: 'Dispatched',
  in_progress: 'In progress',
  complete: 'Complete',
  invoiced: 'Invoiced',
};

export const jobKindLabel: Record<JobKind, string> = {
  install: 'Install',
  service: 'Service call',
  inspection: 'Inspection',
};

export const quoteStatusLabel: Record<QuoteStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
};

export const monitoringLabel: Record<MonitoringStatus, string> = {
  monitored: 'Monitored',
  unmonitored: 'Not monitored',
  suspended: 'Suspended',
};

export const systemKindLabel: Record<SystemKind, string> = {
  fire_alarm: 'Fire alarm',
  security: 'Security',
  access_control: 'Access control',
  cameras: 'Cameras',
  low_voltage: 'Low voltage',
};

export function formatMoney(amount: number) {
  return amount.toLocaleString('en-US', {style: 'currency', currency: 'USD'});
}

export function roundMoney(amount: number) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function lineExtension(line: Pick<QuoteLine, 'quantity' | 'unitPrice'>) {
  return roundMoney(Math.max(0, line.quantity) * Math.max(0, line.unitPrice));
}

export function quoteTotal(quote: Pick<AlarmQuote, 'lines'>) {
  return roundMoney(quote.lines.reduce((sum, line) => sum + lineExtension(line), 0));
}

export function invoiceTotal(invoice: Pick<AlarmInvoice, 'lines'>) {
  return roundMoney(invoice.lines.reduce((sum, line) => sum + line.amount, 0));
}

export function allowedJobTransitions(status: JobStatus) {
  return JOB_TRANSITIONS[status].filter(next => next !== 'invoiced');
}

export function alarmRecordId(prefix: string) {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${rand}`;
}

export function nextAlarmNumber(existing: readonly string[], prefix: string, year: number) {
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const max = existing.reduce((best, value) => {
    const match = pattern.exec(value);
    return match ? Math.max(best, Number(match[1])) : best;
  }, 0);
  return `${prefix}-${year}-${String(max + 1).padStart(3, '0')}`;
}

function toIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(value: string, label: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new AlarmOpsError(`${label} must be a calendar date.`);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    throw new AlarmOpsError(`${label} must be a calendar date.`);
  }
  return date;
}

export function addCalendarDays(iso: string, days: number) {
  const date = parseDate(iso, 'Date');
  date.setDate(date.getDate() + days);
  return toIso(date);
}

export function addCalendarMonths(iso: string, months: number) {
  const date = parseDate(iso, 'Date');
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return toIso(target);
}

/** Monday that starts the Mon–Sun workweek containing `iso`. Matches FireOps payroll. */
export function workweekStart(iso: string) {
  const date = parseDate(iso, 'Date');
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return toIso(date);
}

export function nfpa72Checklist(idPrefix: string): ChecklistItem[] {
  return NFPA_PROMPTS.map((item, index) => ({
    id: `${idPrefix}-${index + 1}`,
    section: item.section,
    prompt: item.prompt,
    result: 'pending' as const,
    notes: '',
  }));
}

function must<T extends {id: string}>(items: readonly T[], id: string, label: string) {
  const found = items.find(item => item.id === id);
  if (!found) throw new AlarmOpsError(`${label} was not found.`);
  return found;
}

function replace<T extends {id: string}>(items: readonly T[], id: string, next: T) {
  return items.map(item => item.id === id ? next : item);
}

export function addCustomer(book: AlarmBook, customer: AlarmCustomer): AlarmBook {
  const name = customer.name.trim();
  if (!name) throw new AlarmOpsError('Customer name is required.');
  if (book.customers.some(item => item.id === customer.id)) throw new AlarmOpsError('That customer already exists.');
  return {...book, customers: [{...customer, name, accountNumber: customer.accountNumber.trim(), contactName: customer.contactName.trim(), email: customer.email.trim(), phone: customer.phone.trim(), notes: customer.notes.trim()}, ...book.customers]};
}

export function addSite(book: AlarmBook, site: AlarmSite): AlarmBook {
  must(book.customers, site.customerId, 'Customer');
  if (!site.name.trim() || !site.address.trim() || !site.city.trim()) throw new AlarmOpsError('Site name, address, and city are required.');
  if (site.monthlyMonitoring < 0) throw new AlarmOpsError('Monthly monitoring cannot be negative.');
  return {...book, sites: [{...site, name: site.name.trim(), address: site.address.trim(), city: site.city.trim(), state: site.state.trim() || 'ID', postalCode: site.postalCode.trim(), contractNumber: site.contractNumber.trim(), monthlyMonitoring: roundMoney(site.monthlyMonitoring)}, ...book.sites]};
}

export function addSystem(book: AlarmBook, system: InstalledSystem): AlarmBook {
  must(book.sites, system.siteId, 'Site');
  if (!system.name.trim()) throw new AlarmOpsError('System name is required.');
  if (!Number.isInteger(system.deviceCount) || system.deviceCount < 0) throw new AlarmOpsError('Device count must be a whole number.');
  return {...book, systems: [{...system, name: system.name.trim(), location: system.location.trim()}, ...book.systems]};
}

export function addQuote(book: AlarmBook, quote: AlarmQuote): AlarmBook {
  const site = must(book.sites, quote.siteId, 'Site');
  if (site.customerId !== quote.customerId) throw new AlarmOpsError('That site belongs to a different customer.');
  if (!quote.title.trim()) throw new AlarmOpsError('Quote title is required.');
  if (!quote.lines.length || quoteTotal(quote) <= 0) throw new AlarmOpsError('Add at least one priced line.');
  const lines = quote.lines.map(line => ({
    ...line,
    description: line.description.trim(),
    quantity: line.quantity,
    unitPrice: roundMoney(line.unitPrice),
  }));
  if (lines.some(line => !line.description || line.quantity <= 0 || line.unitPrice < 0)) throw new AlarmOpsError('Each line needs a description, quantity, and price.');
  return {...book, quotes: [{...quote, title: quote.title.trim(), lines, status: quote.status === 'accepted' || quote.status === 'declined' ? 'draft' : quote.status}, ...book.quotes]};
}

export function addQuoteLine(book: AlarmBook, quoteId: string, line: QuoteLine): AlarmBook {
  const quote = must(book.quotes, quoteId, 'Quote');
  if (quote.status !== 'draft' && quote.status !== 'sent') throw new AlarmOpsError('Only a draft or sent quote can take another line.');
  const description = line.description.trim();
  if (!description || !(line.quantity > 0) || line.unitPrice < 0) throw new AlarmOpsError('Each line needs a description, quantity, and price.');
  const next: QuoteLine = {id: line.id, description, kind: line.kind, quantity: line.quantity, unitPrice: roundMoney(line.unitPrice)};
  return {...book, quotes: book.quotes.map(item => item.id === quote.id ? {...quote, lines: [...quote.lines, next]} : item)};
}

export function acceptQuote(book: AlarmBook, quoteId: string, ids: {jobId: string; jobNumber: string; assignedTechId: string; scheduledOn: string}): AlarmBook {
  const quote = must(book.quotes, quoteId, 'Quote');
  if (quote.status === 'declined') throw new AlarmOpsError('A declined quote cannot be accepted.');
  if (quote.status === 'accepted') {
    if (quote.jobId && book.jobs.some(job => job.id === quote.jobId)) return book;
    throw new AlarmOpsError('This quote is already accepted.');
  }
  if (quoteTotal(quote) <= 0) throw new AlarmOpsError('Add a priced line before accepting the quote.');
  must(book.techs, ids.assignedTechId, 'Technician');
  parseDate(ids.scheduledOn, 'Schedule date');
  const job: AlarmJob = {
    id: ids.jobId,
    number: ids.jobNumber,
    customerId: quote.customerId,
    siteId: quote.siteId,
    quoteId: quote.id,
    kind: quote.kind,
    status: 'scheduled',
    title: quote.title,
    assignedTechId: ids.assignedTechId,
    scheduledOn: ids.scheduledOn,
    notes: `Created from quote ${quote.number}.`,
  };
  return {
    ...book,
    quotes: replace(book.quotes, quote.id, {...quote, status: 'accepted', jobId: job.id}),
    jobs: [job, ...book.jobs],
  };
}

export function declineQuote(book: AlarmBook, quoteId: string): AlarmBook {
  const quote = must(book.quotes, quoteId, 'Quote');
  if (quote.status === 'accepted') throw new AlarmOpsError('An accepted quote stays tied to its job.');
  if (quote.status === 'declined') return book;
  return {...book, quotes: replace(book.quotes, quote.id, {...quote, status: 'declined'})};
}

export function transitionJob(book: AlarmBook, jobId: string, status: JobStatus): AlarmBook {
  const job = must(book.jobs, jobId, 'Job');
  if (job.status === status) return book;
  if (status === 'invoiced') throw new AlarmOpsError('Create an invoice to mark the job invoiced.');
  if (!JOB_TRANSITIONS[job.status].includes(status)) throw new AlarmOpsError(`A ${jobStatusLabel[job.status].toLowerCase()} job cannot move to ${jobStatusLabel[status].toLowerCase()}.`);
  return {...book, jobs: replace(book.jobs, job.id, {...job, status})};
}

export function assignJob(book: AlarmBook, jobId: string, techId: string): AlarmBook {
  const job = must(book.jobs, jobId, 'Job');
  if (techId) must(book.techs, techId, 'Technician');
  return {...book, jobs: replace(book.jobs, job.id, {...job, assignedTechId: techId})};
}

export function startInspection(book: AlarmBook, input: {id: string; number: string; siteId: string; jobId?: string; inspectorId: string; inspectedOn: string; frequencyMonths: number}): AlarmBook {
  must(book.sites, input.siteId, 'Site');
  must(book.techs, input.inspectorId, 'Technician');
  if (input.jobId) {
    const job = must(book.jobs, input.jobId, 'Job');
    if (job.siteId !== input.siteId) throw new AlarmOpsError('That job is for a different site.');
  }
  if (![1, 3, 6, 12].includes(input.frequencyMonths)) throw new AlarmOpsError('Inspection frequency must be 1, 3, 6, or 12 months.');
  parseDate(input.inspectedOn, 'Inspection date');
  const inspection: AlarmInspection = {
    id: input.id,
    number: input.number,
    siteId: input.siteId,
    jobId: input.jobId,
    inspectorId: input.inspectorId,
    inspectedOn: input.inspectedOn,
    frequencyMonths: input.frequencyMonths,
    nextDue: addCalendarMonths(input.inspectedOn, input.frequencyMonths),
    items: nfpa72Checklist(input.id),
    deficiencies: [],
  };
  return {...book, inspections: [inspection, ...book.inspections]};
}

export function setChecklistResult(book: AlarmBook, inspectionId: string, itemId: string, result: ChecklistResult, notes?: string): AlarmBook {
  const inspection = must(book.inspections, inspectionId, 'Inspection');
  const item = inspection.items.find(entry => entry.id === itemId);
  if (!item) throw new AlarmOpsError('Checklist item was not found.');
  const nextItem = {...item, result, notes: notes ?? item.notes};
  const items = inspection.items.map(entry => entry.id === itemId ? nextItem : entry);
  let deficiencies = inspection.deficiencies;
  if (result === 'fail') {
    const existing = deficiencies.find(entry => entry.itemId === itemId);
    const description = nextItem.notes.trim() || nextItem.prompt;
    if (!existing) {
      deficiencies = [...deficiencies, {id: alarmRecordId('def'), itemId, description, status: 'open', dueOn: addCalendarDays(inspection.inspectedOn, 30)}];
    } else {
      deficiencies = deficiencies.map(entry => entry.itemId === itemId ? {...entry, description, status: 'open'} : entry);
    }
  } else if (result === 'pass' || result === 'na') {
    deficiencies = deficiencies.map(entry => entry.itemId === itemId && entry.status === 'open' ? {...entry, status: 'corrected'} : entry);
  }
  return {...book, inspections: replace(book.inspections, inspection.id, {...inspection, items, deficiencies})};
}

export function correctDeficiency(book: AlarmBook, inspectionId: string, deficiencyId: string): AlarmBook {
  const inspection = must(book.inspections, inspectionId, 'Inspection');
  if (!inspection.deficiencies.some(entry => entry.id === deficiencyId)) throw new AlarmOpsError('Deficiency was not found.');
  return {...book, inspections: replace(book.inspections, inspection.id, {...inspection, deficiencies: inspection.deficiencies.map(entry => entry.id === deficiencyId ? {...entry, status: 'corrected'} : entry)})};
}

function invoiceLinesForJob(book: AlarmBook, job: AlarmJob): AlarmInvoiceLine[] {
  const quote = job.quoteId ? book.quotes.find(item => item.id === job.quoteId) : undefined;
  if (quote && quote.lines.length) {
    return quote.lines.map(line => ({description: `${line.description} (${line.quantity} × ${formatMoney(line.unitPrice)})`, amount: lineExtension(line)}));
  }
  const amount = roundMoney(job.billableAmount ?? 0);
  return [{description: job.title, amount}];
}

export function invoiceFromJob(book: AlarmBook, jobId: string, ids: {id: string; number: string; issuedOn: string; dueOn: string}): AlarmBook {
  const job = must(book.jobs, jobId, 'Job');
  const existing = book.invoices.find(invoice => invoice.jobId === jobId);
  if (existing) return book;
  if (job.status !== 'complete') throw new AlarmOpsError('Complete the job before invoicing it.');
  parseDate(ids.issuedOn, 'Invoice date');
  parseDate(ids.dueOn, 'Due date');
  const lines = invoiceLinesForJob(book, job);
  if (invoiceTotal({lines}) <= 0) throw new AlarmOpsError('This job has no billable amount.');
  const invoice: AlarmInvoice = {id: ids.id, number: ids.number, customerId: job.customerId, siteId: job.siteId, source: 'job', jobId: job.id, status: 'unpaid', issuedOn: ids.issuedOn, dueOn: ids.dueOn, lines};
  return {...book, invoices: [invoice, ...book.invoices], jobs: replace(book.jobs, job.id, {...job, status: 'invoiced'})};
}

export function invoiceFromMonitoring(book: AlarmBook, siteId: string, ids: {id: string; number: string; issuedOn: string; dueOn: string; months: number}): AlarmBook {
  const site = must(book.sites, siteId, 'Site');
  if (site.monitoringStatus !== 'monitored') throw new AlarmOpsError('Only a monitored site can be billed for monitoring.');
  if (!Number.isInteger(ids.months) || ids.months < 1 || ids.months > 12) throw new AlarmOpsError('Choose 1 to 12 months of monitoring.');
  if (site.monthlyMonitoring <= 0) throw new AlarmOpsError('Set a monthly monitoring amount on the site first.');
  parseDate(ids.issuedOn, 'Invoice date');
  parseDate(ids.dueOn, 'Due date');
  const period = ids.issuedOn.slice(0, 7);
  if (book.invoices.some(invoice => invoice.source === 'monitoring' && invoice.siteId === site.id && invoice.issuedOn.slice(0, 7) === period)) {
    throw new AlarmOpsError('This site already has a monitoring invoice for that month.');
  }
  const amount = roundMoney(site.monthlyMonitoring * ids.months);
  const invoice: AlarmInvoice = {
    id: ids.id,
    number: ids.number,
    customerId: site.customerId,
    siteId: site.id,
    source: 'monitoring',
    status: 'unpaid',
    issuedOn: ids.issuedOn,
    dueOn: ids.dueOn,
    lines: [{description: `Monitoring ${site.contractNumber || site.name} · ${ids.months} month${ids.months === 1 ? '' : 's'}`, amount}],
  };
  return {...book, invoices: [invoice, ...book.invoices]};
}

export function markInvoicePaid(book: AlarmBook, invoiceId: string, paidOn: string): AlarmBook {
  const invoice = must(book.invoices, invoiceId, 'Invoice');
  if (invoice.status === 'paid') return book;
  parseDate(paidOn, 'Paid date');
  return {...book, invoices: replace(book.invoices, invoice.id, {...invoice, status: 'paid', paidOn})};
}

export type AlarmPaymentState = 'unpaid' | 'overdue' | 'paid';

export function alarmInvoiceState(invoice: Pick<AlarmInvoice, 'status' | 'dueOn'>, today: string): AlarmPaymentState {
  if (invoice.status === 'paid') return 'paid';
  return invoice.dueOn < today ? 'overdue' : 'unpaid';
}

export function logTime(book: AlarmBook, entry: TimeEntry): AlarmBook {
  must(book.techs, entry.techId, 'Technician');
  if (entry.jobId) must(book.jobs, entry.jobId, 'Job');
  parseDate(entry.date, 'Time entry date');
  if (!(entry.hours > 0) || entry.hours > 24) throw new AlarmOpsError('Hours must be greater than 0 and at most 24.');
  return {...book, timeEntries: [{...entry, hours: roundMoney(entry.hours), notes: entry.notes.trim()}, ...book.timeEntries]};
}

export function techTimesheet(entries: readonly TimeEntry[], techId: string) {
  return payrollTotals(entries.filter(entry => entry.techId === techId).map(entry => ({
    date: entry.date,
    hoursWorked: entry.hours,
    crewIds: [techId],
    notes: entry.notes,
    ctr: null,
  })));
}

export function weekHours(entries: readonly TimeEntry[], techId: string, anyDateInWeek: string) {
  const start = workweekStart(anyDateInWeek);
  const end = addCalendarDays(start, 6);
  const hours = roundMoney(entries.filter(entry => entry.techId === techId && entry.date >= start && entry.date <= end).reduce((sum, entry) => sum + entry.hours, 0));
  return {start, end, hours, regularHours: roundMoney(Math.min(40, hours)), overtimeHours: roundMoney(Math.max(0, hours - 40))};
}

export function latestInspection(book: AlarmBook, siteId: string) {
  return book.inspections.filter(inspection => inspection.siteId === siteId).sort((a, b) => b.inspectedOn.localeCompare(a.inspectedOn) || b.number.localeCompare(a.number))[0];
}

export function inspectionsDue(book: AlarmBook, today: string) {
  return book.sites.filter(site => {
    const hasFireAlarm = book.systems.some(system => system.siteId === site.id && system.kind === 'fire_alarm');
    if (!hasFireAlarm) return false;
    const latest = latestInspection(book, site.id);
    return !latest || latest.nextDue <= today;
  });
}

export function openDeficiencies(book: AlarmBook) {
  return book.inspections.flatMap(inspection => inspection.deficiencies.filter(item => item.status === 'open').map(item => ({inspection, deficiency: item})));
}

export function alarmSummary(book: AlarmBook, today: string) {
  const unpaid = book.invoices.filter(invoice => invoice.status !== 'paid');
  return {
    customerCount: book.customers.length,
    siteCount: book.sites.length,
    openJobs: book.jobs.filter(job => job.status !== 'complete' && job.status !== 'invoiced').length,
    quotesWaiting: book.quotes.filter(quote => quote.status === 'draft' || quote.status === 'sent').length,
    inspectionsDue: inspectionsDue(book, today).length,
    openDeficiencies: openDeficiencies(book).length,
    unpaidInvoices: unpaid.length,
    unpaidTotal: roundMoney(unpaid.reduce((sum, invoice) => sum + invoiceTotal(invoice), 0)),
    techsOvertime: book.techs.map(tech => ({techId: tech.id, name: tech.name, ...techTimesheet(book.timeEntries, tech.id)})).filter(row => row.overtimeHours > 0),
  };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function inspectionReportHtml(book: AlarmBook, inspectionId: string) {
  const inspection = must(book.inspections, inspectionId, 'Inspection');
  const site = must(book.sites, inspection.siteId, 'Site');
  const customer = must(book.customers, site.customerId, 'Customer');
  const inspector = book.techs.find(tech => tech.id === inspection.inspectorId);
  const systems = book.systems.filter(system => system.siteId === site.id);
  const open = inspection.deficiencies.filter(item => item.status === 'open');
  const rows = inspection.items.map(item => `<tr><td>${escapeHtml(item.section)}</td><td>${escapeHtml(item.prompt)}</td><td>${escapeHtml(item.result)}</td><td>${escapeHtml(item.notes)}</td></tr>`).join('');
  const deficiencyRows = inspection.deficiencies.map(item => `<li><b>${escapeHtml(item.status)}</b> · due ${escapeHtml(item.dueOn)} — ${escapeHtml(item.description)}</li>`).join('');
  const systemRows = systems.map(system => `<li>${escapeHtml(systemKindLabel[system.kind])}: ${escapeHtml(system.name)} · ${system.deviceCount} devices · ${escapeHtml(system.location || 'Location not recorded')}</li>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${escapeHtml(inspection.number)} inspection report</title>
<style>
  body{font:14px/1.45 "DM Sans",system-ui,sans-serif;color:#19201d;margin:32px}
  h1{font:800 28px/1.1 Manrope,system-ui,sans-serif;letter-spacing:-.03em;margin:0}
  h2{font:700 16px Manrope,system-ui,sans-serif;margin:24px 0 8px}
  p,li{margin:4px 0}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{border:1px solid #d9ded9;padding:8px;text-align:left;vertical-align:top}
  th{font-size:11px;letter-spacing:.04em;text-transform:uppercase}
  .meta{color:#5f6963}
  .banner{margin-top:8px}
</style></head><body>
<p class="meta">${escapeHtml(ALARMCO.name)} · ${escapeHtml(ALARMCO.city)} · ${escapeHtml(ALARMCO.certifications)}</p>
<h1>Fire alarm inspection report</h1>
<p class="banner"><b>${escapeHtml(inspection.number)}</b> · ${escapeHtml(customer.name)} · ${escapeHtml(site.name)}</p>
<p>${escapeHtml(site.address)}, ${escapeHtml(site.city)}, ${escapeHtml(site.state)} ${escapeHtml(site.postalCode)}</p>
<p>Inspected ${escapeHtml(inspection.inspectedOn)} by ${escapeHtml(inspector?.name ?? 'Unassigned')} · Next due ${escapeHtml(inspection.nextDue)} · Every ${inspection.frequencyMonths} months</p>
<p>Monitoring: ${escapeHtml(monitoringLabel[site.monitoringStatus])}${site.contractNumber ? ` · Contract ${escapeHtml(site.contractNumber)}` : ''}</p>
<h2>Installed systems</h2>
${systemRows ? `<ul>${systemRows}</ul>` : '<p>No systems recorded at this site.</p>'}
<h2>NFPA 72-style checklist</h2>
<table><thead><tr><th>Section</th><th>Item</th><th>Result</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Deficiencies</h2>
${deficiencyRows ? `<ul>${deficiencyRows}</ul>` : '<p>No deficiencies recorded.</p>'}
<p>${open.length ? `${open.length} open` : 'No open deficiencies'}.</p>
<p class="meta">This checklist is Alarmco’s field record. It is not a reproduction of NFPA 72 and does not by itself certify code compliance.</p>
</body></html>`;
}

function passedChecklist(prefix: string, failIndex?: number, failNotes = '') {
  const items = nfpa72Checklist(prefix).map(item => ({...item, result: 'pass' as ChecklistResult}));
  const deficiencies: Deficiency[] = [];
  if (failIndex !== undefined) {
    const item = items[failIndex];
    item.result = 'fail';
    item.notes = failNotes;
    deficiencies.push({id: `def-${prefix}`, itemId: item.id, description: failNotes || item.prompt, status: 'open', dueOn: '2026-12-08'});
  }
  return {items, deficiencies};
}

function buildSeed(): AlarmBook {
  const libraryCheck = passedChecklist('lib', 2, 'Idaho Room detector did not alarm on test.');
  const capitolCheck = passedChecklist('cap');
  return {
    techs: [
      {id: 't-lena', name: 'Lena Ortiz', title: 'Lead technician', phone: '(208) 555-0164', email: 'lena@alarmco.example', skills: ['Fire alarm', 'Addressable panels'], certifications: [{id: 'cert-lena', name: 'NICET II Fire Alarm Systems', issuer: 'NICET', expiresOn: '2027-04-30'}], vehicleId: 'v1'},
      {id: 't-chris', name: 'Chris Hale', title: 'Service technician', phone: '(208) 555-0177', email: 'chris@alarmco.example', skills: ['Service', 'Access control'], certifications: [{id: 'cert-chris', name: 'Idaho Fire Alarm License', issuer: 'State of Idaho', expiresOn: '2026-12-15'}], vehicleId: 'v2'},
      {id: 't-priya', name: 'Priya Shah', title: 'Inspector', phone: '(208) 555-0181', email: 'priya@alarmco.example', skills: ['Inspection', 'NFPA 72'], certifications: [{id: 'cert-priya', name: 'NICET III Inspection and Testing', issuer: 'NICET', expiresOn: '2026-11-20'}], vehicleId: 'v3'},
    ],
    customers: [
      {id: 'c-library', name: 'Boise Public Library', accountNumber: 'ALM-1042', contactName: 'Jordan Hale', email: 'facilities@boisepubliclibrary.example', phone: '(208) 555-0188', notes: 'Annual fire alarm inspection plus device refresh on the main branch.'},
      {id: 'c-clinic', name: "St. Luke's Plaza Clinic", accountNumber: 'ALM-1108', contactName: 'Avery Nguyen', email: 'facilities@plazaclinic.example', phone: '(208) 555-0160', notes: 'New fire alarm install. Monitoring starts after acceptance.'},
      {id: 'c-capitol', name: 'Idaho State Capitol', accountNumber: 'ALM-2201', contactName: 'Morgan Ellis', email: 'security@capitol.idaho.example', phone: '(208) 555-0120', notes: 'Federal-style facilities contract. Access control and alarm monitoring.'},
      {id: 'c-coop', name: 'Boise Co-op', accountNumber: 'ALM-1184', contactName: 'Sam Patel', email: 'ops@boisecoop.example', phone: '(208) 555-0194', notes: 'Small fire alarm and camera package.'},
      {id: 'c-centre', name: 'Boise Centre', accountNumber: 'ALM-1410', contactName: 'Elena Brooks', email: 'facilities@boisecentre.example', phone: '(208) 555-0133', notes: 'Convention center. On test during event load-in.'},
      {id: 'c-alpha', name: 'St. Alphonsus Regional', accountNumber: 'ALM-2288', contactName: 'Chris Lang', email: 'security@stals.example', phone: '(208) 555-0171', notes: 'Hospital fire alarm. Communicator timer test is failing.'},
      {id: 'c-yard', name: 'Idaho Power', accountNumber: 'ALM-3310', contactName: 'Drew Alvarez', email: 'ops@idahopower.example', phone: '(208) 555-0155', notes: 'Operations yard. AC loss on the fire panel.'},
      {id: 'c-vista', name: 'Vista Village', accountNumber: 'ALM-1766', contactName: 'Nina Cole', email: 'manager@vistavillage.example', phone: '(208) 555-0190', notes: 'Apartment intrusion account in runaway.'},
    ],
    sites: [
      {id: 's-library', customerId: 'c-library', name: 'Main Branch', address: '715 S Capitol Blvd', city: 'Boise', state: 'ID', postalCode: '83702', monitoringStatus: 'monitored', contractNumber: 'ALM-MON-1042', monthlyMonitoring: 186, contractStart: '2025-01-01', contractEnd: '2027-12-31'},
      {id: 's-clinic', customerId: 'c-clinic', name: 'Plaza Clinic', address: '800 E Park Blvd', city: 'Boise', state: 'ID', postalCode: '83712', monitoringStatus: 'unmonitored', contractNumber: '', monthlyMonitoring: 0, contractStart: '', contractEnd: ''},
      {id: 's-capitol', customerId: 'c-capitol', name: 'Capitol Complex', address: '700 W Jefferson St', city: 'Boise', state: 'ID', postalCode: '83702', monitoringStatus: 'monitored', contractNumber: 'ALM-FED-2201', monthlyMonitoring: 420, contractStart: '2024-10-01', contractEnd: '2027-09-30'},
      {id: 's-coop', customerId: 'c-coop', name: 'Hyde Park Store', address: '888 W Fort St', city: 'Boise', state: 'ID', postalCode: '83702', monitoringStatus: 'unmonitored', contractNumber: '', monthlyMonitoring: 0, contractStart: '', contractEnd: ''},
      {id: 's-centre', customerId: 'c-centre', name: 'Boise Centre', address: '850 W Front St', city: 'Boise', state: 'ID', postalCode: '83702', monitoringStatus: 'monitored', contractNumber: 'ALM-MON-1410', monthlyMonitoring: 240, contractStart: '2025-03-01', contractEnd: '2027-02-28'},
      {id: 's-alpha', customerId: 'c-alpha', name: 'Curtis Campus', address: '1055 N Curtis Rd', city: 'Boise', state: 'ID', postalCode: '83706', monitoringStatus: 'monitored', contractNumber: 'ALM-MON-2288', monthlyMonitoring: 510, contractStart: '2024-06-01', contractEnd: '2027-05-31'},
      {id: 's-yard', customerId: 'c-yard', name: 'Operations Yard', address: '1221 W Idaho St', city: 'Boise', state: 'ID', postalCode: '83702', monitoringStatus: 'monitored', contractNumber: 'ALM-MON-3310', monthlyMonitoring: 165, contractStart: '2025-01-15', contractEnd: '2027-01-14'},
      {id: 's-vista', customerId: 'c-vista', name: 'Vista Village', address: '200 W Mallard Dr', city: 'Boise', state: 'ID', postalCode: '83706', monitoringStatus: 'monitored', contractNumber: 'ALM-MON-1766', monthlyMonitoring: 95, contractStart: '2025-08-01', contractEnd: '2026-12-31'},
    ],
    systems: [
      {id: 'sys-library-facp', siteId: 's-library', kind: 'fire_alarm', name: 'Silent Knight 6820', deviceCount: 42, location: 'Electrical room'},
      {id: 'sys-library-cam', siteId: 's-library', kind: 'cameras', name: 'Axis camera system', deviceCount: 16, location: 'Perimeter'},
      {id: 'sys-capitol-access', siteId: 's-capitol', kind: 'access_control', name: 'West entrance readers', deviceCount: 6, location: 'West entrance'},
      {id: 'sys-capitol-facp', siteId: 's-capitol', kind: 'fire_alarm', name: 'Notifier NFS2-3030', deviceCount: 120, location: 'Basement FACP room'},
      {id: 'sys-capitol-sec', siteId: 's-capitol', kind: 'security', name: 'Intrusion panel', deviceCount: 28, location: 'Security office'},
      {id: 'sys-coop-facp', siteId: 's-coop', kind: 'fire_alarm', name: 'Fire-Lite ES-50X', deviceCount: 18, location: 'Office closet'},
      {id: 'sys-centre-facp', siteId: 's-centre', kind: 'fire_alarm', name: 'Fire-Lite ES-200X', deviceCount: 86, location: 'Fire control room'},
      {id: 'sys-alpha-facp', siteId: 's-alpha', kind: 'fire_alarm', name: 'Notifier NFS-320', deviceCount: 210, location: 'Engineering shop'},
      {id: 'sys-yard-facp', siteId: 's-yard', kind: 'fire_alarm', name: 'Silent Knight 6000', deviceCount: 24, location: 'Guard shack'},
      {id: 'sys-vista-sec', siteId: 's-vista', kind: 'security', name: 'DSC PowerSeries', deviceCount: 32, location: 'Leasing office'},
    ],
    quotes: [
      {
        id: 'q-library', number: 'Q-2026-014', customerId: 'c-library', siteId: 's-library', kind: 'install', status: 'accepted', title: 'Main Branch device refresh', jobId: 'j-library', createdOn: '2026-09-12', validUntil: '2026-10-12',
        lines: [
          {id: 'ql-1', description: 'Photoelectric smoke detector', kind: 'device', quantity: 12, unitPrice: 86},
          {id: 'ql-2', description: 'Horn/strobe', kind: 'device', quantity: 4, unitPrice: 142},
          {id: 'ql-3', description: 'Install labor', kind: 'labor', quantity: 16, unitPrice: 95},
        ],
      },
      {
        id: 'q-clinic', number: 'Q-2026-022', customerId: 'c-clinic', siteId: 's-clinic', kind: 'install', status: 'sent', title: 'Plaza Clinic fire alarm system', createdOn: '2026-11-18', validUntil: '2026-12-18',
        lines: [
          {id: 'ql-4', description: 'Addressable fire alarm panel', kind: 'device', quantity: 1, unitPrice: 2450},
          {id: 'ql-5', description: 'Door contact', kind: 'device', quantity: 8, unitPrice: 45},
          {id: 'ql-6', description: 'Install labor', kind: 'labor', quantity: 24, unitPrice: 95},
        ],
      },
      {
        id: 'q-coop', number: 'Q-2026-019', customerId: 'c-coop', siteId: 's-coop', kind: 'inspection', status: 'draft', title: 'Hyde Park annual inspection', createdOn: '2026-11-20', validUntil: '2026-12-20',
        lines: [
          {id: 'ql-7', description: 'Annual fire alarm inspection', kind: 'labor', quantity: 4, unitPrice: 125},
        ],
      },
    ],
    jobs: [
      {id: 'j-library', number: 'J-2026-031', customerId: 'c-library', siteId: 's-library', quoteId: 'q-library', kind: 'install', status: 'invoiced', title: 'Main Branch device refresh', assignedTechId: 't-lena', scheduledOn: '2026-10-06', notes: 'Devices hung and panel programmed. Invoice INV-2026-044 is open.'},
      {id: 'j-ready', number: 'J-2026-040', customerId: 'c-capitol', siteId: 's-capitol', kind: 'service', status: 'complete', title: 'Replace west stairwell horn/strobe', assignedTechId: 't-lena', scheduledOn: '2026-11-12', notes: 'Device replaced and tested. Ready to invoice.', billableAmount: 410},
      {id: 'j-capitol', number: 'J-2026-044', customerId: 'c-capitol', siteId: 's-capitol', kind: 'service', status: 'in_progress', title: 'West entrance card reader offline', assignedTechId: 't-chris', scheduledOn: '2026-11-23', notes: 'Reader powers up but does not grant. Billable if no warranty part.', billableAmount: 640},
      {id: 'j-coop', number: 'J-2026-046', customerId: 'c-coop', siteId: 's-coop', kind: 'inspection', status: 'scheduled', title: 'Hyde Park annual inspection', assignedTechId: 't-priya', scheduledOn: '2026-11-25', notes: 'First inspection on the new panel. No quote accepted yet.', billableAmount: 500},
      {id: 'j-open', number: 'J-2026-048', customerId: 'c-library', siteId: 's-library', kind: 'service', status: 'scheduled', title: 'Panel trouble follow-up', assignedTechId: '', scheduledOn: '2026-11-24', notes: 'Opened from the central station queue.', billableAmount: 180},
    ],
    inspections: [
      {id: 'i-library', number: 'INS-2026-008', siteId: 's-library', jobId: 'j-library', inspectorId: 't-priya', inspectedOn: '2026-10-08', frequencyMonths: 12, nextDue: '2027-10-08', ...libraryCheck},
      {id: 'i-capitol', number: 'INS-2025-014', siteId: 's-capitol', inspectorId: 't-priya', inspectedOn: '2025-11-02', frequencyMonths: 12, nextDue: '2026-11-02', ...capitolCheck},
      {id: 'i-centre', number: 'INS-2026-011', siteId: 's-centre', inspectorId: 't-priya', inspectedOn: '2026-09-01', frequencyMonths: 12, nextDue: '2027-09-01', ...passedChecklist('centre')},
      {id: 'i-alpha', number: 'INS-2026-012', siteId: 's-alpha', inspectorId: 't-priya', inspectedOn: '2026-08-12', frequencyMonths: 12, nextDue: '2027-08-12', ...passedChecklist('alpha')},
      {id: 'i-yard', number: 'INS-2026-013', siteId: 's-yard', inspectorId: 't-priya', inspectedOn: '2026-07-20', frequencyMonths: 12, nextDue: '2027-07-20', ...passedChecklist('yard')},
    ],
    invoices: [
      {
        id: 'inv-library', number: 'INV-2026-044', customerId: 'c-library', siteId: 's-library', source: 'job', jobId: 'j-library', status: 'unpaid', issuedOn: '2026-10-09', dueOn: '2026-11-08',
        lines: [
          {description: 'Photoelectric smoke detector (12 × $86.00)', amount: 1032},
          {description: 'Horn/strobe (4 × $142.00)', amount: 568},
          {description: 'Install labor (16 × $95.00)', amount: 1520},
        ],
      },
      {
        id: 'inv-monitor', number: 'INV-2026-039', customerId: 'c-library', siteId: 's-library', source: 'monitoring', status: 'paid', issuedOn: '2026-10-01', dueOn: '2026-10-31', paidOn: '2026-10-05',
        lines: [{description: 'Monitoring ALM-MON-1042 · 1 month', amount: 186}],
      },
    ],
    timeEntries: [
      {id: 'te-1', techId: 't-chris', jobId: 'j-capitol', date: '2026-11-16', hours: 10, notes: 'Capitol reader troubleshooting'},
      {id: 'te-2', techId: 't-chris', jobId: 'j-capitol', date: '2026-11-17', hours: 10, notes: 'Parts run and retest'},
      {id: 'te-3', techId: 't-chris', jobId: 'j-capitol', date: '2026-11-18', hours: 10, notes: 'Wiring at west entrance'},
      {id: 'te-4', techId: 't-chris', jobId: 'j-capitol', date: '2026-11-19', hours: 10, notes: 'Panel programming'},
      {id: 'te-5', techId: 't-chris', jobId: 'j-capitol', date: '2026-11-20', hours: 8, notes: 'Closeout with security office'},
      {id: 'te-6', techId: 't-lena', date: '2026-11-16', hours: 8, notes: 'Shop prep'},
      {id: 'te-7', techId: 't-lena', date: '2026-11-17', hours: 8, notes: 'Clinic site walk'},
      {id: 'te-8', techId: 't-lena', date: '2026-11-18', hours: 8, notes: 'Quote support'},
      {id: 'te-9', techId: 't-lena', date: '2026-11-19', hours: 8, notes: 'Panel bench test'},
      {id: 'te-10', techId: 't-lena', date: '2026-11-20', hours: 8, notes: 'Inventory'},
      {id: 'te-11', techId: 't-priya', jobId: 'j-library', date: '2026-10-08', hours: 6, notes: 'Main Branch inspection'},
    ],
    timeOff: [
      {id: 'off-priya', techId: 't-priya', start: '2026-11-26', end: '2026-11-26', reason: 'Manufacturer training'},
    ],
  };
}

export function seedAlarmBook(): AlarmBook {
  return buildSeed();
}

export function normalizeAlarmBook(value: unknown): AlarmBook {
  if (!value || typeof value !== 'object') return seedAlarmBook();
  const record = value as Partial<AlarmBook>;
  if (!Array.isArray(record.customers) || !Array.isArray(record.sites)) return seedAlarmBook();
  const seed = seedAlarmBook();
  return {
    customers: record.customers,
    sites: record.sites,
    systems: Array.isArray(record.systems) ? record.systems : [],
    quotes: Array.isArray(record.quotes) ? record.quotes : [],
    jobs: Array.isArray(record.jobs) ? record.jobs : [],
    inspections: Array.isArray(record.inspections) ? record.inspections : [],
    invoices: Array.isArray(record.invoices) ? record.invoices : [],
    techs: Array.isArray(record.techs) && record.techs.length ? record.techs : seed.techs,
    timeEntries: Array.isArray(record.timeEntries) ? record.timeEntries : [],
    timeOff: Array.isArray(record.timeOff) ? record.timeOff : [],
  };
}
