import { useMemo, useState } from 'react';
import { Redirect, Stack, useRouter } from 'expo-router';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { openReceipt, refreshReceipts, useReceipts, type CompanyReceipt } from '@/lib/receipts-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

type Timespan = '30-days' | 'this-year' | 'last-year' | 'all';

function formatMoney(cents: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);
}

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

export default function ReceiptsScreen() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const { receipts, loading, refreshing, error } = useReceipts(member?.company.id ?? null);
  const [timespan, setTimespan] = useState<Timespan>('this-year');
  const [crewId, setCrewId] = useState('all');
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const isOwner = member?.user.role === 'owner';

  const crew = useMemo(() => {
    const people = new Map<string, string>();
    receipts.forEach((receipt) => people.set(receipt.uploadedBy, receipt.uploadedByName));
    return [...people].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
  }, [receipts]);

  const visible = useMemo(() => {
    const start = startFor(timespan);
    const end = timespan === 'last-year' ? new Date(new Date().getFullYear(), 0, 1) : null;
    return receipts.filter((receipt) => {
      const created = new Date(receipt.createdAt);
      return (!isOwner || crewId === 'all' || receipt.uploadedBy === crewId)
        && (!start || created >= start)
        && (!end || created < end);
    });
  }, [crewId, isOwner, receipts, timespan]);

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

  const total = visible.reduce((sum, receipt) => sum + receipt.amountCents, 0);
  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <Stack.Screen options={{ title: 'Receipts' }} />
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshReceipts} tintColor={theme.commandForeground} />}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}><Text accessibilityRole="header" style={styles.title}>{isOwner ? 'Receipts' : 'My receipts'}</Text><Text style={styles.subtitle}>{isOwner ? 'Review expense receipts submitted by crew.' : 'Upload expense records and keep them ready for review.'}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Add receipt" onPress={() => router.push('/receipt/form' as never)} style={({ pressed }) => [styles.add, pressed && styles.pressed]}><AppSymbol name={{ ios: 'plus', android: 'add' } as never} color="#FFFFFF" size={18} /><Text style={styles.addText}>Add</Text></Pressable>
      </View>

      <View style={styles.summary}><View style={styles.summaryItem}><Text style={styles.summaryValue}>{visible.length}</Text><Text style={styles.summaryLabel}>receipts</Text></View><View style={styles.summaryRule} /><View style={styles.summaryItem}><Text style={styles.summaryValue}>{formatMoney(total)}</Text><Text style={styles.summaryLabel}>total</Text></View></View>

      {isOwner ? <View style={styles.filterGroup}><Text style={styles.filterLabel}>Crew member</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}><FilterChip label="All crew" selected={crewId === 'all'} onPress={() => setCrewId('all')} styles={styles} />{crew.map((person) => <FilterChip key={person.id} label={person.name} selected={crewId === person.id} onPress={() => setCrewId(person.id)} styles={styles} />)}</ScrollView></View> : null}
      <View style={styles.filterGroup}><Text style={styles.filterLabel}>Timespan</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{([['30-days', '30 days'], ['this-year', 'This year'], ['last-year', 'Last year'], ['all', 'All time']] as [Timespan, string][]).map(([value, label]) => <FilterChip key={value} label={label} selected={timespan === value} onPress={() => setTimespan(value)} styles={styles} />)}</ScrollView></View>

      {error ? <View style={styles.error}><Text style={styles.errorTitle}>Receipts unavailable</Text><Text style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" onPress={refreshReceipts} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
      {actionError ? <Text accessibilityRole="alert" style={styles.actionError}>{actionError}</Text> : null}
      {loading ? <Text style={styles.state}>Loading receipts…</Text> : null}
      {!loading && !error && !visible.length ? <View style={styles.empty}><View style={styles.emptyIcon}><AppSymbol name={{ ios: 'doc.text', android: 'receipt_long' } as never} color={theme.secondary} size={28} /></View><Text style={styles.emptyTitle}>No receipts found</Text><Text style={styles.emptyText}>{receipts.length ? 'Change filters to see more receipts.' : 'Tap Add to upload first receipt.'}</Text></View> : null}
      {!!visible.length ? <View style={styles.list}>{visible.map((receipt, index) => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${receipt.name}`} disabled={Boolean(busyId)} key={receipt.id} onPress={() => void viewReceipt(receipt)} style={({ pressed }) => [styles.row, index > 0 && styles.rowBorder, pressed && styles.pressed]}><View style={styles.receiptIcon}><AppSymbol name={{ ios: 'doc.text.fill', android: 'receipt_long' } as never} color={theme.commandForeground} size={21} /></View><View style={styles.rowCopy}><Text numberOfLines={1} style={styles.rowTitle}>{receipt.name}</Text><Text numberOfLines={1} style={styles.rowMeta}>{isOwner ? `${receipt.uploadedByName} · ` : ''}{formatDate(receipt.createdAt)}</Text><Text numberOfLines={1} style={styles.fileName}>{receipt.fileName}</Text></View><View style={styles.rowEnd}><Text style={styles.amount}>{formatMoney(receipt.amountCents)}</Text><Text style={styles.openText}>{busyId === receipt.id ? 'Opening…' : 'View'}</Text></View></Pressable>)}</View> : null}
    </ScrollView>
  </SafeAreaView>;
}

function FilterChip({ label, selected, onPress, styles }: { label: string; selected: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>;
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.canvas }, content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 48, gap: 20 },
    heading: { flexDirection: 'row', alignItems: 'center', gap: 14 }, headingCopy: { flex: 1, gap: 6 }, title: { color: theme.ink, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7 }, subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 21 }, add: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 11, backgroundColor: theme.ember, paddingHorizontal: 14 }, addText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
    summary: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.command, borderRadius: 14, paddingVertical: 17 }, summaryItem: { flex: 1, alignItems: 'center', gap: 2 }, summaryValue: { color: theme.commandText, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }, summaryLabel: { color: theme.commandText, opacity: 0.72, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }, summaryRule: { width: StyleSheet.hairlineWidth, height: 35, backgroundColor: theme.commandText, opacity: 0.25 },
    filterGroup: { gap: 8 }, filterLabel: { color: theme.ink, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' }, chips: { gap: 8, paddingRight: 12 }, chip: { minHeight: 38, justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 999, backgroundColor: theme.paper, paddingHorizontal: 13 }, chipSelected: { borderColor: theme.command, backgroundColor: theme.command }, chipText: { color: theme.secondary, fontSize: 13, fontWeight: '700' }, chipTextSelected: { color: theme.commandText },
    list: { overflow: 'hidden', borderWidth: 1, borderColor: theme.divider, borderRadius: 14, backgroundColor: theme.paper }, row: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13 }, rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider }, receiptIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: theme.surfaceAlt }, rowCopy: { flex: 1, gap: 3 }, rowTitle: { color: theme.ink, fontSize: 15, fontWeight: '700' }, rowMeta: { color: theme.secondary, fontSize: 11 }, fileName: { color: theme.secondary, fontSize: 10 }, rowEnd: { alignItems: 'flex-end', gap: 7 }, amount: { color: theme.ink, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }, openText: { color: theme.commandForeground, fontSize: 11, fontWeight: '800' },
    error: { backgroundColor: theme.dangerSurface, padding: 15, borderRadius: 12, gap: 6 }, errorTitle: { color: theme.danger, fontSize: 16, fontWeight: '700' }, errorText: { color: theme.danger, fontSize: 13, lineHeight: 19 }, retry: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', borderRadius: 8, backgroundColor: theme.command, paddingHorizontal: 13 }, retryText: { color: theme.commandText, fontSize: 13, fontWeight: '700' }, actionError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 13, fontSize: 13 }, state: { color: theme.secondary, textAlign: 'center', paddingVertical: 32 },
    empty: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 42, gap: 8 }, emptyIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 28, backgroundColor: theme.surfaceAlt }, emptyTitle: { color: theme.ink, fontSize: 18, fontWeight: '700' }, emptyText: { color: theme.secondary, fontSize: 14, lineHeight: 20, textAlign: 'center' }, pressed: { opacity: 0.65 },
  });
}
