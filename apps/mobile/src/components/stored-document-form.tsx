import { useMemo, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import type { LocalFleetFile } from '@/lib/fleet-files';
import { documentStores } from '@/lib/stored-documents-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';



export function StoredDocumentFormScreen({kind}: {kind: 'invoices' | 'payroll'}) {
  const title = kind === 'invoices' ? 'invoice' : 'payroll document';
  const {useStoredDocuments, createStoredDocument, updateStoredDocument} = documentStores[kind];
  const router = useRouter();
  const { documentId } = useLocalSearchParams<{ documentId?: string }>();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const { documents, loading } = useStoredDocuments(member?.company.id ?? null, member?.user.id ?? null);
  const document = documentId ? documents.find((item) => item.id === documentId) : undefined;
  const editing = Boolean(documentId);
  const [name, setName] = useState<string | null>(null);
  const [file, setFile] = useState<LocalFleetFile | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const resolvedName = name ?? document?.name ?? '';

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (editing && member && member.user.role !== 'owner') return <Redirect href={`/${kind}` as never} />;
  if (editing && !loading && !document) return <Redirect href={`/${kind}` as never} />;

  const chooseFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true, multiple: false });
    if (result.canceled) return;
    const asset = result.assets[0];
    setFile({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? null });
    setSaveError('');
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setSaveError('Camera permission is required to photograph a document.'); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setFile({ uri: asset.uri, name: asset.fileName ?? `document-${Date.now()}.jpg`, type: asset.mimeType ?? 'image/jpeg' });
    setSaveError('');
  };

  const submit = async () => {
    setAttempted(true);
    if (!member || !resolvedName.trim() || (!editing && !file) || (editing && !document) || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      if (editing && document) await updateStoredDocument(member.company.id, document.id, resolvedName);
      else if (file) await createStoredDocument(member.company.id, member.user.id, member.user.name, resolvedName, file);
      router.back();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : `Document could not be ${editing ? 'updated' : 'uploaded'}. Check connection and try again.`);
    } finally {
      setSaving(false);
    }
  };

  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <Stack.Screen options={{ title: editing ? `Edit ${title}` : `Add ${title}` }} />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>{editing ? `Edit ${title}` : `Upload ${title}`}</Text><Text style={styles.subtitle}>{editing ? 'Correct document name. Uploaded file and date stay unchanged.' : 'Add name and document image or PDF. Upload date is recorded automatically.'}</Text></View>

        <View style={styles.field}><Text style={styles.label}>Name</Text><TextInput accessibilityLabel="Document name" autoFocus maxLength={160} onChangeText={setName} placeholder="Document name" placeholderTextColor={theme.secondary} style={[styles.input, attempted && !resolvedName.trim() && styles.inputError]} value={resolvedName} />{attempted && !resolvedName.trim() ? <Text style={styles.fieldError}>Enter document name.</Text> : null}</View>

        {!editing ? <View style={styles.field}><Text style={styles.label}>Document file</Text><View style={[styles.fileCard, attempted && !file && styles.inputError]}><View style={styles.fileIcon}><AppSymbol name={{ ios: file ? 'doc.fill' : 'doc.badge.plus', android: file ? 'description' : 'note_add' } as never} color={file ? theme.green : theme.secondary} size={25} /></View><View style={styles.fileCopy}><Text numberOfLines={1} style={styles.fileTitle}>{file?.name ?? 'No document selected'}</Text><Text style={styles.fileHelp}>{file ? 'Ready to upload' : 'Image or PDF · maximum 10 MB'}</Text></View></View>{attempted && !file ? <Text style={styles.fieldError}>Photograph or choose document file.</Text> : null}<View style={styles.fileActions}><Pressable accessibilityRole="button" disabled={saving} onPress={() => void takePhoto().catch(() => setSaveError('Camera could not open. Try again or choose a file.'))} style={({ pressed }) => [styles.fileButton, pressed && styles.pressed]}><AppSymbol name={{ ios: 'camera', android: 'photo_camera' } as never} color={theme.ink} size={19} /><Text style={styles.fileButtonText}>Camera</Text></Pressable><Pressable accessibilityRole="button" disabled={saving} onPress={() => void chooseFile().catch(() => setSaveError('File picker could not open. Please try again.'))} style={({ pressed }) => [styles.fileButton, pressed && styles.pressed]}><AppSymbol name={{ ios: 'folder', android: 'folder' } as never} color={theme.ink} size={19} /><Text style={styles.fileButtonText}>Choose file</Text></Pressable></View>{file ? <Pressable accessibilityRole="button" onPress={() => setFile(null)} style={styles.remove}><Text style={styles.removeText}>Remove selected file</Text></Pressable> : null}</View> : document ? <View style={styles.field}><Text style={styles.label}>Document file</Text><View style={styles.fileCard}><View style={styles.fileIcon}><AppSymbol name={{ ios: 'doc.fill', android: 'description' } as never} color={theme.green} size={25} /></View><View style={styles.fileCopy}><Text numberOfLines={1} style={styles.fileTitle}>{document.fileName}</Text><Text style={styles.fileHelp}>Uploaded file stays unchanged</Text></View></View></View> : null}

        <View style={styles.dateNote}><AppSymbol name={{ ios: 'calendar', android: 'calendar_today' } as never} color={theme.secondary} size={18} /><Text style={styles.dateText}>{editing && document ? `Uploaded ${new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(document.createdAt))}` : `Upload date: ${new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date())}`}</Text></View>
        {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}
        <Pressable accessibilityRole="button" disabled={saving || (editing && !document)} onPress={() => void submit()} style={({ pressed }) => [styles.submit, (saving || (editing && !document)) && styles.disabled, pressed && !saving && styles.pressed]}><Text style={styles.submitText}>{saving ? (editing ? 'Saving…' : 'Uploading…') : (editing ? 'Save changes' : 'Upload document')}</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    flex: { flex: 1 }, safe: { flex: 1, backgroundColor: theme.canvas }, content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48, gap: 25 }, heading: { gap: 7 }, title: { color: theme.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 }, subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    field: { gap: 9 }, label: { color: theme.ink, fontSize: 15, fontWeight: '700' }, input: { minHeight: 50, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 14, fontSize: 16 }, inputError: { borderColor: theme.danger }, fieldError: { color: theme.danger, fontSize: 13 },
    fileCard: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, padding: 13 }, fileIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: theme.surfaceAlt }, fileCopy: { flex: 1, gap: 4 }, fileTitle: { color: theme.ink, fontSize: 15, fontWeight: '700' }, fileHelp: { color: theme.secondary, fontSize: 12 }, fileActions: { flexDirection: 'row', gap: 10 }, fileButton: { minHeight: 46, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: theme.divider, borderRadius: 11, backgroundColor: theme.paper }, fileButtonText: { color: theme.ink, fontSize: 14, fontWeight: '700' }, remove: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' }, removeText: { color: theme.danger, fontSize: 13, fontWeight: '700' },
    dateNote: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 11, backgroundColor: theme.surfaceAlt, paddingHorizontal: 14 }, dateText: { color: theme.secondary, fontSize: 13, fontWeight: '600' }, saveError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 13, fontSize: 14, lineHeight: 20 }, submit: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.ember }, submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' }, pressed: { opacity: 0.68 }, disabled: { opacity: 0.5 },
  });
}
