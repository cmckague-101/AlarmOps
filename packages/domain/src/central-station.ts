import {AlarmOpsError, alarmRecordId, type AlarmBook, type AlarmJob} from './alarm-ops';

/**
 * Alarmco central station.
 * The desk talks only to CentralStationSource. seededCentralStation is the demo feed.
 * manitouCentralStation is the adapter edge for Bold Manitou REST (Swagger 2.1.48+):
 * a future client maps that API into CentralStationSnapshot. This module does not call Manitou.
 */

export const SIGNAL_PRIORITIES = ['fire', 'burglary', 'panic', 'trouble', 'supervisory'] as const;
export type SignalPriority = (typeof SIGNAL_PRIORITIES)[number];

export const PRIORITY_RANK: Record<SignalPriority, number> = {
  fire: 0,
  burglary: 1,
  panic: 2,
  trouble: 3,
  supervisory: 4,
};

export const RESPONSE_TARGET_SECONDS: Record<SignalPriority, number> = {
  fire: 60,
  panic: 60,
  burglary: 90,
  trouble: 180,
  supervisory: 180,
};

export const priorityLabel: Record<SignalPriority, string> = {
  fire: 'Fire',
  burglary: 'Burglary',
  panic: 'Panic',
  trouble: 'Trouble',
  supervisory: 'Supervisory',
};

export type SignalStepKind = 'received' | 'operator' | 'call' | 'dispatch' | 'close';

export type SignalStep = {
  kind: SignalStepKind;
  at: string;
  actor: string;
  note: string;
};

export type StationAccountMode = 'normal' | 'test' | 'runaway';

export type StationAccount = {
  id: string;
  customerId: string;
  siteId: string;
  accountNumber: string;
  name: string;
  siteName: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  panel: string;
  mode: StationAccountMode;
  timerTest: 'passed' | 'failed';
  lowBattery: boolean;
  acLoss: boolean;
};

export type StationOperator = {id: string; name: string; onShift: boolean};

export type StationSignal = {
  id: string;
  accountId: string;
  priority: SignalPriority;
  eventType: string;
  zone: string;
  receivedAt: string;
  operatorId?: string;
  falseAlarm: boolean;
  open: boolean;
  steps: SignalStep[];
};

export type ProblemKind = 'false_alarms' | 'timer_test' | 'low_battery' | 'ac_loss';

export type ProblemAccount = {
  id: string;
  accountId: string;
  customerId: string;
  siteId: string;
  kind: ProblemKind;
  title: string;
  detail: string;
};

export type PinStatus = 'normal' | SignalPriority | 'test' | 'runaway';

export type StationPin = {
  accountId: string;
  customerId: string;
  siteId: string;
  name: string;
  siteName: string;
  latitude: number;
  longitude: number;
  status: PinStatus;
};

export type HistoryFilter = {
  accountId?: string;
  eventType?: string;
  date?: string;
  operatorId?: string;
  query?: string;
};

export type CentralStationSnapshot = {
  asOf: string;
  accounts: StationAccount[];
  operators: StationOperator[];
  queue: StationSignal[];
  history: StationSignal[];
  kpis: {
    activeAlarms: number;
    averageResponseSeconds: number | null;
    operatorsOnShift: number;
    accountsInTest: number;
    runawayAccounts: number;
  };
  problems: ProblemAccount[];
  trends: {
    alarmsByHour: number[];
    alarmsByWeekday: number[];
    falseAlarmRate: {customerId: string; name: string; alarms: number; falseAlarms: number; rate: number}[];
    responseByPriority: {priority: SignalPriority; averageSeconds: number | null; targetSeconds: number; samples: number}[];
  };
  pins: StationPin[];
};

export interface CentralStationSource {
  readonly kind: 'seed' | 'manitou';
  load(now: Date): Promise<CentralStationSnapshot>;
}

const OPERATORS: StationOperator[] = [
  {id: 'op-ava', name: 'Ava Chen', onShift: true},
  {id: 'op-luis', name: 'Luis Ortega', onShift: true},
  {id: 'op-noah', name: 'Noah Brooks', onShift: true},
  {id: 'op-samira', name: 'Samira Cole', onShift: false},
];

const ACCOUNTS: StationAccount[] = [
  {id: 'a-library', customerId: 'c-library', siteId: 's-library', accountNumber: 'ALM-1042', name: 'Boise Public Library', siteName: 'Main Branch', address: '715 S Capitol Blvd', city: 'Boise', latitude: 43.6096, longitude: -116.2075, panel: 'Silent Knight 6820', mode: 'normal', timerTest: 'passed', lowBattery: false, acLoss: false},
  {id: 'a-capitol', customerId: 'c-capitol', siteId: 's-capitol', accountNumber: 'ALM-2201', name: 'Idaho State Capitol', siteName: 'Capitol Complex', address: '700 W Jefferson St', city: 'Boise', latitude: 43.6178, longitude: -116.1995, panel: 'Notifier NFS2-3030', mode: 'normal', timerTest: 'passed', lowBattery: false, acLoss: false},
  {id: 'a-coop', customerId: 'c-coop', siteId: 's-coop', accountNumber: 'ALM-1184', name: 'Boise Co-op', siteName: 'Hyde Park Store', address: '888 W Fort St', city: 'Boise', latitude: 43.6284, longitude: -116.2038, panel: 'Fire-Lite ES-50X', mode: 'normal', timerTest: 'passed', lowBattery: true, acLoss: false},
  {id: 'a-centre', customerId: 'c-centre', siteId: 's-centre', accountNumber: 'ALM-1410', name: 'Boise Centre', siteName: 'Boise Centre', address: '850 W Front St', city: 'Boise', latitude: 43.6151, longitude: -116.2048, panel: 'Fire-Lite ES-200X', mode: 'test', timerTest: 'passed', lowBattery: false, acLoss: false},
  {id: 'a-alpha', customerId: 'c-alpha', siteId: 's-alpha', accountNumber: 'ALM-2288', name: 'St. Alphonsus Regional', siteName: 'Curtis Campus', address: '1055 N Curtis Rd', city: 'Boise', latitude: 43.6138, longitude: -116.2555, panel: 'Notifier NFS-320', mode: 'normal', timerTest: 'failed', lowBattery: false, acLoss: false},
  {id: 'a-yard', customerId: 'c-yard', siteId: 's-yard', accountNumber: 'ALM-3310', name: 'Idaho Power', siteName: 'Operations Yard', address: '1221 W Idaho St', city: 'Boise', latitude: 43.6182, longitude: -116.2055, panel: 'Silent Knight 6000', mode: 'normal', timerTest: 'passed', lowBattery: false, acLoss: true},
  {id: 'a-vista', customerId: 'c-vista', siteId: 's-vista', accountNumber: 'ALM-1766', name: 'Vista Village', siteName: 'Vista Village', address: '200 W Mallard Dr', city: 'Boise', latitude: 43.6012, longitude: -116.1802, panel: 'DSC PowerSeries', mode: 'runaway', timerTest: 'passed', lowBattery: false, acLoss: false},
];

const STEP_ORDER: SignalStepKind[] = ['received', 'operator', 'call', 'dispatch', 'close'];

export function seededCentralStation(): CentralStationSource {
  return {kind: 'seed', load: async now => buildSeedSnapshot(now)};
}

/** Bold Manitou REST adapter. `load` is where Swagger 2.1.48+ responses get mapped into this snapshot. */
export function manitouCentralStation(load: (now: Date) => CentralStationSnapshot | Promise<CentralStationSnapshot>): CentralStationSource {
  return {kind: 'manitou', load: async now => load(now)};
}

export function buildSeedSnapshot(now: Date): CentralStationSnapshot {
  const signals = [...openSignals(now), ...historySignals(now)].map(signal => ({
    ...signal,
    steps: [...signal.steps].sort((a, b) => STEP_ORDER.indexOf(a.kind) - STEP_ORDER.indexOf(b.kind) || a.at.localeCompare(b.at)),
  }));
  const queue = sortQueue(signals.filter(signal => signal.open));
  const history = signals.filter(signal => !signal.open).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return {
    asOf: now.toISOString(),
    accounts: ACCOUNTS.map(account => ({...account})),
    operators: OPERATORS.map(operator => ({...operator})),
    queue,
    history,
    kpis: stationKpis(signals, now),
    problems: problemAccounts(signals),
    trends: stationTrends(signals),
    pins: stationPins(queue),
  };
}

export function sortQueue(signals: readonly StationSignal[]) {
  return [...signals].sort((a, b) => {
    const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (rank) return rank;
    return a.receivedAt.localeCompare(b.receivedAt);
  });
}

export function responseSeconds(signal: StationSignal) {
  const received = signal.steps.find(step => step.kind === 'received');
  const action = signal.steps.find(step => step.kind === 'operator');
  if (!received || !action) return null;
  return Math.max(0, Math.round((Date.parse(action.at) - Date.parse(received.at)) / 1000));
}

export function waitingMinutes(signal: StationSignal, now: Date) {
  return Math.max(0, Math.round((now.getTime() - Date.parse(signal.receivedAt)) / 60000));
}

export function waitingLabel(signal: StationSignal, now: Date) {
  const minutes = waitingMinutes(signal, now);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

export function filterSignals(signals: readonly StationSignal[], accounts: readonly StationAccount[], filter: HistoryFilter) {
  const query = filter.query?.trim().toLocaleLowerCase() ?? '';
  return signals.filter(signal => {
    const account = accounts.find(item => item.id === signal.accountId);
    if (filter.accountId && signal.accountId !== filter.accountId) return false;
    if (filter.eventType && signal.eventType !== filter.eventType) return false;
    if (filter.operatorId && signal.operatorId !== filter.operatorId) return false;
    if (filter.date && localDate(signal.receivedAt) !== filter.date) return false;
    if (!query) return true;
    const haystack = `${account?.name ?? ''} ${account?.accountNumber ?? ''} ${signal.zone} ${signal.eventType} ${signal.priority}`.toLocaleLowerCase();
    return haystack.includes(query);
  });
}

export function workOrderFromProblem(book: AlarmBook, problem: ProblemAccount, ids: {jobId: string; jobNumber: string; techId: string; scheduledOn: string}): AlarmBook {
  const customer = book.customers.find(item => item.id === problem.customerId);
  const site = book.sites.find(item => item.id === problem.siteId);
  if (!customer) throw new AlarmOpsError('Customer was not found.');
  if (!site || site.customerId !== customer.id) throw new AlarmOpsError('Site was not found.');
  if (!book.techs.some(tech => tech.id === ids.techId)) throw new AlarmOpsError('Technician was not found.');
  const marker = `station:${problem.accountId}:${problem.kind}`;
  if (book.jobs.some(job => job.notes.includes(marker) && job.status !== 'complete' && job.status !== 'invoiced')) return book;
  const job: AlarmJob = {
    id: ids.jobId || alarmRecordId('j'),
    number: ids.jobNumber,
    customerId: customer.id,
    siteId: site.id,
    kind: 'service',
    status: 'scheduled',
    title: problem.title,
    assignedTechId: ids.techId,
    scheduledOn: ids.scheduledOn,
    notes: `${problem.detail} ${marker}`,
  };
  return {...book, jobs: [job, ...book.jobs]};
}

function stationKpis(signals: readonly StationSignal[], now: Date) {
  const today = localDate(now.toISOString());
  const samples = signals
    .filter(signal => localDate(signal.receivedAt) === today)
    .map(responseSeconds)
    .filter((value): value is number => value !== null);
  const average = samples.length ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length) : null;
  return {
    activeAlarms: signals.filter(signal => signal.open).length,
    averageResponseSeconds: average,
    operatorsOnShift: OPERATORS.filter(operator => operator.onShift).length,
    accountsInTest: ACCOUNTS.filter(account => account.mode === 'test').length,
    runawayAccounts: ACCOUNTS.filter(account => account.mode === 'runaway').length,
  };
}

function problemAccounts(signals: readonly StationSignal[]): ProblemAccount[] {
  const problems: ProblemAccount[] = [];
  const byAccount = new Map<string, StationSignal[]>();
  for (const signal of signals) {
    const list = byAccount.get(signal.accountId) ?? [];
    list.push(signal);
    byAccount.set(signal.accountId, list);
  }
  const ranked = ACCOUNTS.map(account => {
    const rows = byAccount.get(account.id) ?? [];
    return {account, falseAlarms: rows.filter(signal => signal.falseAlarm).length};
  }).filter(row => row.falseAlarms > 0).sort((a, b) => b.falseAlarms - a.falseAlarms || a.account.name.localeCompare(b.account.name));
  if (ranked[0]) {
    problems.push(problem(ranked[0].account, 'false_alarms', 'Repeated false alarms', `${ranked[0].account.name} has ${ranked[0].falseAlarms} false alarms in the last 14 days.`));
  }
  for (const account of ACCOUNTS) {
    if (account.timerTest === 'failed') problems.push(problem(account, 'timer_test', 'Failed communicator timer test', `${account.panel} at ${account.siteName} missed the communicator timer test.`));
  }
  for (const account of ACCOUNTS) {
    if (account.lowBattery) problems.push(problem(account, 'low_battery', 'Low battery', `${account.panel} at ${account.siteName} is reporting low battery.`));
  }
  for (const account of ACCOUNTS) {
    if (account.acLoss) problems.push(problem(account, 'ac_loss', 'AC loss', `${account.panel} at ${account.siteName} is reporting AC loss.`));
  }
  return problems;
}

function problem(account: StationAccount, kind: ProblemKind, title: string, detail: string): ProblemAccount {
  return {id: `${account.id}:${kind}`, accountId: account.id, customerId: account.customerId, siteId: account.siteId, kind, title, detail};
}

function stationTrends(signals: readonly StationSignal[]) {
  const alarmsByHour = Array.from({length: 24}, () => 0);
  const alarmsByWeekday = Array.from({length: 7}, () => 0);
  for (const signal of signals) {
    const when = new Date(signal.receivedAt);
    alarmsByHour[when.getHours()] += 1;
    alarmsByWeekday[when.getDay()] += 1;
  }
  const falseAlarmRate = ACCOUNTS.map(account => {
    const rows = signals.filter(signal => signal.accountId === account.id);
    const falseAlarms = rows.filter(signal => signal.falseAlarm).length;
    return {customerId: account.customerId, name: account.name, alarms: rows.length, falseAlarms, rate: rows.length ? falseAlarms / rows.length : 0};
  }).filter(row => row.alarms > 0).sort((a, b) => b.rate - a.rate || b.falseAlarms - a.falseAlarms);
  const responseByPriority = SIGNAL_PRIORITIES.map(priority => {
    const samples = signals.filter(signal => signal.priority === priority).map(responseSeconds).filter((value): value is number => value !== null);
    const averageSeconds = samples.length ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length) : null;
    return {priority, averageSeconds, targetSeconds: RESPONSE_TARGET_SECONDS[priority], samples: samples.length};
  });
  return {alarmsByHour, alarmsByWeekday, falseAlarmRate, responseByPriority};
}

function stationPins(queue: readonly StationSignal[]): StationPin[] {
  return ACCOUNTS.map(account => {
    const active = sortQueue(queue.filter(signal => signal.accountId === account.id))[0];
    const status: PinStatus = active ? active.priority : account.mode === 'test' ? 'test' : account.mode === 'runaway' ? 'runaway' : 'normal';
    return {accountId: account.id, customerId: account.customerId, siteId: account.siteId, name: account.name, siteName: account.siteName, latitude: account.latitude, longitude: account.longitude, status};
  });
}

function openSignals(now: Date): StationSignal[] {
  return [
    signal({id: 'sig-fire', accountId: 'a-library', priority: 'fire', eventType: 'Smoke detector', zone: 'Zone 14 Idaho Room', at: minutesAgo(now, 4), operatorId: 'op-ava', falseAlarm: false, open: true, responseSeconds: 50, call: true}),
    signal({id: 'sig-burg', accountId: 'a-capitol', priority: 'burglary', eventType: 'Door contact', zone: 'Zone 3 west door', at: minutesAgo(now, 11), operatorId: 'op-luis', falseAlarm: false, open: true, responseSeconds: 70, call: true}),
    signal({id: 'sig-panic', accountId: 'a-centre', priority: 'panic', eventType: 'Hold-up', zone: 'Zone 1 loading dock', at: minutesAgo(now, 2), operatorId: 'op-noah', falseAlarm: false, open: true, responseSeconds: 30, call: true, dispatch: true}),
    signal({id: 'sig-batt', accountId: 'a-coop', priority: 'trouble', eventType: 'Low battery', zone: 'FACP battery', at: minutesAgo(now, 26), falseAlarm: false, open: true}),
    signal({id: 'sig-super', accountId: 'a-alpha', priority: 'supervisory', eventType: 'Duct detector', zone: 'Zone 8 air handler', at: minutesAgo(now, 18), operatorId: 'op-luis', falseAlarm: false, open: true, responseSeconds: 100}),
    signal({id: 'sig-ac', accountId: 'a-yard', priority: 'trouble', eventType: 'AC loss', zone: 'FACP power', at: minutesAgo(now, 40), falseAlarm: false, open: true}),
  ];
}

function historySignals(now: Date): StationSignal[] {
  const closed: StationSignal[] = [];
  for (let day = 1; day <= 14; day += 1) {
    const when = new Date(now);
    when.setDate(now.getDate() - day);
    const weekend = when.getDay() === 0 || when.getDay() === 6;
    const accountId = day % 4 === 0 ? 'a-library' : day % 4 === 1 ? 'a-capitol' : day % 4 === 2 ? 'a-coop' : 'a-yard';
    closed.push(signal({
      id: `hist-${day}`,
      accountId,
      priority: weekend ? 'burglary' : 'trouble',
      eventType: weekend ? 'Door contact' : 'Trouble restoral',
      zone: weekend ? 'Zone 2 perimeter' : 'Panel trouble',
      at: atClock(when, weekend ? 1 : 9 + (day % 5), 12),
      operatorId: day % 2 ? 'op-ava' : 'op-noah',
      falseAlarm: accountId === 'a-library',
      open: false,
      responseSeconds: weekend ? 70 : 200,
      call: true,
      close: true,
    }));
    const libraryAt = atClock(when, 15, 5 + day);
    closed.push(signal({
      id: `hist-lib-${day}`,
      accountId: 'a-library',
      priority: 'fire',
      eventType: 'Smoke detector',
      zone: 'Zone 14 Idaho Room',
      at: libraryAt,
      operatorId: 'op-ava',
      falseAlarm: true,
      open: false,
      responseSeconds: 50,
      call: true,
      close: true,
    }));
  }
  return closed;
}

function signal(input: {id: string; accountId: string; priority: SignalPriority; eventType: string; zone: string; at: Date; operatorId?: string; falseAlarm: boolean; open: boolean; responseSeconds?: number; call?: boolean; dispatch?: boolean; close?: boolean}): StationSignal {
  const operator = OPERATORS.find(item => item.id === input.operatorId);
  const steps: SignalStep[] = [{kind: 'received', at: input.at.toISOString(), actor: 'Receiver', note: `${input.eventType} received`}];
  if (operator && input.responseSeconds !== undefined) {
    const acted = new Date(input.at.getTime() + input.responseSeconds * 1000);
    steps.push({kind: 'operator', at: acted.toISOString(), actor: operator.name, note: 'Operator accepted the signal'});
    if (input.call) steps.push({kind: 'call', at: new Date(acted.getTime() + 45_000).toISOString(), actor: operator.name, note: 'Called the site contact'});
    if (input.dispatch) steps.push({kind: 'dispatch', at: new Date(acted.getTime() + 90_000).toISOString(), actor: operator.name, note: 'Dispatched field response'});
    if (!input.open || input.close) steps.push({kind: 'close', at: new Date(acted.getTime() + 180_000).toISOString(), actor: operator.name, note: input.falseAlarm ? 'Closed as a false alarm' : 'Closed after verification'});
  }
  return {id: input.id, accountId: input.accountId, priority: input.priority, eventType: input.eventType, zone: input.zone, receivedAt: input.at.toISOString(), operatorId: input.operatorId, falseAlarm: input.falseAlarm, open: input.open, steps};
}

function minutesAgo(now: Date, minutes: number) {
  return new Date(now.getTime() - minutes * 60_000);
}

function atClock(day: Date, hour: number, minute: number) {
  const next = new Date(day);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function localDate(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
