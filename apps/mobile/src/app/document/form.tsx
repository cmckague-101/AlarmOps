import { useMemo, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { createCompanyDocument, removeCompanyDocumentFiles, updateCompanyDocument, useCompanyDocuments } from '@/lib/documents-store';
import { LocalFleetFile, uploadFleetFile } from '@/lib/fleet-files';
import type { FleetVehicleFile } from '@/lib/fleet-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

export default function CompanyDocumentFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const { documents, loading } = useCompanyDocuments(member?.company.id ?? null, member?.user.id ?? null);
  const document = id ? documents.find((item) => item.id === id) : undefined;
  const [name, setName] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<LocalFleetFile | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const effectiveName = name ?? document?.name ?? '';

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (member && member.user.role !== 'owner') return <Redirect href={'/documents' as never} />;

  const chooseFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setPickedFile({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? null });
    if (!effectiveName.trim()) setName(asset.name.replace(/\.[^.]+$/, ''));
    setSaveError('');
  };

  const submit = async () => {
    setAttempted(true);
    if (!member || !effectiveName.trim() || (!document && !pickedFile)) return;
    setSaving(true);
    setSaveError('');
    let uploaded: FleetVehicleFile | null = null;
    try {
      if (pickedFile) uploaded = await uploadFleetFile(member.company.id, member.user.id, pickedFile);
      if (document) {
        await updateCompanyDocument(document, effectiveName.trim(), uploaded ?? undefined);
        if (uploaded?.path && document.file.path && uploaded.path !== document.file.path) {
          try {
            await removeCompanyDocumentFiles(member.company.id, [document.file.path]);
          } catch {
            // The record already points at the replacement; an orphan is safer than undoing it.
          }
        }
      } else if (uploaded) {
        await createCompanyDocument(effectiveName.trim(), uploaded);
      }
      router.back();
    } catch (error) {
      if (uploaded?.path) {
        try {
          await removeCompanyDocumentFiles(member.company.id, [uploaded.path]);
        } catch {
          // Preserve the original save error.
        }
      }
      setSaveError(error instanceof Error ? error.message : 'Document could not be saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const missingDocument = Boolean(id && !loading && !document);
  const missingName = attempted && !effectiveName.trim();
  const missingFile = attempted && !document && !pickedFile;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: document ? 'Edit document' : 'Upload document' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled">
          {loading && id ? <Text style={styles.stateText}>Loading document…</Text> : null}
          {missingDocument ? (
            <View style={styles.message}>
              <Text style={styles.messageTitle}>Document not found</Text>
              <Text style={styles.messageText}>It may have been removed or you may no longer have access.</Text>
            </View>
          ) : null}

          {!missingDocument && (!id || document) ? (
            <>
              <View style={styles.heading}>
                <Text accessibilityRole="header" style={styles.title}>{document ? 'Update company document' : 'Add a company document'}</Text>
                <Text style={styles.subtitle}>{document ? 'Rename the document or choose a replacement file.' : 'Name the document, then choose an image or PDF for the crew.'}</Text>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Document name</Text>
                <TextInput
                  accessibilityLabel="Document name"
                  autoFocus={!id}
                  maxLength={160}
                  onChangeText={setName}
                  placeholder="Employee handbook"
                  placeholderTextColor={theme.secondary}
                  style={[styles.input, missingName && styles.inputError]}
                  value={effectiveName}
                />
                {missingName ? <Text style={styles.fieldError}>Enter a document name.</Text> : null}
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>{document ? 'Replacement file' : 'Document file'}</Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => void chooseFile()}
                  style={({ pressed }) => [styles.filePicker, missingFile && styles.inputError, pressed && styles.pressed]}
                >
                  <View style={styles.fileIcon}>
                    <AppSymbol name={{ ios: pickedFile ? 'doc.fill' : 'square.and.arrow.up', android: pickedFile ? 'description' : 'upload' } as never} color={pickedFile ? theme.green : theme.secondary} size={23} />
                  </View>
                  <View style={styles.fileCopy}>
                    <Text numberOfLines={1} style={styles.fileTitle}>{pickedFile?.name ?? (document ? 'Choose a new file (optional)' : 'Choose an image or PDF')}</Text>
                    <Text style={styles.fileHelp}>{pickedFile ? 'Ready to upload' : document ? `Current: ${document.file.name}` : 'Maximum file size 8 MB'}</Text>
                  </View>
                </Pressable>
                {missingFile ? <Text style={styles.fieldError}>Choose a document file.</Text> : null}
                {pickedFile ? (
                  <Pressable accessibilityRole="button" onPress={() => setPickedFile(null)} style={({ pressed }) => [styles.removeFile, pressed && styles.pressed]}>
                    <Text style={styles.removeFileLabel}>Remove selected file</Text>
                  </Pressable>
                ) : null}
              </View>

              {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}

              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => void submit()}
                style={({ pressed }) => [styles.submitButton, saving && styles.disabled, pressed && !saving && styles.pressed]}
              >
                <Text style={styles.submitLabel}>{saving ? 'Saving…' : document ? 'Save changes' : 'Upload document'}</Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { flex: 1, backgroundColor: theme.canvas },
    content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48, gap: 27 },
    heading: { gap: 7 },
    title: { color: theme.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
    subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    fieldGroup: { gap: 9 },
    label: { color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    input: { minHeight: 48, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 14, fontSize: 16 },
    inputError: { borderColor: theme.danger },
    fieldError: { color: theme.danger, fontSize: 13, lineHeight: 18 },
    filePicker: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, padding: 13 },
    fileIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: theme.surfaceAlt },
    fileCopy: { flex: 1, gap: 4 },
    fileTitle: { color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    fileHelp: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    removeFile: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', paddingHorizontal: 4 },
    removeFileLabel: { color: theme.danger, fontSize: 13, fontWeight: '700' },
    saveError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 13, fontSize: 14, lineHeight: 20 },
    submitButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.ember, borderRadius: 12, paddingHorizontal: 18 },
    submitLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
    stateText: { color: theme.secondary, fontSize: 15, paddingVertical: 24 },
    message: { paddingVertical: 48, gap: 9 },
    messageTitle: { color: theme.ink, fontSize: 22, lineHeight: 28, fontWeight: '700' },
    messageText: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.5 },
  });
}
