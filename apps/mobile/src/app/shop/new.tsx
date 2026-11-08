import { SHOP_PARTS_BLOCKER, shopBoardStatuses, shopJobPriorities, shopPriorityLabel, shopStatusLabel, type ShopJobPriority, type ShopJobStatus } from '@fireops/domain';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip, createShopStyles, useShopMember } from '@/components/shop-ui';
import { useFleetVehicles } from '@/lib/fleet-store';
import { createShopJob } from '@/lib/shop-store';
import { useFireOpsTheme } from '@/theme';

export default function NewShopJobScreen() {
  const params = useLocalSearchParams<{ vehicleId?: string; kind?: string }>();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createShopStyles(theme), [theme]);
  const router = useRouter();
  const { session, access, member, allowed } = useShopMember();
  const { vehicles } = useFleetVehicles(allowed ? member!.company.id : null);
  const [kind, setKind] = useState<'general' | 'fleet'>(params.vehicleId ? 'fleet' : 'general');
  const [vehicleId, setVehicleId] = useState(params.vehicleId ?? '');
  const [shopArea, setShopArea] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<ShopJobPriority>('medium');
  const [status, setStatus] = useState<ShopJobStatus>('queued');
  const [assignToMe, setAssignToMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (access.status === 'ready' && !allowed) return <Redirect href="/" />;

  const submit = async () => {
    if (busy) return;
    const resolvedTitle = title.trim() || description.trim().split('\n')[0]?.slice(0, 160) || '';
    if (!resolvedTitle) { setError('Give the task a title.'); return; }
    if (kind === 'fleet' && !vehicles.some((vehicle) => vehicle.id === vehicleId)) { setError('Choose the unit.'); return; }
    setBusy(true);
    setError('');
    try {
      const job = await createShopJob({
        title: resolvedTitle, description: description.trim(), priority, status, assignToMe, kind,
        blockerReason: status === 'parts' ? SHOP_PARTS_BLOCKER : undefined,
        shopArea: kind === 'general' ? shopArea.trim() || undefined : undefined,
        fleetVehicleId: kind === 'fleet' ? vehicleId : undefined,
      });
      router.replace(`/shop/job/${job.id}` as never);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The task could not be created.');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: 'New shop task' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.legend}>WHAT&apos;S IT FOR?</Text>
        <View style={styles.row}>
          <Chip label="General shop" selected={kind === 'general'} onPress={() => setKind('general')} />
          <Chip label="Fleet vehicle" selected={kind === 'fleet'} onPress={() => setKind('fleet')} />
        </View>
        {kind === 'general' ? (
          <TextInput style={styles.input} placeholder="Shop area or equipment (optional)" placeholderTextColor={theme.secondary} value={shopArea} onChangeText={setShopArea} maxLength={160} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {vehicles.map((vehicle) => <Chip key={vehicle.id} label={vehicle.name} selected={vehicleId === vehicle.id} onPress={() => setVehicleId(vehicle.id)} />)}
          </ScrollView>
        )}
        <Text style={styles.legend}>TASK</Text>
        <TextInput style={styles.input} placeholder="Short task title" placeholderTextColor={theme.secondary} value={title} onChangeText={setTitle} maxLength={160} />
        <TextInput style={[styles.input, styles.area]} placeholder="Describe the work needed" placeholderTextColor={theme.secondary} value={description} onChangeText={setDescription} maxLength={4000} multiline />
        <Text style={styles.legend}>PRIORITY</Text>
        <View style={styles.row}>
          {shopJobPriorities.map(({ value }) => <Chip key={value} label={shopPriorityLabel(value)} selected={priority === value} onPress={() => setPriority(value)} />)}
        </View>
        <Text style={styles.legend}>STARTING STATUS</Text>
        <View style={styles.row}>
          {shopBoardStatuses.map((value) => <Chip key={value} label={shopStatusLabel(value)} selected={status === value} onPress={() => setStatus(value)} />)}
        </View>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: assignToMe }} onPress={() => setAssignToMe((value) => !value)} style={styles.check}>
          <Text style={styles.checkText}>{assignToMe ? '☑' : '☐'} Assign to me</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} style={[styles.primary, busy && styles.disabled]} onPress={() => void submit()}>
          <Text style={styles.primaryText}>{busy ? 'Creating…' : 'Create task'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
