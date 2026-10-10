import type { CredentialRecordType, CrewMember, QualificationCardRequest } from '@fireops/domain';
import { crewCredentials } from '@fireops/domain';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { loadCompanyCardRequests } from '@/lib/qualification-card-store';
import { useFireOpsTheme } from '@/theme';

const recordTypes: CredentialRecordType[] = ['Training', 'Qualification', 'License', 'Task Book', 'DOT Medical'];
const date = (value?: string) => value ? new Date(`${value}T12:00:00`).toLocaleDateString() : 'Not recorded';

export function CrewReview({ crew, companyId }: { crew: CrewMember[]; companyId: string }) {
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const members = useMemo(() => crew.filter((member) => member.role !== 'owner').sort((a, b) => a.name.localeCompare(b.name)), [crew]);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [requests, setRequests] = useState<QualificationCardRequest[]>([]);
  const [cardError, setCardError] = useState('');
  const member = members.find((item) => item.id === selectedId);

  useEffect(() => {
    let active = true;
    loadCompanyCardRequests(companyId)
      .then((next) => { if (active) setRequests(next); })
      .catch((error: unknown) => { if (active) setCardError(error instanceof Error ? error.message : 'Qualification card status unavailable.'); });
    return () => { active = false; };
  }, [companyId, members]);

  const credentials = member ? crewCredentials(member) : [];
  const approvedCard = member ? requests.find((request) => request.crewUserId === member.id && request.status === 'approved') : undefined;

  return <View style={styles.container}>
    <View style={styles.selectRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="Crew Review, select crew member" onPress={() => setOpen((value) => !value)} style={({ pressed }) => [styles.select, pressed && styles.pressed]}>
        <View><Text style={styles.title}>Crew Review</Text><Text style={styles.subtitle}>{member?.name ?? 'Select crew member'}</Text></View><Text style={styles.chevron}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      {selectedId ? <Pressable accessibilityRole="button" accessibilityLabel="Clear crew selection" onPress={() => { setSelectedId(''); setOpen(false); }} style={({ pressed }) => [styles.clear, pressed && styles.pressed]}><Text style={styles.clearText}>×</Text></Pressable> : null}
    </View>
    {open && <View style={styles.options}>{members.length ? members.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => { setSelectedId(item.id); setOpen(false); }} style={({ pressed }) => [styles.option, pressed && styles.pressed]}><Text style={styles.optionText}>{item.name}</Text></Pressable>) : <Text style={styles.empty}>No crew members</Text>}</View>}
    {member && <View style={styles.details}>
      <Text style={styles.memberName}>{member.name}</Text><Text style={styles.meta}>{member.email} · {member.phone}</Text>
      <Text style={[styles.cardStatus, approvedCard && styles.cardComplete]}>{approvedCard ? 'Qualification card completed' : 'No completed qualification card'}</Text>
      {cardError ? <Text style={styles.error}>{cardError}</Text> : null}
      {recordTypes.map((type) => {
        const records = credentials.filter((credential) => (credential.recordType ?? 'Qualification') === type);
        const photoOnly = type === 'License' || type === 'DOT Medical';
        return <View key={type} style={styles.section}><Text style={styles.sectionTitle}>{type}</Text>{records.length ? records.map((record) => <View key={record.id} style={styles.record}><Text style={styles.recordTitle}>{record.name}</Text>{photoOnly ? <Text style={styles.meta}>Photo: {record.file?.name || 'None'}</Text> : <><Text style={styles.meta}>Course: {record.courseCode || 'Not recorded'}</Text><Text style={styles.meta}>Completed: {date(record.completionDate)}</Text><Text style={styles.meta}>Expires: {date(record.expirationDate)}</Text><Text style={styles.meta}>Provider: {record.provider || 'Not recorded'}</Text><Text style={styles.meta}>File: {record.file?.name || 'None'}</Text></>}</View>) : <Text style={styles.empty}>No records</Text>}</View>;
      })}
      <View style={styles.section}><Text style={styles.sectionTitle}>Experience</Text>{member.experiences?.length ? member.experiences.map((experience) => <View key={experience.id} style={styles.record}><Text style={styles.recordTitle}>{experience.incident}</Text><Text style={styles.meta}>Position: {experience.position}</Text><Text style={styles.meta}>Days: {experience.days}</Text><Text style={styles.meta}>File: {experience.file?.name || 'None'}</Text></View>) : <Text style={styles.empty}>No experience records</Text>}</View>
      <View style={styles.section}><Text style={styles.sectionTitle}>Annual records</Text>{member.annualRecord ? <View style={styles.record}><Text style={styles.meta}>RT-130 completion: {date(member.annualRecord.rt130CompletionDate)}</Text><Text style={styles.meta}>RT-130 currency: {date(member.annualRecord.rt130CurrencyDate)}</Text><Text style={styles.meta}>WCT completion: {date(member.annualRecord.wctCompletionDate)}</Text><Text style={styles.meta}>WCT currency: {date(member.annualRecord.wctCurrencyDate)}</Text></View> : <Text style={styles.empty}>No annual record</Text>}</View>
    </View>}
  </View>;
}

function createStyles(theme: ReturnType<typeof useFireOpsTheme>) { return StyleSheet.create({
  container: { width: '100%', marginBottom: 10 }, selectRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, select: { flex: 1, minHeight: 78, padding: 16, borderRadius: 16, backgroundColor: theme.paper, borderWidth: 1, borderColor: theme.divider, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, clear: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.divider }, clearText: { color: theme.ink, fontSize: 24, lineHeight: 26 }, pressed: { opacity: .72 }, title: { color: theme.ink, fontSize: 17, fontWeight: '800' }, subtitle: { color: theme.secondary, fontSize: 13, marginTop: 4 }, chevron: { color: theme.secondary, fontSize: 14 }, options: { marginTop: 6, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.paper }, option: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider }, optionText: { color: theme.ink, fontSize: 15, fontWeight: '600' }, details: { marginTop: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.paper }, memberName: { color: theme.ink, fontSize: 20, fontWeight: '800' }, meta: { color: theme.secondary, fontSize: 13, lineHeight: 19 }, cardStatus: { alignSelf: 'flex-start', color: '#9C351C', backgroundColor: '#F4E5E0', fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, marginTop: 10 }, cardComplete: { color: '#236B34', backgroundColor: '#E2F1E5' }, error: { color: theme.danger, marginTop: 8 }, section: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider }, sectionTitle: { color: theme.ink, fontSize: 16, fontWeight: '800', marginBottom: 7 }, record: { paddingVertical: 6 }, recordTitle: { color: theme.ink, fontSize: 14, fontWeight: '700', marginBottom: 2 }, empty: { color: theme.secondary, fontSize: 13, padding: 12 },
}); }
