import { filterShopJobs, groupShopJobsByVehicle, rankShopJobs, shopBoardStatuses, shopStatusLabel, type ShopBoardFilter, type ShopJob } from '@fireops/domain';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { BoardCard, Chip, createShopStyles, useShopMember } from '@/components/shop-ui';
import { useFleetVehicles } from '@/lib/fleet-store';
import { refreshShop, useShop } from '@/lib/shop-store';
import { useFireOpsTheme } from '@/theme';

export default function ShopBoardScreen() {
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createShopStyles(theme), [theme]);
  const router = useRouter();
  const { session, access, member, allowed } = useShopMember();
  const companyId = allowed ? member!.company.id : null;
  const shop = useShop(companyId);
  const { vehicles } = useFleetVehicles(companyId);
  const [filter, setFilter] = useState<ShopBoardFilter>('open');
  const [query, setQuery] = useState('');

  const units = useMemo(() => vehicles.map((vehicle) => ({ ...vehicle, unit: vehicle.name })), [vehicles]);
  const unitById = useMemo(() => new Map(units.map((unit) => [unit.id, unit.unit])), [units]);
  const visible = useMemo(() => rankShopJobs(filterShopJobs(shop.jobs, filter, query, (job: ShopJob) => job.fleetVehicleId ? unitById.get(job.fleetVehicleId) : undefined)), [shop.jobs, filter, query, unitById]);
  const groups = useMemo(() => groupShopJobsByVehicle(units, visible, shop.jobs), [units, visible, shop.jobs]);
  const open = shop.jobs.filter((job) => job.status !== 'done');
  const critical = visible.filter((job) => job.priority === 'critical');
  const general = visible.filter((job) => job.kind === 'general');
  const preview = (jobs: ShopJob[]) => jobs[0] ? `${jobs[0].title}${jobs.length > 1 ? ` +${jobs.length - 1} more` : ''}` : undefined;

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (access.status === 'ready' && !allowed) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{
        title: 'Shop tasks',
        headerRight: () => (
          <Pressable accessibilityRole="button" accessibilityLabel="New shop task" onPress={() => router.push('/shop/new' as never)} style={styles.headerAction}>
            <Text style={styles.headerActionText}>+ New task</Text>
          </Pressable>
        ),
      }} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={shop.refreshing} onRefresh={() => void refreshShop()} tintColor={theme.ember} />}>
        <Text style={styles.subtitle}>{open.length} open · {open.filter((job) => job.status === 'parts').length} waiting on parts</Text>
        {shop.error ? <Text style={styles.error}>{shop.error}</Text> : null}
        <TextInput accessibilityLabel="Search shop jobs" placeholder="Search units or jobs" placeholderTextColor={theme.secondary} value={query} onChangeText={setQuery} style={styles.search} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="All open" selected={filter === 'open'} onPress={() => setFilter('open')} />
          {shopBoardStatuses.map((status) => <Chip key={status} label={shopStatusLabel(status)} selected={filter === status} onPress={() => setFilter(status)} />)}
        </ScrollView>
        {shop.loading ? <Text style={styles.empty}>Loading shop jobs…</Text> : (
          <>
            <BoardCard critical title="Critical tasks" subtitle="Open critical work across fleet and general shop" count={open.filter((job) => job.priority === 'critical').length}
              preview={preview(critical)} icon={<AppSymbol name={{ ios: 'flame.fill', android: 'local_fire_department' }} size={22} color="#fff" />}
              onPress={() => router.push('/shop/unit/critical' as never)} />
            <BoardCard title="General shop" subtitle="Not tied to a fleet vehicle" count={open.filter((job) => job.kind === 'general').length}
              preview={preview(general)} icon={<AppSymbol name={{ ios: 'building.2.fill', android: 'warehouse' }} size={22} color={theme.secondary} />}
              onPress={() => router.push('/shop/unit/general' as never)} />
            {groups.map(({ vehicle, jobs, openCount }) => (
              <BoardCard key={vehicle.id} title={vehicle.unit} subtitle={vehicle.type} count={openCount} preview={preview(jobs)}
                icon={<AppSymbol name={{ ios: 'truck.box.fill', android: 'local_shipping' }} size={22} color={theme.secondary} />}
                onPress={() => router.push(`/shop/unit/${vehicle.id}` as never)} />
            ))}
            {units.length ? (
              <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.push('/shop/repair' as never)}>
                <Text style={styles.secondaryText}>Log a fleet repair</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
