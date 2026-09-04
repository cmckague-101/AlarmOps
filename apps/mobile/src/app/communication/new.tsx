import { useMemo, useState } from 'react';
import { Redirect, Stack, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createCommunicationThread } from '@/lib/communications-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

export default function NewCommunicationThreadScreen() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  if (!session || access.status === 'error') return <Redirect href="/" />;

  const valid = Boolean(subject.trim() && description.trim());
  const submit = async () => {
    setAttempted(true);
    if (!valid) return;
    setSaving(true);
    setSaveError('');
    try {
      const thread = await createCommunicationThread(subject.trim(), description.trim());
      router.replace(`/communication/${encodeURIComponent(thread.id)}` as never);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Thread could not be posted. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'New thread' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={styles.title}>Start a company conversation</Text>
            <Text style={styles.subtitle}>Share an update, ask a question, or coordinate with the crew.</Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Subject</Text>
            <TextInput
              autoFocus
              accessibilityLabel="Thread subject"
              maxLength={160}
              onChangeText={setSubject}
              placeholder="Equipment pickup plan"
              placeholderTextColor={theme.secondary}
              style={[styles.input, attempted && !subject.trim() && styles.inputError]}
              value={subject}
            />
            {attempted && !subject.trim() ? <Text style={styles.fieldError}>Enter a subject.</Text> : null}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              accessibilityLabel="Thread description"
              maxLength={5000}
              multiline
              onChangeText={setDescription}
              placeholder="Share the details the company needs"
              placeholderTextColor={theme.secondary}
              style={[styles.input, styles.textarea, attempted && !description.trim() && styles.inputError]}
              textAlignVertical="top"
              value={description}
            />
            <Text style={styles.help}>{description.length}/5000</Text>
            {attempted && !description.trim() ? <Text style={styles.fieldError}>Enter a description.</Text> : null}
          </View>

          {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void submit()}
            style={({ pressed }) => [styles.submitButton, saving && styles.disabled, pressed && !saving && styles.pressed]}
          >
            <Text style={styles.submitLabel}>{saving ? 'Posting…' : 'Post thread'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { flex: 1, backgroundColor: theme.canvas },
    content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48, gap: 26 },
    heading: { gap: 7 },
    title: { color: theme.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
    subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    fieldGroup: { gap: 9 },
    label: { color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    input: { minHeight: 48, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 14, fontSize: 16 },
    textarea: { minHeight: 160, paddingTop: 13, paddingBottom: 13, lineHeight: 23 },
    inputError: { borderColor: theme.danger },
    fieldError: { color: theme.danger, fontSize: 13, lineHeight: 18 },
    help: { alignSelf: 'flex-end', color: theme.secondary, fontSize: 12, lineHeight: 16 },
    saveError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 13, fontSize: 14, lineHeight: 20 },
    submitButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.ember, borderRadius: 12, paddingHorizontal: 18 },
    submitLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
    pressed: { opacity: 0.74 },
    disabled: { opacity: 0.5 },
  });
}
