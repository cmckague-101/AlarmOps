import { useMemo, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import type { LocalFleetFile } from '@/lib/fleet-files';
import { createFleetId } from '@/lib/fleet-store';
import { createReceipt, effectiveMimeType, updateReceipt, useReceipts } from '@/lib/receipts-store';
import { useOptionalOfflineSync } from '@/providers/offline-sync-provider';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

function amountToCents(value: string) {
  const normalized = value.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [dollars, cents = ''] = normalized.split('.');
  const result = Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
  return Number.isSafeInteger(result) && result > 0 && result <= 100000000 ? result : null;
}

export default function ReceiptFormScreen() {
  const router = useRouter();
  const { receiptId } = useLocalSearchParams<{ receiptId?: string }>();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const { receipts, loading } = useReceipts(member?.company.id ?? null);
  const receipt = receiptId ? receipts.find((item) => item.id === receiptId) : undefined;
  const editing = Boolean(receiptId);
  const [name, setName] = useState<string | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [file, setFile] = useState<LocalFleetFile | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // Offline, the file is kept on this device and the receipt is created when connected.
  const offlineSync = useOptionalOfflineSync();
  const offline = !!offlineSync?.offline;
  const userSync = offlineSync?.userSync && member && offlineSync.userSync.scope.companyId === member.company.id && offlineSync.userSync.scope.userId === member.user.id ? offlineSync.userSync : null;
  const offlineId = useRef(createFleetId());
  const resolvedName = name ?? receipt?.name ?? '';
  const resolvedAmount = amount ?? (receipt ? (receipt.amountCents / 100).toFixed(2) : '');
  const amountCents = amountToCents(resolvedAmount);

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (editing && member && member.user.role !== 'owner' && member.user.role !== 'admin') return <Redirect href="/receipts" />;
  if (editing && !loading && !receipt) return <Redirect href="/receipts" />;

  const chooseFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: false });
    if (result.canceled) return;
    const asset = result.assets[0];
    setFile({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? null });
    setSaveError('');
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setSaveError('Camera permission is required to photograph a receipt.'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setFile({ uri: asset.uri, name: asset.fileName ?? `receipt-${Date.now()}.jpg`, type: asset.mimeType ?? 'image/jpeg' });
    setSaveError('');
  };

  const submit = async () => {
    setAttempted(true);
    if (!member || !resolvedName.trim() || amountCents === null || (!editing && !file) || (editing && !receipt) || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      if (editing && receipt) await updateReceipt(member.company.id, receipt.id, resolvedName, amountCents);
      else if (file && offline) {
        if (!userSync) throw new Error('Saving receipts offline is unavailable on this device.');
        await userSync.createReceipt({ id: offlineId.current, name: resolvedName, amountCents, fileName: file.name, mimeType: effectiveMimeType(file) }, file.uri);
      } else if (file) await createReceipt(member.company.id, member.user.id, member.user.name, resolvedName, amountCents, file);
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
        <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>{editing ? 'Edit expense receipt' : 'Upload expense receipt'}</Text><Text style={styles.subtitle}>{editing ? 'Correct receipt name or amount. Uploaded file and date stay unchanged.' : 'Add name, amount, and receipt image or PDF. Upload date is recorded automatically.'}</Text></View>

        <View style={styles.field}><Text style={styles.label}>Name</Text><TextInput accessibilityLabel="Receipt name" autoFocus maxLength={160} onChangeText={setName} placeholder="Fuel at Station 12" placeholderTextColor={theme.secondary} style={[styles.input, attempted && !resolvedName.trim() && styles.inputError]} value={resolvedName} />{attempted && !resolvedName.trim() ? <Text style={styles.fieldError}>Enter receipt name.</Text> : null}</View>
        <View style={styles.field}><Text style={styles.label}>Amount</Text><View style={[styles.moneyInput, attempted && amountCents === null && styles.inputError]}><Text style={styles.currency}>$</Text><TextInput accessibilityLabel="Receipt amount" inputMode="decimal" keyboardType="decimal-pad" onChangeText={setAmount} placeholder="0.00" placeholderTextColor={theme.secondary} style={styles.moneyText} value={resolvedAmount} /></View>{attempted && amountCents === null ? <Text style={styles.fieldError}>Enter valid amount.</Text> : null}</View>

        {!editing ? <View style={styles.field}><Text style={styles.label}>Receipt file</Text><View style={[styles.fileCard, attempted && !file && styles.inputError]}><View style={styles.fileIcon}><AppSymbol name={{ ios: file ? 'doc.fill' : 'doc.badge.plus', android: file ? 'description' : 'note_add' } as never} color={file ? theme.green : theme.secondary} size={25} /></View><View style={styles.fileCopy}><Text numberOfLines={1} style={styles.fileTitle}>{file?.name ?? 'No receipt selected'}</Text><Text style={styles.fileHelp}>{file ? (offline ? 'Offline — kept on this device and uploaded when connected' : 'Ready to upload') : 'Image or PDF · maximum 10 MB'}</Text></View></View>{attempted && !file ? <Text style={styles.fieldError}>Photograph or choose receipt file.</Text> : null}<View style={styles.fileActions}><Pressable accessibilityRole="button" disabled={saving} onPress={() => void takePhoto()} style={({ pressed }) => [styles.fileButton, pressed && styles.pressed]}><AppSymbol name={{ ios: 'camera', android: 'photo_camera' } as never} color={theme.ink} size={19} /><Text style={styles.fileButtonText}>Camera</Text></Pressable><Pressable accessibilityRole="button" disabled={saving} onPress={() => void chooseFile()} style={({ pressed }) => [styles.fileButton, pressed && styles.pressed]}><AppSymbol name={{ ios: 'folder', android: 'folder' } as never} color={theme.ink} size={19} /><Text style={styles.fileButtonText}>Choose file</Text></Pressable></View>{file ? <Pressable accessibilityRole="button" onPress={() => setFile(null)} style={styles.remove}><Text style={styles.removeText}>Remove selected file</Text></Pressable> : null}</View> : receipt ? <View style={styles.field}><Text style={styles.label}>Receipt file</Text><View style={styles.fileCard}><View style={styles.fileIcon}><AppSymbol name={{ ios: 'doc.fill', android: 'description' } as never} color={theme.green} size={25} /></View><View style={styles.fileCopy}><Text numberOfLines={1} style={styles.fileTitle}>{receipt.fileName}</Text><Text style={styles.fileHelp}>Uploaded file stays unchanged</Text></View></View></View> : null}

        <View style={styles.dateNote}><AppSymbol name={{ ios: 'calendar', android: 'calendar_today' } as never} color={theme.secondary} size={18} /><Text style={styles.dateText}>{editing && receipt ? `Uploaded ${new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(receipt.createdAt))}` : `Upload date: ${new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date())}`}</Text></View>
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
    dateNote: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 11, backgroundColor: theme.surfaceAlt, paddingHorizontal: 14 }, dateText: { color: theme.secondary, fontSize: 13, fontWeight: '600' }, saveError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 13, fontSize: 14, lineHeight: 20 }, submit: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.ember }, submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' }, pressed: { opacity: 0.68 }, disabled: { opacity: 0.5 },
  });
}
