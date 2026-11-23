import { useEffect, useMemo, useRef, useState } from 'react';
import { inspectionExpirationDate, localDateToday, vinError, type Vehicle, type VehicleStatus } from '@fireops/domain';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Alert,
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
import { removeFleetFiles, uploadFleetFile, type LocalFleetFile } from '@/lib/fleet-files';
import { assertFleetRecordVersion, fleetReadVersion, createFleetId, saveFleetVehicleRecord, useFleetVehicles, type FleetVehicle, type FleetVehicleFile } from '@/lib/fleet-store';
import { useOptionalOfflineSync } from '@/providers/offline-sync-provider';
import { useSession } from '@/providers/session-provider';
import { useVehicleTypes } from '@/lib/vehicle-type-store';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';
const statuses: VehicleStatus[] = ['Ready', 'Out of service'];
const statusLabel = (status: VehicleStatus) => status === 'Out of service' ? 'Out of Service' : status;
const currentYear = new Date().getFullYear();
const binderDocuments = [
  { key: 'contract', label: 'Contract' },
  { key: 'viprChecklist', label: 'VIPR Checklist' },
  { key: 'registration', label: 'Registration' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'dotInspection', label: 'DOT Inspection' },
] as const;
type BinderDocumentKey = typeof binderDocuments[number]['key'];

function attachedBinderFile(vehicle: FleetVehicle | undefined, label: string) {
  return vehicle?.files.find((entry) => entry.label.toLocaleLowerCase() === label.toLocaleLowerCase())?.file;
}

function binderDocumentId(vehicle: FleetVehicle | undefined, key: BinderDocumentKey, label: string) {
  return vehicle?.documents.find((document) => document.id === key || document.name.toLocaleLowerCase() === label.toLocaleLowerCase())?.id ?? key;
}

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
function editableVehicleVersion(vehicle:FleetVehicle|undefined){try{return vehicle?fleetReadVersion(vehicle,'vehicles'):undefined}catch{return undefined}}

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
  const baseVersionRef=useRef(editableVehicleVersion(vehicle));
  const scopeKey=user&&session?.user.id===user.id?`${user.id}:${companyId}:${user.role}`:null;
  const originalScopeRef=useRef(scopeKey);
  if(originalScopeRef.current===null&&scopeKey)originalScopeRef.current=scopeKey;
  const [newVehicleId] = useState(() => createFleetId());
  // Offline, a new vehicle (no photo) is saved on this device and created when connected.
  const offlineSync = useOptionalOfflineSync();
  const offlineCreate = !!offlineSync?.offline && Platform.OS !== 'web';
  const offlineVehicle = useRef<Record<string, unknown> | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState<LocalFleetFile | null>(null);
  const [binderFiles, setBinderFiles] = useState<Partial<Record<BinderDocumentKey, LocalFleetFile>>>({});
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [inspectionDate, setInspectionDate] = useState(() => vehicle?.documents.find(document => document.id === 'dotInspection' || document.name.toLowerCase() === 'dot inspection')?.inspectionDate ?? '');
  const [datePickerOpen, setDatePickerOpen] = useState(false);
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
    baseVersionRef.current=editableVehicleVersion(vehicle);
    setInspectionDate(vehicle.documents.find(document => document.id === 'dotInspection' || document.name.toLowerCase() === 'dot inspection')?.inspectionDate ?? '');
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
  if(scopeKey!==originalScopeRef.current)return <SafeAreaView style={styles.safeArea}><Text accessibilityRole="alert" style={styles.loading}>Account or permissions changed. Reopen this editor.</Text></SafeAreaView>;
  if (!user || session.user.id!==user.id || user.role !== 'owner' && user.role !== 'admin') return <Redirect href={id ? `/vehicle/${id}` : '/(tabs)/fleet'} />;

  const update = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };
  const choosePhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setPhoto({ uri: asset.uri, name: asset.fileName ?? `${form.unit.trim() || 'vehicle'}-photo.jpg`, type: asset.mimeType ?? 'image/jpeg' });
  };

  const applyBinderFile = (key: BinderDocumentKey, file: LocalFleetFile) => {
    if (key === 'dotInspection') setInspectionDate('');
    setBinderFiles((current) => ({ ...current, [key]: file }));
  };

  const chooseBinderDocument = async (key: BinderDocumentKey) => {
    const allowCamera = key === 'registration' || key === 'dotInspection';
    if (!allowCamera) {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      applyBinderFile(key, { uri: asset.uri, name: asset.name, type: asset.mimeType ?? null });
      return;
    }
    Alert.alert(
      key === 'dotInspection' ? 'DOT Inspection' : 'Registration',
      'Take a photo or choose an image/PDF file.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Take photo',
          onPress: () => {
            void (async () => {
              const permission = await ImagePicker.requestCameraPermissionsAsync();
              if (!permission.granted) {
                setSaveError('Camera permission is required to photograph this document.');
                return;
              }
              const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
              if (result.canceled) return;
              const asset = result.assets[0];
              applyBinderFile(key, { uri: asset.uri, name: asset.fileName ?? `${key}-${Date.now()}.jpg`, type: asset.mimeType ?? 'image/jpeg' });
            })();
          },
        },
        {
          text: 'Choose file',
          onPress: () => {
            void (async () => {
              const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
              if (result.canceled) return;
              const asset = result.assets[0];
              applyBinderFile(key, { uri: asset.uri, name: asset.name, type: asset.mimeType ?? null });
            })();
          },
        },
      ],
    );
  };

  const submit = async () => {
    const nextErrors: FormErrors = {};
    const year = Number(form.year);
    if (!form.unit.trim()) nextErrors.unit = 'Unit name is required.';
    if (!selectedType) nextErrors.type = 'Select a vehicle type.';
    if (!form.make.trim()) nextErrors.make = 'Make is required.';
    if (!form.model.trim()) nextErrors.model = 'Model is required.';
    if (!Number.isInteger(year) || year < 1950 || year > currentYear + 1) nextErrors.year = `Enter a year from 1950 to ${currentYear + 1}.`;
    // Only a changed VIN is checked, so older records with odd VINs can still be edited.
    if (form.vin.trim().toUpperCase() !== (vehicle?.vin ?? '').trim().toUpperCase() && vinError(form.vin)) nextErrors.vin = vinError(form.vin);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    if ((binderFiles.dotInspection || attachedBinderFile(vehicle, 'DOT Inspection')) && !inspectionExpirationDate(inspectionDate)) {
      setSaveError('Select a valid DOT inspection date.');
      return;
    }
    if (offlineCreate) {
      if (editing) { setSaveError('Editing all vehicle details needs a connection. Use Edit saved details on the vehicle to change fields offline.'); return; }
      if (photo) { setSaveError('Vehicle photos need a connection. Remove the photo to save this vehicle on the device, then add the photo later.'); return; }
      setSaving(true);
      setSaveError('');
      try {
        if (!offlineSync?.detailEditor) throw new Error('Adding vehicles offline needs saved device data. Reconnect to add this vehicle.');
        // The same record (identity and time) is retried until saved; edits start a new record with the same ID.
        const draft = { id: newVehicleId, unit: form.unit.trim(), type: selectedType, year, make: form.make.trim(), model: form.model.trim(), vin: form.vin.trim().toUpperCase(), plate: form.plate.trim().toUpperCase(), notes: form.notes.trim(), status: form.status };
        const previous = offlineVehicle.current;
        const record = previous && Object.entries(draft).every(([key, value]) => JSON.stringify(previous[key]) === JSON.stringify(value)) ? previous : { ...draft, createdAt: new Date().toISOString() };
        offlineVehicle.current = record;
        await offlineSync.detailEditor.createVehicle(record as never);
        router.back();
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Vehicle could not be saved on this device. Try again.');
      } finally {
        setSaving(false);
      }
      return;
    }
    setSaving(true);
    setSaveError('');
    const recordId = vehicle?.id ?? newVehicleId;
    const uploaded: FleetVehicleFile[] = [];
    const replacedPaths: (string | null)[] = [];
    try {
      if(editing)assertFleetRecordVersion('vehicles',recordId,baseVersionRef.current);
      let uploadedPhoto: FleetVehicleFile | undefined;
      if (!editing && photo) {
        uploadedPhoto = await uploadFleetFile(companyId!, user.id, photo);
        uploaded.push(uploadedPhoto);
      }
      const documents = editing
        ? await Promise.all(binderDocuments.flatMap(({ key, label }) => {
            const pending = binderFiles[key];
            const existing = attachedBinderFile(vehicle, label);
            if (!pending && !existing) return [];
            return [(async () => {
              let file = existing!;
              if (pending) {
                file = await uploadFleetFile(companyId!, user.id, pending);
                uploaded.push(file);
                if (existing?.path) replacedPaths.push(existing.path);
              }
              return { id: binderDocumentId(vehicle, key, label), name: label, file, ...(key === 'dotInspection' ? { inspectionDate } : {}) };
            })()];
          }))
        : vehicle?.documents;
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
        ...(!editing && uploadedPhoto ? { photo: uploadedPhoto } : {}),
        ...(editing ? { documents, contract: null, viprChecklist: null, registration: null, insurance: null, dotInspection: null } : {}),
        createdAt: typeof vehicle?.source.createdAt === 'string' ? vehicle.source.createdAt : new Date().toISOString(),
      }, user, editing,{version:baseVersionRef.current,companyId,userId:user.id});
      if (replacedPaths.length) void removeFleetFiles(replacedPaths).catch(() => undefined);
      if (editing) router.dismissTo(`/vehicle/${recordId}`);
      else router.replace(`/vehicle/${recordId}`);
    } catch (error) {
      if (uploaded.length) void removeFleetFiles(uploaded.map((file) => file.path)).catch(() => undefined);
      setSaveError(error instanceof Error ? error.message : 'Vehicle could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (editing && (loading && !vehicle || vehicle && hydratedIdRef.current!==vehicle.id)) {
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
            <Text style={styles.subtitle}>{editing ? 'Keep vehicle identity and readiness details current.' : 'Create a vehicle record for your company resources.'}</Text>
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
            <Text style={styles.sectionTitle}>Registration &amp; notes</Text>
            <Field label="VIN" error={errors.vin} styles={styles}><TextInput style={styles.textInput} value={form.vin} onChangeText={(value) => update('vin', value)} placeholder="17-character VIN" placeholderTextColor={theme.secondary} maxLength={17} autoCapitalize="characters" autoCorrect={false} /></Field>
            <Field label="License plate" styles={styles}><TextInput style={styles.textInput} value={form.plate} onChangeText={(value) => update('plate', value)} placeholder="Plate number" placeholderTextColor={theme.secondary} maxLength={20} autoCapitalize="characters" autoCorrect={false} /></Field>
            {!editing ? <View style={styles.uploadGroup}><Text style={styles.label}>Vehicle photo</Text><Pressable accessibilityRole="button" onPress={() => void choosePhoto()} style={({ pressed }) => [styles.uploadButton, pressed && styles.pressed]}><AppSymbol name={{ ios: 'photo', android: 'image' } as never} color={theme.ember} size={18} /><View style={styles.uploadCopy}><Text style={styles.uploadLabel}>{photo ? 'Replace photo' : 'Choose photo'}</Text><Text style={styles.uploadName} numberOfLines={1}>{photo?.name ?? 'No photo selected'}</Text></View></Pressable></View> : null}
            <Field label="Notes" styles={styles}><TextInput style={[styles.textInput, styles.notesInput]} value={form.notes} onChangeText={(value) => update('notes', value)} placeholder="Anything else to know about this vehicle" placeholderTextColor={theme.secondary} maxLength={2000} multiline textAlignVertical="top" /></Field>
          </View>

          {/* VIPR bid details were removed from this form to match the client sandbox. Saved values are kept on save. */}

          {editing ? <View style={styles.section}><Text style={styles.sectionTitle}>Digital Equipment Binder</Text><Text style={styles.sectionHelp}>Upload image or PDF for each document. Registration and DOT Inspection also support photo capture.</Text><View style={styles.binderList}>{binderDocuments.map(({ key, label }) => { const pending = binderFiles[key]; const existing = attachedBinderFile(vehicle, label); const cameraCapable = key === 'registration' || key === 'dotInspection'; return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${pending || existing ? 'Replace' : 'Upload'} ${label}`} onPress={() => void chooseBinderDocument(key)} style={({ pressed }) => [styles.binderRow, pressed && styles.pressed]}><View style={styles.binderIcon}><AppSymbol name={{ ios: cameraCapable ? 'camera.fill' : 'doc.fill', android: cameraCapable ? 'photo_camera' : 'description' } as never} color={theme.ember} size={18} /></View><View style={styles.uploadCopy}><Text style={styles.binderLabel}>{label}</Text><Text style={styles.uploadName} numberOfLines={1}>{pending?.name ?? existing?.name ?? 'No document attached'}</Text></View><Text style={styles.binderAction}>{pending || existing ? 'Replace' : cameraCapable ? 'Photo / file' : 'Upload'}</Text></Pressable>; })}</View>{(binderFiles.dotInspection || attachedBinderFile(vehicle, 'DOT Inspection')) ? <Field label="DOT inspection date" required styles={styles}><Pressable accessibilityRole="button" accessibilityLabel="Select DOT inspection date" style={styles.binderRow} onPress={() => setDatePickerOpen(open => !open)}><Text style={styles.binderLabel}>{inspectionDate || 'Select inspection date'}</Text></Pressable><Text style={styles.sectionHelp}>Expires {inspectionExpirationDate(inspectionDate) ?? 'one year after inspection'}</Text>{datePickerOpen ? <><DateTimePicker value={inspectionDate ? new Date(`${inspectionDate}T12:00:00`) : new Date()} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={(event, date) => { if (Platform.OS !== 'ios') setDatePickerOpen(false); if (event.type === 'set' && date) setInspectionDate(localDateToday(date)); }}/>{Platform.OS === 'ios' ? <Pressable accessibilityRole="button" onPress={() => setDatePickerOpen(false)}><Text style={styles.binderAction}>Done</Text></Pressable> : null}</> : null}</Field> : null}</View> : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable accessibilityRole="button" disabled={saving} onPress={() => { if (id) router.dismissTo(`/vehicle/${id}`); else router.back(); }} style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}><Text style={styles.cancelLabel}>Cancel</Text></Pressable>
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
    sectionHelp: { color: theme.secondary, fontSize: 13, lineHeight: 18, marginTop: -9 },
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
    choiceSelected: { backgroundColor: theme.ember, borderColor: theme.ember },
    choiceLabel: { color: theme.ink, fontSize: 14, fontWeight: '700' },
    choiceLabelSelected: { color: '#FFFFFF' },
    notesInput: { minHeight: 112, paddingTop: 12 },
    uploadGroup: { gap: 7 },
    uploadButton: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.divider, borderRadius: 11, backgroundColor: theme.canvas },
    uploadCopy: { flex: 1, minWidth: 0, gap: 2 },
    uploadLabel: { color: theme.ember, fontSize: 14, fontWeight: '800' },
    uploadName: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    binderList: { gap: 8 },
    binderRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, borderRadius: 11, backgroundColor: theme.canvas },
    binderIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: theme.paper },
    binderLabel: { color: theme.ink, fontSize: 14, fontWeight: '800' },
    binderAction: { color: theme.ember, fontSize: 13, fontWeight: '800' },
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
