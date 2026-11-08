import { formatRepairReading, recentRepairTypes, suggestRepairTypes, validateFleetRepairDraft } from '@fireops/domain';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip, createShopStyles, useShopMember } from '@/components/shop-ui';
import { useFleetVehicles } from '@/lib/fleet-store';
import { fileFleetRepair, useShop } from '@/lib/shop-store';
import { useFireOpsTheme } from '@/theme';

/** File a repair under a unit at its Motive odometer, or a manual reading with a reason. */
export default function FleetRepairScreen() {
  const params = useLocalSearchParams<{ vehicleId?: string }>();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createShopStyles(theme), [theme]);
  const router = useRouter();
  const { session, access, member, allowed } = useShopMember();
  const companyId = allowed ? member!.company.id : null;
  const shop = useShop(companyId);
  const { vehicles } = useFleetVehicles(companyId);
  const [selectedId, setSelectedId] = useState(params.vehicleId ?? '');
  const [repairTypeText, setRepairTypeText] = useState('');
  const [laborHours, setLaborHours] = useState('');
  const [notes, setNotes] = useState('');
  const [manualValue, setManualValue] = useState('');
  const [manualUnit, setManualUnit] = useState<'miles' | 'hrs'>('miles');
  const [manualReason, setManualReason] = useState('');
  const [openJob, setOpenJob] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const vehicle = vehicles.find((item) => item.id === selectedId) ?? (params.vehicleId ? undefined : vehicles[0]);
  const odometer = vehicle?.motive?.odometerMiles;
  const motive = typeof odometer === 'number' && Number.isFinite(odometer) ? { value: odometer, locatedAt: vehicle?.motive?.updatedAt } : null;
  const suggestions = repairTypeText.trim() ? suggestRepairTypes(shop.repairTypes, repairTypeText, 6).filter((type) => type.nameNormalized !== repairTypeText.trim().toLowerCase()) : [];
  const recent = recentRepairTypes(shop.repairTypes);
  const quickPicks = recent.length ? recent : suggestRepairTypes(shop.repairTypes, '', 6);

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (access.status === 'ready' && !allowed) return <Redirect href="/" />;

  const submit = async () => {
    if (busy) return;
    const draftError = validateFleetRepairDraft({ repairTypeText, hasMotiveReading: Boolean(motive), manualReadingValue: manualValue, manualReason, laborHours });
    if (draftError || !vehicle) { setError(draftError ?? 'Choose the unit.'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await fileFleetRepair({
        vehicleId: vehicle.id, repairTypeText: repairTypeText.trim(), notes: notes.trim(), openJob,
        laborHours: laborHours.trim() ? Number(laborHours) : undefined,
        ...(motive ? {} : { manualReadingValue: Number(manualValue), manualReadingUnit: manualUnit, manualReason: manualReason.trim() }),
      });
      router.replace((result.shopJobId ? `/shop/job/${result.shopJobId}` : `/shop/unit/${vehicle.id}`) as never);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The repair could not be filed.');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Log a fleet repair' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.legend}>UNIT</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {vehicles.map((item) => <Chip key={item.id} label={item.name} selected={item.id === vehicle?.id} onPress={() => setSelectedId(item.id)} />)}
        </ScrollView>
        {!vehicles.length ? <Text style={styles.meta}>No fleet units available.</Text> : null}
        <Text style={styles.legend}>REPAIR TYPE</Text>
        <TextInput style={styles.input} value={repairTypeText} onChangeText={setRepairTypeText} maxLength={120} placeholder="Brakes, Oil change…" placeholderTextColor={theme.secondary} autoCorrect={false} />
        <View style={styles.row}>
          {(suggestions.length ? suggestions : repairTypeText.trim() ? [] : quickPicks).map((type) => <Chip key={type.id} label={type.name} onPress={() => setRepairTypeText(type.name)} />)}
        </View>
        <View style={styles.reading}>
          <Text style={styles.meta}>Odometer</Text>
          {motive ? (
            <>
              <Text style={styles.readingValue}>{formatRepairReading(motive.value, 'miles')}</Text>
              <Text style={styles.badge}>MOTIVE</Text>
              <Text style={styles.meta}>The repair is filed at Motive’s latest reading{motive.locatedAt ? ` (${motive.locatedAt})` : ''}.</Text>
            </>
          ) : (
            <>
              <Text style={styles.meta}>No Motive reading for this unit. Enter the reading and why it’s manual; manual readings are recorded in the audit log.</Text>
              <TextInput style={styles.input} value={manualValue} onChangeText={setManualValue} placeholder="Reading" placeholderTextColor={theme.secondary} keyboardType="decimal-pad" />
              <View style={styles.row}>
                <Chip label="Miles" selected={manualUnit === 'miles'} onPress={() => setManualUnit('miles')} />
                <Chip label="Engine hours" selected={manualUnit === 'hrs'} onPress={() => setManualUnit('hrs')} />
              </View>
              <TextInput style={styles.input} value={manualReason} onChangeText={setManualReason} maxLength={500} placeholder="Reason for manual reading" placeholderTextColor={theme.secondary} />
            </>
          )}
        </View>
        <TextInput style={styles.input} value={laborHours} onChangeText={setLaborHours} placeholder="Labor hours (optional)" placeholderTextColor={theme.secondary} keyboardType="decimal-pad" />
        <TextInput style={[styles.input, styles.area]} value={notes} onChangeText={setNotes} maxLength={4000} placeholder="Notes / parts used" placeholderTextColor={theme.secondary} multiline />
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: openJob }} onPress={() => setOpenJob((value) => !value)} style={styles.check}>
          <Text style={styles.checkText}>{openJob ? '☑' : '☐'} Open a follow-up shop task</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy || !vehicle} style={[styles.primary, (busy || !vehicle) && styles.disabled]} onPress={() => void submit()}>
          <Text style={styles.primaryText}>{busy ? 'Filing…' : `File repair${vehicle ? ` under ${vehicle.name}` : ''}`}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
