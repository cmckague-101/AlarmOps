import {useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useRouter} from 'expo-router';
import {
  alarmRecordId, nextAlarmNumber, buildSeedSnapshot, priorityLabel, waitingLabel, workOrderFromProblem,
  type ProblemAccount, type StationSignal,
} from '@fireops/domain';
import {SectionScreen} from '@/components/section-screen';
import {useAlarmBook} from '@/lib/alarm-book';
import {useFireOpsTheme, type FireOpsTheme} from '@/theme';

const PIN: Record<string, string> = {fire: '#98392E', panic: '#98392E', burglary: '#C94321', trouble: '#7B5014', supervisory: '#7B5014', test: '#315F48', runaway: '#19201D', normal: '#26765A'};

export function CentralStationScreen() {
  const theme = useFireOpsTheme();
  const styles = stylesFor(theme);
  const router = useRouter();
  const {book, setBook} = useAlarmBook();
  const now = useMemo(() => new Date(), []);
  const snapshot = useMemo(() => buildSeedSnapshot(now), [now]);
  const [selectedId, setSelectedId] = useState<string | null>(snapshot.queue[0]?.id ?? null);
  const [notice, setNotice] = useState('');
  const selected = [...snapshot.queue, ...snapshot.history].find(signal => signal.id === selectedId);
  const createOrder = (problem: ProblemAccount) => {
    try {
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      setBook(workOrderFromProblem(book, problem, {jobId: alarmRecordId('j'), jobNumber: nextAlarmNumber(book.jobs.map(job => job.number), 'J', now.getFullYear()), techId: book.techs[0]?.id ?? '', scheduledOn: today}));
      setNotice(`Work order opened for ${problem.title}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The work order could not be opened.');
    }
  };
  return <SectionScreen title="Central station" description="Alarmco’s Manitou desk. This is seeded demo data until the REST feed is connected.">
    {notice ? <Text style={styles.error}>{notice}</Text> : null}
    <View style={styles.stats}>
      <Stat styles={styles} label="Active alarms" value={String(snapshot.kpis.activeAlarms)}/>
      <Stat styles={styles} label="Avg response" value={snapshot.kpis.averageResponseSeconds === null ? '—' : `${snapshot.kpis.averageResponseSeconds} sec`}/>
      <Stat styles={styles} label="On shift" value={String(snapshot.kpis.operatorsOnShift)}/>
      <Stat styles={styles} label="Test / runaway" value={`${snapshot.kpis.accountsInTest} / ${snapshot.kpis.runawayAccounts}`}/>
    </View>
    <Text style={styles.heading}>Live queue</Text>
    {snapshot.queue.map(signal => <SignalRow key={signal.id} styles={styles} signal={signal} name={snapshot.accounts.find(account => account.id === signal.accountId)?.name ?? 'Account'} waiting={waitingLabel(signal, now)} onPress={() => setSelectedId(signal.id)}/>)}
    <Text style={styles.heading}>Sites</Text>
    <View style={styles.pins}>{snapshot.pins.map(pin => <Pressable key={pin.accountId} accessibilityRole="button" accessibilityLabel={`${pin.name}, ${pin.status}`} onPress={() => { const signal = snapshot.queue.find(item => item.accountId === pin.accountId); if (signal) setSelectedId(signal.id); else router.push('/customers' as never); }} style={styles.pin}><View style={[styles.dot, {backgroundColor: PIN[pin.status] ?? theme.secondary}]}/><Text style={styles.meta}>{pin.siteName} · {pin.status}</Text></Pressable>)}</View>
    {selected && <Detail styles={styles} bookSites={book} signal={selected} account={snapshot.accounts.find(item => item.id === selected.accountId)} operator={snapshot.operators.find(item => item.id === selected.operatorId)?.name ?? 'Unassigned'} onOpen={() => router.push('/customers' as never)}/>}
    <Text style={styles.heading}>Problem accounts</Text>
    {snapshot.problems.map(problem => <View key={problem.id} style={styles.card}><Text style={styles.rowTitle}>{problem.title}</Text><Text style={styles.meta}>{problem.detail}</Text><Pressable accessibilityRole="button" onPress={() => createOrder(problem)} style={styles.primary}><Text style={styles.primaryLabel}>Create work order</Text></Pressable></View>)}
    <Text style={styles.heading}>False alarm rate</Text>
    {snapshot.trends.falseAlarmRate.slice(0, 4).map(row => <Text key={row.customerId} style={styles.meta}>{row.name}: {row.falseAlarms} of {row.alarms} ({Math.round(row.rate * 100)}%)</Text>)}
    <Text style={styles.heading}>Response versus target</Text>
    {snapshot.trends.responseByPriority.filter(row => row.samples > 0).map(row => <Text key={row.priority} style={styles.meta}>{priorityLabel[row.priority]}: {row.averageSeconds} sec average, target {row.targetSeconds} sec</Text>)}
  </SectionScreen>;
}

function SignalRow({styles, signal, name, waiting, onPress}: {styles: ReturnType<typeof stylesFor>; signal: StationSignal; name: string; waiting: string; onPress: () => void}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${priorityLabel[signal.priority]} ${name} ${signal.zone}, waiting ${waiting}`} onPress={onPress} style={styles.row}><Text style={styles.rowTitle}>{priorityLabel[signal.priority]} · {name}</Text><Text style={styles.meta}>{signal.zone} · {waiting}</Text></Pressable>;
}

function Detail({styles, bookSites, signal, account, operator, onOpen}: {styles: ReturnType<typeof stylesFor>; bookSites: {sites: {id: string; address: string; city: string}[]; systems: {siteId: string; name: string}[]; jobs: {siteId: string; status: string; number: string; title: string}[]; inspections: {siteId: string; nextDue: string; number: string}[]}; signal: StationSignal; account?: {siteId: string; panel: string; customerId: string}; operator: string; onOpen: () => void}) {
  const site = bookSites.sites.find(item => item.id === account?.siteId);
  const systems = bookSites.systems.filter(item => item.siteId === account?.siteId);
  const jobs = bookSites.jobs.filter(item => item.siteId === account?.siteId && item.status !== 'complete' && item.status !== 'invoiced');
  const inspections = bookSites.inspections.filter(item => item.siteId === account?.siteId);
  return <View style={styles.card}>
    <Text style={styles.heading}>{priorityLabel[signal.priority]} · {signal.eventType}</Text>
    <Text style={styles.meta}>{operator} · {account?.panel}</Text>
    <Text style={styles.meta}>{site ? `${site.address}, ${site.city}` : 'Site address is on the account'}</Text>
    <Text style={styles.meta}>Systems: {systems.map(item => item.name).join(', ') || 'None on the customer record'}</Text>
    <Text style={styles.meta}>Open work orders: {jobs.map(item => item.number).join(', ') || 'None'}</Text>
    <Text style={styles.meta}>Inspections: {inspections.map(item => `${item.number} due ${item.nextDue}`).join(', ') || 'None'}</Text>
    {signal.steps.map(step => <Text key={`${step.kind}${step.at}`} style={styles.meta}>{step.kind}: {step.actor} · {step.note}</Text>)}
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.primary}><Text style={styles.primaryLabel}>Open customer</Text></Pressable>
  </View>;
}

function Stat({styles, label, value}: {styles: ReturnType<typeof stylesFor>; label: string; value: string}) {
  return <View style={styles.stat} accessibilityLabel={`${value} ${label}`}><Text style={styles.statValue}>{value}</Text><Text style={styles.meta}>{label}</Text></View>;
}

function stylesFor(theme: FireOpsTheme) {
  return StyleSheet.create({
    stats: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
    stat: {width: '48%', flexGrow: 1, backgroundColor: theme.paper, borderWidth: 1, borderColor: theme.divider, borderRadius: 14, padding: 12, minHeight: 68},
    statValue: {color: theme.ink, fontSize: 18, fontWeight: '800'},
    heading: {color: theme.ink, fontSize: 16, fontWeight: '800', marginTop: 14},
    meta: {color: theme.secondary, fontSize: 13, lineHeight: 18},
    row: {backgroundColor: theme.paper, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, padding: 12, gap: 4, minHeight: 60},
    rowTitle: {color: theme.ink, fontSize: 16, fontWeight: '700'},
    card: {backgroundColor: theme.paper, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, padding: 12, gap: 6},
    pins: {gap: 8},
    pin: {flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44},
    dot: {width: 12, height: 12, borderRadius: 6},
    primary: {backgroundColor: theme.ember, borderRadius: 9, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14},
    primaryLabel: {color: '#fff', fontWeight: '700'},
    error: {color: theme.danger, fontSize: 14},
  });
}
