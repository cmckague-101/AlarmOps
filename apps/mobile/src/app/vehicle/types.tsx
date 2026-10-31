import { useMemo, useState } from 'react';
import { Redirect, Stack, useRouter } from 'expo-router';
import {
  Alert,
  KeyboardAvoidingView,
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
import { useFleetVehicles } from '@/lib/fleet-store';
import { addVehicleType, removeVehicleType, type VehicleType, useVehicleTypes } from '@/lib/vehicle-type-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

export default function VehicleTypesScreen() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const companyId = access.value?.kind === 'member' ? access.value.company.id : null;
  const user = access.value?.kind === 'member' ? access.value.user : null;
  const { vehicles } = useFleetVehicles(companyId);
  const { types, loading, error: loadError } = useVehicleTypes(companyId);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (access.status === 'idle' || access.status === 'loading') return <SafeAreaView style={styles.safeArea}><Text style={styles.loading}>Checking fleet access…</Text></SafeAreaView>;
  if (!companyId || !user || user.role !== 'owner' && user.role !== 'admin') return <Redirect href="/(tabs)/fleet" />;

  const add = async () => {
    const value = name.trim();
    if (!value || busy) return;
    if (types.some((type) => type.name.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      setActionError('Vehicle type already exists.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      await addVehicleType(companyId, value);
      setName('');
    } catch (addError) {
      setActionError(addError instanceof Error ? addError.message : 'Vehicle type could not be added.');
    } finally {
      setBusy(false);
    }
  };

  const usageCount = (type: VehicleType) => vehicles.filter((vehicle) => vehicle.type.trim().toLocaleLowerCase() === type.name.toLocaleLowerCase()).length;

  const confirmRemove = (type: VehicleType) => {
    const count = usageCount(type);
    if (count) {
      Alert.alert('Vehicle type in use', `${type.name} is assigned to ${count} ${count === 1 ? 'vehicle' : 'vehicles'}. Change those vehicles before removing this type.`);
      return;
    }
    if (types.length === 1) {
      Alert.alert('Keep one vehicle type', 'Add another vehicle type before removing this one.');
      return;
    }
    Alert.alert(`Remove ${type.name}?`, 'This removes it from vehicle type choices.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(type.id);
          setActionError('');
          try {
            await removeVehicleType(companyId, type);
          } catch (removeError) {
            setActionError(removeError instanceof Error ? removeError.message : 'Vehicle type could not be removed.');
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Vehicle types' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={92}>
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled">
          <View style={styles.intro}>
            <Text style={styles.title}>Vehicle types</Text>
            <Text style={styles.subtitle}>Add choices used when creating or editing vehicles. Types assigned to vehicles cannot be removed.</Text>
          </View>

          {loadError || actionError ? <View style={styles.errorBanner}><Text style={styles.errorText}>{actionError || loadError}</Text></View> : null}

          <View style={styles.addCard}>
            <Text style={styles.cardTitle}>Add vehicle type</Text>
            <View style={styles.addRow}>
              <TextInput
                accessibilityLabel="Vehicle type name"
                style={styles.input}
                value={name}
                onChangeText={(value) => { setName(value); setActionError(''); }}
                placeholder="e.g. Command Vehicle"
                placeholderTextColor={theme.secondary}
                maxLength={80}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={() => void add()}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="Add vehicle type" disabled={!name.trim() || busy} onPress={() => void add()} style={({ pressed }) => [styles.addButton, (!name.trim() || busy) && styles.disabled, pressed && styles.pressed]}>
                <AppSymbol name="plus" color={theme.commandText} size={20} />
                <Text style={styles.addLabel}>{busy ? 'Adding…' : 'Add'}</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.listCard}>
            <View style={styles.listHeader}>
              <Text style={styles.cardTitle}>Available types</Text>
              <Text style={styles.count}>{types.length}</Text>
            </View>
            {loading && !types.length ? <Text style={styles.empty}>Loading vehicle types…</Text> : null}
            {!loading && !types.length ? <Text style={styles.empty}>No vehicle types yet. Add one above.</Text> : null}
            {types.map((type) => {
              const count = usageCount(type);
              const cannotRemove = count > 0 || types.length === 1;
              return (
                <View key={type.id} style={styles.typeRow}>
                  <View style={styles.typeCopy}>
                    <Text style={styles.typeName}>{type.name}</Text>
                    <Text style={styles.typeUsage}>{count ? `${count} ${count === 1 ? 'vehicle' : 'vehicles'}` : 'Not in use'}</Text>
                  </View>
                  {count ? null : <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${type.name}`}
                    accessibilityHint={count ? 'Change vehicles using this type first' : types.length === 1 ? 'Add another type first' : undefined}
                    disabled={deletingId !== null}
                    onPress={() => confirmRemove(type)}
                    style={({ pressed }) => [styles.removeButton, cannotRemove && styles.removeButtonUnavailable, deletingId === type.id && styles.disabled, pressed && styles.pressed]}
                  >
                    <AppSymbol name="trash" color={cannotRemove ? theme.secondary : theme.danger} size={18} />
                  </Pressable>}
                </View>
              );
            })}
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={({ pressed }) => [styles.doneButton, pressed && styles.doneButtonPressed]}><Text style={styles.doneLabel}>Done</Text></Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
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
    errorBanner: { backgroundColor: theme.dangerSurface, borderRadius: 12, padding: 14 },
    errorText: { color: theme.danger, fontSize: 14, lineHeight: 20, fontWeight: '600' },
    addCard: { backgroundColor: theme.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, borderRadius: 16, padding: 16, gap: 12 },
    cardTitle: { color: theme.ink, fontSize: 17, lineHeight: 22, fontWeight: '800' },
    addRow: { flexDirection: 'row', gap: 10 },
    input: { flex: 1, minWidth: 0, height: 48, borderWidth: 1, borderColor: theme.divider, borderRadius: 11, paddingHorizontal: 13, backgroundColor: theme.canvas, color: theme.ink, fontSize: 16 },
    addButton: { minHeight: 48, minWidth: 92, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, backgroundColor: theme.ember, paddingHorizontal: 14 },
    addLabel: { color: theme.commandText, fontSize: 14, fontWeight: '800' },
    listCard: { overflow: 'hidden', backgroundColor: theme.paper, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, borderRadius: 16 },
    listHeader: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.divider },
    count: { color: theme.secondary, fontSize: 13, fontWeight: '700' },
    empty: { color: theme.secondary, fontSize: 14, lineHeight: 20, padding: 16 },
    typeRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.divider },
    typeCopy: { flex: 1, gap: 3 },
    typeName: { color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    typeUsage: { color: theme.secondary, fontSize: 12, lineHeight: 16 },
    removeButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.dangerSurface },
    removeButtonUnavailable: { backgroundColor: theme.canvas },
    footer: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 8 : 16, borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, backgroundColor: theme.paper },
    doneButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.command },
    doneButtonPressed: { opacity: 0.78 },
    doneLabel: { color: theme.commandText, fontSize: 15, fontWeight: '800' },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.72 },
  });
}
