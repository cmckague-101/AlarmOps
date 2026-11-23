import {useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import * as Location from 'expo-location';
import {
  alarmRecordId, availableFieldActions, canApproveTimesheets, certificationState, createMockQboTimeClient,
  fieldStatusLabel, isFieldTechnician, jobsVisibleTo, logTime, placeJob, queueApprovedSync, recordPunch,
  shiftState, syncApprovedTime, techIdForViewer, unassignedJobs, updateFieldStatus, weekHours,
  approveTimesheet, type AlarmBook, type FieldStatus, type UserRole,
} from '@fireops/domain';
import {SectionScreen} from '@/components/section-screen';
import {useAlarmBook} from '@/lib/alarm-book';
import {useIntegrationVault} from '@/lib/integration-vault';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';

const mockClient = createMockQboTimeClient().client;

export function FieldServiceScreen({mode}: {mode: 'board' | 'time'}) {
  const theme = useFireOpsTheme();
  const styles = StyleSheet.create({
    stack: {gap: 12},
    card: {borderWidth: 1, borderColor: theme.divider, borderRadius: 14, backgroundColor: theme.paper, padding: 14, gap: 6},
    title: {color: theme.ink, fontSize: 16, fontWeight: '800'},
    meta: {color: theme.secondary, fontSize: 13, lineHeight: 18},
    row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
    button: {minHeight: 44, borderRadius: 10, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.ember},
    quiet: {backgroundColor: theme.paper, borderWidth: 1, borderColor: theme.divider},
    label: {color: '#fff', fontWeight: '800'},
    quietLabel: {color: theme.ink, fontWeight: '800'},
    input: {minHeight: 44, borderWidth: 1, borderColor: theme.divider, borderRadius: 10, paddingHorizontal: 12, color: theme.ink, backgroundColor: theme.paper},
    error: {color: theme.danger, fontWeight: '700'},
    ok: {color: theme.green, fontWeight: '700'},
  });
  const {book, setBook, techTime, setTechTime, today} = useAlarmBook();
  const {access, demoMode} = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const role = member?.user.role ?? 'owner';
  const name = member?.user.name ?? 'Elena Voss';
  const technician = isFieldTechnician(role);
  const viewerTechId = techIdForViewer(book, name);
  const manager = canApproveTimesheets(role);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const run = (change: () => AlarmBook) => {
    try { setBook(change()); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'That change could not be saved.'); }
  };
  const jobs = jobsVisibleTo(book, role, viewerTechId);
  return <SectionScreen title={mode === 'time' ? 'Tech time' : 'Field Service'} description={mode === 'time' ? 'Clock in and out. Approved hours roll into the Monday–Sunday timesheet.' : 'Dispatch board, roster, and field status for assigned jobs.'}>
    <View style={styles.stack}>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      {notice ? <Text style={styles.ok} accessibilityRole="text">{notice}</Text> : null}
      {mode === 'board' ? <Board book={book} today={today} jobs={jobs} technician={technician} manager={manager} run={run} styles={styles}/> : <Clock book={book} today={today} role={role} name={name} viewerTechId={viewerTechId} manager={manager} demoMode={demoMode} styles={styles} onError={setError} onNotice={setNotice}/>}
    </View>
  </SectionScreen>;
}

function Board({book, today, jobs, technician, manager, run, styles}: {
  book: AlarmBook; today: string; jobs: AlarmBook['jobs']; technician: boolean; manager: boolean; run: (change: () => AlarmBook) => void; styles: Record<string, object>;
}) {
  const queue = manager ? unassignedJobs(book) : [];
  return <>
    {queue.map(job => <View key={job.id} style={styles.card}><Text style={styles.title}>{job.title}</Text><Text style={styles.meta}>Unassigned · {job.scheduledOn} · {customer(book, job.customerId)}</Text>
      <View style={styles.row}>{book.techs.map(tech => <Pressable key={tech.id} accessibilityRole="button" accessibilityLabel={`Assign ${job.title} to ${tech.name}`} onPress={() => run(() => placeJob(book, job.id, job.scheduledOn, tech.id))} style={[styles.button, styles.quiet]}><Text style={styles.quietLabel}>{tech.name}</Text></Pressable>)}</View>
    </View>)}
    {jobs.filter(job => job.status !== 'invoiced' && job.status !== 'complete').map(job => <View key={job.id} style={styles.card}>
      <Text style={styles.title}>{job.title}</Text>
      <Text style={styles.meta}>{job.scheduledOn} · {customer(book, job.customerId)} · {site(book, job.siteId)} · {book.techs.find(tech => tech.id === job.assignedTechId)?.name ?? 'Unassigned'}</Text>
      <View style={styles.row}>{availableFieldActions(job.status).map(status => <Pressable key={status} accessibilityRole="button" onPress={() => run(() => updateFieldStatus(book, job.id, status as FieldStatus))} style={styles.button}><Text style={styles.label}>{fieldStatusLabel[status]}</Text></Pressable>)}</View>
    </View>)}
    {!technician && book.techs.map(tech => <View key={tech.id} style={styles.card}><Text style={styles.title}>{tech.name}</Text><Text style={styles.meta}>{tech.title} · {tech.phone}</Text><Text style={styles.meta}>{tech.skills.join(' · ')}</Text>{tech.certifications.map(cert => <Text key={cert.id} style={styles.meta}>{cert.name} · {certificationState(cert.expiresOn, today)} {cert.expiresOn}</Text>)}</View>)}
  </>;
}

function Clock({book, today, role, name, viewerTechId, manager, demoMode, styles, onError, onNotice}: {
  book: AlarmBook; today: string; role: UserRole; name: string; viewerTechId: string | null; manager: boolean; demoMode: boolean; styles: Record<string, object>;
  onError: (message: string) => void; onNotice: (message: string) => void;
}) {
  const {techTime, setTechTime, setBook} = useAlarmBook();
  const vault = useIntegrationVault();
  const quickBooksConnected = demoMode || vault.list().some(item => item.provider === 'quickbooks' && (item.status === 'connected' || item.secrets.length > 0));
  const self = viewerTechId ?? (manager ? book.techs[0]?.id ?? '' : '');
  const [techId, setTechId] = useState(self);
  const [jobId, setJobId] = useState('');
  const [notes, setNotes] = useState('');
  const people = manager ? book.techs : book.techs.filter(tech => tech.id === self);
  const jobs = jobsVisibleTo(book, role, viewerTechId).filter(job => job.status !== 'invoiced');
  const state = shiftState(techTime, techId);
  const punch = async (kind: 'in' | 'out' | 'break_start' | 'break_end') => {
    if (!techId) { onError('This sign-in is not linked to a technician.'); return; }
    const location = await stampLocation();
    try {
      const next = recordPunch(techTime, {id: alarmRecordId('punch'), techId, jobId: kind === 'in' ? jobId : state.jobId, kind, at: nowStamp(), ...location, notes});
      if (next.entry) setBook(logTime(book, next.entry));
      setTechTime(next.log);
      onError('');
      onNotice(location.latitude == null ? 'Punched. Location unavailable.' : 'Punched with a location stamp.');
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'That punch could not be saved.'); }
  };
  const approve = async (personId: string, weekStart: string) => {
    try {
      const approved = approveTimesheet(techTime, personId, weekStart, name, nowStamp());
      const queued = queueApprovedSync(approved, book);
      setTechTime(await syncApprovedTime(queued, book, mockClient, quickBooksConnected));
      onNotice(quickBooksConnected ? 'Approved and sent through the mock QuickBooks client.' : 'Approved. Connect QuickBooks in API keys before hours can sync.');
      onError('');
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'The timesheet could not be approved.'); }
  };
  return <>
    <View style={styles.card}>
      <Text style={styles.title}>{state.clockedIn ? 'Clocked in' : 'Clocked out'}{state.onBreak ? ' · on break' : ''}</Text>
      <Text style={styles.meta}>Location is stamped when the phone shares it. You can still punch if location is denied.</Text>
      {manager ? <View style={styles.row}>{people.map(tech => <Pressable key={tech.id} accessibilityRole="button" onPress={() => setTechId(tech.id)} style={[styles.button, tech.id === techId ? null : styles.quiet]}><Text style={tech.id === techId ? styles.label : styles.quietLabel}>{tech.name}</Text></Pressable>)}</View> : null}
      <View style={styles.row}><Pressable accessibilityRole="button" onPress={() => setJobId('')} style={[styles.button, jobId ? styles.quiet : null]}><Text style={jobId ? styles.quietLabel : styles.label}>No job</Text></Pressable>{jobs.map(job => <Pressable key={job.id} accessibilityRole="button" onPress={() => setJobId(job.id)} style={[styles.button, jobId === job.id ? null : styles.quiet]}><Text style={jobId === job.id ? styles.label : styles.quietLabel}>{job.number}</Text></Pressable>)}</View>
      <TextInput accessibilityLabel="Notes" value={notes} onChangeText={setNotes} style={styles.input} placeholder="Notes"/>
      <View style={styles.row}>
        {!state.clockedIn ? <Pressable accessibilityRole="button" onPress={() => void punch('in')} style={styles.button}><Text style={styles.label}>Clock in</Text></Pressable> : null}
        {state.clockedIn && !state.onBreak ? <Pressable accessibilityRole="button" onPress={() => void punch('break_start')} style={[styles.button, styles.quiet]}><Text style={styles.quietLabel}>Start break</Text></Pressable> : null}
        {state.onBreak ? <Pressable accessibilityRole="button" onPress={() => void punch('break_end')} style={[styles.button, styles.quiet]}><Text style={styles.quietLabel}>End break</Text></Pressable> : null}
        {state.clockedIn && !state.onBreak ? <Pressable accessibilityRole="button" onPress={() => void punch('out')} style={styles.button}><Text style={styles.label}>Clock out</Text></Pressable> : null}
      </View>
    </View>
    {people.map(tech => {
      const current = weekHours(book.timeEntries, tech.id, today);
      const dates = book.timeEntries.filter(entry => entry.techId === tech.id).map(entry => entry.date).sort();
      const recorded = dates.length ? weekHours(book.timeEntries, tech.id, dates[dates.length - 1]) : current;
      const weeks = recorded.start === current.start ? [current] : [recorded, current];
      return <View key={tech.id} style={styles.card}><Text style={styles.title}>{tech.name}</Text>{weeks.map(week => {
        const approved = techTime.approvals.some(item => item.techId === tech.id && item.weekStart === week.start);
        return <View key={week.start}><Text style={styles.meta}>Week of {week.start}: {week.hours} hrs · {week.overtimeHours} overtime{approved ? ' · approved' : ''}</Text>{manager && week.hours > 0 && !approved ? <Pressable accessibilityRole="button" accessibilityLabel={`Approve ${tech.name} ${week.start}`} onPress={() => void approve(tech.id, week.start)} style={styles.button}><Text style={styles.label}>Approve {week.start}</Text></Pressable> : null}</View>;
      })}</View>;
    })}
    {manager ? <View style={styles.card}><Text style={styles.title}>QuickBooks sync</Text><Text style={styles.meta}>{demoMode ? 'Demo uses a mock client. Payroll item mapping stays off.' : 'Signed-in sync waits for QuickBooks in API keys.'}</Text>{techTime.employees.map(item => <Text key={item.techId} style={styles.meta}>{book.techs.find(tech => tech.id === item.techId)?.name} → {item.qboEmployeeName}</Text>)}{techTime.syncs.map(item => <Text key={item.idempotencyKey} style={styles.meta}>{item.status}{item.error ? ` · ${item.error}` : ''}</Text>)}</View> : null}
  </>;
}

function customer(book: AlarmBook, id: string) { return book.customers.find(item => item.id === id)?.name ?? 'Customer'; }
function site(book: AlarmBook, id: string) { return book.sites.find(item => item.id === id)?.name ?? 'Site'; }

function nowStamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

async function stampLocation() {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return {latitude: null, longitude: null};
    const position = await Location.getCurrentPositionAsync({accuracy: Location.Accuracy.Balanced});
    return {latitude: position.coords.latitude, longitude: position.coords.longitude};
  } catch {
    return {latitude: null, longitude: null};
  }
}
