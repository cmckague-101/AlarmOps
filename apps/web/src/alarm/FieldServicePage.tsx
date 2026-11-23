import {useState} from 'react';
import {
  ALARMCO, alarmRecordId, availableFieldActions, canApproveTimesheets, certificationState, createMockQboTimeClient,
  fieldStatusLabel, isFieldTechnician, jobsOn, jobsVisibleTo, logTime, placeJob, queueApprovedSync, recordPunch,
  setPayrollItemsEnabled, shiftState, syncApprovedTime, techIdForViewer, techTimeOff, unassignedJobs, updateFieldStatus,
  addTimeOff, approveTimesheet, mapEmployee, weekDates, weekHours,
  type AlarmBook, type FieldStatus, type QboTimeClient, type TechTimeLog, type UserRole,
} from '@fireops/domain';
import './alarm-ops.css';
import './field-service.css';

type View = 'board' | 'roster' | 'time';
type OpenTarget = 'customers' | 'jobs' | 'compliance';

const fallbackClient = createMockQboTimeClient().client;

export function FieldServicePage({book, onChange, techTime, onTechTime, today, role, userName, vehicles, quickBooksConnected, demoMode, client = fallbackClient, onOpen, initialView = 'board'}: {
  book: AlarmBook;
  onChange: (book: AlarmBook) => void;
  techTime: TechTimeLog;
  onTechTime: (log: TechTimeLog) => void;
  today: string;
  role: UserRole;
  userName: string;
  vehicles: {id: string; unit: string}[];
  quickBooksConnected: boolean;
  demoMode: boolean;
  client?: QboTimeClient;
  onOpen: (section: OpenTarget, id?: string) => void;
  initialView?: View;
}) {
  const technician = isFieldTechnician(role);
  const viewerTechId = techIdForViewer(book, userName);
  const [view, setView] = useState<View>(initialView);
  const [span, setSpan] = useState<'week' | 'day'>('week');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const run = (change: () => AlarmBook) => {
    try { onChange(change()); setError(''); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'That change could not be saved.'); return false; }
  };
  return <div className="page ao-page">
    <div className="page-heading">
      <div>
        <p className="ao-kicker">{ALARMCO.name} · Field service</p>
        <h1>Field Service</h1>
        <p>Dispatch, roster, time off, and tech time. Overtime starts after 40 hours, Monday through Sunday.</p>
      </div>
    </div>
    <div className="fs-switch" role="tablist" aria-label="Field service">
      {(['board', 'roster', 'time'] as const).map(item => <button key={item} type="button" className={view === item ? 'primary' : 'secondary'} aria-pressed={view === item} onClick={() => setView(item)}>{item === 'board' ? 'Board' : item === 'roster' ? 'Roster' : 'Tech time'}</button>)}
    </div>
    {error && <div className="form-submit-error" role="alert">{error}</div>}
    {notice && <p className="fs-status" role="status">{notice}</p>}
    {view === 'board' && <Board book={book} today={today} span={span} onSpan={setSpan} technician={technician} viewerTechId={viewerTechId} run={run} onOpen={onOpen}/>}
    {view === 'roster' && <Roster book={book} today={today} vehicles={vehicles} technician={technician} viewerTechId={viewerTechId} run={run}/>}
    {view === 'time' && <TechTime book={book} log={techTime} today={today} role={role} viewerTechId={viewerTechId} userName={userName} quickBooksConnected={quickBooksConnected} demoMode={demoMode} client={client} onBook={onChange} onLog={onTechTime} onError={setError} onNotice={setNotice}/>}
  </div>;
}

function Board({book, today, span, onSpan, technician, viewerTechId, run, onOpen}: {
  book: AlarmBook; today: string; span: 'week' | 'day'; onSpan: (span: 'week' | 'day') => void; technician: boolean; viewerTechId: string | null;
  run: (change: () => AlarmBook) => boolean; onOpen: (section: OpenTarget, id?: string) => void;
}) {
  const dates = span === 'week' ? weekDates(today) : [today];
  const techs = technician ? book.techs.filter(tech => tech.id === viewerTechId) : book.techs;
  const queue = technician ? [] : unassignedJobs(book);
  const [jobId, setJobId] = useState(queue[0]?.id ?? '');
  const [techId, setTechId] = useState(techs[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const jobs = jobsVisibleTo(book, technician ? 'shop_tech' : 'owner', viewerTechId);
  const drop = (scheduledOn: string, assignedTechId: string, draggedId: string) => run(() => placeJob(book, draggedId, scheduledOn, assignedTechId));
  return <div className="ao-stack">
    <div className="fs-day">
      <button type="button" className={span === 'day' ? 'primary' : 'secondary'} onClick={() => onSpan('day')}>Day</button>
      <button type="button" className={span === 'week' ? 'primary' : 'secondary'} onClick={() => onSpan('week')}>Week</button>
    </div>
    {!technician && <section className="ao-panel"><header><div><h2>Unassigned</h2><p>Jobs with no technician, including work orders opened from the central station.</p></div></header>
      <div className="ao-list">{queue.map(job => <JobChip key={job.id} book={book} jobId={job.id} onOpen={onOpen}/>)}{!queue.length && <p className="ao-muted" style={{padding: 12}}>Every open job has a technician.</p>}</div>
    </section>}
    <div className={`fs-board${span === 'day' ? ' day' : ''}`}>
      <div/>
      {dates.map(day => <div key={day} className="fs-head">{day.slice(5)}</div>)}
      {techs.map(tech => <div key={tech.id} style={{display: 'contents'}}>
        <div className="fs-tech">{tech.name}</div>
        {dates.map(day => {
          const off = techTimeOff(book, tech.id, day);
          const assigned = jobsOn(book, tech.id, day).filter(job => jobs.some(visible => visible.id === job.id));
          return <div key={day} className={`fs-cell${off ? ' off' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('text/job-id'); if (id) drop(day, tech.id, id); }}>
            {off && <small>Off · {off.reason}</small>}
            {assigned.map(job => <JobChip key={job.id} book={book} jobId={job.id} onOpen={onOpen} draggable={!technician}/>)}
          </div>;
        })}
      </div>)}
    </div>
    {!technician && <form className="ao-form" onSubmit={event => { event.preventDefault(); run(() => placeJob(book, jobId, date, techId)); }}>
      <label><span>Assign a job</span><select value={jobId} onChange={event => setJobId(event.target.value)}>{book.jobs.filter(job => job.status !== 'invoiced').map(job => <option key={job.id} value={job.id}>{job.number} · {job.title}</option>)}</select></label>
      <label><span>Technician</span><select value={techId} onChange={event => setTechId(event.target.value)}><option value="">Unassigned</option>{book.techs.map(tech => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></label>
      <label><span>Date</span><input type="date" value={date} onChange={event => setDate(event.target.value)}/></label>
      <button className="primary" type="submit">Place job</button>
    </form>}
    <FieldActions book={book} jobs={jobs} run={run} onOpen={onOpen}/>
  </div>;
}

function JobChip({book, jobId, onOpen, draggable = false}: {book: AlarmBook; jobId: string; onOpen: (section: OpenTarget, id?: string) => void; draggable?: boolean}) {
  const job = book.jobs.find(item => item.id === jobId);
  if (!job) return null;
  const customer = book.customers.find(item => item.id === job.customerId);
  const site = book.sites.find(item => item.id === job.siteId);
  return <button type="button" className="fs-job" draggable={draggable} onDragStart={event => { event.dataTransfer.setData('text/job-id', job.id); event.dataTransfer.effectAllowed = 'move'; }} onClick={() => onOpen('jobs', job.id)}>
    <b>{job.title}</b>
    <small>{customer?.name ?? 'Customer'} · {site?.name ?? 'Site'}</small>
  </button>;
}

function FieldActions({book, jobs, run, onOpen}: {book: AlarmBook; jobs: AlarmBook['jobs']; run: (change: () => AlarmBook) => boolean; onOpen: (section: OpenTarget, id?: string) => void}) {
  const active = jobs.filter(job => availableFieldActions(job.status).length);
  if (!active.length) return null;
  return <section className="ao-panel"><header><div><h2>Field status</h2><p>En route, on site, and complete follow the job pipeline.</p></div></header>
    <div className="ao-list">{active.map(job => {
      const inspection = book.inspections.find(item => item.siteId === job.siteId);
      return <div key={job.id} className="ao-row"><div className="ao-row-copy"><b>{job.title}</b><small>{job.number}</small></div>
        <div className="ao-actions">
          <button type="button" className="secondary" onClick={() => onOpen('customers', job.customerId)}>Customer</button>
          {inspection && <button type="button" className="secondary" onClick={() => onOpen('compliance', inspection.id)}>Inspection</button>}
          {availableFieldActions(job.status).map(status => <button key={status} type="button" className="primary" onClick={() => run(() => updateFieldStatus(book, job.id, status as FieldStatus))}>{fieldStatusLabel[status]}</button>)}
        </div>
      </div>;
    })}</div>
  </section>;
}

function Roster({book, today, vehicles, technician, viewerTechId, run}: {book: AlarmBook; today: string; vehicles: {id: string; unit: string}[]; technician: boolean; viewerTechId: string | null; run: (change: () => AlarmBook) => boolean}) {
  const techs = technician ? book.techs.filter(tech => tech.id === viewerTechId) : book.techs;
  const [techId, setTechId] = useState(techs[0]?.id ?? '');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState('');
  return <div className="ao-stack">
    <div className="fs-roster">{techs.map(tech => <article key={tech.id}>
      <h2>{tech.name}</h2>
      <p>{tech.title}</p>
      <p>{tech.phone} · {tech.email}</p>
      <p>Vehicle {vehicles.find(vehicle => vehicle.id === tech.vehicleId)?.unit ?? 'not assigned'}</p>
      <p>{tech.skills.join(' · ')}</p>
      <ul>{tech.certifications.map(cert => {
        const state = certificationState(cert.expiresOn, today);
        return <li key={cert.id}>{cert.name} · {cert.issuer} · {state === 'expired' ? `expired ${cert.expiresOn}` : state === 'expiring' ? `expires ${cert.expiresOn}` : `current through ${cert.expiresOn}`}</li>;
      })}</ul>
    </article>)}</div>
    {!technician && <form className="ao-form" onSubmit={event => { event.preventDefault(); run(() => addTimeOff(book, {id: alarmRecordId('off'), techId, start, end, reason})); setReason(''); }}>
      <h2>Time off</h2>
      <label><span>Technician</span><select value={techId} onChange={event => setTechId(event.target.value)}>{techs.map(tech => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></label>
      <label><span>Start</span><input type="date" value={start} onChange={event => setStart(event.target.value)}/></label>
      <label><span>End</span><input type="date" value={end} onChange={event => setEnd(event.target.value)}/></label>
      <label><span>Reason</span><input value={reason} onChange={event => setReason(event.target.value)} maxLength={120}/></label>
      <button className="primary" type="submit">Add time off</button>
      <ul className="fs-roster">{book.timeOff.map(item => <li key={item.id}>{book.techs.find(tech => tech.id === item.techId)?.name} · {item.start} to {item.end} · {item.reason}</li>)}</ul>
    </form>}
  </div>;
}

function TechTime({book, log, today, role, viewerTechId, userName, quickBooksConnected, demoMode, client, onBook, onLog, onError, onNotice}: {
  book: AlarmBook; log: TechTimeLog; today: string; role: UserRole; viewerTechId: string | null; userName: string; quickBooksConnected: boolean; demoMode: boolean; client: QboTimeClient;
  onBook: (book: AlarmBook) => void; onLog: (log: TechTimeLog) => void; onError: (message: string) => void; onNotice: (message: string) => void;
}) {
  const manager = canApproveTimesheets(role);
  const self = viewerTechId ?? '';
  const [techId, setTechId] = useState(manager ? (book.techs[0]?.id ?? '') : self);
  const [jobId, setJobId] = useState('');
  const [notes, setNotes] = useState('');
  const [mappingId, setMappingId] = useState(book.techs[0]?.id ?? '');
  const [qboId, setQboId] = useState('');
  const [qboName, setQboName] = useState('');
  const [busy, setBusy] = useState(false);
  const jobs = jobsVisibleTo(book, role, viewerTechId).filter(job => job.status !== 'invoiced');
  const state = shiftState(log, techId);
  const punch = async (kind: 'in' | 'out' | 'break_start' | 'break_end') => {
    if (!techId) { onError('This sign-in is not linked to a technician.'); return; }
    const location = await readLocation();
    try {
      const next = recordPunch(log, {id: alarmRecordId('punch'), techId, jobId: kind === 'in' ? jobId : state.jobId, kind, at: nowStamp(), ...location, notes});
      const nextBook = next.entry ? logTime(book, next.entry) : book;
      onLog(next.log);
      if (next.entry) onBook(nextBook);
      onError('');
      onNotice(location.latitude == null ? 'Punched. Location unavailable.' : 'Punched with a location stamp.');
      if (kind === 'out') setNotes('');
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'That punch could not be saved.');
    }
  };
  const approve = async (personId: string, weekStart: string) => {
    setBusy(true);
    try {
      const approved = approveTimesheet(log, personId, weekStart, userName, nowStamp());
      const queued = queueApprovedSync(approved, book);
      onLog(queued);
      const synced = await syncApprovedTime(queued, book, client, quickBooksConnected);
      onLog(synced);
      onNotice(quickBooksConnected ? 'Timesheet approved and sent to QuickBooks.' : 'Timesheet approved. Connect QuickBooks in API keys to sync.');
      onError('');
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'The timesheet could not be approved.');
    } finally { setBusy(false); }
  };
  const retry = async () => {
    setBusy(true);
    try {
      onLog(await syncApprovedTime(log, book, client, quickBooksConnected));
      onError('');
    } finally { setBusy(false); }
  };
  const people = manager ? book.techs : book.techs.filter(tech => tech.id === self);
  return <div className="ao-stack">
    <section className="ao-detail"><header><div><h2>Tech time</h2><p>{state.clockedIn ? `Clocked in${state.onBreak ? ' · on break' : ''}` : 'Clocked out'}{state.since ? ` since ${state.since.slice(11, 16)}` : ''}</p></div></header>
      <div className="ao-body">
        {manager && <label className="ao-form"><span>Technician</span><select value={techId} onChange={event => setTechId(event.target.value)}>{people.map(tech => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></label>}
        <label className="ao-form"><span>Job</span><select value={jobId} onChange={event => setJobId(event.target.value)} disabled={state.clockedIn}><option value="">No job</option>{jobs.map(job => <option key={job.id} value={job.id}>{job.number} · {job.title}</option>)}</select></label>
        <label className="ao-form"><span>Notes</span><input value={notes} onChange={event => setNotes(event.target.value)} maxLength={200}/></label>
        <p className="fs-note">Location is stamped at the punch when this device shares it. A denied location still lets you clock in.</p>
        <div className="ao-actions">
          {!state.clockedIn && <button type="button" className="primary" onClick={() => void punch('in')}>Clock in</button>}
          {state.clockedIn && !state.onBreak && <button type="button" className="secondary" onClick={() => void punch('break_start')}>Start break</button>}
          {state.onBreak && <button type="button" className="secondary" onClick={() => void punch('break_end')}>End break</button>}
          {state.clockedIn && !state.onBreak && <button type="button" className="primary" onClick={() => void punch('out')}>Clock out</button>}
        </div>
      </div>
    </section>
    <section className="ao-panel"><header><div><h2>Timesheets</h2><p>Monday–Sunday. Hours over 40 are overtime. Supervisors approve, then approved hours sync.</p></div></header>
      <div className="ao-list">{people.map(tech => {
        const current = weekHours(book.timeEntries, tech.id, today);
        const dates = book.timeEntries.filter(entry => entry.techId === tech.id).map(entry => entry.date).sort();
        const recorded = dates.length ? weekHours(book.timeEntries, tech.id, dates[dates.length - 1]) : current;
        const weeks = recorded.start === current.start ? [current] : [recorded, current];
        return <article key={tech.id} className="ao-row"><div className="ao-row-copy"><b>{tech.name}</b>{weeks.map(week => {
          const approved = log.approvals.some(item => item.techId === tech.id && item.weekStart === week.start);
          return <small key={week.start}>Week of {week.start}: {week.hours} hrs · {week.overtimeHours} overtime{approved ? ' · approved' : ''}</small>;
        })}</div>
          {manager && <div className="ao-actions">{weeks.filter(week => week.hours > 0 && !log.approvals.some(item => item.techId === tech.id && item.weekStart === week.start)).map(week => <button key={week.start} type="button" className="primary" disabled={busy} onClick={() => void approve(tech.id, week.start)}>Approve {week.start}</button>)}</div>}
        </article>;
      })}</div>
    </section>
    {manager && <section className="ao-panel"><header><div><h2>QuickBooks TimeActivity</h2><p>{demoMode ? 'Demo sync uses a mock QuickBooks client. It records employee, customer, hours, and date, and it does not post to Intuit.' : 'Sync uses the QuickBooks connection saved in Settings, API keys. This app still sends that payload through the mock client so secrets stay on the server.'}</p></div></header>
      <form className="ao-form" style={{padding: 16}} onSubmit={event => { event.preventDefault(); try { onLog(mapEmployee(log, {techId: mappingId, qboEmployeeId: qboId, qboEmployeeName: qboName})); setQboId(''); setQboName(''); onError(''); } catch (reason) { onError(reason instanceof Error ? reason.message : 'The employee could not be mapped.'); } }}>
        <label><span>AlarmOps technician</span><select value={mappingId} onChange={event => setMappingId(event.target.value)}>{book.techs.map(tech => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></label>
        <label><span>QuickBooks employee id</span><input value={qboId} onChange={event => setQboId(event.target.value)}/></label>
        <label><span>QuickBooks employee name</span><input value={qboName} onChange={event => setQboName(event.target.value)}/></label>
        <button className="secondary" type="submit">Save employee mapping</button>
        <ul>{log.employees.map(item => <li key={item.techId}>{book.techs.find(tech => tech.id === item.techId)?.name} → {item.qboEmployeeName} ({item.qboEmployeeId})</li>)}</ul>
        <label><input type="checkbox" checked={log.payrollItemsEnabled} onChange={event => onLog(setPayrollItemsEnabled(log, event.target.checked))}/> Map hours to Regular and Overtime pay items. This needs Intuit Premium Silver and stays off until you turn it on.</label>
      </form>
      <ul className="fs-sync" style={{padding: 16}}>{log.syncs.map(item => <li key={item.idempotencyKey}><span>{item.idempotencyKey}</span><b>{item.status}{item.error ? ` · ${item.error}` : ''}</b></li>)}{!log.syncs.length && <li>No time has been sent yet.</li>}</ul>
      {log.syncs.some(item => item.status === 'failed') && <div className="ao-actions" style={{padding: 16}}><button type="button" className="primary" disabled={busy} onClick={() => void retry()}>Retry failed sync</button></div>}
    </section>}
  </div>;
}

function nowStamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function readLocation(): Promise<{latitude: number | null; longitude: number | null}> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve({latitude: null, longitude: null});
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({latitude: position.coords.latitude, longitude: position.coords.longitude}),
      () => resolve({latitude: null, longitude: null}),
      {enableHighAccuracy: true, timeout: 4000, maximumAge: 60_000},
    );
  });
}
