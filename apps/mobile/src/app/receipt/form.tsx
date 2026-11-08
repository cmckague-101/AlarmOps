import { useMemo, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { MAX_RECEIPT_PROJECT_LENGTH, formatCalendarDate, normalizeReceiptProject, receiptAmountToCents, receiptDate } from '@fireops/domain';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { updateReceipt, useReceipts } from '@/lib/receipts-store';
import { useOptionalOfflineSync } from '@/providers/offline-sync-provider';
import { useReceiptEdits } from '@/lib/use-offline-edits';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateFromIso(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return year ? new Date(year, month - 1, day) : new Date();
}

export default function ReceiptFormScreen() {
  const router = useRouter();
  const { receiptId } = useLocalSearchParams<{ receiptId?: string }>();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const receiptList = useReceipts(member?.company.id ?? null);
  const { loading } = receiptList;
  // Offline edits saved on this device are shown and apply only to an unchanged receipt.
  const edits = useReceiptEdits(receiptList.receipts, member, receiptList.downloaded?.receiptWatermark);
  const receipts = edits.items;
  const receipt = receiptId ? receipts.find((item) => item.id === receiptId) : undefined;
  const editing = Boolean(receiptId);
  const [name, setName] = useState<string | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [purchasedOn, setPurchasedOn] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // Offline, the file is kept on this device and the receipt is created when connected.
  const offlineSync = useOptionalOfflineSync();
  const offline = !!offlineSync?.offline;
  const userSync = offlineSync?.userSync && member && offlineSync.userSync.scope.companyId === member.company.id && offlineSync.userSync.scope.userId === member.user.id ? offlineSync.userSync : null;
  const resolvedName = name ?? receipt?.name ?? '';
  const resolvedAmount = amount ?? (receipt ? (receipt.amountCents / 100).toFixed(2) : '');
  const resolvedProject = project ?? receipt?.project ?? '';
  const amountCents = receiptAmountToCents(resolvedAmount);
  const resolvedDate = purchasedOn ?? (receipt ? receiptDate(receipt) : isoDate(new Date()));
  // Offline edits only carry name and amount, so the date and project are fixed while editing offline.
  const dateLocked = offline;

  if (!session || access.status === 'error') return <Redirect href="/" />;
  // New receipts are added in batches on the capture screen.
  if (!editing) return <Redirect href={'/receipt/capture' as never} />;
  if (editing && member && member.user.role !== 'owner' && member.user.role !== 'admin') return <Redirect href="/receipts" />;
  if (editing && !loading && !receipt) return <Redirect href="/receipts" />;

  const submit = async () => {
    setAttempted(true);
    if (!member || !resolvedName.trim() || amountCents === null || !receipt || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      if (offline) {
        if (!userSync) throw new Error('Editing receipts offline is unavailable on this device.');
        const seen = receiptList.receipts.find((item) => item.id === receipt.id) ?? receipt;
        await userSync.updateReceipt(receipt.id, { name: resolvedName, amountCents }, edits.baseFor(receipt.id, { name: seen.name, amountCents: seen.amountCents, storagePath: seen.storagePath }));
      } else {
        const nextProject = normalizeReceiptProject(resolvedProject);
        await updateReceipt(member.company.id, receipt.id, resolvedName, amountCents, purchasedOn ?? undefined, nextProject !== normalizeReceiptProject(receipt.project) ? nextProject ?? null : undefined);
      }
      router.back();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : `Receipt could not be ${editing ? 'updated' : 'uploaded'}. Check connection and try again.`);
    } finally {
      setSaving(false);
    }
  };

  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <Stack.Screen options={{ title: editing ? 'Edit receipt' : 'Add receipt' }} />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>{editing ? 'Edit expense receipt' : 'Upload expense receipt'}</Text><Text style={styles.subtitle}>Correct the receipt name, amount, project or date. The uploaded file stays unchanged.</Text></View>

        <View style={styles.field}><Text style={styles.label}>Name</Text><TextInput accessibilityLabel="Receipt name" autoFocus maxLength={160} onChangeText={setName} placeholder="Fuel at Station 12" placeholderTextColor={theme.secondary} style={[styles.input, attempted && !resolvedName.trim() && styles.inputError]} value={resolvedName} />{attempted && !resolvedName.trim() ? <Text style={styles.fieldError}>Enter receipt name.</Text> : null}</View>
        <View style={styles.field}><Text style={styles.label}>Amount</Text><View style={[styles.moneyInput, attempted && amountCents === null && styles.inputError]}><Text style={styles.currency}>$</Text><TextInput accessibilityLabel="Receipt amount" inputMode="decimal" keyboardType="decimal-pad" onChangeText={setAmount} placeholder="0.00" placeholderTextColor={theme.secondary} style={styles.moneyText} value={resolvedAmount} /></View>{attempted && amountCents === null ? <Text style={styles.fieldError}>Enter valid amount.</Text> : null}</View>

        <View style={styles.field}><Text style={styles.label}>Project</Text><TextInput accessibilityLabel="Receipt project" editable={!offline} maxLength={MAX_RECEIPT_PROJECT_LENGTH} onChangeText={setProject} placeholder="Optional" placeholderTextColor={theme.secondary} style={[styles.input, offline && styles.disabledField]} value={resolvedProject} />{offline ? <Text style={styles.dateText}>The project can be changed when online.</Text> : null}</View>
        {receipt ? <View style={styles.field}><Text style={styles.label}>Receipt file</Text><View style={styles.fileCard}><View style={styles.fileIcon}><AppSymbol name={{ ios: 'doc.fill', android: 'description' } as never} color={theme.green} size={25} /></View><View style={styles.fileCopy}><Text numberOfLines={1} style={styles.fileTitle}>{receipt.fileName}</Text><Text style={styles.fileHelp}>Uploaded file stays unchanged</Text></View></View></View> : null}

        <View style={styles.field}><Text style={styles.label}>Purchase date</Text><Pressable accessibilityRole="button" accessibilityLabel={`Purchase date, ${formatCalendarDate(resolvedDate)}`} disabled={dateLocked} onPress={() => setDatePickerOpen((open) => !open)} style={[styles.dateNote, dateLocked && styles.disabledField]}><AppSymbol name={{ ios: 'calendar', android: 'calendar_today' } as never} color={theme.secondary} size={18} /><Text style={styles.dateValue}>{formatCalendarDate(resolvedDate)}</Text></Pressable>{datePickerOpen && !dateLocked ? <><DateTimePicker value={dateFromIso(resolvedDate)} mode="date" maximumDate={new Date()} display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={(event, date) => { if (Platform.OS !== 'ios') setDatePickerOpen(false); if (event.type === 'set' && date) setPurchasedOn(isoDate(date)); }} />{Platform.OS === 'ios' ? <Pressable accessibilityRole="button" onPress={() => setDatePickerOpen(false)} style={styles.dateDone}><Text style={styles.dateDoneText}>Done</Text></Pressable> : null}</> : null}<Text style={styles.dateText}>{dateLocked ? 'The purchase date can be changed when online.' : editing && receipt ? `Uploaded ${new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(receipt.createdAt))}` : 'The day the expense was paid.'}</Text></View>
        {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}
        <Pressable accessibilityRole="button" disabled={saving || (editing && !receipt)} onPress={() => void submit()} style={({ pressed }) => [styles.submit, (saving || (editing && !receipt)) && styles.disabled, pressed && !saving && styles.pressed]}><Text style={styles.submitText}>{saving ? (editing ? 'Saving…' : 'Uploading…') : (editing ? 'Save changes' : offline ? 'Save on this device' : 'Upload receipt')}</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    flex: { flex: 1 }, safe: { flex: 1, backgroundColor: theme.canvas }, content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48, gap: 25 }, heading: { gap: 7 }, title: { color: theme.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 }, subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    field: { gap: 9 }, label: { color: theme.ink, fontSize: 15, fontWeight: '700' }, input: { minHeight: 50, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 14, fontSize: 16 }, inputError: { borderColor: theme.danger }, fieldError: { color: theme.danger, fontSize: 13 },
    moneyInput: { minHeight: 50, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper }, currency: { color: theme.secondary, paddingLeft: 14, fontSize: 16, fontWeight: '700' }, moneyText: { flex: 1, minHeight: 48, color: theme.ink, paddingHorizontal: 8, fontSize: 16, fontVariant: ['tabular-nums'] },
    fileCard: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, padding: 13 }, fileIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: theme.surfaceAlt }, fileCopy: { flex: 1, gap: 4 }, fileTitle: { color: theme.ink, fontSize: 15, fontWeight: '700' }, fileHelp: { color: theme.secondary, fontSize: 12 }, fileActions: { flexDirection: 'row', gap: 10 }, fileButton: { minHeight: 46, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: theme.divider, borderRadius: 11, backgroundColor: theme.paper }, fileButtonText: { color: theme.ink, fontSize: 14, fontWeight: '700' }, remove: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' }, removeText: { color: theme.danger, fontSize: 13, fontWeight: '700' },
    dateNote: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 11, backgroundColor: theme.surfaceAlt, paddingHorizontal: 14 }, dateText: { color: theme.secondary, fontSize: 13, fontWeight: '600' }, dateValue: { color: theme.ink, fontSize: 16, fontWeight: '600' }, disabledField: { opacity: 0.6 }, dateDone: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, dateDoneText: { color: theme.ember, fontSize: 15, fontWeight: '700' }, saveError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 13, fontSize: 14, lineHeight: 20 }, submit: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.ember }, submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' }, pressed: { opacity: 0.68 }, disabled: { opacity: 0.5 },
  });
}
