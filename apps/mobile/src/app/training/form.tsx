import { useMemo, useState } from 'react';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createTraining, updateTraining, useTrainings } from '@/lib/training-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

type FormState = { courseCode: string; courseTitle: string; date: string; time: string; location: string; instructor: string; capacity: string; information: string };
type FormKey = keyof FormState;

function localParts(value?: string) {
  if (!value) return { date: '', time: '' };
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return { date: '', time: '' };
  const two = (part: number) => String(part).padStart(2, '0');
  return { date: `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`, time: `${two(date.getHours())}:${two(date.getMinutes())}` };
}

function parseLocalDate(dateText: string, timeText: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !/^\d{2}:\d{2}$/.test(timeText)) return null;
  const [year, month, day] = dateText.split('-').map(Number);
  const [hour, minute] = timeText.split(':').map(Number);
  const value = new Date(year, month - 1, day, hour, minute);
  if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day || value.getHours() !== hour || value.getMinutes() !== minute) return null;
  return value;
}

export default function TrainingFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const { trainings, loading } = useTrainings(member?.company.id ?? null, member?.user.id ?? null);
  const training = id ? trainings.find((item) => item.id === id) : undefined;
  const parts = localParts(training?.date);
  const initial: FormState = {
    courseCode: training?.courseCode ?? '', courseTitle: training?.courseTitle ?? '', date: parts.date, time: parts.time,
    location: training?.location ?? '', instructor: training?.instructor ?? '', capacity: training ? String(training.capacity) : '', information: training?.information ?? '',
  };
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FormKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const values = form ?? initial;

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (member && member.user.role !== 'owner' && member.user.role !== 'admin') return <Redirect href={'/training' as never} />;

  const update = (key: FormKey, value: string) => {
    setForm({ ...values, [key]: value });
    setErrors((current) => ({ ...current, [key]: undefined }));
    setSaveError('');
  };

  const submit = async () => {
    const nextErrors: Partial<Record<FormKey, string>> = {};
    if (!values.courseCode.trim()) nextErrors.courseCode = 'Course code is required.';
    if (!values.courseTitle.trim()) nextErrors.courseTitle = 'Course title is required.';
    const startsAt = parseLocalDate(values.date.trim(), values.time.trim());
    if (!startsAt || startsAt.valueOf() <= Date.now()) nextErrors.date = 'Choose a future date and time.';
    if (!values.location.trim()) nextErrors.location = 'Location is required.';
    if (!values.instructor.trim()) nextErrors.instructor = 'Instructor is required.';
    const capacity = Number(values.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) nextErrors.capacity = 'Capacity must be between 1 and 10,000.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || !startsAt) return;
    const next = { courseCode: values.courseCode.trim(), courseTitle: values.courseTitle.trim(), date: startsAt.toISOString(), location: values.location.trim(), instructor: values.instructor.trim(), capacity, information: values.information.trim() };
    setSaving(true);
    setSaveError('');
    try {
      if (training) await updateTraining(training, next);
      else await createTraining(next);
      router.back();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : `Training could not be ${training ? 'updated' : 'created'}.`);
    } finally {
      setSaving(false);
    }
  };

  const missingTraining = Boolean(id && !loading && !training);
  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: training ? 'Edit training' : 'Create training' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled">
          {loading && id ? <Text style={styles.stateText}>Loading course…</Text> : null}
          {missingTraining ? <View style={styles.message}><Text style={styles.messageTitle}>Course not found</Text><Text style={styles.messageText}>It may have been removed or you may no longer have access.</Text></View> : null}
          {!missingTraining && (!id || training) ? (
            <>
              <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>{training ? 'Update training' : 'Schedule training'}</Text><Text style={styles.subtitle}>Course details are shared with every crew member.</Text></View>
              <Field label="Course code" error={errors.courseCode} styles={styles}><TextInput accessibilityLabel="Course code" autoCapitalize="characters" autoFocus={!id} maxLength={80} onChangeText={(value) => update('courseCode', value)} placeholder="S-130" placeholderTextColor={theme.secondary} style={[styles.input, errors.courseCode && styles.inputError]} value={values.courseCode} /></Field>
              <Field label="Course title" error={errors.courseTitle} styles={styles}><TextInput accessibilityLabel="Course title" maxLength={200} onChangeText={(value) => update('courseTitle', value)} placeholder="Firefighter Training" placeholderTextColor={theme.secondary} style={[styles.input, errors.courseTitle && styles.inputError]} value={values.courseTitle} /></Field>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Date and time</Text>
                <View style={styles.dateRow}>
                  <TextInput accessibilityLabel="Course date" autoCapitalize="none" keyboardType="numbers-and-punctuation" maxLength={10} onChangeText={(value) => update('date', value)} placeholder="YYYY-MM-DD" placeholderTextColor={theme.secondary} style={[styles.input, styles.dateInput, errors.date && styles.inputError]} value={values.date} />
                  <TextInput accessibilityLabel="Course time" autoCapitalize="none" keyboardType="numbers-and-punctuation" maxLength={5} onChangeText={(value) => update('time', value)} placeholder="HH:MM" placeholderTextColor={theme.secondary} style={[styles.input, styles.timeInput, errors.date && styles.inputError]} value={values.time} />
                </View>
                <Text style={styles.help}>Use local time in 24-hour format.</Text>
                {errors.date ? <Text style={styles.fieldError}>{errors.date}</Text> : null}
              </View>
              <Field label="Location" error={errors.location} styles={styles}><TextInput accessibilityLabel="Course location" maxLength={300} onChangeText={(value) => update('location', value)} placeholder="Station 4 training room" placeholderTextColor={theme.secondary} style={[styles.input, errors.location && styles.inputError]} value={values.location} /></Field>
              <Field label="Instructor" error={errors.instructor} styles={styles}><TextInput accessibilityLabel="Course instructor" maxLength={160} onChangeText={(value) => update('instructor', value)} placeholder="Instructor name" placeholderTextColor={theme.secondary} style={[styles.input, errors.instructor && styles.inputError]} value={values.instructor} /></Field>
              <Field label="Capacity" error={errors.capacity} styles={styles}><TextInput accessibilityLabel="Course capacity" keyboardType="number-pad" maxLength={5} onChangeText={(value) => update('capacity', value)} placeholder="20" placeholderTextColor={theme.secondary} style={[styles.input, errors.capacity && styles.inputError]} value={values.capacity} /></Field>
              <View style={styles.fieldGroup}><Text style={styles.label}>Course information <Text style={styles.optional}>Optional</Text></Text><TextInput accessibilityLabel="Course information" maxLength={5000} multiline onChangeText={(value) => update('information', value)} placeholder="Prerequisites, required gear, arrival instructions, or course outline" placeholderTextColor={theme.secondary} style={[styles.input, styles.textarea]} textAlignVertical="top" value={values.information} /><Text style={styles.help}>{values.information.length}/5000</Text></View>
              {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}
              <Pressable accessibilityRole="button" disabled={saving} onPress={() => void submit()} style={({ pressed }) => [styles.submitButton, saving && styles.disabled, pressed && styles.pressed]}><Text style={styles.submitLabel}>{saving ? 'Saving…' : training ? 'Save changes' : 'Create training'}</Text></Pressable>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, error, children, styles }: { label: string; error?: string; children: React.ReactNode; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.fieldGroup}><Text style={styles.label}>{label}</Text>{children}{error ? <Text style={styles.fieldError}>{error}</Text> : null}</View>;
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    flex: { flex: 1 }, safeArea: { flex: 1, backgroundColor: theme.canvas }, content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48, gap: 24 },
    heading: { gap: 7 }, title: { color: theme.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 }, subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    fieldGroup: { gap: 8 }, label: { color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' }, optional: { color: theme.secondary, fontSize: 12, fontWeight: '500' },
    input: { minHeight: 48, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 14, fontSize: 16 }, inputError: { borderColor: theme.danger },
    dateRow: { flexDirection: 'row', gap: 10 }, dateInput: { flex: 1 }, timeInput: { width: 112 }, help: { color: theme.secondary, fontSize: 12, lineHeight: 17 }, fieldError: { color: theme.danger, fontSize: 13, lineHeight: 18 },
    textarea: { minHeight: 132, paddingTop: 13, paddingBottom: 13, lineHeight: 23 }, saveError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 13, fontSize: 14, lineHeight: 20 },
    submitButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.ember, borderRadius: 12, paddingHorizontal: 18 }, submitLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
    stateText: { color: theme.secondary, fontSize: 15, paddingVertical: 24 }, message: { paddingVertical: 48, gap: 9 }, messageTitle: { color: theme.ink, fontSize: 22, lineHeight: 28, fontWeight: '700' }, messageText: { color: theme.secondary, fontSize: 15, lineHeight: 22 }, pressed: { opacity: 0.72 }, disabled: { opacity: 0.5 },
  });
}
