import { formatCalendarDate, matchesReceiptFilter, possibleDuplicateReceiptIds, receiptDate, receiptProjects } from '@fireops/domain';
import { useMemo, useState } from 'react';
import { Redirect, Stack, useRouter } from 'expo-router';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DownloadedListNotice } from '@/components/downloaded-list-notice';
import { AppSymbol } from '@/components/app-symbol';
import { FilterSelect, type FilterSelectOption } from '@/components/filter-select';
import { deleteReceipt, openReceipt, refreshReceipts, shareReceiptZip, shareReceiptsZip, useReceipts, type CompanyReceipt } from '@/lib/receipts-store';
import { deviceReceipts, scopedUserEntries } from '@/lib/offline-user-sync';
import { useOptionalOfflineSync } from '@/providers/offline-sync-provider';
import { useReceiptEdits } from '@/lib/use-offline-edits';
import { useOfflineUserSync } from '@/lib/use-offline-user-sync';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

type Timespan = '30-days' | 'this-year' | 'last-year' | 'all';

const timespanOptions: readonly FilterSelectOption<Timespan>[] = [
  { value: '30-days', label: '30 days' },
  { value: 'this-year', label: 'This year' },
  { value: 'last-year', label: 'Last year' },
  { value: 'all', label: 'All time' },
];

function formatMoney(cents: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function startFor(timespan: Timespan) {
  const now = new Date();
  if (timespan === '30-days') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  if (timespan === 'this-year') return new Date(now.getFullYear(), 0, 1);
  if (timespan === 'last-year') return new Date(now.getFullYear() - 1, 0, 1);
  return null;
}

export default function ReceiptsScreen() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const receiptList = useReceipts(member?.company.id ?? null);
  const { loading, refreshing, error, downloaded } = receiptList;
  // Offline edits/deletes saved on this device are shown on top; each applies only to an unchanged receipt.
  const edits = useReceiptEdits(receiptList.receipts, member, downloaded?.receiptWatermark);
  const receipts = edits.items;
  const { offline: deviceOffline, userSync } = useOfflineUserSync(member?.company.id, member?.user.id);
  const [timespan, setTimespan] = useState<Timespan>('this-year');
  const [crewId, setCrewId] = useState('all');
  const [projectFilter, setProjectFilter] = useState('');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const isOwner = member?.user.role === 'owner' || member?.user.role === 'admin';
  // Receipts saved on this device that the downloaded list does not include yet.
  const offlineEntries = useOptionalOfflineSync()?.state.entries;
  const saved = useMemo(() => member ? deviceReceipts(scopedUserEntries(offlineEntries ?? [], member.user.id, member.company.id)).filter((item) => !receipts.some((receipt) => receipt.id === item.id)) : [], [offlineEntries, member, receipts]);

  const crew = useMemo(() => {
    const people = new Map<string, string>();
    receipts.forEach((receipt) => people.set(receipt.uploadedBy, receipt.uploadedByName));
    return [...people].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
  }, [receipts]);

  const duplicates = useMemo(() => possibleDuplicateReceiptIds(receipts), [receipts]);
  const visible = useMemo(() => {
    const start = startFor(timespan);
    const end = timespan === 'last-year' ? new Date(new Date().getFullYear(), 0, 1) : null;
    return receipts.filter((receipt) => {
      const [year, month, day] = receiptDate(receipt).split('-').map(Number);
      const purchased = new Date(year, month - 1, day);
      return (!isOwner || crewId === 'all' || receipt.uploadedBy === crewId)
        && (!start || purchased >= start)
        && (!end || purchased < end)
        && matchesReceiptFilter(receipt, { project: projectFilter, query });
    }).sort((a, b) => receiptDate(b).localeCompare(receiptDate(a)) || b.createdAt.localeCompare(a.createdAt));
  }, [crewId, isOwner, projectFilter, query, receipts, timespan]);
  const projects = useMemo(() => receiptProjects(receipts), [receipts]);

  if (!session || access.status === 'error') return <Redirect href="/" />;

  const viewReceipt = async (receipt: CompanyReceipt) => {
    if (busyId) return;
    setBusyId(receipt.id);
    setActionError('');
    try {
      const url = await openReceipt(receipt);
      await Linking.openURL(url);
    } catch (openError) {
      setActionError(openError instanceof Error ? openError.message : 'Receipt could not be opened.');
    } finally {
      setBusyId('');
    }
  };

  const shareOne = async (receipt: CompanyReceipt) => {
    if (busyId) return;
    setBusyId(receipt.id);
    setActionError('');
    try {
      await shareReceiptZip(receipt);
    } catch (shareError) {
      setActionError(shareError instanceof Error ? shareError.message : 'Receipt could not be shared.');
    } finally {
      setBusyId('');
    }
  };

  const exportVisible = async () => {
    if (busyId || !visible.length) return;
    setBusyId('export');
    setActionError('');
    try {
      const result = await shareReceiptsZip(visible);
      if (result.warning) setActionError(result.warning);
    } catch (exportError) {
      setActionError(exportError instanceof Error ? exportError.message : 'Receipts could not be exported.');
    } finally {
      setBusyId('');
    }
  };

  const confirmDelete = (receipt: CompanyReceipt) => {
    if (!member || !isOwner || busyId) return;
    Alert.alert('Delete receipt?', `“${receipt.name}” and its uploaded file will be permanently deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        setBusyId(receipt.id);
        setActionError('');
        const seen = receiptList.receipts.find((item) => item.id === receipt.id) ?? receipt;
        void (deviceOffline ? (userSync ? userSync.deleteReceipt(receipt.id, edits.baseFor(receipt.id, { name: seen.name, amountCents: seen.amountCents, storagePath: seen.storagePath })) : Promise.reject(new Error('Deleting receipts offline is unavailable on this device.'))) : deleteReceipt(member.company.id, receipt))
          .catch((deleteError) => setActionError(deleteError instanceof Error ? deleteError.message : 'Receipt could not be deleted.'))
          .finally(() => setBusyId(''));
      } },
    ]);
  };

  const total = visible.reduce((sum, receipt) => sum + receipt.amountCents, 0);
  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <Stack.Screen options={{ title: 'Receipts' }} />
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshReceipts} tintColor={theme.commandForeground} />}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}><Text accessibilityRole="header" style={styles.title}>{isOwner ? 'Receipts' : 'My receipts'}</Text>{!isOwner ? <Text style={styles.subtitle}>Upload expense records and keep them ready for review.</Text> : null}</View>
        <View style={styles.headingActions}>
          {visible.length ? <Pressable accessibilityRole="button" accessibilityLabel="Export filtered receipts as ZIP" disabled={Boolean(busyId)} onPress={() => void exportVisible()} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}><AppSymbol name={{ ios: 'square.and.arrow.up', android: 'ios_share' } as never} color={theme.commandForeground} size={17} /><Text style={styles.secondaryText}>{busyId === 'export' ? 'Exporting…' : 'Export ZIP'}</Text></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Add receipt" onPress={() => router.push('/receipt/capture' as never)} style={({ pressed }) => [styles.add, pressed && styles.pressed]}><AppSymbol name={{ ios: 'plus', android: 'add' } as never} color="#FFFFFF" size={18} /><Text style={styles.addText}>Add</Text></Pressable>
        </View>
      </View>

      <View style={styles.summary}><View style={styles.summaryItem}><Text style={styles.summaryValue}>{visible.length}</Text><Text style={styles.summaryLabel}>receipts</Text></View><View style={styles.summaryRule} /><View style={styles.summaryItem}><Text style={styles.summaryValue}>{formatMoney(total)}</Text><Text style={styles.summaryLabel}>total</Text></View></View>

      {isOwner ? <View style={styles.filterGroup}><Text style={styles.filterLabel}>Crew member</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}><FilterChip label="All crew" selected={crewId === 'all'} onPress={() => setCrewId('all')} styles={styles} />{crew.map((person) => <FilterChip key={person.id} label={person.name} selected={crewId === person.id} onPress={() => setCrewId(person.id)} styles={styles} />)}</ScrollView></View> : null}
      <View style={styles.filterGroup}><Text style={styles.filterLabel}>Search</Text><TextInput accessibilityLabel="Search receipts" autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" onChangeText={setQuery} placeholder="Merchant, project, file" placeholderTextColor={theme.secondary} returnKeyType="search" style={styles.search} value={query} /></View>
      {projects.length ? <View style={styles.filterGroup}><Text style={styles.filterLabel}>Project</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}><FilterChip label="All projects" selected={!projectFilter} onPress={() => setProjectFilter('')} styles={styles} />{projects.map((item) => <FilterChip key={item} label={item} selected={projectFilter === item} onPress={() => setProjectFilter(item)} styles={styles} />)}</ScrollView></View> : null}
      <View style={styles.filterGroup}><Text style={styles.filterLabel}>Timespan</Text><FilterSelect accessibilityLabel="Receipt timespan" onChange={setTimespan} options={timespanOptions} value={timespan} /></View>

      <DownloadedListNotice info={downloaded} />
      {error ? <View style={styles.error}><Text style={styles.errorTitle}>Receipts unavailable</Text><Text style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" onPress={refreshReceipts} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
      {actionError ? <Text accessibilityRole="alert" style={styles.actionError}>{actionError}</Text> : null}
      {saved.length ? <View style={styles.list}>{saved.map((receipt, index) => <View key={receipt.id} style={[styles.row, index > 0 && styles.rowBorder]}><View style={styles.rowMain}><View style={styles.receiptIcon}><AppSymbol name={{ ios: 'icloud.and.arrow.up', android: 'cloud_upload' } as never} color={theme.secondary} size={21} /></View><View style={styles.rowCopy}><Text numberOfLines={1} style={styles.rowTitle}>{receipt.name}</Text><Text numberOfLines={2} style={styles.rowMeta}>{receipt.state === 'action_needed' ? 'Saved on this device — needs attention in Saved changes & sync' : receipt.state === 'posted' ? 'Uploaded — refreshing list' : 'Saved on this device — uploads when connected'}</Text><Text numberOfLines={1} style={styles.fileName}>{receipt.fileName}</Text></View><View style={styles.rowEnd}><Text style={styles.amount}>{formatMoney(receipt.amountCents)}</Text></View></View></View>)}</View> : null}
      {loading ? <Text style={styles.state}>Loading receipts…</Text> : null}
      {!loading && !error && !visible.length ? <View style={styles.empty}><View style={styles.emptyIcon}><AppSymbol name={{ ios: 'doc.text', android: 'receipt_long' } as never} color={theme.secondary} size={28} /></View><Text style={styles.emptyTitle}>No receipts found</Text><Text style={styles.emptyText}>{receipts.length ? 'Change filters to see more receipts.' : 'Tap Add to photograph receipts.'}</Text></View> : null}
      {!!visible.length ? <View style={styles.list}>{visible.map((receipt, index) => <View key={receipt.id} style={[styles.row, index > 0 && styles.rowBorder]}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${receipt.name}`} disabled={Boolean(busyId)} onPress={() => void viewReceipt(receipt)} style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}><View style={styles.receiptIcon}><AppSymbol name={{ ios: 'doc.text.fill', android: 'receipt_long' } as never} color={theme.commandForeground} size={21} /></View><View style={styles.rowCopy}><Text numberOfLines={1} style={styles.rowTitle}>{receipt.name}</Text><Text numberOfLines={1} style={styles.rowMeta}>{isOwner ? `${receipt.uploadedByName} · ` : ''}{formatCalendarDate(receiptDate(receipt))}{receipt.project ? ` · ${receipt.project}` : ''}</Text>{duplicates.has(receipt.id) ? <Text accessibilityLabel="Possible duplicate: same amount, uploader and day as another receipt" numberOfLines={1} style={styles.duplicate}>Possible duplicate</Text> : <Text numberOfLines={1} style={styles.fileName}>{receipt.fileName}</Text>}</View><View style={styles.rowEnd}><Text style={styles.amount}>{formatMoney(receipt.amountCents)}</Text><Text style={styles.openText}>{busyId === receipt.id ? 'Working…' : 'View'}</Text></View></Pressable><View style={styles.ownerActions}><Pressable accessibilityRole="button" accessibilityLabel={`Share ZIP for ${receipt.name}`} disabled={Boolean(busyId)} onPress={() => void shareOne(receipt)} style={({ pressed }) => [styles.ownerAction, pressed && styles.pressed]}><AppSymbol name={{ ios: 'square.and.arrow.up', android: 'ios_share' } as never} color={theme.commandForeground} size={17} /><Text style={styles.ownerActionText}>Share ZIP</Text></Pressable>{isOwner ? <><Pressable accessibilityRole="button" accessibilityLabel={`Edit ${receipt.name}`} disabled={Boolean(busyId)} onPress={() => router.push({ pathname: '/receipt/form', params: { receiptId: receipt.id } } as never)} style={({ pressed }) => [styles.ownerAction, pressed && styles.pressed]}><AppSymbol name={{ ios: 'pencil', android: 'edit' } as never} color={theme.commandForeground} size={17} /><Text style={styles.ownerActionText}>Edit</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Delete ${receipt.name}`} disabled={Boolean(busyId)} onPress={() => confirmDelete(receipt)} style={({ pressed }) => [styles.ownerAction, styles.deleteAction, pressed && styles.pressed]}><AppSymbol name={{ ios: 'trash', android: 'delete' } as never} color={theme.danger} size={17} /><Text style={styles.deleteActionText}>Delete</Text></Pressable></> : null}</View></View>)}</View> : null}
    </ScrollView>
  </SafeAreaView>;
}

function FilterChip({ label, selected, onPress, styles }: { label: string; selected: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.canvas }, content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 48, gap: 20 },
    heading: { flexDirection: 'row', alignItems: 'center', gap: 14 }, headingCopy: { flex: 1, gap: 6 }, headingActions: { flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { color: theme.ink, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7 }, subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 21 }, secondary: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 11, borderWidth: 1, borderColor: theme.divider, backgroundColor: theme.paper, paddingHorizontal: 12 }, secondaryText: { color: theme.commandForeground, fontSize: 13, fontWeight: '800' }, add: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 11, backgroundColor: theme.ember, paddingHorizontal: 14 }, addText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
    summary: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.command, borderRadius: 14, paddingVertical: 17 }, summaryItem: { flex: 1, alignItems: 'center', gap: 2 }, summaryValue: { color: theme.commandText, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }, summaryLabel: { color: theme.commandText, opacity: 0.72, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }, summaryRule: { width: StyleSheet.hairlineWidth, height: 35, backgroundColor: theme.commandText, opacity: 0.25 },
    filterGroup: { gap: 8 }, search: { minHeight: 44, borderWidth: 1, borderColor: theme.divider, borderRadius: 11, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 13, fontSize: 16 }, filterLabel: { color: theme.ink, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' }, chips: { gap: 8, paddingRight: 12 }, chip: { minHeight: 38, justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 999, backgroundColor: theme.paper, paddingHorizontal: 13 }, chipSelected: { borderColor: theme.ember, backgroundColor: theme.ember }, chipText: { color: theme.secondary, fontSize: 13, fontWeight: '700' }, chipTextSelected: { color: '#FFFFFF' },
    list: { overflow: 'hidden', borderWidth: 1, borderColor: theme.divider, borderRadius: 14, backgroundColor: theme.paper }, duplicate: { color: theme.warning, fontSize: 12, fontWeight: '700' }, row: { minHeight: 86 }, rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider }, rowMain: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 }, receiptIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: theme.surfaceAlt }, rowCopy: { flex: 1, gap: 3 }, rowTitle: { color: theme.ink, fontSize: 15, fontWeight: '700' }, rowMeta: { color: theme.secondary, fontSize: 11 }, fileName: { color: theme.secondary, fontSize: 10 }, rowEnd: { alignItems: 'flex-end', gap: 7 }, amount: { color: theme.ink, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }, openText: { color: theme.commandForeground, fontSize: 11, fontWeight: '800' }, ownerActions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider, marginHorizontal: 13, paddingVertical: 8, gap: 8 }, ownerAction: { minHeight: 38, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 9, backgroundColor: theme.surfaceAlt }, ownerActionText: { color: theme.commandForeground, fontSize: 12, fontWeight: '800' }, deleteAction: { backgroundColor: theme.dangerSurface }, deleteActionText: { color: theme.danger, fontSize: 12, fontWeight: '800' },
    error: { backgroundColor: theme.dangerSurface, padding: 15, borderRadius: 12, gap: 6 }, errorTitle: { color: theme.danger, fontSize: 16, fontWeight: '700' }, errorText: { color: theme.danger, fontSize: 13, lineHeight: 19 }, retry: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', borderRadius: 8, backgroundColor: theme.command, paddingHorizontal: 13 }, retryText: { color: theme.commandText, fontSize: 13, fontWeight: '700' }, actionError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 13, fontSize: 13 }, state: { color: theme.secondary, textAlign: 'center', paddingVertical: 32 },
    empty: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 42, gap: 8 }, emptyIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 28, backgroundColor: theme.surfaceAlt }, emptyTitle: { color: theme.ink, fontSize: 18, fontWeight: '700' }, emptyText: { color: theme.secondary, fontSize: 14, lineHeight: 20, textAlign: 'center' }, pressed: { opacity: 0.65 },
  });
}
