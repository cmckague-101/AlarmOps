import { useMemo, useState } from 'react';
import { Redirect, Stack, useRouter } from 'expo-router';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { FilterSelect, type FilterSelectOption } from '@/components/filter-select';
import { documentStores, type CompanyStoredDocument } from '@/lib/stored-documents-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

type Timespan = '30-days' | 'this-year' | 'last-year' | 'all';

const timespanOptions: readonly FilterSelectOption<Timespan>[] = [
  { value: '30-days', label: '30 days' },
  { value: 'this-year', label: 'This year' },
  { value: 'last-year', label: 'Last year' },
  { value: 'all', label: 'All time' },
];



function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function startFor(timespan: Timespan) {
  const now = new Date();
  if (timespan === '30-days') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  if (timespan === 'this-year') return new Date(now.getFullYear(), 0, 1);
  if (timespan === 'last-year') return new Date(now.getFullYear() - 1, 0, 1);
  return null;
}

export function StoredDocumentsScreen({kind}: {kind: 'invoices' | 'payroll'}) {
  const title = kind === 'invoices' ? 'Invoices' : 'Payroll';
  const {useStoredDocuments, refreshStoredDocuments, deleteStoredDocument, openStoredDocument} = documentStores[kind];
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const { documents, loading, refreshing, error } = useStoredDocuments(member?.company.id ?? null, member?.user.id ?? null);
  const [timespan, setTimespan] = useState<Timespan>('all');
  const [crewId, setCrewId] = useState('all');
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const isOwner = member?.user.role === 'owner';

  const crew = useMemo(() => {
    const people = new Map<string, string>();
    documents.forEach((document) => people.set(document.uploadedBy, document.uploadedByName));
    return [...people].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
  }, [documents]);
  const crewOptions = useMemo<FilterSelectOption<string>[]>(() => [
    { value: 'all', label: 'All Crew' },
    ...crew.map((person) => ({ value: person.id, label: person.name })),
  ], [crew]);

  const visible = useMemo(() => {
    const start = startFor(timespan);
    const end = timespan === 'last-year' ? new Date(new Date().getFullYear(), 0, 1) : null;
    return documents.filter((document) => {
      const created = new Date(document.createdAt);
      return (isOwner ? crewId === 'all' || document.uploadedBy === crewId : document.uploadedBy === member?.user.id)
        && (!start || created >= start)
        && (!end || created < end);
    });
  }, [crewId, isOwner, documents, timespan, member?.user.id]);

  if (!session || access.status === 'error') return <Redirect href="/" />;

  const viewStoredDocument = async (document: CompanyStoredDocument) => {
    if (busyId) return;
    setBusyId(document.id);
    setActionError('');
    try {
      const url = await openStoredDocument(document);
      await Linking.openURL(url);
    } catch (openError) {
      setActionError(openError instanceof Error ? openError.message : 'Document could not be opened.');
    } finally {
      setBusyId('');
    }
  };

  const confirmDelete = (document: CompanyStoredDocument) => {
    if (!member || !isOwner || busyId) return;
    Alert.alert('Delete document?', `“${document.name}” and its uploaded file will be permanently deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        setBusyId(document.id);
        setActionError('');
        void deleteStoredDocument(member.company.id, document)
          .catch((deleteError) => setActionError(deleteError instanceof Error ? deleteError.message : 'Document could not be deleted.'))
          .finally(() => setBusyId(''));
      } },
    ]);
  };

  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <Stack.Screen options={{ title }} />
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshStoredDocuments} tintColor={theme.commandForeground} />}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}><Text accessibilityRole="header" style={styles.title}>{isOwner ? title : `My ${title.toLowerCase()}`}</Text>{!isOwner ? <Text style={styles.subtitle}>Upload documents and keep them ready for review.</Text> : null}</View>
        <Pressable accessibilityRole="button" accessibilityLabel="Add document" onPress={() => router.push(`/${kind}/form` as never)} style={({ pressed }) => [styles.add, pressed && styles.pressed]}><AppSymbol name={{ ios: 'plus', android: 'add' } as never} color="#FFFFFF" size={18} /><Text style={styles.addText}>Add</Text></Pressable>
      </View>

      
      {isOwner ? <View style={styles.filterGroup}><Text style={styles.filterLabel}>Crew member</Text><FilterSelect accessibilityLabel={`${title} crew member`} onChange={setCrewId} options={crewOptions} value={crewId} /></View> : null}
      <View style={styles.filterGroup}><Text style={styles.filterLabel}>Timespan</Text><FilterSelect accessibilityLabel="Document timespan" onChange={setTimespan} options={timespanOptions} value={timespan} /></View>

      {error ? <View style={styles.error}><Text style={styles.errorTitle}>Documents unavailable</Text><Text style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" onPress={refreshStoredDocuments} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
      {actionError ? <Text accessibilityRole="alert" style={styles.actionError}>{actionError}</Text> : null}
      {loading ? <Text style={styles.state}>Loading documents…</Text> : null}
      {!loading && !error && !visible.length ? <View style={styles.empty}><View style={styles.emptyIcon}><AppSymbol name={{ ios: 'doc.text', android: 'description' } as never} color={theme.secondary} size={28} /></View><Text style={styles.emptyTitle}>No documents found</Text><Text style={styles.emptyText}>{documents.length ? 'Change filters to see more documents.' : 'Tap Add to upload first document.'}</Text></View> : null}
      {!!visible.length ? <View style={styles.list}>{visible.map((document, index) => <View key={document.id} style={[styles.row, index > 0 && styles.rowBorder]}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${document.name}`} disabled={Boolean(busyId)} onPress={() => void viewStoredDocument(document)} style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}><View style={styles.documentIcon}><AppSymbol name={{ ios: 'doc.text.fill', android: 'description' } as never} color={theme.commandForeground} size={21} /></View><View style={styles.rowCopy}><Text numberOfLines={1} style={styles.rowTitle}>{document.name}</Text><Text numberOfLines={1} style={styles.rowMeta}>{isOwner ? `${document.uploadedByName} · ` : ''}{formatDate(document.createdAt)}</Text><Text numberOfLines={1} style={styles.fileName}>{document.fileName}</Text></View><View style={styles.rowEnd}><Text style={styles.openText}>{busyId === document.id ? 'Working…' : 'View'}</Text></View></Pressable>{isOwner ? <View style={styles.ownerActions}><Pressable accessibilityRole="button" accessibilityLabel={`Edit ${document.name}`} disabled={Boolean(busyId)} onPress={() => router.push({ pathname: `/${kind}/form`, params: { documentId: document.id } } as never)} style={({ pressed }) => [styles.ownerAction, pressed && styles.pressed]}><AppSymbol name={{ ios: 'pencil', android: 'edit' } as never} color={theme.commandForeground} size={17} /><Text style={styles.ownerActionText}>Edit</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Delete ${document.name}`} disabled={Boolean(busyId)} onPress={() => confirmDelete(document)} style={({ pressed }) => [styles.ownerAction, styles.deleteAction, pressed && styles.pressed]}><AppSymbol name={{ ios: 'trash', android: 'delete' } as never} color={theme.danger} size={17} /><Text style={styles.deleteActionText}>Delete</Text></Pressable></View> : null}</View>)}</View> : null}
    </ScrollView>
  </SafeAreaView>;
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.canvas }, content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 48, gap: 20 },
    heading: { flexDirection: 'row', alignItems: 'center', gap: 14 }, headingCopy: { flex: 1, gap: 6 }, title: { color: theme.ink, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7 }, subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 21 }, add: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 11, backgroundColor: theme.ember, paddingHorizontal: 14 }, addText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
    filterGroup: { gap: 8 }, filterLabel: { color: theme.ink, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
    list: { overflow: 'hidden', borderWidth: 1, borderColor: theme.divider, borderRadius: 14, backgroundColor: theme.paper }, row: { minHeight: 86 }, rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider }, rowMain: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 }, documentIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: theme.surfaceAlt }, rowCopy: { flex: 1, gap: 3 }, rowTitle: { color: theme.ink, fontSize: 15, fontWeight: '700' }, rowMeta: { color: theme.secondary, fontSize: 11 }, fileName: { color: theme.secondary, fontSize: 10 }, rowEnd: { alignItems: 'flex-end', gap: 7 }, openText: { color: theme.commandForeground, fontSize: 11, fontWeight: '800' }, ownerActions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider, marginHorizontal: 13, paddingVertical: 8, gap: 8 }, ownerAction: { minHeight: 38, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 9, backgroundColor: theme.surfaceAlt }, ownerActionText: { color: theme.commandForeground, fontSize: 12, fontWeight: '800' }, deleteAction: { backgroundColor: theme.dangerSurface }, deleteActionText: { color: theme.danger, fontSize: 12, fontWeight: '800' },
    error: { backgroundColor: theme.dangerSurface, padding: 15, borderRadius: 12, gap: 6 }, errorTitle: { color: theme.danger, fontSize: 16, fontWeight: '700' }, errorText: { color: theme.danger, fontSize: 13, lineHeight: 19 }, retry: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', borderRadius: 8, backgroundColor: theme.command, paddingHorizontal: 13 }, retryText: { color: theme.commandText, fontSize: 13, fontWeight: '700' }, actionError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 13, fontSize: 13 }, state: { color: theme.secondary, textAlign: 'center', paddingVertical: 32 },
    empty: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 42, gap: 8 }, emptyIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 28, backgroundColor: theme.surfaceAlt }, emptyTitle: { color: theme.ink, fontSize: 18, fontWeight: '700' }, emptyText: { color: theme.secondary, fontSize: 14, lineHeight: 20, textAlign: 'center' }, pressed: { opacity: 0.65 },
  });
}
