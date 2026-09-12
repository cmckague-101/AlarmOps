import { useEffect, useMemo, useRef, useState } from 'react';
import type { VehicleStatus } from '@fireops/domain';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { createFleetId, saveFleetVehicleRecord, useFleetVehicles } from '@/lib/fleet-store';
import { useSession } from '@/providers/session-provider';
import { useVehicleTypes } from '@/lib/vehicle-type-store';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';
const statuses: VehicleStatus[] = ['Ready', 'Out of service'];
const statusLabel = (status: VehicleStatus) => status === 'Out of service' ? 'Out of Service' : status;
const currentYear = new Date().getFullYear();

type FormState = {
  unit: string;
  type: string;
  year: string;
  make: string;
  model: string;
  vin: string;
  plate: string;
  status: VehicleStatus;
  notes: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

export default function VehicleFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const companyId = access.value?.kind === 'member' ? access.value.company.id : null;
  const user = access.value?.kind === 'member' ? access.value.user : null;
  const { vehicles, loading } = useFleetVehicles(companyId);
  const { types: vehicleTypes, loading: vehicleTypesLoading } = useVehicleTypes(companyId);
  const vehicle = id ? vehicles.find((item) => item.id === id) : undefined;
  const editing = Boolean(id);
  const [form, setForm] = useState<FormState>(() => ({
    unit: vehicle?.name ?? '',
    type: vehicle?.type ?? '',
    year: vehicle?.year ?? String(currentYear),
    make: vehicle?.make ?? '',
    model: vehicle?.model ?? '',
    vin: vehicle?.vin ?? '',
    plate: vehicle?.plate ?? '',
    status: statuses.includes(vehicle?.status as VehicleStatus) ? vehicle?.status as VehicleStatus : 'Ready',
    notes: vehicle?.notes ?? '',
  }));
  const hydratedIdRef = useRef(vehicle?.id ?? null);
  const [newVehicleId] = useState(() => createFleetId());
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const configuredType = vehicleTypes.find((type) => type.name.toLocaleLowerCase() === form.type.toLocaleLowerCase());
  const isExistingLegacyType = Boolean(editing && vehicle && form.type && vehicle.type.toLocaleLowerCase() === form.type.toLocaleLowerCase());
  const selectedType = configuredType?.name ?? (isExistingLegacyType ? form.type : vehicleTypes[0]?.name ?? '');
  const typeOptions = useMemo(() => {
    const names = vehicleTypes.map((type) => type.name);
    return isExistingLegacyType && form.type && !names.some((name) => name.toLocaleLowerCase() === form.type.toLocaleLowerCase())
      ? [form.type, ...names]
      : names;
  }, [form.type, isExistingLegacyType, vehicleTypes]);

  useEffect(() => {
    if (!vehicle || hydratedIdRef.current === vehicle.id) return;
    hydratedIdRef.current = vehicle.id;
    setForm({
      unit: vehicle.name,
      type: vehicle.type,
      year: vehicle.year ?? String(currentYear),
      make: vehicle.make ?? '',
      model: vehicle.model ?? '',
      vin: vehicle.vin ?? '',
      plate: vehicle.plate ?? '',
      status: statuses.includes(vehicle.status as VehicleStatus) ? vehicle.status as VehicleStatus : 'Ready',
      notes: vehicle.notes ?? '',
    });
  }, [vehicle]);

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (access.status === 'idle' || access.status === 'loading') return <SafeAreaView style={styles.safeArea}><Text style={styles.loading}>Checking fleet access…</Text></SafeAreaView>;
  if (!user || user.role !== 'owner') return <Redirect href={id ? `/vehicle/${id}` : '/(tabs)/fleet'} />;

  const update = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async () => {
    const nextErrors: FormErrors = {};
    const year = Number(form.year);
    if (!form.unit.trim()) nextErrors.unit = 'Unit name is required.';
    if (!selectedType) nextErrors.type = 'Select a vehicle type.';
    if (!form.make.trim()) nextErrors.make = 'Make is required.';
    if (!form.model.trim()) nextErrors.model = 'Model is required.';
    if (!Number.isInteger(year) || year < 1950 || year > currentYear + 1) nextErrors.year = `Enter a year from 1950 to ${currentYear + 1}.`;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    setSaveError('');
    const recordId = vehicle?.id ?? newVehicleId;
    try {
      await saveFleetVehicleRecord({
        ...(vehicle?.source ?? {}),
        id: recordId,
        unit: form.unit.trim(),
        type: selectedType,
        year,
        make: form.make.trim(),
        model: form.model.trim(),
        vin: form.vin.trim().toUpperCase(),
        plate: form.plate.trim().toUpperCase(),
        status: form.status,
        assignedTo: form.status === 'Assigned' ? vehicle?.assignedTo : undefined,
        assignedFire: form.status === 'Assigned' ? vehicle?.assignedFire : undefined,
        notes: form.notes.trim(),
        createdAt: typeof vehicle?.source.createdAt === 'string' ? vehicle.source.createdAt : new Date().toISOString(),
      }, user, editing);
      if (editing) router.back();
      else router.replace(`/vehicle/${recordId}`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Vehicle could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (editing && loading && !vehicle) {
    return <SafeAreaView style={styles.safeArea}><Text style={styles.loading}>Loading vehicle…</Text></SafeAreaView>;
  }
  if (editing && !loading && !vehicle) return <Redirect href="/(tabs)/fleet" />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: editing ? 'Edit vehicle' : 'Add vehicle' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={92}>
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled">
          <View style={styles.intro}>
            <Text style={styles.title}>{editing ? 'Edit vehicle' : 'Add vehicle'}</Text>
            <Text style={styles.subtitle}>{editing ? 'Keep fleet identity and readiness details current.' : 'Create a vehicle record for your company fleet.'}</Text>
          </View>

          {saveError ? <View style={styles.errorBanner}><Text style={styles.errorBannerTitle}>Couldn’t save vehicle</Text><Text style={styles.errorBannerText}>{saveError}</Text></View> : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Vehicle details</Text>
            <Field label="Unit name" required error={errors.unit} styles={styles}>
              <TextInput style={styles.textInput} value={form.unit} onChangeText={(value) => update('unit', value)} placeholder="Engine 702" placeholderTextColor={theme.secondary} maxLength={120} autoCapitalize="words" returnKeyType="next" />
            </Field>
            <Field label="Vehicle type" required error={errors.type} styles={styles}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Vehicle type"
                accessibilityHint="Opens vehicle type choices"
                disabled={vehicleTypesLoading}
                onPress={() => setTypePickerOpen(true)}
                style={({ pressed }) => [styles.selectButton, pressed && styles.pressed]}
              >
                <Text style={[styles.selectValue, !selectedType && styles.selectPlaceholder]}>{selectedType || (vehicleTypesLoading ? 'Loading vehicle types…' : 'Select vehicle type')}</Text>
                <AppSymbol name="chevron.down" color={theme.secondary} size={17} />
              </Pressable>
            </Field>
            <View style={styles.row}>
              <View style={styles.rowField}><Field label="Year" required error={errors.year} styles={styles}><TextInput style={styles.textInput} value={form.year} onChangeText={(value) => update('year', value)} placeholder={String(currentYear)} placeholderTextColor={theme.secondary} keyboardType="number-pad" maxLength={4} /></Field></View>
              <View style={styles.rowField}><Field label="Make" required error={errors.make} styles={styles}><TextInput style={styles.textInput} value={form.make} onChangeText={(value) => update('make', value)} placeholder="International" placeholderTextColor={theme.secondary} maxLength={80} autoCapitalize="words" /></Field></View>
            </View>
            <Field label="Model" required error={errors.model} styles={styles}><TextInput style={styles.textInput} value={form.model} onChangeText={(value) => update('model', value)} placeholder="HV" placeholderTextColor={theme.secondary} maxLength={80} autoCapitalize="words" /></Field>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Readiness</Text>
            <Field label="Status" error={errors.status} styles={styles}>
              <View style={styles.choiceGrid}>{statuses.map((status) => <Choice key={status} label={statusLabel(status)} selected={form.status === status} onPress={() => update('status', status)} styles={styles} />)}</View>
            </Field>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Registration & notes</Text>
            <Field label="VIN" styles={styles}><TextInput style={styles.textInput} value={form.vin} onChangeText={(value) => update('vin', value)} placeholder="17-character VIN" placeholderTextColor={theme.secondary} maxLength={17} autoCapitalize="characters" autoCorrect={false} /></Field>
            <Field label="License plate" styles={styles}><TextInput style={styles.textInput} value={form.plate} onChangeText={(value) => update('plate', value)} placeholder="Plate number" placeholderTextColor={theme.secondary} maxLength={20} autoCapitalize="characters" autoCorrect={false} /></Field>
            <Field label="Notes" styles={styles}><TextInput style={[styles.textInput, styles.notesInput]} value={form.notes} onChangeText={(value) => update('notes', value)} placeholder="Anything else to know about this vehicle" placeholderTextColor={theme.secondary} maxLength={2000} multiline textAlignVertical="top" /></Field>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable accessibilityRole="button" disabled={saving} onPress={() => router.back()} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}><Text style={styles.cancelLabel}>Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={saving} onPress={submit} style={({ pressed }) => [styles.saveButton, pressed && styles.saveButtonPressed, saving && styles.disabled]}>
            <AppSymbol name="checkmark" color={theme.commandText} size={18} />
            <Text style={styles.saveLabel}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add vehicle'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={typePickerOpen} transparent animationType="fade" onRequestClose={() => setTypePickerOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close vehicle type choices" style={styles.modalBackdrop} onPress={() => setTypePickerOpen(false)} />
          <View accessibilityViewIsModal style={styles.typeMenu}>
            <View style={styles.typeMenuHeader}>
              <Text style={styles.typeMenuTitle}>Vehicle type</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setTypePickerOpen(false)} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                <AppSymbol name="xmark" color={theme.ink} size={17} />
              </Pressable>
            </View>
            <ScrollView style={styles.typeMenuScroll} contentContainerStyle={styles.typeMenuContent}>
              {typeOptions.map((type) => (
                <Pressable
                  key={type}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selectedType === type }}
                  onPress={() => { update('type', type); setTypePickerOpen(false); }}
                  style={({ pressed }) => [styles.typeOption, selectedType === type && styles.typeOptionSelected, pressed && styles.pressed]}
                >
                  <Text style={[styles.typeOptionLabel, selectedType === type && styles.typeOptionLabelSelected]}>{type}</Text>
                  {selectedType === type ? <AppSymbol name="checkmark" color={theme.commandText} size={17} /> : null}
                </Pressable>
              ))}
              {!vehicleTypesLoading && !typeOptions.length ? <Text style={styles.noTypes}>No vehicle types. Add one below.</Text> : null}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() => { setTypePickerOpen(false); router.push('/vehicle/types'); }}
              style={({ pressed }) => [styles.manageTypesButton, pressed && styles.pressed]}
            >
              <AppSymbol name="pencil" color={theme.ember} size={17} />
              <Text style={styles.manageTypesLabel}>Edit vehicle types</Text>
              <AppSymbol name="chevron.right" color={theme.ember} size={15} />
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Field({ label, required, error, children, styles }: { label: string; required?: boolean; error?: string; children: React.ReactNode; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.field}><Text style={styles.label}>{label}{required ? <Text style={styles.required}> *</Text> : null}</Text><View style={[styles.inputShell, error && styles.inputError]}>{children}</View>{error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text> : null}</View>;
}

function Choice({ label, selected, disabled, onPress, styles }: { label: string; selected: boolean; disabled?: boolean; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, disabled && styles.disabled, pressed && styles.pressed]}><Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{label}</Text></Pressable>;
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.canvas },
    flex: { flex: 1 },
    loading: { color: theme.secondary, fontSize: 16, padding: 24 },
    content: { padding: 18, paddingBottom: 28, gap: 18 },
    intro: { gap: 5, paddingVertical: 4 },
    title: { color: theme.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.5 },
    subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 22 },
    section: { backgroundColor: theme.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, borderRadius: 16, padding: 16, gap: 16 },
    sectionTitle: { color: theme.ink, fontSize: 18, lineHeight: 23, fontWeight: '800' },
    field: { gap: 7 },
    label: { color: theme.ink, fontSize: 14, lineHeight: 19, fontWeight: '700' },
    required: { color: theme.ember },
    inputShell: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 11, paddingHorizontal: 13, backgroundColor: theme.canvas },
    textInput: { color: theme.ink, fontSize: 16 },
    inputError: { borderColor: theme.danger, backgroundColor: theme.dangerSurface },
    errorText: { color: theme.danger, fontSize: 13, lineHeight: 18, fontWeight: '600' },
    selectButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    selectValue: { flex: 1, color: theme.ink, fontSize: 16 },
    selectPlaceholder: { color: theme.secondary },
    row: { flexDirection: 'row', gap: 12 },
    rowField: { flex: 1 },
    choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 4 },
    choice: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 24, paddingHorizontal: 14, backgroundColor: theme.canvas },
    choiceSelected: { backgroundColor: theme.command, borderColor: theme.command },
    choiceLabel: { color: theme.ink, fontSize: 14, fontWeight: '700' },
    choiceLabelSelected: { color: theme.commandText },
    notesInput: { minHeight: 112, paddingTop: 12 },
    errorBanner: { backgroundColor: theme.dangerSurface, borderRadius: 12, padding: 14, gap: 3 },
    errorBannerTitle: { color: theme.danger, fontSize: 15, fontWeight: '800' },
    errorBannerText: { color: theme.danger, fontSize: 14, lineHeight: 20 },
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    modalBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.48)' },
    typeMenu: { maxHeight: '72%', overflow: 'hidden', borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: theme.paper, paddingBottom: Platform.OS === 'ios' ? 24 : 12 },
    typeMenuHeader: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.divider },
    typeMenuTitle: { color: theme.ink, fontSize: 19, fontWeight: '800' },
    closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: theme.canvas },
    typeMenuScroll: { flexGrow: 0 },
    typeMenuContent: { padding: 10, gap: 6 },
    typeOption: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderRadius: 11, paddingHorizontal: 13 },
    typeOptionSelected: { backgroundColor: theme.command },
    typeOptionLabel: { flex: 1, color: theme.ink, fontSize: 15, fontWeight: '700' },
    typeOptionLabelSelected: { color: theme.commandText },
    noTypes: { color: theme.secondary, fontSize: 14, lineHeight: 20, padding: 12 },
    manageTypesButton: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 9, marginHorizontal: 10, paddingHorizontal: 13, borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.divider },
    manageTypesLabel: { flex: 1, color: theme.ember, fontSize: 15, fontWeight: '800' },
    footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 8 : 16, borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, backgroundColor: theme.paper },
    cancelButton: { minHeight: 48, minWidth: 96, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.divider, borderRadius: 12 },
    cancelLabel: { color: theme.ink, fontSize: 15, fontWeight: '800' },
    saveButton: { minHeight: 48, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, backgroundColor: theme.ember },
    saveButtonPressed: { backgroundColor: theme.emberPressed },
    saveLabel: { color: theme.commandText, fontSize: 15, fontWeight: '800' },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.72 },
  });
}
