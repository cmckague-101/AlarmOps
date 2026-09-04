import { useMemo, useState } from 'react';
import type { IssuePriority } from '@fireops/domain';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createFleetId, saveFleetRecord, useFleetVehicles } from '@/lib/fleet-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

const priorities: IssuePriority[] = ['Low', 'Medium', 'High', 'Critical'];

export default function NewIssueScreen() {
  const { vehicleId: initialVehicleId } = useLocalSearchParams<{ vehicleId?: string }>();
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const companyId = access.value?.kind === 'member' ? access.value.company.id : null;
  const user = access.value?.kind === 'member' ? access.value.user : null;
  const { vehicles, loading } = useFleetVehicles(companyId);
  const vehicleId = initialVehicleId ?? '';
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<IssuePriority>('Medium');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  if (!session || access.status === 'error') return <Redirect href="/" />;

  const valid = Boolean(selectedVehicle && title.trim() && description.trim() && user);
  const submit = async () => {
    setAttempted(true);
    if (!valid || !user) return;
    setSaving(true);
    setSaveError('');
    try {
      await saveFleetRecord('issues', {
        id: createFleetId(),
        vehicleId,
        title: title.trim(),
        description: description.trim(),
        priority,
        status: 'Open' as const,
        updates: [],
        createdBy: user.name,
        createdById: user.id,
        createdAt: new Date().toISOString(),
      });
      router.back();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Issue could not be created. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'New issue' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.headingGroup}>
            <Text style={styles.title}>Report vehicle issue</Text>
            <Text style={styles.subtitle}>Give your company enough detail to triage and repair it.</Text>
          </View>

          {loading ? <Text style={styles.help}>Loading vehicle…</Text> : selectedVehicle ? (
            <View style={styles.selectedVehicle}>
              <Text style={styles.selectedVehicleLabel}>Vehicle</Text>
              <Text style={styles.vehicleName}>{selectedVehicle.name}</Text>
              <Text style={styles.vehicleMeta}>{[selectedVehicle.type, selectedVehicle.detail].filter(Boolean).join(' · ')}</Text>
            </View>
          ) : (
            <View style={styles.missingVehicle}>
              <Text style={styles.missingVehicleTitle}>Select vehicle first</Text>
              <Text style={styles.missingVehicleText}>Open vehicle from Fleet, then choose Open issue.</Text>
              <Pressable accessibilityRole="button" onPress={() => router.replace('/(tabs)/fleet' as never)} style={styles.fleetButton}>
                <Text style={styles.fleetButtonLabel}>Go to Fleet</Text>
              </Pressable>
            </View>
          )}

          {selectedVehicle ? <>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Issue title</Text>
            <TextInput
              accessibilityLabel="Issue title"
              maxLength={160}
              onChangeText={setTitle}
              placeholder="Pump losing pressure"
              placeholderTextColor={theme.secondary}
              style={[styles.input, attempted && !title.trim() && styles.inputError]}
              value={title}
            />
            {attempted && !title.trim() ? <Text style={styles.fieldError}>Enter issue title.</Text> : null}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              accessibilityLabel="Issue description"
              maxLength={2000}
              multiline
              onChangeText={setDescription}
              placeholder="Describe problem and when it occurs"
              placeholderTextColor={theme.secondary}
              style={[styles.input, styles.textarea, attempted && !description.trim() && styles.inputError]}
              textAlignVertical="top"
              value={description}
            />
            {attempted && !description.trim() ? <Text style={styles.fieldError}>Enter description.</Text> : null}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Priority</Text>
            <View style={styles.priorityOptions}>
              {priorities.map((value) => {
                const selected = priority === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => setPriority(value)}
                    style={({ pressed }) => [styles.priorityOption, selected && styles.priorityOptionSelected, pressed && styles.pressed]}
                  >
                    <Text style={[styles.priorityText, selected && styles.priorityTextSelected]}>{value}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={submit}
            style={({ pressed }) => [styles.submitButton, saving && styles.disabled, pressed && !saving && styles.pressed]}
          >
            <Text style={styles.submitLabel}>{saving ? 'Creating issue…' : 'Create issue'}</Text>
          </Pressable>
          </> : null}
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
    headingGroup: { gap: 7 },
    title: { color: theme.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 },
    subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    fieldGroup: { gap: 9 },
    label: { color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    help: { color: theme.secondary, fontSize: 14, lineHeight: 20 },
    input: { minHeight: 48, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 14, fontSize: 16 },
    textarea: { minHeight: 126, paddingTop: 13, paddingBottom: 13 },
    inputError: { borderColor: theme.danger },
    fieldError: { color: theme.danger, fontSize: 13, lineHeight: 18 },
    selectedVehicle: { backgroundColor: theme.greenSurface, borderRadius: 12, padding: 15, gap: 4 },
    selectedVehicleLabel: { color: theme.green, fontSize: 12, lineHeight: 16, fontWeight: '800', textTransform: 'uppercase' },
    vehicleName: { color: theme.ink, fontSize: 17, lineHeight: 22, fontWeight: '700' },
    vehicleMeta: { color: theme.secondary, fontSize: 13, lineHeight: 18 },
    missingVehicle: { backgroundColor: theme.warningSurface, borderRadius: 12, padding: 17, gap: 8 },
    missingVehicleTitle: { color: theme.warning, fontSize: 18, lineHeight: 23, fontWeight: '700' },
    missingVehicleText: { color: theme.ink, fontSize: 14, lineHeight: 20 },
    fleetButton: { alignSelf: 'flex-start', minHeight: 42, justifyContent: 'center', backgroundColor: theme.command, borderRadius: 10, paddingHorizontal: 15, marginTop: 4 },
    fleetButtonLabel: { color: theme.commandText, fontSize: 14, fontWeight: '700' },
    priorityOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    priorityOption: { minHeight: 40, justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 999, backgroundColor: theme.paper, paddingHorizontal: 14 },
    priorityOptionSelected: { backgroundColor: theme.command, borderColor: theme.command },
    priorityText: { color: theme.secondary, fontSize: 13, fontWeight: '700' },
    priorityTextSelected: { color: theme.commandText },
    saveError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 13, fontSize: 14, lineHeight: 20 },
    submitButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.ember, borderRadius: 12, paddingHorizontal: 18 },
    submitLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
    pressed: { opacity: 0.76 },
    disabled: { opacity: 0.52 },
  });
}
