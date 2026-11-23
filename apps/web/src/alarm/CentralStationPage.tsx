import {useEffect, useState} from 'react';
import {
  ALARMCO, alarmRecordId, nextAlarmNumber,
  buildSeedSnapshot, filterSignals, priorityLabel, waitingLabel, workOrderFromProblem,
  type AlarmBook, type HistoryFilter, type PinStatus, type ProblemAccount, type StationLoad, type StationSignal,
} from '@fireops/domain';
import './central-station.css';

const BOUNDS = {north: 43.635, south: 43.595, west: -116.27, east: -116.17};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PIN_LABEL: Record<PinStatus, string> = {
  normal: 'Normal', fire: 'Fire', burglary: 'Burglary', panic: 'Panic', trouble: 'Trouble', supervisory: 'Supervisory', test: 'Test', runaway: 'Runaway',
};

export function CentralStationPage({book, onChange, onOpenCustomer, now, loadStation}: {
  book: AlarmBook;
  onChange: (book: AlarmBook) => void;
  onOpenCustomer: (customerId: string) => void;
  now?: Date;
  loadStation?: (now: Date) => Promise<StationLoad>;
}) {
  const clock = useStationClock(now);
  const [bundle, setBundle] = useState<StationLoad>(() => ({snapshot: buildSeedSnapshot(clock), using: 'seed'}));
  useEffect(() => {
    if (!loadStation) return;
    let active = true;
    void loadStation(clock).then(next => { if (active) setBundle(next); });
    return () => { active = false; };
  }, [clock, loadStation]);
  const snapshot = bundle.snapshot;
  const [selectedId, setSelectedId] = useState('sig-fire');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<HistoryFilter>({});
  const selected = [...snapshot.queue, ...snapshot.history].find(signal => signal.id === selectedId) ?? snapshot.queue[0];
  const history = filterSignals(snapshot.history, snapshot.accounts, filter);
  const eventTypes = [...new Set(snapshot.history.map(signal => signal.eventType))];
  const createOrder = (problem: ProblemAccount) => {
    try {
      const today = localDay(clock);
      onChange(workOrderFromProblem(book, problem, {
        jobId: alarmRecordId('j'),
        jobNumber: nextAlarmNumber(book.jobs.map(job => job.number), 'J', clock.getFullYear()),
        techId: book.techs[0]?.id ?? '',
        scheduledOn: today,
      }));
      setNotice(`Work order opened for ${problem.title}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The work order could not be opened.');
    }
  };
  return <div className="page cs-page">
    <div className="page-heading">
      <div>
        <p className="ao-kicker">{ALARMCO.name} · Manitou central station</p>
        <h1>Central station</h1>
        <p>Live queue, site map, and signal history for Alarmco’s own monitoring center.</p>
      </div>
    </div>
    <p className="cs-note">{bundle.using === 'manitou' ? 'Live Manitou feed from the credentials saved in Settings.' : 'Demo feed. Save Manitou credentials in Settings to use the REST API. Bold Manitou (Swagger 2.1.48+) is read on the server; this page never receives the password or API key.'}</p>
    <div className="cs-kpis">
      <Kpi value={String(snapshot.kpis.activeAlarms)} label="Active alarms"/>
      <Kpi value={snapshot.kpis.averageResponseSeconds === null ? '—' : formatSeconds(snapshot.kpis.averageResponseSeconds)} label="Avg response today"/>
      <Kpi value={String(snapshot.kpis.operatorsOnShift)} label="Operators on shift"/>
      <Kpi value={`${snapshot.kpis.accountsInTest} test · ${snapshot.kpis.runawayAccounts} runaway`} label="Test or runaway"/>
    </div>
    <div className="cs-split">
      <section className="cs-panel" aria-labelledby="queue-heading">
        <header><div><h2 id="queue-heading">Live alarm queue</h2><p>Fire, then burglary, panic, trouble, and supervisory.</p></div></header>
        <div className="cs-queue">
          {snapshot.queue.map(signal => {
            const account = snapshot.accounts.find(item => item.id === signal.accountId);
            const operator = snapshot.operators.find(item => item.id === signal.operatorId);
            return <button key={signal.id} type="button" className="cs-signal" aria-current={signal.id === selected?.id ? 'true' : undefined} onClick={() => setSelectedId(signal.id)}>
              <b className={`ao-chip ao-${signal.priority === 'fire' || signal.priority === 'panic' ? 'bad' : signal.priority === 'burglary' ? 'warn' : 'idle'}`}>{priorityLabel[signal.priority]}</b>
              <span><b>{account?.name}</b><small>{account?.siteName} · {signal.zone}</small></span>
              <small>{waitingLabel(signal, clock)} · {operator?.name ?? 'Unassigned'}</small>
            </button>;
          })}
        </div>
      </section>
      <section className="cs-panel" aria-labelledby="map-heading">
        <header><div><h2 id="map-heading">Site map</h2><p>Boise pins colored by the highest open signal.</p></div></header>
        <div className="cs-map">
          <svg viewBox="0 0 640 360" aria-hidden="true">
            <path d="M0 250 C 80 230, 140 280, 220 250 S 360 200, 460 240 640 210 640 210" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="10"/>
            <text x="16" y="28" fill="currentColor" opacity=".55" fontSize="14">Boise</text>
          </svg>
          {snapshot.pins.map(pin => {
            const left = ((pin.longitude - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * 100;
            const top = ((BOUNDS.north - pin.latitude) / (BOUNDS.north - BOUNDS.south)) * 100;
            return <button key={pin.accountId} type="button" className={`cs-pin cs-pin-${pin.status}`} style={{left: `${left}%`, top: `${top}%`}} aria-label={`${pin.name}, ${pin.siteName}, ${PIN_LABEL[pin.status]}`} onClick={() => {
              const signal = snapshot.queue.find(item => item.accountId === pin.accountId);
              if (signal) setSelectedId(signal.id);
              else onOpenCustomer(pin.customerId);
            }}><i/></button>;
          })}
        </div>
        <div className="cs-legend">{(Object.keys(PIN_LABEL) as PinStatus[]).map(status => <span key={status}><i className={`cs-pin-${status}`}/>{PIN_LABEL[status]}</span>)}</div>
      </section>
    </div>
    {selected && <SignalDetail book={book} signal={selected} snapshotAccounts={snapshot.accounts} operators={snapshot.operators} clock={clock} onOpenCustomer={onOpenCustomer}/>}
    <div className="cs-stack">
      {notice && <div className="cs-status" role="status">{notice}</div>}
      <section className="cs-panel" aria-labelledby="problem-heading">
        <header><div><h2 id="problem-heading">Problem accounts</h2><p>False alarms, failed timer tests, low battery, and AC loss.</p></div></header>
        <div className="cs-problems">
          {snapshot.problems.map(problem => <article key={problem.id} className="cs-problem">
            <div><b>{problem.title}</b><p>{problem.detail}</p></div>
            <button className="primary" type="button" onClick={() => createOrder(problem)}>Create work order</button>
          </article>)}
        </div>
      </section>
      <section className="cs-panel" aria-labelledby="trend-heading">
        <header><div><h2 id="trend-heading">Trends</h2><p>Last 14 days plus the open queue.</p></div></header>
        <h3 className="cs-muted" style={{padding: '12px 16px 0'}}>Alarms by hour</h3>
        <div className="cs-bars" aria-hidden="true">{snapshot.trends.alarmsByHour.map((count, hour) => <span key={hour} title={`${hour}:00 · ${count}`} style={{height: `${barHeight(count, snapshot.trends.alarmsByHour)}%`}}/>)}</div>
        <div className="cs-axis"><span>12a</span><span>6a</span><span>12p</span><span>6p</span></div>
        <ul className="sr-only">{snapshot.trends.alarmsByHour.map((count, hour) => <li key={hour}>{hour}:00, {count} alarms</li>)}</ul>
        <h3 className="cs-muted" style={{padding: '0 16px'}}>Alarms by day of week</h3>
        <div className="cs-bars" aria-hidden="true">{snapshot.trends.alarmsByWeekday.map((count, day) => <span key={day} title={`${WEEKDAYS[day]} · ${count}`} style={{height: `${barHeight(count, snapshot.trends.alarmsByWeekday)}%`}}/>)}</div>
        <div className="cs-axis">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
        <ul className="sr-only">{snapshot.trends.alarmsByWeekday.map((count, day) => <li key={day}>{WEEKDAYS[day]}, {count} alarms</li>)}</ul>
        <div className="cs-problems">
          {snapshot.trends.falseAlarmRate.map(row => <article key={row.customerId} className="cs-problem"><div><b>{row.name}</b><p>{row.falseAlarms} false of {row.alarms} alarms · {Math.round(row.rate * 100)}%</p></div></article>)}
          {snapshot.trends.responseByPriority.filter(row => row.samples > 0).map(row => <article key={row.priority} className="cs-problem"><div><b>{priorityLabel[row.priority]} response</b><p>{formatSeconds(row.averageSeconds ?? 0)} average · target {formatSeconds(row.targetSeconds)}</p></div><b className={`ao-chip ${(row.averageSeconds ?? 0) <= row.targetSeconds ? 'ao-ok' : 'ao-bad'}`}>{(row.averageSeconds ?? 0) <= row.targetSeconds ? 'Inside target' : 'Over target'}</b></article>)}
        </div>
      </section>
      <section className="cs-panel" aria-labelledby="history-heading">
        <header><div><h2 id="history-heading">Signal history</h2><p>{history.length} closed signals match.</p></div></header>
        <div className="cs-filters">
          <label>Account<select value={filter.accountId ?? ''} onChange={event => setFilter(current => ({...current, accountId: event.target.value || undefined}))}><option value="">All accounts</option>{snapshot.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          <label>Event type<select value={filter.eventType ?? ''} onChange={event => setFilter(current => ({...current, eventType: event.target.value || undefined}))}><option value="">All events</option>{eventTypes.map(type => <option key={type}>{type}</option>)}</select></label>
          <label>Date<input type="date" value={filter.date ?? ''} onChange={event => setFilter(current => ({...current, date: event.target.value || undefined}))}/></label>
          <label>Operator<select value={filter.operatorId ?? ''} onChange={event => setFilter(current => ({...current, operatorId: event.target.value || undefined}))}><option value="">All operators</option>{snapshot.operators.map(operator => <option key={operator.id} value={operator.id}>{operator.name}</option>)}</select></label>
        </div>
        <label className="cs-filters" style={{gridTemplateColumns: '1fr'}}>Search<input aria-label="Search signals" value={filter.query ?? ''} placeholder="Account, zone, or event" onChange={event => setFilter(current => ({...current, query: event.target.value}))}/></label>
        <div className="cs-queue">
          {history.map(signal => {
            const account = snapshot.accounts.find(item => item.id === signal.accountId);
            return <button key={signal.id} type="button" className="cs-signal" onClick={() => setSelectedId(signal.id)}>
              <b>{priorityLabel[signal.priority]}</b>
              <span><b>{account?.name}</b><small>{signal.eventType} · {signal.zone}</small></span>
              <small>{new Date(signal.receivedAt).toLocaleString()}</small>
            </button>;
          })}
          {!history.length && <p className="cs-note" style={{padding: 16}}>No signals match these filters.</p>}
        </div>
      </section>
    </div>
  </div>;
}

function SignalDetail({book, signal, snapshotAccounts, operators, clock, onOpenCustomer}: {
  book: AlarmBook;
  signal: StationSignal;
  snapshotAccounts: {id: string; customerId: string; siteId: string; panel: string; name: string; siteName: string; address: string}[];
  operators: {id: string; name: string}[];
  clock: Date;
  onOpenCustomer: (customerId: string) => void;
}) {
  const account = snapshotAccounts.find(item => item.id === signal.accountId);
  const site = book.sites.find(item => item.id === account?.siteId);
  const systems = book.systems.filter(item => item.siteId === account?.siteId);
  const jobs = book.jobs.filter(item => item.siteId === account?.siteId && item.status !== 'complete' && item.status !== 'invoiced');
  const today = localDay(clock);
  const upcoming = book.inspections.filter(item => item.siteId === account?.siteId && item.nextDue >= today);
  const operator = operators.find(item => item.id === signal.operatorId);
  return <section className="cs-panel" style={{marginTop: 16}} aria-labelledby="signal-heading">
    <header>
      <div>
        <h2 id="signal-heading">{account?.name} · {priorityLabel[signal.priority]}</h2>
        <p>{account?.siteName} · {signal.zone} · {signal.eventType} · {operator?.name ?? 'Unassigned'} · waiting {waitingLabel(signal, clock)}</p>
      </div>
      {account && <button className="secondary" type="button" onClick={() => onOpenCustomer(account.customerId)}>Open customer</button>}
    </header>
    <div className="cs-detail">
      <dl className="ao-facts">
        <div><dt>Panel</dt><dd>{account?.panel}</dd></div>
        <div><dt>Address</dt><dd>{site ? `${site.address}, ${site.city}` : account?.address}</dd></div>
        <div><dt>Systems</dt><dd>{systems.length ? systems.map(system => system.name).join(', ') : 'No system on the customer record'}</dd></div>
        <div><dt>Open work orders</dt><dd>{jobs.length ? jobs.map(job => `${job.number} ${job.title}`).join('; ') : 'None'}</dd></div>
        <div><dt>Upcoming inspections</dt><dd>{upcoming.length ? upcoming.map(item => `${item.number} due ${item.nextDue}`).join('; ') : 'None scheduled'}</dd></div>
      </dl>
      <ol className="cs-timeline">
        {signal.steps.map(step => <li key={`${step.kind}-${step.at}`}><b>{stepLabel(step.kind)}</b><span>{new Date(step.at).toLocaleString()} · {step.actor} · {step.note}</span></li>)}
      </ol>
    </div>
  </section>;
}

function Kpi({value, label}: {value: string; label: string}) {
  return <div className="cs-kpi"><strong>{value}</strong><span>{label}</span></div>;
}

function useStationClock(fixed?: Date) {
  const [now, setNow] = useState(() => fixed ?? new Date());
  useEffect(() => {
    if (fixed) { setNow(fixed); return; }
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [fixed]);
  return fixed ?? now;
}

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatSeconds(seconds: number) {
  if (seconds < 60) return `${seconds} sec`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
}

function barHeight(count: number, series: number[]) {
  const max = Math.max(1, ...series);
  return Math.max(4, Math.round((count / max) * 100));
}

function stepLabel(kind: string) {
  if (kind === 'received') return 'Received';
  if (kind === 'operator') return 'Operator';
  if (kind === 'call') return 'Call';
  if (kind === 'dispatch') return 'Dispatch';
  return 'Close';
}
