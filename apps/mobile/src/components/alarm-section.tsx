import {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useRouter} from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  ALARMCO, acceptQuote, addQuoteLine, adiQuoteLine, alarmRecordId, alarmSummary, assignJob, createMockAdiParts, formatMoney, inspectionsDue, invoiceFromJob, inspectionReportHtml, markedUpUnitPrice,
  alarmInvoiceState, invoiceFromMonitoring, invoiceTotal, jobKindLabel, jobStatusLabel, markInvoicePaid,
  monitoringLabel, nextAlarmNumber, quoteStatusLabel, quoteTotal, setChecklistResult, startInspection, systemKindLabel,
  transitionJob,
  type AdiPart, type AlarmBook, type ChecklistResult, type JobStatus,
} from '@fireops/domain';
import {SectionScreen} from '@/components/section-screen';
import {useAlarmBook} from '@/lib/alarm-book';
import {useFireOpsTheme, type FireOpsTheme} from '@/theme';

export type AlarmScreenSection = 'command' | 'customers' | 'jobs' | 'quotes' | 'compliance' | 'billing';

const titles: Record<AlarmScreenSection, {title: string; description: string}> = {
  command: {title: 'Command', description: 'Customers, sites, quotes, jobs, inspections, and invoices.'},
  customers: {title: 'Customers', description: 'Accounts, sites, systems, and monitoring contracts.'},
  jobs: {title: 'Jobs', description: 'Installs, service calls, and inspections assigned to a technician.'},
  quotes: {title: 'Quotes', description: 'Device and labor lines. Accepting a quote opens a job.'},
  compliance: {title: 'Inspections', description: 'NFPA 72-style checklists, due dates, and deficiencies.'},
  billing: {title: 'Billing', description: 'Invoices from a finished job or a monitoring contract.'},
};

export function AlarmSection({section}: {section: AlarmScreenSection}) {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = stylesFor(theme);
  const {book, setBook, today} = useAlarmBook();
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { setSelected(null); setError(''); }, [section]);
  const run = (change: () => AlarmBook) => {
    try { setBook(change()); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'That change could not be saved.'); }
  };
  const open = (path: string) => router.push(path as never);
  const heading = titles[section];
  return <SectionScreen title={heading.title} description={`${ALARMCO.name} · ${ALARMCO.certifications}. ${heading.description}`}>
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    {selected ? <Back onPress={() => setSelected(null)} styles={styles}/> : null}
    {section === 'command' && <Command book={book} today={today} styles={styles} onOpen={open}/>}
    {section === 'customers' && <Customers book={book} selected={selected} onSelect={setSelected} styles={styles}/>}
    {section === 'jobs' && <Jobs book={book} today={today} selected={selected} onSelect={setSelected} run={run} styles={styles} onOpen={open}/>}
    {section === 'quotes' && <Quotes book={book} today={today} selected={selected} onSelect={setSelected} run={run} styles={styles} onOpen={open}/>}
    {section === 'compliance' && <Compliance book={book} today={today} selected={selected} onSelect={setSelected} run={run} styles={styles}/>}
    {section === 'billing' && <Billing book={book} today={today} selected={selected} onSelect={setSelected} run={run} styles={styles}/>}
  </SectionScreen>;
}

function Command({book, today, styles, onOpen}: {book: AlarmBook; today: string; styles: ReturnType<typeof stylesFor>; onOpen: (path: string) => void}) {
  const summary = alarmSummary(book, today);
  const due = inspectionsDue(book, today);
  return <View style={styles.stack}>
    <View style={styles.stats}>
      <Stat styles={styles} label="Customers" value={String(summary.customerCount)} onPress={() => onOpen('/customers')}/>
      <Stat styles={styles} label="Open jobs" value={String(summary.openJobs)} onPress={() => onOpen('/jobs')}/>
      <Stat styles={styles} label="Due" value={String(summary.inspectionsDue)} onPress={() => onOpen('/compliance')}/>
      <Stat styles={styles} label="Unpaid" value={formatMoney(summary.unpaidTotal)} onPress={() => onOpen('/billing')}/>
    </View>
    <Text style={styles.heading}>Quotes waiting</Text>
    {book.quotes.filter(quote => quote.status === 'sent' || quote.status === 'draft').map(quote => <Row key={quote.id} styles={styles} title={quote.number} meta={`${customer(book, quote.customerId)} · ${quoteStatusLabel[quote.status]}`} onPress={() => onOpen('/quotes')}/>)}
    <Text style={styles.heading}>Jobs in motion</Text>
    {book.jobs.filter(job => job.status !== 'invoiced').map(job => <Row key={job.id} styles={styles} title={job.title} meta={`${job.number} · ${jobStatusLabel[job.status]} · ${tech(book, job.assignedTechId)}`} onPress={() => onOpen('/jobs')}/>)}
    <Text style={styles.heading}>Inspections due</Text>
    {due.map(site => <Row key={site.id} styles={styles} title={site.name} meta={customer(book, site.customerId)} onPress={() => onOpen('/compliance')}/>)}
    {!due.length ? <Text style={styles.meta}>Every fire alarm site has a current inspection.</Text> : null}
    <Row styles={styles} title="Field service" meta={summary.techsOvertime.length ? `${summary.techsOvertime[0].name} has overtime on the books` : 'No overtime this pay picture'} onPress={() => onOpen('/field-service')}/>
  </View>;
}

function Customers({book, selected, onSelect, styles}: {book: AlarmBook; selected: string | null; onSelect: (id: string) => void; styles: ReturnType<typeof stylesFor>}) {
  const customerRecord = book.customers.find(item => item.id === selected);
  if (!customerRecord) return <View style={styles.stack}>{book.customers.map(item => <Row key={item.id} styles={styles} title={item.name} meta={`${item.accountNumber} · ${item.contactName}`} onPress={() => onSelect(item.id)}/>)}</View>;
  const sites = book.sites.filter(site => site.customerId === customerRecord.id);
  return <View style={styles.stack}>
    <Text style={styles.heading}>{customerRecord.name}</Text>
    <Text style={styles.meta}>{customerRecord.contactName} · {customerRecord.phone}</Text>
    <Text style={styles.meta}>{customerRecord.email}</Text>
    <Text style={styles.meta}>{customerRecord.notes}</Text>
    {sites.map(site => <View key={site.id} style={styles.card}>
      <Text style={styles.heading}>{site.name}</Text>
      <Text style={styles.meta}>{site.address}, {site.city}, {site.state} {site.postalCode}</Text>
      <Text style={styles.meta}>{monitoringLabel[site.monitoringStatus]}{site.contractNumber ? ` · ${site.contractNumber}` : ''}{site.monthlyMonitoring ? ` · ${formatMoney(site.monthlyMonitoring)}/mo` : ''}</Text>
      {book.systems.filter(system => system.siteId === site.id).map(system => <Text key={system.id} style={styles.meta}>{systemKindLabel[system.kind]} · {system.name} · {system.deviceCount} devices · {system.location}</Text>)}
    </View>)}
  </View>;
}

function Jobs({book, today, selected, onSelect, run, styles, onOpen}: {book: AlarmBook; today: string; selected: string | null; onSelect: (id: string) => void; run: (change: () => AlarmBook) => void; styles: ReturnType<typeof stylesFor>; onOpen: (path: string) => void}) {
  const job = book.jobs.find(item => item.id === selected);
  if (!job) return <View style={styles.stack}>{book.jobs.map(item => <Row key={item.id} styles={styles} title={item.title} meta={`${item.number} · ${jobStatusLabel[item.status]} · ${customer(book, item.customerId)}`} onPress={() => onSelect(item.id)}/>)}</View>;
  const invoice = book.invoices.find(item => item.jobId === job.id);
  const year = Number(today.slice(0, 4));
  const steps: JobStatus[] = job.status === 'scheduled' ? ['dispatched', 'in_progress'] : job.status === 'dispatched' ? ['in_progress'] : job.status === 'in_progress' ? ['complete'] : [];
  return <View style={styles.stack}>
    <Text style={styles.heading}>{job.title}</Text>
    <Text style={styles.meta}>{job.number} · {jobKindLabel[job.kind]} · {jobStatusLabel[job.status]}</Text>
    <Text style={styles.meta}>{siteLabel(book, job.siteId)} · {job.scheduledOn}</Text>
    <Text style={styles.meta}>Technician {tech(book, job.assignedTechId)}</Text>
    <Text style={styles.meta}>{job.notes}</Text>
    <Text style={styles.heading}>Assign</Text>
    {book.techs.map(person => <Row key={person.id} styles={styles} title={person.name} meta={person.title} onPress={() => run(() => assignJob(book, job.id, person.id))}/>)}
    {steps.map(status => <Primary key={status} styles={styles} label={`Mark ${jobStatusLabel[status].toLowerCase()}`} onPress={() => run(() => transitionJob(book, job.id, status))}/>)}
    {job.status === 'complete' && !invoice ? <Primary styles={styles} label="Create invoice" onPress={() => run(() => invoiceFromJob(book, job.id, {id: alarmRecordId('inv'), number: nextAlarmNumber(book.invoices.map(item => item.number), 'INV', year), issuedOn: today, dueOn: shift(today, 30)}))}/> : null}
    {invoice ? <Row styles={styles} title={invoice.number} meta="Open billing" onPress={() => onOpen('/billing')}/> : null}
  </View>;
}

function Quotes({book, today, selected, onSelect, run, styles, onOpen}: {book: AlarmBook; today: string; selected: string | null; onSelect: (id: string) => void; run: (change: () => AlarmBook) => void; styles: ReturnType<typeof stylesFor>; onOpen: (path: string) => void}) {
  const quote = book.quotes.find(item => item.id === selected);
  if (!quote) return <View style={styles.stack}>{book.quotes.map(item => <Row key={item.id} styles={styles} title={item.number} meta={`${customer(book, item.customerId)} · ${formatMoney(quoteTotal(item))} · ${quoteStatusLabel[item.status]}`} onPress={() => onSelect(item.id)}/>)}</View>;
  const year = Number(today.slice(0, 4));
  return <View style={styles.stack}>
    <Text style={styles.heading}>{quote.title}</Text>
    <Text style={styles.meta}>{quote.number} · {customer(book, quote.customerId)} · {siteLabel(book, quote.siteId)}</Text>
    {quote.lines.map(line => <Text key={line.id} style={styles.meta}>{line.quantity} × {line.description} · {formatMoney(line.quantity * line.unitPrice)}</Text>)}
    <Text style={styles.heading}>Total {formatMoney(quoteTotal(quote))}</Text>
    {(quote.status === 'draft' || quote.status === 'sent') ? <AdiParts styles={styles} onAdd={line => run(() => addQuoteLine(book, quote.id, line))}/> : null}
    {quote.jobId ? <Row styles={styles} title="Open job" meta={quote.jobId} onPress={() => onOpen('/jobs')}/> : null}
    {(quote.status === 'draft' || quote.status === 'sent') && book.techs.map(person => <Primary key={person.id} styles={styles} label={`Accept with ${person.name}`} onPress={() => {
      const jobId = alarmRecordId('j');
      run(() => acceptQuote(book, quote.id, {jobId, jobNumber: nextAlarmNumber(book.jobs.map(job => job.number), 'J', year), assignedTechId: person.id, scheduledOn: today}));
      onOpen('/jobs');
    }}/>)}
  </View>;
}

function Compliance({book, today, selected, onSelect, run, styles}: {book: AlarmBook; today: string; selected: string | null; onSelect: (id: string) => void; run: (change: () => AlarmBook) => void; styles: ReturnType<typeof stylesFor>}) {
  const inspection = book.inspections.find(item => item.id === selected);
  const due = inspectionsDue(book, today);
  const [reportError, setReportError] = useState('');
  if (!inspection) return <View style={styles.stack}>
    {due.length ? <Text style={styles.error}>{due.map(site => site.name).join(', ')} {due.length === 1 ? 'is' : 'are'} due for a fire alarm inspection.</Text> : null}
    {book.inspections.map(item => <Row key={item.id} styles={styles} title={item.number} meta={`${siteLabel(book, item.siteId)} · next due ${item.nextDue}`} onPress={() => onSelect(item.id)}/>)}
    <Primary styles={styles} label="Start Hyde Park checklist" onPress={() => {
      const id = alarmRecordId('i');
      run(() => startInspection(book, {id, number: nextAlarmNumber(book.inspections.map(item => item.number), 'INS', Number(today.slice(0, 4))), siteId: 's-coop', jobId: 'j-coop', inspectorId: 't-priya', inspectedOn: today, frequencyMonths: 12}));
      onSelect(id);
    }}/>
  </View>;
  return <View style={styles.stack}>
    <Text style={styles.heading}>{inspection.number}</Text>
    <Text style={styles.meta}>{siteLabel(book, inspection.siteId)} · next due {inspection.nextDue}</Text>
    {inspection.items.map(item => <View key={item.id} style={styles.card}>
      <Text style={styles.meta}>{item.section}</Text>
      <Text style={styles.body}>{item.prompt}</Text>
      <Text style={styles.meta}>Result: {item.result}{item.notes ? ` · ${item.notes}` : ''}</Text>
      <View style={styles.rowButtons}>
        {(['pass', 'fail', 'na'] as ChecklistResult[]).map(result => <Pressable key={result} accessibilityRole="button" onPress={() => run(() => setChecklistResult(book, inspection.id, item.id, result, item.notes))} style={styles.smallButton}><Text style={styles.smallLabel}>{result === 'na' ? 'N/A' : result}</Text></Pressable>)}
      </View>
    </View>)}
    <Text style={styles.heading}>Deficiencies</Text>
    {inspection.deficiencies.map(item => <Text key={item.id} style={styles.meta}>{item.status} · due {item.dueOn} · {item.description}</Text>)}
    {!inspection.deficiencies.length ? <Text style={styles.meta}>No deficiencies.</Text> : null}
    <Primary styles={styles} label="Share PDF report" onPress={() => { void shareReport(inspectionReportHtml(book, inspection.id)).catch(() => setReportError('The report could not be shared from this device.')); }}/>
    {reportError ? <Text style={styles.error}>{reportError}</Text> : null}
  </View>;
}

function Billing({book, today, selected, onSelect, run, styles}: {book: AlarmBook; today: string; selected: string | null; onSelect: (id: string) => void; run: (change: () => AlarmBook) => void; styles: ReturnType<typeof stylesFor>}) {
  const invoice = book.invoices.find(item => item.id === selected);
  if (!invoice) return <View style={styles.stack}>
    {book.invoices.map(item => <Row key={item.id} styles={styles} title={item.number} meta={`${customer(book, item.customerId)} · ${formatMoney(invoiceTotal(item))} · ${alarmInvoiceState(item, today)}`} onPress={() => onSelect(item.id)}/>)}
    <Primary styles={styles} label="Bill Capitol monitoring, 1 month" onPress={() => {
      const id = alarmRecordId('inv');
      run(() => invoiceFromMonitoring(book, 's-capitol', {id, number: nextAlarmNumber(book.invoices.map(item => item.number), 'INV', Number(today.slice(0, 4))), issuedOn: today, dueOn: shift(today, 30), months: 1}));
      onSelect(id);
    }}/>
  </View>;
  const state = alarmInvoiceState(invoice, today);
  return <View style={styles.stack}>
    <Text style={styles.heading}>{invoice.number}</Text>
    <Text style={styles.meta}>{customer(book, invoice.customerId)} · {state} · due {invoice.dueOn}</Text>
    {invoice.lines.map(line => <Text key={line.description} style={styles.meta}>{line.description} · {formatMoney(line.amount)}</Text>)}
    <Text style={styles.heading}>{formatMoney(invoiceTotal(invoice))}</Text>
    {invoice.status !== 'paid' ? <Primary styles={styles} label="Mark paid" onPress={() => run(() => markInvoicePaid(book, invoice.id, today))}/> : null}
  </View>;
}

function Row({title, meta, onPress, styles}: {title: string; meta: string; onPress: () => void; styles: ReturnType<typeof stylesFor>}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${meta}`} onPress={onPress} style={styles.row}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.meta}>{meta}</Text></Pressable>;
}
function Stat({label, value, onPress, styles}: {label: string; value: string; onPress: () => void; styles: ReturnType<typeof stylesFor>}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${value} ${label}`} onPress={onPress} style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.meta}>{label}</Text></Pressable>;
}
function Primary({label, onPress, styles}: {label: string; onPress: () => void; styles: ReturnType<typeof stylesFor>}) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.primary}><Text style={styles.primaryLabel}>{label}</Text></Pressable>;
}
function Back({onPress, styles}: {onPress: () => void; styles: ReturnType<typeof stylesFor>}) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.back}><Text style={styles.backLabel}>Back</Text></Pressable>;
}

async function shareReport(html: string) {
  const file = await Print.printToFileAsync({html});
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, {mimeType: 'application/pdf', UTI: 'com.adobe.pdf'});
}

function AdiParts({styles, onAdd}: {styles: ReturnType<typeof stylesFor>; onAdd: (line: ReturnType<typeof adiQuoteLine>) => void}) {
  const [query, setQuery] = useState('smoke');
  const [markup, setMarkup] = useState('35');
  const [parts, setParts] = useState<AdiPart[]>([]);
  const [error, setError] = useState('');
  const search = async () => {
    try { setParts(await createMockAdiParts().search(query)); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'ADI parts could not be searched.'); }
  };
  return <View style={styles.card}>
    <Text style={styles.heading}>ADI parts</Text>
    <Text style={styles.meta}>Demo catalog. Dealer price plus markup. Photos and branch stock are not in ADI’s price response, so this mock supplies them.</Text>
    <TextInput accessibilityLabel="Part search" value={query} onChangeText={setQuery} style={styles.input}/>
    <TextInput accessibilityLabel="Markup percent" keyboardType="decimal-pad" value={markup} onChangeText={setMarkup} style={styles.input}/>
    <Primary styles={styles} label="Search ADI" onPress={() => void search()}/>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {parts.map(item => <View key={item.partNumber}>
      <Text style={styles.body}>{item.partNumber}</Text>
      <Text style={styles.meta}>{item.description}</Text>
      <Text style={styles.meta}>Dealer {formatMoney(item.dealerPrice)} · Quote {formatMoney(safeSell(item.dealerPrice, markup))}</Text>
      <Text style={styles.meta}>{item.stock.map(row => `${row.branch} ${row.quantity}`).join(' · ')}</Text>
      <Primary styles={styles} label={`Add ${item.partNumber}`} onPress={() => onAdd(adiQuoteLine(item, 1, Number(markup) || 0, alarmRecordId('ql')))}/>
    </View>)}
  </View>;
}

function safeSell(dealerPrice: number, markup: string) {
  try { return markedUpUnitPrice(dealerPrice, Number(markup)); }
  catch { return dealerPrice; }
}

function customer(book: AlarmBook, id: string) { return book.customers.find(item => item.id === id)?.name ?? 'Customer'; }
function tech(book: AlarmBook, id: string) { return book.techs.find(item => item.id === id)?.name ?? 'Unassigned'; }
function siteLabel(book: AlarmBook, id: string) {
  const site = book.sites.find(item => item.id === id);
  return site ? `${site.name}, ${site.city}` : 'Site';
}
function shift(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function stylesFor(theme: FireOpsTheme) {
  return StyleSheet.create({
    stack: {gap: 10},
    stats: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
    stat: {width: '48%', flexGrow: 1, backgroundColor: theme.paper, borderWidth: 1, borderColor: theme.divider, borderRadius: 14, padding: 14, minHeight: 72},
    statValue: {color: theme.ink, fontSize: 18, fontWeight: '800'},
    heading: {color: theme.ink, fontSize: 16, fontWeight: '800', marginTop: 8},
    body: {color: theme.ink, fontSize: 15, lineHeight: 21},
    meta: {color: theme.secondary, fontSize: 13, lineHeight: 18},
    row: {backgroundColor: theme.paper, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, padding: 14, gap: 4, minHeight: 64},
    rowTitle: {color: theme.ink, fontSize: 16, fontWeight: '700'},
    card: {backgroundColor: theme.paper, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, padding: 14, gap: 6},
    primary: {backgroundColor: theme.ember, borderRadius: 9, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16},
    primaryLabel: {color: '#fff', fontWeight: '700', fontSize: 15},
    smallButton: {minHeight: 44, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: theme.divider, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.paper},
    smallLabel: {color: theme.ink, fontWeight: '700', textTransform: 'capitalize'},
    rowButtons: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
    input: {minHeight: 44, borderWidth: 1, borderColor: theme.divider, borderRadius: 8, paddingHorizontal: 12, color: theme.ink, backgroundColor: theme.paper, fontSize: 16},
    error: {color: theme.danger, fontSize: 14, lineHeight: 20},
    back: {minHeight: 44, justifyContent: 'center'},
    backLabel: {color: theme.ember, fontWeight: '700', fontSize: 16},
  });
}
