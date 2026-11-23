import {useEffect, useState, type ReactNode} from 'react';
import {ChevronRight, Plus} from 'lucide-react';
import {
  ALARMCO, acceptQuote, addCustomer, addQuote, addQuoteLine, addSite, addSystem, adiQuoteLine, alarmRecordId, alarmSummary, assignJob, createMockAdiParts, markedUpUnitPrice,
  correctDeficiency, declineQuote, formatMoney, inspectionReportHtml, inspectionsDue, invoiceFromJob,
  alarmInvoiceState, invoiceFromMonitoring, invoiceTotal, jobKindLabel, jobStatusLabel, lineExtension,
  markInvoicePaid, monitoringLabel, nextAlarmNumber, quoteStatusLabel, quoteTotal, setChecklistResult,
  startInspection, systemKindLabel, transitionJob,
  type AdiPart, type AlarmBook, type AlarmInvoice, type ChecklistResult, type JobKind,
  type JobStatus, type MonitoringStatus, type QuoteLine, type SystemKind,
} from '@fireops/domain';
import './alarm-ops.css';

export type AlarmSection = 'command' | 'customers' | 'jobs' | 'quotes' | 'compliance' | 'billing';
export type AlarmDestination = AlarmSection | 'field-service';

type Tone = 'ok' | 'warn' | 'bad' | 'idle';

const copy: Record<AlarmSection, {title: string; lede: string}> = {
  command: {title: 'Command', lede: 'Customers, sites, quotes, jobs, inspections, and invoices for the fire alarm and security desk.'},
  customers: {title: 'Customers', lede: 'Accounts, site addresses, installed systems, and monitoring contracts.'},
  jobs: {title: 'Jobs', lede: 'Installs, service calls, and inspections, with a technician on each one.'},
  quotes: {title: 'Quotes', lede: 'Device and labor lines. Accepting a quote opens a job.'},
  compliance: {title: 'Inspections', lede: 'NFPA 72-style checklists, recurring due dates, deficiencies, and a printable report.'},
  billing: {title: 'Billing', lede: 'Invoices from a finished job or a monitoring contract. Paid and unpaid stay on the account.'},
};

export function AlarmWorkspace({section, book, onChange, onOpen, focusId, today}: {
  section: AlarmSection;
  book: AlarmBook;
  onChange: (book: AlarmBook) => void;
  onOpen: (section: AlarmDestination, id?: string) => void;
  focusId?: string;
  today: string;
}) {
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<Partial<Record<AlarmSection, string>>>({});
  useEffect(() => {
    if (focusId) setPicked(current => ({...current, [section]: focusId}));
  }, [focusId, section]);
  const select = (id: string) => { setPicked(current => ({...current, [section]: id})); setError(''); };
  const selected = picked[section] ?? '';
  const run = (change: () => AlarmBook) => {
    try { onChange(change()); setError(''); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'That change could not be saved.'); return false; }
  };
  const heading = copy[section];
  return <div className="page ao-page">
    <div className="page-heading">
      <div>
        <p className="ao-kicker">{ALARMCO.name} · {ALARMCO.city} · {ALARMCO.certifications}</p>
        <h1>{heading.title}</h1>
        <p>{heading.lede}</p>
      </div>
    </div>
    {error && <div className="form-submit-error" role="alert">{error}</div>}
    {section === 'command' && <Command book={book} today={today} onOpen={onOpen}/>}
    {section === 'customers' && <Customers book={book} selected={selected} onSelect={select} run={run} onOpen={onOpen}/>}
    {section === 'jobs' && <Jobs book={book} today={today} selected={selected} onSelect={select} run={run} onOpen={onOpen}/>}
    {section === 'quotes' && <Quotes book={book} today={today} selected={selected} onSelect={select} run={run} onOpen={onOpen}/>}
    {section === 'compliance' && <Compliance book={book} today={today} selected={selected} onSelect={select} run={run}/>}
    {section === 'billing' && <Billing book={book} today={today} selected={selected} onSelect={select} run={run}/>}
  </div>;
}

function Command({book, today, onOpen}: {book: AlarmBook; today: string; onOpen: (section: AlarmDestination, id?: string) => void}) {
  const summary = alarmSummary(book, today);
  const due = inspectionsDue(book, today);
  const waiting = book.quotes.filter(quote => quote.status === 'sent' || quote.status === 'draft');
  const active = book.jobs.filter(job => job.status !== 'invoiced');
  return <>
    <div className="ao-stats">
      <Stat label="Customers" value={summary.customerCount} onClick={() => onOpen('customers')}/>
      <Stat label="Open jobs" value={summary.openJobs} onClick={() => onOpen('jobs')}/>
      <Stat label="Inspections due" value={summary.inspectionsDue} onClick={() => onOpen('compliance')}/>
      <Stat label="Unpaid" value={formatMoney(summary.unpaidTotal)} onClick={() => onOpen('billing')}/>
    </div>
    <div className="ao-split">
      <Panel title="Quotes waiting" meta={`${summary.quotesWaiting} to send or accept`}>
        {waiting.map(quote => <Row key={quote.id} title={quote.number} meta={`${nameOf(book, quote.customerId)} · ${quote.title}`} chip={quoteStatusLabel[quote.status]} tone={quote.status === 'sent' ? 'warn' : 'idle'} onClick={() => onOpen('quotes', quote.id)}/>)}
        {!waiting.length && <p className="ao-note">No open quotes.</p>}
      </Panel>
      <Panel title="Jobs in motion" meta="Scheduled through complete">
        {active.map(job => <Row key={job.id} title={job.title} meta={`${job.number} · ${techName(book, job.assignedTechId)} · ${job.scheduledOn}`} chip={jobStatusLabel[job.status]} tone={jobTone(job.status)} onClick={() => onOpen('jobs', job.id)}/>)}
      </Panel>
    </div>
    <div className="ao-split" style={{marginTop: 16}}>
      <Panel title="Inspections due" meta="Fire alarm sites with no current report">
        {due.map(site => <Row key={site.id} title={site.name} meta={`${nameOf(book, site.customerId)} · ${site.address}`} chip="Due" tone="bad" onClick={() => onOpen('compliance', latestId(book, site.id))}/>)}
        {!due.length && <p className="ao-note">Every fire alarm site has a current inspection.</p>}
      </Panel>
      <Panel title="This pay picture" meta={`${summary.openDeficiencies} open ${summary.openDeficiencies === 1 ? 'deficiency' : 'deficiencies'}`}>
        {summary.techsOvertime.map(row => <Row key={row.techId} title={row.name} meta={`${row.overtimeHours} overtime hours on the books`} chip="Overtime" tone="warn" onClick={() => onOpen('field-service')}/>)}
        {!summary.techsOvertime.length && <p className="ao-note">No technician is over 40 hours in a Monday–Sunday week.</p>}
        <Row title="Open billing" meta={`${summary.unpaidInvoices} unpaid · ${formatMoney(summary.unpaidTotal)}`} chip="Unpaid" tone="warn" onClick={() => onOpen('billing')}/>
      </Panel>
    </div>
  </>;
}

function Customers({book, selected, onSelect, run, onOpen}: {book: AlarmBook; selected: string; onSelect: (id: string) => void; run: (change: () => AlarmBook) => boolean; onOpen: (section: AlarmSection, id?: string) => void}) {
  const [creating, setCreating] = useState(false);
  const customer = book.customers.find(item => item.id === selected) ?? book.customers[0];
  return <div className="ao-split">
    <Panel title="Accounts" meta={`${book.customers.length} customers`} action={<button className="secondary" type="button" onClick={() => setCreating(value => !value)}><Plus size={16}/> Customer</button>}>
      {creating && <CustomerForm onCancel={() => setCreating(false)} onSave={draft => { const id = alarmRecordId('c'); run(() => addCustomer(book, {...draft, id})); onSelect(id); setCreating(false); }}/>}
      {book.customers.map(item => <Row key={item.id} current={item.id === customer?.id} title={item.name} meta={`${item.accountNumber} · ${item.contactName}`} onClick={() => onSelect(item.id)}/>)}
    </Panel>
    {customer && <CustomerDetail book={book} customerId={customer.id} run={run} onOpen={onOpen}/>}
  </div>;
}

function CustomerDetail({book, customerId, run, onOpen}: {book: AlarmBook; customerId: string; run: (change: () => AlarmBook) => boolean; onOpen: (section: AlarmSection, id?: string) => void}) {
  const customer = book.customers.find(item => item.id === customerId)!;
  const sites = book.sites.filter(site => site.customerId === customer.id);
  const [siteOpen, setSiteOpen] = useState(false);
  const [systemSite, setSystemSite] = useState('');
  return <section className="ao-detail" aria-labelledby="customer-title">
    <header><div><h2 id="customer-title">{customer.name}</h2><p>{customer.accountNumber} · {customer.contactName}</p></div></header>
    <div className="ao-body">
      <dl className="ao-facts">
        <div><dt>Email</dt><dd>{customer.email || 'Not added'}</dd></div>
        <div><dt>Phone</dt><dd>{customer.phone || 'Not added'}</dd></div>
        <div><dt>Notes</dt><dd>{customer.notes || 'None'}</dd></div>
      </dl>
      <div className="ao-actions">
        <button className="secondary" type="button" onClick={() => setSiteOpen(value => !value)}>Add site</button>
        <button className="secondary" type="button" onClick={() => onOpen('quotes')}>New quote</button>
      </div>
      {siteOpen && <SiteForm customers={[{id: customer.id, name: customer.name}]} lockedCustomer onCancel={() => setSiteOpen(false)} onSave={site => { const id = alarmRecordId('s'); run(() => addSite(book, {...site, id, customerId: customer.id})); setSiteOpen(false); }}/>}
      {sites.map(site => {
        const systems = book.systems.filter(system => system.siteId === site.id);
        return <article key={site.id} className="ao-panel">
          <header><div><h2>{site.name}</h2><p>{site.address}, {site.city}, {site.state} {site.postalCode}</p></div><Chip tone={site.monitoringStatus === 'monitored' ? 'ok' : site.monitoringStatus === 'suspended' ? 'bad' : 'idle'}>{monitoringLabel[site.monitoringStatus]}</Chip></header>
          <div className="ao-body">
            <p className="ao-note">{site.contractNumber ? `Contract ${site.contractNumber}` : 'No monitoring contract'}{site.monthlyMonitoring ? ` · ${formatMoney(site.monthlyMonitoring)} / month` : ''}{site.contractEnd ? ` · through ${site.contractEnd}` : ''}</p>
            {systems.map(system => <p key={system.id} className="ao-note"><b>{systemKindLabel[system.kind]}</b> · {system.name} · {system.deviceCount} devices · {system.location}</p>)}
            {!systems.length && <p className="ao-note">No systems recorded.</p>}
            {systemSite === site.id && <SystemForm onCancel={() => setSystemSite('')} onSave={system => run(() => addSystem(book, {...system, id: alarmRecordId('sys'), siteId: site.id}))}/>}
            <div className="ao-actions">
              <button className="secondary" type="button" onClick={() => setSystemSite(site.id)}>Add system</button>
              <button className="secondary" type="button" onClick={() => onOpen('compliance')}>Inspections</button>
              {site.monitoringStatus === 'monitored' && <button className="secondary" type="button" onClick={() => onOpen('billing', site.id)}>Bill monitoring</button>}
            </div>
          </div>
        </article>;
      })}
      {!sites.length && <p className="ao-note">Add the first site for this account.</p>}
    </div>
  </section>;
}

function Jobs({book, today, selected, onSelect, run, onOpen}: {book: AlarmBook; today: string; selected: string; onSelect: (id: string) => void; run: (change: () => AlarmBook) => boolean; onOpen: (section: AlarmSection, id?: string) => void}) {
  const job = book.jobs.find(item => item.id === selected) ?? book.jobs[0];
  return <div className="ao-split">
    <Panel title="Work orders" meta={`${book.jobs.length} jobs`}>
      {book.jobs.map(item => <Row key={item.id} current={item.id === job?.id} title={item.title} meta={`${item.number} · ${nameOf(book, item.customerId)}`} chip={jobStatusLabel[item.status]} tone={jobTone(item.status)} onClick={() => onSelect(item.id)}/>)}
    </Panel>
    {job && <JobDetail book={book} jobId={job.id} today={today} run={run} onOpen={onOpen}/>}
  </div>;
}

function JobDetail({book, jobId, today, run, onOpen}: {book: AlarmBook; jobId: string; today: string; run: (change: () => AlarmBook) => boolean; onOpen: (section: AlarmSection, id?: string) => void}) {
  const job = book.jobs.find(item => item.id === jobId)!;
  const invoice = book.invoices.find(item => item.jobId === job.id);
  const year = Number(today.slice(0, 4));
  const next = (status: JobStatus) => run(() => transitionJob(book, job.id, status));
  return <section className="ao-detail">
    <header><div><h2>{job.title}</h2><p>{job.number} · {jobKindLabel[job.kind]} · {nameOf(book, job.customerId)}</p></div><Chip tone={jobTone(job.status)}>{jobStatusLabel[job.status]}</Chip></header>
    <div className="ao-body">
      <dl className="ao-facts">
        <div><dt>Site</dt><dd>{siteName(book, job.siteId)}</dd></div>
        <div><dt>Scheduled</dt><dd>{job.scheduledOn}</dd></div>
        <div><dt>Technician</dt><dd>{techName(book, job.assignedTechId)}</dd></div>
        <div><dt>Notes</dt><dd>{job.notes || 'None'}</dd></div>
      </dl>
      <label className="ao-form"><span>Assigned technician</span>
        <select aria-label="Assigned technician" value={job.assignedTechId} onChange={event => run(() => assignJob(book, job.id, event.target.value))}>
          {book.techs.map(tech => <option key={tech.id} value={tech.id}>{tech.name} · {tech.title}</option>)}
        </select>
      </label>
      <div className="ao-actions">
        {(['dispatched', 'in_progress', 'complete'] as JobStatus[]).filter(status => status !== job.status).map(status => {
          const allowed = status === 'dispatched' ? job.status === 'scheduled' : status === 'in_progress' ? job.status === 'scheduled' || job.status === 'dispatched' : job.status === 'in_progress';
          return allowed ? <button key={status} className="primary" type="button" onClick={() => next(status)}>Mark {jobStatusLabel[status].toLowerCase()}</button> : null;
        })}
        {job.status === 'complete' && !invoice && <button className="primary" type="button" onClick={() => run(() => invoiceFromJob(book, job.id, {id: alarmRecordId('inv'), number: nextAlarmNumber(book.invoices.map(item => item.number), 'INV', year), issuedOn: today, dueOn: dueIn(today, 30)}))}>Create invoice</button>}
        {invoice && <button className="secondary" type="button" onClick={() => onOpen('billing', invoice.id)}>Open {invoice.number}</button>}
        <button className="secondary" type="button" onClick={() => onOpen('compliance', job.siteId)}>Inspection</button>
      </div>
    </div>
  </section>;
}

function Quotes({book, today, selected, onSelect, run, onOpen}: {book: AlarmBook; today: string; selected: string; onSelect: (id: string) => void; run: (change: () => AlarmBook) => boolean; onOpen: (section: AlarmSection, id?: string) => void}) {
  const [creating, setCreating] = useState(false);
  const quote = book.quotes.find(item => item.id === selected) ?? book.quotes.find(item => item.status === 'sent' || item.status === 'draft') ?? book.quotes[0];
  return <div className="ao-split">
    <Panel title="Quotes" meta={`${book.quotes.length} quotes`} action={<button className="secondary" type="button" onClick={() => setCreating(value => !value)}><Plus size={16}/> Quote</button>}>
      {creating && <QuoteForm book={book} today={today} onCancel={() => setCreating(false)} onSave={draft => { const id = alarmRecordId('q'); run(() => addQuote(book, {...draft, id})); onSelect(id); setCreating(false); }}/>}
      {book.quotes.map(item => <Row key={item.id} current={item.id === quote?.id} title={item.number} meta={`${nameOf(book, item.customerId)} · ${formatMoney(quoteTotal(item))}`} chip={quoteStatusLabel[item.status]} tone={item.status === 'accepted' ? 'ok' : item.status === 'declined' ? 'bad' : item.status === 'sent' ? 'warn' : 'idle'} onClick={() => onSelect(item.id)}/>)}
    </Panel>
    {quote && <QuoteDetail book={book} quoteId={quote.id} today={today} run={run} onOpen={onOpen}/>}
  </div>;
}

function QuoteDetail({book, quoteId, today, run, onOpen}: {book: AlarmBook; quoteId: string; today: string; run: (change: () => AlarmBook) => boolean; onOpen: (section: AlarmSection, id?: string) => void}) {
  const quote = book.quotes.find(item => item.id === quoteId)!;
  const [techId, setTechId] = useState(book.techs[0]?.id ?? '');
  const [scheduledOn, setScheduledOn] = useState(today);
  const year = Number(today.slice(0, 4));
  return <section className="ao-detail">
    <header><div><h2>{quote.title}</h2><p>{quote.number} · {nameOf(book, quote.customerId)} · {siteName(book, quote.siteId)}</p></div><Chip tone={quote.status === 'accepted' ? 'ok' : quote.status === 'declined' ? 'bad' : quote.status === 'sent' ? 'warn' : 'idle'}>{quoteStatusLabel[quote.status]}</Chip></header>
    <div className="ao-body">
      <table className="ao-lines"><thead><tr><th>Line</th><th>Qty</th><th>Amount</th></tr></thead><tbody>
        {quote.lines.map(line => <tr key={line.id}><td>{line.description}<br/><small className="ao-muted">{line.kind === 'labor' ? 'Labor' : 'Device'} · {formatMoney(line.unitPrice)} each</small></td><td>{line.quantity}</td><td>{formatMoney(lineExtension(line))}</td></tr>)}
      </tbody></table>
      <p><b>Total {formatMoney(quoteTotal(quote))}</b> · Valid through {quote.validUntil} · {jobKindLabel[quote.kind]}</p>
      {quote.jobId && <button className="secondary" type="button" onClick={() => onOpen('jobs', quote.jobId)}>Open job</button>}
      {(quote.status === 'draft' || quote.status === 'sent') && <AdiParts onAdd={line => run(() => addQuoteLine(book, quote.id, line))}/>}
      {(quote.status === 'draft' || quote.status === 'sent') && <div className="ao-form">
        <label><span>Technician</span><select value={techId} onChange={event => setTechId(event.target.value)}>{book.techs.map(tech => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></label>
        <label><span>Schedule date</span><input type="date" value={scheduledOn} onChange={event => setScheduledOn(event.target.value)}/></label>
        <div className="ao-actions">
          <button className="primary" type="button" onClick={() => { const jobId = alarmRecordId('j'); if (run(() => acceptQuote(book, quote.id, {jobId, jobNumber: nextAlarmNumber(book.jobs.map(job => job.number), 'J', year), assignedTechId: techId, scheduledOn}))) onOpen('jobs', jobId); }}>Accept and open job</button>
          <button className="secondary" type="button" onClick={() => run(() => declineQuote(book, quote.id))}>Decline</button>
        </div>
      </div>}
    </div>
  </section>;
}

function Compliance({book, today, selected, onSelect, run}: {book: AlarmBook; today: string; selected: string; onSelect: (id: string) => void; run: (change: () => AlarmBook) => boolean}) {
  const [creating, setCreating] = useState(false);
  const due = inspectionsDue(book, today);
  const inspection = book.inspections.find(item => item.id === selected) ?? book.inspections.find(item => item.siteId === selected) ?? book.inspections[0];
  return <div className="ao-stack">
    {due.length > 0 && <div className="form-submit-error" role="status">{due.length} fire alarm {due.length === 1 ? 'site is' : 'sites are'} due: {due.map(site => site.name).join(', ')}.</div>}
    <div className="ao-split">
      <Panel title="Reports" meta={`${book.inspections.length} on file`} action={<button className="secondary" type="button" onClick={() => setCreating(value => !value)}><Plus size={16}/> Inspection</button>}>
        {creating && <InspectionForm book={book} today={today} onCancel={() => setCreating(false)} onSave={draft => { const id = alarmRecordId('i'); run(() => startInspection(book, {...draft, id, number: nextAlarmNumber(book.inspections.map(item => item.number), 'INS', Number(today.slice(0, 4)))})); onSelect(id); setCreating(false); }}/>}
        {book.inspections.map(item => <Row key={item.id} current={item.id === inspection?.id} title={item.number} meta={`${siteName(book, item.siteId)} · next due ${item.nextDue}`} chip={item.nextDue <= today ? 'Due' : 'Current'} tone={item.nextDue <= today ? 'bad' : 'ok'} onClick={() => onSelect(item.id)}/>)}
      </Panel>
      {inspection && <InspectionDetail book={book} inspectionId={inspection.id} run={run}/>}
    </div>
  </div>;
}

function InspectionDetail({book, inspectionId, run}: {book: AlarmBook; inspectionId: string; run: (change: () => AlarmBook) => boolean}) {
  const inspection = book.inspections.find(item => item.id === inspectionId)!;
  const html = inspectionReportHtml(book, inspection.id);
  const print = () => {
    const frame = document.createElement('iframe');
    frame.title = 'Print inspection report';
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0';
    document.body.appendChild(frame);
    frame.contentDocument?.open();
    frame.contentDocument?.write(html);
    frame.contentDocument?.close();
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 1500);
  };
  return <section className="ao-detail">
    <header><div><h2>{inspection.number}</h2><p>{siteName(book, inspection.siteId)} · Inspected {inspection.inspectedOn} · Next due {inspection.nextDue}</p></div></header>
    <div className="ao-body">
      <div className="ao-check">
        {inspection.items.map(item => <article key={item.id}>
          <b>{item.section}</b>
          <p className="ao-note">{item.prompt}</p>
          <fieldset>
            <legend className="sr-only">{item.prompt}</legend>
            {(['pass', 'fail', 'na', 'pending'] as ChecklistResult[]).map(result => <label key={result}><input type="radio" name={item.id} checked={item.result === result} onChange={() => run(() => setChecklistResult(book, inspection.id, item.id, result, item.notes))}/> {result === 'na' ? 'N/A' : result[0].toUpperCase() + result.slice(1)}</label>)}
          </fieldset>
          <label><span className="ao-muted">Notes</span><input aria-label={`Notes for ${item.prompt}`} defaultValue={item.notes} onBlur={event => { if (event.target.value !== item.notes) run(() => setChecklistResult(book, inspection.id, item.id, item.result, event.target.value)); }}/></label>
        </article>)}
      </div>
      <div>
        <h2>Deficiencies</h2>
        {inspection.deficiencies.map(item => <p key={item.id} className="ao-note"><Chip tone={item.status === 'open' ? 'bad' : 'ok'}>{item.status}</Chip> Due {item.dueOn} · {item.description} {item.status === 'open' && <button className="secondary" type="button" onClick={() => run(() => correctDeficiency(book, inspection.id, item.id))}>Mark corrected</button>}</p>)}
        {!inspection.deficiencies.length && <p className="ao-note">No deficiencies. A failed item opens one.</p>}
      </div>
      <div className="ao-actions"><button className="primary" type="button" onClick={print}>Print / PDF</button></div>
      <iframe className="ao-report" title={`${inspection.number} inspection report`} srcDoc={html}/>
    </div>
  </section>;
}

function Billing({book, today, selected, onSelect, run}: {book: AlarmBook; today: string; selected: string; onSelect: (id: string) => void; run: (change: () => AlarmBook) => boolean}) {
  const [siteId, setSiteId] = useState(book.sites.find(site => site.monitoringStatus === 'monitored')?.id ?? '');
  const [months, setMonths] = useState(1);
  const invoice = book.invoices.find(item => item.id === selected) ?? book.invoices.find(item => item.siteId === selected) ?? book.invoices[0];
  const monitored = book.sites.filter(site => site.monitoringStatus === 'monitored');
  return <div className="ao-split">
    <Panel title="Invoices" meta={`${book.invoices.filter(item => item.status !== 'paid').length} unpaid`}>
      {book.invoices.map(item => {
        const state = alarmInvoiceState(item, today);
        return <Row key={item.id} current={item.id === invoice?.id} title={item.number} meta={`${nameOf(book, item.customerId)} · ${formatMoney(invoiceTotal(item))}`} chip={state} tone={state === 'paid' ? 'ok' : state === 'overdue' ? 'bad' : 'warn'} onClick={() => onSelect(item.id)}/>;
      })}
      <form className="ao-form" style={{padding: 12}} onSubmit={event => { event.preventDefault(); const id = alarmRecordId('inv'); run(() => invoiceFromMonitoring(book, siteId, {id, number: nextAlarmNumber(book.invoices.map(item => item.number), 'INV', Number(today.slice(0, 4))), issuedOn: today, dueOn: dueIn(today, 30), months})); onSelect(id); }}>
        <h2>Bill monitoring</h2>
        <label><span>Site</span><select value={siteId} onChange={event => setSiteId(event.target.value)}>{monitored.map(site => <option key={site.id} value={site.id}>{site.name} · {formatMoney(site.monthlyMonitoring)}/mo</option>)}</select></label>
        <label><span>Months</span><input type="number" min={1} max={12} value={months} onChange={event => setMonths(Number(event.target.value))}/></label>
        <button className="primary" type="submit">Create monitoring invoice</button>
      </form>
    </Panel>
    {invoice && <InvoiceDetail book={book} invoice={invoice} today={today} run={run}/>}
  </div>;
}

function InvoiceDetail({book, invoice, today, run}: {book: AlarmBook; invoice: AlarmInvoice; today: string; run: (change: () => AlarmBook) => boolean}) {
  const state = alarmInvoiceState(invoice, today);
  return <section className="ao-detail">
    <header><div><h2>{invoice.number}</h2><p>{nameOf(book, invoice.customerId)} · {invoice.source === 'job' ? 'Job' : 'Monitoring'} · Issued {invoice.issuedOn}</p></div><Chip tone={state === 'paid' ? 'ok' : state === 'overdue' ? 'bad' : 'warn'}>{state}</Chip></header>
    <div className="ao-body">
      <table className="ao-lines"><tbody>{invoice.lines.map(line => <tr key={line.description}><td>{line.description}</td><td>{formatMoney(line.amount)}</td></tr>)}</tbody></table>
      <p><b>Total {formatMoney(invoiceTotal(invoice))}</b> · Due {invoice.dueOn}{invoice.paidOn ? ` · Paid ${invoice.paidOn}` : ''}</p>
      {invoice.status !== 'paid' && <button className="primary" type="button" onClick={() => run(() => markInvoicePaid(book, invoice.id, today))}>Mark paid</button>}
    </div>
  </section>;
}

function CustomerForm({onCancel, onSave}: {onCancel: () => void; onSave: (customer: {name: string; accountNumber: string; contactName: string; email: string; phone: string; notes: string}) => void}) {
  const [name, setName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  return <form className="ao-form" style={{padding: 10}} onSubmit={event => { event.preventDefault(); onSave({name, accountNumber, contactName, email, phone, notes: ''}); }}>
    <label><span>Account name</span><input required value={name} onChange={event => setName(event.target.value)}/></label>
    <label><span>Account number</span><input value={accountNumber} onChange={event => setAccountNumber(event.target.value)}/></label>
    <label><span>Contact</span><input value={contactName} onChange={event => setContactName(event.target.value)}/></label>
    <label><span>Email</span><input type="email" value={email} onChange={event => setEmail(event.target.value)}/></label>
    <label><span>Phone</span><input value={phone} onChange={event => setPhone(event.target.value)}/></label>
    <div className="ao-actions"><button className="primary" type="submit">Save customer</button><button className="secondary" type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}

function SiteForm({customers, lockedCustomer, onCancel, onSave}: {customers: {id: string; name: string}[]; lockedCustomer?: boolean; onCancel: () => void; onSave: (site: {customerId: string; name: string; address: string; city: string; state: string; postalCode: string; monitoringStatus: MonitoringStatus; contractNumber: string; monthlyMonitoring: number; contractStart: string; contractEnd: string}) => void}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('Boise');
  const [monitoringStatus, setMonitoringStatus] = useState<MonitoringStatus>('unmonitored');
  const [monthlyMonitoring, setMonthly] = useState('0');
  const [contractNumber, setContract] = useState('');
  return <form className="ao-form" style={{padding: 10}} onSubmit={event => { event.preventDefault(); onSave({customerId, name, address, city, state: 'ID', postalCode: '', monitoringStatus, contractNumber, monthlyMonitoring: Number(monthlyMonitoring) || 0, contractStart: '', contractEnd: ''}); }}>
    {!lockedCustomer && <label><span>Customer</span><select value={customerId} onChange={event => setCustomerId(event.target.value)}>{customers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <label><span>Site name</span><input required value={name} onChange={event => setName(event.target.value)}/></label>
    <label><span>Address</span><input required value={address} onChange={event => setAddress(event.target.value)}/></label>
    <label><span>City</span><input required value={city} onChange={event => setCity(event.target.value)}/></label>
    <label><span>Monitoring</span><select value={monitoringStatus} onChange={event => setMonitoringStatus(event.target.value as MonitoringStatus)}><option value="unmonitored">Not monitored</option><option value="monitored">Monitored</option><option value="suspended">Suspended</option></select></label>
    <label><span>Monthly amount</span><input type="number" min={0} step={0.01} value={monthlyMonitoring} onChange={event => setMonthly(event.target.value)}/></label>
    <label><span>Contract number</span><input value={contractNumber} onChange={event => setContract(event.target.value)}/></label>
    <div className="ao-actions"><button className="primary" type="submit">Save site</button><button className="secondary" type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}

function SystemForm({onCancel, onSave}: {onCancel: () => void; onSave: (system: {kind: SystemKind; name: string; deviceCount: number; location: string}) => void}) {
  const [kind, setKind] = useState<SystemKind>('fire_alarm');
  const [name, setName] = useState('');
  const [deviceCount, setCount] = useState('1');
  const [location, setLocation] = useState('');
  return <form className="ao-form" onSubmit={event => { event.preventDefault(); onSave({kind, name, deviceCount: Number(deviceCount), location}); onCancel(); }}>
    <label><span>Kind</span><select value={kind} onChange={event => setKind(event.target.value as SystemKind)}>{(Object.keys(systemKindLabel) as SystemKind[]).map(key => <option key={key} value={key}>{systemKindLabel[key]}</option>)}</select></label>
    <label><span>Panel or system</span><input required value={name} onChange={event => setName(event.target.value)}/></label>
    <label><span>Devices</span><input type="number" min={0} value={deviceCount} onChange={event => setCount(event.target.value)}/></label>
    <label><span>Location</span><input value={location} onChange={event => setLocation(event.target.value)}/></label>
    <div className="ao-actions"><button className="primary" type="submit">Save system</button><button className="secondary" type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}

function sellPrice(dealerPrice: number, markup: string) {
  try { return markedUpUnitPrice(dealerPrice, Number(markup)); }
  catch { return dealerPrice; }
}

function AdiParts({onAdd}: {onAdd: (line: QuoteLine) => void}) {
  const [query, setQuery] = useState('smoke');
  const [markup, setMarkup] = useState('35');
  const [quantity, setQuantity] = useState('1');
  const [parts, setParts] = useState<AdiPart[]>([]);
  const [error, setError] = useState('');
  const search = async () => {
    try {
      setParts(await createMockAdiParts().search(query));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ADI parts could not be searched.');
    }
  };
  return <form className="ao-form" onSubmit={event => { event.preventDefault(); void search(); }}>
    <h2>ADI parts</h2>
    <p className="ao-note">Demo catalog for adiglobaldistribution.us. A signed-in company still needs the dealer API key, password, and secret from Settings, API keys. ADI’s price call does not return photos or branch quantities, so this mock supplies those.</p>
    <label><span>Part number or description</span><input value={query} onChange={event => setQuery(event.target.value)}/></label>
    <label><span>Markup percent</span><input type="number" min={0} max={300} step={1} value={markup} onChange={event => setMarkup(event.target.value)}/></label>
    <label><span>Quantity</span><input type="number" min={1} value={quantity} onChange={event => setQuantity(event.target.value)}/></label>
    <button className="secondary" type="submit">Search ADI</button>
    {error && <p className="form-submit-error" role="alert">{error}</p>}
    {parts.map(item => <article key={item.partNumber} className="ao-part">
      <img src={item.imageUrl} alt=""/>
      <div><b>{item.partNumber}</b><small>{item.description}</small><small>Dealer {formatMoney(item.dealerPrice)} · Quote {formatMoney(sellPrice(item.dealerPrice, markup))}</small><small>{item.stock.map(row => `${row.branch} ${row.quantity}`).join(' · ')}</small></div>
      <button className="primary" type="button" onClick={() => onAdd(adiQuoteLine(item, Number(quantity) || 1, Number(markup) || 0, alarmRecordId('ql')))}>Add to quote</button>
    </article>)}
  </form>;
}

function QuoteForm({book, today, onCancel, onSave}: {book: AlarmBook; today: string; onCancel: () => void; onSave: (quote: {number: string; customerId: string; siteId: string; kind: JobKind; status: 'draft' | 'sent'; title: string; lines: QuoteLine[]; createdOn: string; validUntil: string}) => void}) {
  const [customerId, setCustomerId] = useState(book.customers[0]?.id ?? '');
  const sites = book.sites.filter(site => site.customerId === customerId);
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<JobKind>('install');
  const [lines, setLines] = useState<{id: string; description: string; kind: 'device' | 'labor'; quantity: string; unitPrice: string}[]>([{id: alarmRecordId('ql'), description: '', kind: 'device', quantity: '1', unitPrice: ''}]);
  const updateLine = (id: string, patch: Partial<(typeof lines)[number]>) => setLines(current => current.map(line => line.id === id ? {...line, ...patch} : line));
  return <form className="ao-form" style={{padding: 10}} onSubmit={event => {
    event.preventDefault();
    onSave({number: nextAlarmNumber(book.quotes.map(quote => quote.number), 'Q', Number(today.slice(0, 4))), customerId, siteId, kind, status: 'sent', title, createdOn: today, validUntil: dueIn(today, 30), lines: lines.map(line => ({id: line.id, description: line.description, kind: line.kind, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice)}))});
  }}>
    <label><span>Customer</span><select value={customerId} onChange={event => { setCustomerId(event.target.value); const next = book.sites.find(site => site.customerId === event.target.value); setSiteId(next?.id ?? ''); }}>{book.customers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label><span>Site</span><select value={siteId} onChange={event => setSiteId(event.target.value)}>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
    <label><span>Title</span><input required value={title} onChange={event => setTitle(event.target.value)}/></label>
    <label><span>Becomes</span><select value={kind} onChange={event => setKind(event.target.value as JobKind)}><option value="install">Install</option><option value="service">Service call</option><option value="inspection">Inspection</option></select></label>
    {lines.map((line, index) => <fieldset key={line.id} className="ao-form">
      <legend>Line {index + 1}</legend>
      <label><span>Description</span><input required value={line.description} onChange={event => updateLine(line.id, {description: event.target.value})} placeholder="Device or labor"/></label>
      <label><span>Kind</span><select value={line.kind} onChange={event => updateLine(line.id, {kind: event.target.value as 'device' | 'labor'})}><option value="device">Device</option><option value="labor">Labor</option></select></label>
      <label><span>Quantity</span><input type="number" min={1} value={line.quantity} onChange={event => updateLine(line.id, {quantity: event.target.value})}/></label>
      <label><span>Unit price</span><input type="number" min={0} step={0.01} required value={line.unitPrice} onChange={event => updateLine(line.id, {unitPrice: event.target.value})}/></label>
      {lines.length > 1 && <button className="secondary" type="button" onClick={() => setLines(current => current.filter(item => item.id !== line.id))}>Remove line</button>}
    </fieldset>)}
    <div className="ao-actions"><button className="secondary" type="button" onClick={() => setLines(current => [...current, {id: alarmRecordId('ql'), description: '', kind: 'device', quantity: '1', unitPrice: ''}])}>Add line</button><button className="primary" type="submit">Save quote</button><button className="secondary" type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}

function InspectionForm({book, today, onCancel, onSave}: {book: AlarmBook; today: string; onCancel: () => void; onSave: (draft: {siteId: string; jobId?: string; inspectorId: string; inspectedOn: string; frequencyMonths: number}) => void}) {
  const [siteId, setSiteId] = useState(book.sites[0]?.id ?? '');
  const [inspectorId, setInspector] = useState(book.techs[0]?.id ?? '');
  const [frequencyMonths, setFrequency] = useState(12);
  const jobs = book.jobs.filter(job => job.siteId === siteId);
  const [jobId, setJobId] = useState('');
  return <form className="ao-form" style={{padding: 10}} onSubmit={event => { event.preventDefault(); onSave({siteId, jobId: jobId || undefined, inspectorId, inspectedOn: today, frequencyMonths}); }}>
    <label><span>Site</span><select value={siteId} onChange={event => { setSiteId(event.target.value); setJobId(''); }}>{book.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
    <label><span>Job</span><select value={jobId} onChange={event => setJobId(event.target.value)}><option value="">Not tied to a job</option>{jobs.map(job => <option key={job.id} value={job.id}>{job.number}</option>)}</select></label>
    <label><span>Inspector</span><select value={inspectorId} onChange={event => setInspector(event.target.value)}>{book.techs.map(tech => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></label>
    <label><span>Repeats every</span><select value={frequencyMonths} onChange={event => setFrequency(Number(event.target.value))}><option value={12}>12 months</option><option value={6}>6 months</option><option value={3}>3 months</option><option value={1}>1 month</option></select></label>
    <div className="ao-actions"><button className="primary" type="submit">Start checklist</button><button className="secondary" type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}

function Panel({title, meta, action, children}: {title: string; meta?: string; action?: ReactNode; children: ReactNode}) {
  return <section className="ao-panel"><header><div><h2>{title}</h2>{meta && <p>{meta}</p>}</div>{action}</header><div className="ao-list">{children}</div></section>;
}

function Row({title, meta, chip, tone = 'idle', current, onClick}: {title: string; meta: string; chip?: string; tone?: Tone; current?: boolean; onClick?: () => void}) {
  return <button type="button" className="ao-row" aria-current={current ? 'true' : undefined} onClick={onClick}><span className="ao-row-copy"><b>{title}</b><small>{meta}</small></span>{chip && <Chip tone={tone}>{chip}</Chip>}{onClick && <ChevronRight size={16}/>}</button>;
}

function Stat({label, value, onClick}: {label: string; value: number | string; onClick: () => void}) {
  return <button type="button" className="ao-stat" onClick={onClick}><strong>{value}</strong><span>{label}</span></button>;
}

function Chip({tone, children}: {tone: Tone; children: ReactNode}) {
  return <i className={`ao-chip ao-${tone}`}>{children}</i>;
}

function nameOf(book: AlarmBook, id: string) {
  return book.customers.find(item => item.id === id)?.name ?? 'Unknown customer';
}
function siteName(book: AlarmBook, id: string) {
  const site = book.sites.find(item => item.id === id);
  return site ? `${site.name}, ${site.city}` : 'Unknown site';
}
function techName(book: AlarmBook, id: string) {
  return book.techs.find(item => item.id === id)?.name ?? 'Unassigned';
}
function latestId(book: AlarmBook, siteId: string) {
  return book.inspections.find(item => item.siteId === siteId)?.id ?? siteId;
}
function jobTone(status: JobStatus): Tone {
  if (status === 'complete' || status === 'invoiced') return 'ok';
  if (status === 'in_progress' || status === 'dispatched') return 'warn';
  return 'idle';
}
function dueIn(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
