import {describe, expect, it} from 'vitest';
import {
  acceptQuote, addCustomer, addQuote, addSite, alarmSummary, declineQuote, inspectionReportHtml, inspectionsDue,
  invoiceFromJob, invoiceFromMonitoring, alarmInvoiceState, invoiceTotal, markInvoicePaid, nextAlarmNumber,
  quoteTotal, seedAlarmBook, setChecklistResult, startInspection, techTimesheet, transitionJob, weekHours, workweekStart,
  type AlarmQuote,
} from './alarm-ops';

const TODAY = '2026-11-23';

describe('Alarmco quote, job, inspection, and invoice flow', () => {
  it('prices the seeded library quote and keeps the accepted job tied to it', () => {
    const book = seedAlarmBook();
    const quote = book.quotes.find(item => item.id === 'q-library')!;
    expect(quoteTotal(quote)).toBe(3120);
    expect(quote.jobId).toBe('j-library');
    expect(book.jobs.find(job => job.id === 'j-library')?.status).toBe('invoiced');
    expect(invoiceTotal(book.invoices.find(invoice => invoice.jobId === 'j-library')!)).toBe(3120);
  });

  it('accepts a sent quote into one scheduled job and does not create a second job', () => {
    const book = seedAlarmBook();
    const accepted = acceptQuote(book, 'q-clinic', {jobId: 'j-new', jobNumber: 'J-2026-047', assignedTechId: 't-lena', scheduledOn: '2026-12-02'});
    const job = accepted.jobs.find(item => item.id === 'j-new')!;
    expect(job).toMatchObject({status: 'scheduled', kind: 'install', quoteId: 'q-clinic', siteId: 's-clinic', customerId: 'c-clinic'});
    expect(accepted.quotes.find(item => item.id === 'q-clinic')).toMatchObject({status: 'accepted', jobId: 'j-new'});
    expect(quoteTotal(accepted.quotes.find(item => item.id === 'q-clinic')!)).toBe(5090);
    const again = acceptQuote(accepted, 'q-clinic', {jobId: 'j-other', jobNumber: 'J-2026-099', assignedTechId: 't-chris', scheduledOn: '2026-12-03'});
    expect(again).toBe(accepted);
    expect(again.jobs.filter(item => item.quoteId === 'q-clinic')).toHaveLength(1);
  });

  it('walks a job to complete, then invoices it once from the quote lines', () => {
    let book = acceptQuote(seedAlarmBook(), 'q-clinic', {jobId: 'j-new', jobNumber: 'J-2026-047', assignedTechId: 't-lena', scheduledOn: '2026-12-02'});
    book = transitionJob(book, 'j-new', 'dispatched');
    book = transitionJob(book, 'j-new', 'in_progress');
    book = transitionJob(book, 'j-new', 'complete');
    expect(() => transitionJob(book, 'j-new', 'invoiced')).toThrow(/invoice/i);
    book = invoiceFromJob(book, 'j-new', {id: 'inv-new', number: 'INV-2026-050', issuedOn: TODAY, dueOn: '2026-12-23'});
    expect(book.jobs.find(job => job.id === 'j-new')?.status).toBe('invoiced');
    expect(invoiceTotal(book.invoices.find(invoice => invoice.id === 'inv-new')!)).toBe(5090);
    const again = invoiceFromJob(book, 'j-new', {id: 'inv-dup', number: 'INV-2026-051', issuedOn: TODAY, dueOn: '2026-12-23'});
    expect(again).toBe(book);
    expect(book.invoices.filter(invoice => invoice.jobId === 'j-new')).toHaveLength(1);
  });

  it('refuses to invoice a job that is still in progress and bills monitoring from the contract', () => {
    const book = seedAlarmBook();
    expect(() => invoiceFromJob(book, 'j-capitol', {id: 'x', number: 'INV-2026-060', issuedOn: TODAY, dueOn: '2026-12-23'})).toThrow(/Complete the job/);
    const billed = invoiceFromMonitoring(book, 's-capitol', {id: 'inv-fed', number: 'INV-2026-060', issuedOn: TODAY, dueOn: '2026-12-23', months: 3});
    expect(invoiceTotal(billed.invoices[0])).toBe(1260);
    expect(() => invoiceFromMonitoring(book, 's-clinic', {id: 'nope', number: 'INV-2026-061', issuedOn: TODAY, dueOn: '2026-12-23', months: 1})).toThrow(/monitored/);
  });

  it('marks an overdue job invoice paid and leaves the paid monitoring invoice alone', () => {
    const book = seedAlarmBook();
    const open = book.invoices.find(invoice => invoice.id === 'inv-library')!;
    expect(alarmInvoiceState(open, TODAY)).toBe('overdue');
    expect(alarmInvoiceState(book.invoices.find(invoice => invoice.id === 'inv-monitor')!, TODAY)).toBe('paid');
    const paid = markInvoicePaid(book, 'inv-library', TODAY);
    expect(paid.invoices.find(invoice => invoice.id === 'inv-library')).toMatchObject({status: 'paid', paidOn: TODAY});
    expect(markInvoicePaid(paid, 'inv-library', TODAY)).toBe(paid);
  });

  it('opens a deficiency from a failed checklist item and prints it on the report', () => {
    let book = seedAlarmBook();
    expect(inspectionsDue(book, TODAY).map(site => site.id).sort()).toEqual(['s-capitol', 's-coop']);
    book = startInspection(book, {id: 'i-coop', number: 'INS-2026-021', siteId: 's-coop', jobId: 'j-coop', inspectorId: 't-priya', inspectedOn: TODAY, frequencyMonths: 12});
    expect(book.inspections[0]).toMatchObject({nextDue: '2027-11-23', items: expect.any(Array)});
    const item = book.inspections[0].items[2];
    book = setChecklistResult(book, 'i-coop', item.id, 'fail', 'Stockroom detector failed to alarm.');
    const deficiency = book.inspections[0].deficiencies.find(entry => entry.itemId === item.id)!;
    expect(deficiency).toMatchObject({status: 'open', dueOn: '2026-12-23', description: 'Stockroom detector failed to alarm.'});
    book = setChecklistResult(book, 'i-coop', item.id, 'pass');
    expect(book.inspections[0].deficiencies.find(entry => entry.id === deficiency.id)?.status).toBe('corrected');
    const report = inspectionReportHtml(seedAlarmBook(), 'i-library');
    expect(report).toContain('Alarmco, Inc.');
    expect(report).toContain('WOSB / EDWOSB');
    expect(report).toContain('Boise Public Library');
    expect(report).toContain('715 S Capitol Blvd');
    expect(report).toContain('Idaho Room detector did not alarm');
    expect(report).toContain('NFPA 72-style checklist');
    expect(report).toContain('Silent Knight 6820');
    expect(report).not.toContain('<script');
  });

  it('counts Monday–Sunday overtime over 40 hours the way payroll does', () => {
    const book = seedAlarmBook();
    expect(workweekStart('2026-11-22')).toBe('2026-11-16');
    expect(workweekStart('2026-11-16')).toBe('2026-11-16');
    expect(workweekStart('2026-11-23')).toBe('2026-11-23');
    expect(techTimesheet(book.timeEntries, 't-chris')).toMatchObject({totalHours: 48, regularHours: 40, overtimeHours: 8});
    expect(techTimesheet(book.timeEntries, 't-lena')).toMatchObject({totalHours: 40, overtimeHours: 0});
    expect(weekHours(book.timeEntries, 't-chris', '2026-11-20')).toMatchObject({start: '2026-11-16', end: '2026-11-22', hours: 48, overtimeHours: 8});
    const summary = alarmSummary(book, TODAY);
    expect(summary).toMatchObject({customerCount: 8, openJobs: 2, quotesWaiting: 2, inspectionsDue: 2, openDeficiencies: 1, unpaidInvoices: 1, unpaidTotal: 3120});
    expect(summary.techsOvertime).toEqual([expect.objectContaining({techId: 't-chris', overtimeHours: 8})]);
  });

  it('rejects a declined quote and numbers the next document in the year', () => {
    const declined = declineQuote(seedAlarmBook(), 'q-coop');
    expect(declined.quotes.find(quote => quote.id === 'q-coop')?.status).toBe('declined');
    expect(() => acceptQuote(declined, 'q-coop', {jobId: 'j', jobNumber: 'J-2026-001', assignedTechId: 't-lena', scheduledOn: TODAY})).toThrow(/declined/);
    expect(nextAlarmNumber(seedAlarmBook().quotes.map(quote => quote.number), 'Q', 2026)).toBe('Q-2026-023');
  });

  it('keeps a new customer, site, and quote consistent', () => {
    let book = seedAlarmBook();
    book = addCustomer(book, {id: 'c-new', name: 'Trailhead Credit Union', accountNumber: 'ALM-1300', contactName: 'Riley Chen', email: 'facilities@trailhead.example', phone: '(208) 555-0104', notes: ''});
    book = addSite(book, {id: 's-new', customerId: 'c-new', name: 'Downtown Branch', address: '100 N 8th St', city: 'Boise', state: 'ID', postalCode: '83702', monitoringStatus: 'unmonitored', contractNumber: '', monthlyMonitoring: 0, contractStart: '', contractEnd: ''});
    const quote: AlarmQuote = {
      id: 'q-new', number: 'Q-2026-023', customerId: 'c-new', siteId: 's-new', kind: 'service', status: 'draft', title: 'Camera NVR replacement', createdOn: TODAY, validUntil: '2026-12-23',
      lines: [{id: 'ql-new', description: 'NVR and labor', kind: 'labor', quantity: 1, unitPrice: 890}],
    };
    book = addQuote(book, quote);
    expect(book.quotes[0].title).toBe('Camera NVR replacement');
    expect(() => addSite(book, {...book.sites[0], id: 's-bad', customerId: 'missing'})).toThrow(/Customer was not found/);
  });
});
