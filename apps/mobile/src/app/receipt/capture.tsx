import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  MAX_RECEIPT_BATCH, MAX_RECEIPT_PROJECT_LENGTH, applyReceiptAutofill, failReceiptAutofill, formatCalendarDate, newReceiptDraft, normalizeReceiptProject,
  receiptAmountToCents, receiptDraftProblems, receiptDraftReady, receiptProjects, type ReceiptDraft,
} from '@fireops/domain';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, Stack, useRouter } from 'expo-router';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import type { LocalFleetFile } from '@/lib/fleet-files';
import { createFleetId } from '@/lib/fleet-store';
import { autofillMimeTypes, createReceipt, effectiveMimeType, loadReceiptAutofillEnabled, requestReceiptAutofill, useReceipts } from '@/lib/receipts-store';
import { useOfflineUserSync } from '@/lib/use-offline-user-sync';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

const acceptedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const maxFileSize = 10 * 1024 * 1024;
/** Auto-fill requests running at once for one batch. */
const autofillConcurrency = 3;

/** A staged receipt: editable details plus the device file it will upload. `key` doubles as the offline receipt ID. */
type PhotoCard = ReceiptDraft & { file: LocalFleetFile; mimeType: string; size: number | null; uploadError?: string };

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateFromIso(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return year ? new Date(year, month - 1, day) : new Date();
}

export default function ReceiptCaptureScreen() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const companyId = member?.company.id ?? null;
  const { receipts } = useReceipts(companyId);
  const { offline, userSync } = useOfflineUserSync(companyId, member?.user.id);
  const [project, setProject] = useState('');
  const [cards, setCards] = useState<PhotoCard[]>([]);
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [dateOpenKey, setDateOpenKey] = useState('');
  const [autofillEnabled, setAutofillEnabled] = useState(false);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const queue = useRef<string[]>([]);
  const running = useRef(0);
  const today = isoDate(new Date());
  const projects = useMemo(() => receiptProjects(receipts), [receipts]);
  const projectSuggestions = useMemo(() => {
    const typed = project.trim().toLowerCase();
    return projects.filter((item) => item.toLowerCase() !== typed && (!typed || item.toLowerCase().includes(typed))).slice(0, 6);
  }, [project, projects]);
  const autofillOn = autofillEnabled && !offline;

  useEffect(() => {
    let active = true;
    setAutofillEnabled(false);
    if (companyId && !offline) void loadReceiptAutofillEnabled(companyId).then((enabled) => { if (active) setAutofillEnabled(enabled); });
    return () => { active = false; };
  }, [companyId, offline]);

  const updateCard = useCallback((key: string, update: (card: PhotoCard) => PhotoCard) => {
    setCards((current) => current.map((card) => card.key === key ? update(card) : card));
  }, []);

  const pump = useCallback(() => {
    while (companyId && running.current < autofillConcurrency && queue.current.length) {
      const key = queue.current.shift()!;
      const card = cardsRef.current.find((item) => item.key === key);
      if (!card) continue;
      running.current += 1;
      void requestReceiptAutofill(companyId, card.file.uri, card.mimeType)
        .then((result) => updateCard(key, (current) => applyReceiptAutofill(current, result, isoDate(new Date()))))
        .catch((error: unknown) => updateCard(key, (current) => failReceiptAutofill(current, error instanceof Error ? error.message : 'Auto-fill could not read this photo. Enter the details.')))
        .finally(() => { running.current -= 1; pump(); });
    }
  }, [companyId, updateCard]);

  /** Stage picked files as cards; returns how many more fit in the batch. */
  const addFiles = (files: LocalFleetFile[], sizes: (number | null)[]) => {
    const room = MAX_RECEIPT_BATCH - cardsRef.current.length;
    const rejected: string[] = [];
    const created: PhotoCard[] = [];
    files.forEach((file, index) => {
      const mimeType = effectiveMimeType(file);
      const size = sizes[index] ?? null;
      if (!acceptedTypes.includes(mimeType)) { rejected.push(`“${file.name}” is not a JPG, PNG, WebP, HEIC, or PDF.`); return; }
      if (size !== null && size > maxFileSize) { rejected.push(`“${file.name}” is larger than 10 MB.`); return; }
      if (created.length >= room) { if (!rejected.some((item) => item.startsWith('Up to'))) rejected.push(`Up to ${MAX_RECEIPT_BATCH} receipts per batch. Submit these first, then add the rest.`); return; }
      const reading = autofillOn && autofillMimeTypes.includes(mimeType);
      created.push({ ...newReceiptDraft(createFleetId(), isoDate(new Date()), reading), file, mimeType, size });
    });
    setNotice(rejected.join(' '));
    setSaveError('');
    if (created.length) {
      cardsRef.current = [...cardsRef.current, ...created];
      setCards(cardsRef.current);
      queue.current.push(...created.filter((card) => card.status === 'reading').map((card) => card.key));
      pump();
    }
    return room - created.length;
  };

  /** Camera stays open for the next receipt until the person cancels or the batch is full. */
  const takePhotos = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setSaveError('Camera permission is required to photograph receipts.'); return; }
    for (;;) {
      if (cardsRef.current.length >= MAX_RECEIPT_BATCH) break;
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (result.canceled) break;
      const asset = result.assets[0];
      const left = addFiles([{ uri: asset.uri, name: asset.fileName ?? `receipt-${Date.now()}.jpg`, type: asset.mimeType ?? 'image/jpeg' }], [asset.fileSize ?? null]);
      if (left <= 0) break;
    }
  };

  const choosePhotos = async () => {
    const room = MAX_RECEIPT_BATCH - cardsRef.current.length;
    if (room <= 0) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, quality: 0.7, orderedSelection: true });
    if (result.canceled) return;
    addFiles(result.assets.map((asset, index) => ({ uri: asset.uri, name: asset.fileName ?? `receipt-${Date.now()}-${index + 1}.jpg`, type: asset.mimeType ?? null })), result.assets.map((asset) => asset.fileSize ?? null));
  };

  const chooseFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: true });
    if (result.canceled) return;
    addFiles(result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? null })), result.assets.map((asset) => asset.size ?? null));
  };

  const removeCard = (key: string) => {
    queue.current = queue.current.filter((item) => item !== key);
    setCards((current) => current.filter((card) => card.key !== key));
  };

  const retry = (key: string) => {
    updateCard(key, (card) => ({ ...card, status: 'reading', note: undefined }));
    queue.current.push(key);
    pump();
  };

  const readingCount = cards.filter((card) => card.status === 'reading').length;
  const readyCount = cards.filter((card) => receiptDraftReady(card, today)).length;

  if (!session || access.status === 'error') return <Redirect href="/" />;

  const submit = async () => {
    setAttempted(true);
    if (!member || saving || !cards.length) return;
    if (readingCount) { setSaveError('Auto-fill is still reading receipts. Wait a moment, then submit.'); return; }
    if (readyCount !== cards.length) { setSaveError('Review each card: every receipt needs a merchant, amount and date, and auto-filled cards must be confirmed.'); return; }
    if (offline && !userSync) { setSaveError('Saving receipts offline is unavailable on this device.'); return; }
    const batchProject = normalizeReceiptProject(project);
    setSaving(true);
    setSaveError('');
    setCards((current) => current.map((card) => card.uploadError ? { ...card, uploadError: undefined } : card));
    let failed = 0;
    let submitted = 0;
    // One storage object and one receipt per card; a failed card stays staged to retry.
    for (const card of cardsRef.current) {
      const amountCents = receiptAmountToCents(card.amount)!;
      try {
        if (offline) await userSync!.createReceipt({ id: card.key, name: card.merchant, amountCents, fileName: card.file.name, mimeType: card.mimeType, purchasedOn: card.purchasedOn, project: batchProject }, card.file.uri);
        else await createReceipt(member.company.id, member.user.id, member.user.name, card.merchant, amountCents, card.file, card.purchasedOn, batchProject);
        submitted += 1;
        setCards((current) => current.filter((item) => item.key !== card.key));
      } catch (error) {
        failed += 1;
        updateCard(card.key, (current) => ({ ...current, uploadError: error instanceof Error ? error.message : 'Receipt could not be uploaded.' }));
      }
    }
    setSaving(false);
    if (failed) setSaveError(`${failed} ${failed === 1 ? 'receipt' : 'receipts'} could not ${offline ? 'be saved' : 'upload'}. ${submitted ? `${submitted} ${offline ? 'saved' : 'submitted'}. ` : ''}Check the cards and submit again.`);
    else router.back();
  };

  const full = cards.length >= MAX_RECEIPT_BATCH;
  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <Stack.Screen options={{ title: 'Add receipts' }} />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>Add receipts</Text>
          <Text style={styles.subtitle}>{offline ? 'Offline: receipts are kept on this device and upload when connected.' : autofillOn ? 'Photograph each receipt. Auto-fill reads the merchant, date and amount; check each card before submitting.' : 'Photograph each receipt or choose files, then enter the merchant, date and amount on each card.'}</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Project <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput accessibilityLabel="Project" editable={!saving} maxLength={MAX_RECEIPT_PROJECT_LENGTH} onChangeText={setProject} placeholder="Pine Valley Fire" placeholderTextColor={theme.secondary} style={styles.input} value={project} />
          {projectSuggestions.length ? <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{projectSuggestions.map((item) => <Pressable key={item} accessibilityRole="button" accessibilityLabel={`Use project ${item}`} onPress={() => setProject(item)} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}><Text style={styles.chipText}>{item}</Text></Pressable>)}</ScrollView> : null}
          <Text style={styles.help}>Applies to every receipt in this batch.</Text>
        </View>

        <View style={styles.captureActions}>
          <Pressable accessibilityRole="button" disabled={saving || full} onPress={() => void takePhotos()} style={({ pressed }) => [styles.primaryAction, (saving || full) && styles.disabled, pressed && styles.pressed]}><AppSymbol name={{ ios: 'camera.fill', android: 'photo_camera' } as never} color="#FFFFFF" size={20} /><Text style={styles.primaryActionText}>{cards.length ? 'Take more photos' : 'Take photos'}</Text></Pressable>
          <View style={styles.secondaryRow}>
            <Pressable accessibilityRole="button" disabled={saving || full} onPress={() => void choosePhotos()} style={({ pressed }) => [styles.secondaryAction, (saving || full) && styles.disabled, pressed && styles.pressed]}><AppSymbol name={{ ios: 'photo.on.rectangle', android: 'photo_library' } as never} color={theme.ink} size={18} /><Text style={styles.secondaryActionText}>Photos</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={saving || full} onPress={() => void chooseFiles()} style={({ pressed }) => [styles.secondaryAction, (saving || full) && styles.disabled, pressed && styles.pressed]}><AppSymbol name={{ ios: 'folder', android: 'folder' } as never} color={theme.ink} size={18} /><Text style={styles.secondaryActionText}>Files</Text></Pressable>
          </View>
          <Text style={styles.help}>{cards.length} of {MAX_RECEIPT_BATCH} receipts{autofillOn ? ' · the camera stays open for the next receipt until you cancel' : ''}</Text>
        </View>
        {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}

        {!cards.length ? <View style={styles.empty}><View style={styles.emptyIcon}><AppSymbol name={{ ios: 'camera', android: 'photo_camera' } as never} color={theme.secondary} size={28} /></View><Text style={styles.emptyTitle}>No receipts added yet</Text><Text style={styles.emptyText}>Take photos one after another, or choose up to {MAX_RECEIPT_BATCH} photos or PDFs. Each becomes a card to check before submitting.</Text></View> : null}

        {cards.map((card, index) => {
          const problems = attempted || card.autofilled ? receiptDraftProblems(card, today) : {};
          const ready = receiptDraftReady(card, today);
          const label = `Receipt ${index + 1}`;
          const image = card.mimeType.startsWith('image/') && card.mimeType !== 'image/heic' && card.mimeType !== 'image/heif';
          return <View key={card.key} accessibilityLabel={label} style={[styles.card, card.uploadError ? styles.cardError : ready ? styles.cardReady : card.autofilled && !card.confirmed ? styles.cardReview : null]}>
            <View style={styles.cardTop}>
              {image ? <Image accessibilityLabel={`${label} photo`} source={{ uri: card.file.uri }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbFile]}><AppSymbol name={{ ios: 'doc.fill', android: 'description' } as never} color={theme.secondary} size={24} /></View>}
              <View style={styles.cardHeading}>
                <Text style={styles.cardTitle}>{label}</Text>
                <Text numberOfLines={1} style={styles.fileName}>{card.file.name}</Text>
                <Text style={[styles.status, card.uploadError ? styles.statusError : ready ? styles.statusReady : styles.statusReview]}>{card.status === 'reading' ? 'Reading…' : card.uploadError ? 'Not uploaded' : ready ? 'Ready' : card.autofilled && !card.confirmed ? 'Check details' : 'Enter details'}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label.toLowerCase()}`} disabled={saving} hitSlop={8} onPress={() => removeCard(card.key)} style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}><AppSymbol name={{ ios: 'xmark', android: 'close' } as never} color={theme.secondary} size={16} /></Pressable>
            </View>
            {card.status === 'reading' ? <Text style={styles.help}>Auto-fill is reading this receipt…</Text> : <>
              <View style={styles.field}><Text style={styles.smallLabel}>Merchant</Text><TextInput accessibilityLabel={`${label} merchant`} editable={!saving} maxLength={160} onChangeText={(value) => updateCard(card.key, (current) => ({ ...current, merchant: value }))} placeholder="Merchant" placeholderTextColor={theme.secondary} style={[styles.input, problems.merchant && styles.inputError]} value={card.merchant} />{problems.merchant ? <Text style={styles.fieldError}>{problems.merchant}</Text> : null}</View>
              <View style={styles.row}>
                <View style={[styles.field, styles.flex]}><Text style={styles.smallLabel}>Amount</Text><View style={[styles.moneyInput, problems.amount && styles.inputError]}><Text style={styles.currency}>$</Text><TextInput accessibilityLabel={`${label} amount`} editable={!saving} inputMode="decimal" keyboardType="decimal-pad" onChangeText={(value) => updateCard(card.key, (current) => ({ ...current, amount: value }))} placeholder="0.00" placeholderTextColor={theme.secondary} style={styles.moneyText} value={card.amount} /></View>{problems.amount ? <Text style={styles.fieldError}>{problems.amount}</Text> : null}</View>
                <View style={[styles.field, styles.flex]}><Text style={styles.smallLabel}>Purchase date</Text><Pressable accessibilityRole="button" accessibilityLabel={`${label} purchase date, ${formatCalendarDate(card.purchasedOn)}`} disabled={saving} onPress={() => setDateOpenKey((open) => open === card.key ? '' : card.key)} style={[styles.dateButton, problems.purchasedOn && styles.inputError]}><Text style={styles.dateValue}>{formatCalendarDate(card.purchasedOn)}</Text></Pressable></View>
              </View>
              {dateOpenKey === card.key ? <><DateTimePicker value={dateFromIso(card.purchasedOn)} mode="date" maximumDate={new Date()} display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={(event, date) => { if (Platform.OS !== 'ios') setDateOpenKey(''); if (event.type === 'set' && date) updateCard(card.key, (current) => ({ ...current, purchasedOn: isoDate(date) })); }} />{Platform.OS === 'ios' ? <Pressable accessibilityRole="button" onPress={() => setDateOpenKey('')} style={styles.dateDone}><Text style={styles.dateDoneText}>Done</Text></Pressable> : null}</> : null}
              {card.note ? <Text style={styles.warn}>{card.note}</Text> : null}
              {card.autofilled ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: card.confirmed }} disabled={saving} onPress={() => updateCard(card.key, (current) => ({ ...current, confirmed: !current.confirmed }))} style={[styles.confirm, attempted && problems.confirm && styles.inputError]}><View style={[styles.checkbox, card.confirmed && styles.checkboxOn]}>{card.confirmed ? <AppSymbol name={{ ios: 'checkmark', android: 'check' } as never} color="#FFFFFF" size={14} /> : null}</View><Text style={styles.confirmText}>I checked these details against the receipt{card.confidence && card.confidence !== 'high' ? ` (auto-fill confidence: ${card.confidence})` : ''}</Text></Pressable> : null}
              {autofillOn && card.note && autofillMimeTypes.includes(card.mimeType) ? <Pressable accessibilityRole="button" disabled={saving} onPress={() => retry(card.key)} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}><Text style={styles.retryText}>Retry auto-fill</Text></Pressable> : null}
            </>}
            {card.uploadError ? <Text accessibilityRole="alert" style={styles.fieldError}>{card.uploadError}</Text> : null}
          </View>;
        })}

        {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}
        {cards.length ? <Text style={styles.help}>{readingCount ? `Reading ${readingCount} of ${cards.length}…` : `${readyCount} of ${cards.length} ready`}</Text> : null}
        <Pressable accessibilityRole="button" disabled={saving || !cards.length || readingCount > 0} onPress={() => void submit()} style={({ pressed }) => [styles.submit, (saving || !cards.length || readingCount > 0) && styles.disabled, pressed && !saving && styles.pressed]}><Text style={styles.submitText}>{saving ? (offline ? 'Saving…' : 'Submitting…') : `${offline ? 'Save' : 'Submit'} ${cards.length > 1 ? `${cards.length} receipts` : 'receipt'}${offline ? ' on this device' : ''}`}</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    flex: { flex: 1 }, safe: { flex: 1, backgroundColor: theme.canvas }, content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48, gap: 20 }, heading: { gap: 7 }, title: { color: theme.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 }, subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    field: { gap: 7 }, label: { color: theme.ink, fontSize: 15, fontWeight: '700' }, optional: { color: theme.secondary, fontWeight: '500' }, smallLabel: { color: theme.ink, fontSize: 13, fontWeight: '700' }, help: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    input: { minHeight: 48, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 14, fontSize: 16 }, inputError: { borderColor: theme.danger }, fieldError: { color: theme.danger, fontSize: 13 },
    chips: { gap: 8, paddingRight: 12 }, chip: { minHeight: 34, justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 999, backgroundColor: theme.paper, paddingHorizontal: 12 }, chipText: { color: theme.ink, fontSize: 13, fontWeight: '600' },
    captureActions: { gap: 10 }, primaryAction: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 12, backgroundColor: theme.ember }, primaryActionText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' }, secondaryRow: { flexDirection: 'row', gap: 10 }, secondaryAction: { minHeight: 46, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: theme.divider, borderRadius: 11, backgroundColor: theme.paper }, secondaryActionText: { color: theme.ink, fontSize: 14, fontWeight: '700' },
    notice: { color: theme.ink, backgroundColor: theme.surfaceAlt, borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 19 },
    empty: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 30, gap: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.divider, borderRadius: 14 }, emptyIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 28, backgroundColor: theme.surfaceAlt }, emptyTitle: { color: theme.ink, fontSize: 17, fontWeight: '700' }, emptyText: { color: theme.secondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
    card: { gap: 12, borderWidth: 1, borderColor: theme.divider, borderRadius: 14, backgroundColor: theme.paper, padding: 13 }, cardReady: { borderColor: theme.green }, cardReview: { borderColor: theme.warning }, cardError: { borderColor: theme.danger },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 }, thumb: { width: 64, height: 80, borderRadius: 9, backgroundColor: theme.surfaceAlt }, thumbFile: { alignItems: 'center', justifyContent: 'center' }, cardHeading: { flex: 1, gap: 3 }, cardTitle: { color: theme.ink, fontSize: 15, fontWeight: '800' }, fileName: { color: theme.secondary, fontSize: 12 },
    status: { fontSize: 12, fontWeight: '800' }, statusReady: { color: theme.green }, statusReview: { color: theme.warning }, statusError: { color: theme.danger },
    removeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: theme.surfaceAlt },
    row: { flexDirection: 'row', gap: 10 }, moneyInput: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper }, currency: { color: theme.secondary, paddingLeft: 12, fontSize: 16, fontWeight: '700' }, moneyText: { flex: 1, minHeight: 46, color: theme.ink, paddingHorizontal: 6, fontSize: 16, fontVariant: ['tabular-nums'] },
    dateButton: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.surfaceAlt, paddingHorizontal: 12 }, dateValue: { color: theme.ink, fontSize: 15, fontWeight: '600' }, dateDone: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, dateDoneText: { color: theme.ember, fontSize: 15, fontWeight: '700' },
    warn: { color: theme.warning, fontSize: 13, lineHeight: 18 },
    confirm: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderWidth: 1, borderColor: theme.divider, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 9 }, checkbox: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: theme.secondary, borderRadius: 6 }, checkboxOn: { borderColor: theme.ember, backgroundColor: theme.ember }, confirmText: { flex: 1, color: theme.ink, fontSize: 14, lineHeight: 19, fontWeight: '600' },
    retry: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', borderRadius: 9, backgroundColor: theme.surfaceAlt, paddingHorizontal: 13 }, retryText: { color: theme.ink, fontSize: 13, fontWeight: '700' },
    saveError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 13, fontSize: 14, lineHeight: 20 }, submit: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.ember }, submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' }, pressed: { opacity: 0.68 }, disabled: { opacity: 0.5 },
  });
}
