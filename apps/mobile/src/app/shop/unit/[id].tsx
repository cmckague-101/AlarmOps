import { filterShopJobs, rankShopJobs, repairHistoryEntries, repairHistoryHtml, shopBoardStatuses, shopStatusLabel, type ShopBoardFilter, type ShopJob } from '@fireops/domain';
import * as Print from 'expo-print';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip, JobRow, createShopStyles, useShopMember } from '@/components/shop-ui';
import { useFleetVehicles } from '@/lib/fleet-store';
import { refreshShop, useShop } from '@/lib/shop-store';
import { useFireOpsTheme } from '@/theme';

/** One board group: a fleet unit, General shop, or Critical tasks across the shop. */
export default function ShopUnitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createShopStyles(theme), [theme]);
  const router = useRouter();
  const { session, access, member, allowed } = useShopMember();
  const companyId = allowed ? member!.company.id : null;
  const shop = useShop(companyId);
  const { vehicles } = useFleetVehicles(companyId);
  const [filter, setFilter] = useState<ShopBoardFilter>('open');
  const [segment, setSegment] = useState<'tasks' | 'history'>('tasks');
  const [exporting, setExporting] = useState(false);
  const vehicle = vehicles.find((item) => item.id === id);
  const unitById = useMemo(() => new Map(vehicles.map((item) => [item.id, item.name])), [vehicles]);
  const scope = id === 'critical' || id === 'general' ? id : 'vehicle';

  const jobs = useMemo(() => {
    const inScope = (job: ShopJob) => scope === 'critical' ? job.priority === 'critical' : scope === 'general' ? job.kind === 'general' : job.fleetVehicleId === id;
    return rankShopJobs(filterShopJobs(shop.jobs.filter(inScope), filter, '', () => undefined));
  }, [shop.jobs, filter, scope, id]);
  const history = useMemo(() => {
    if (scope === 'general') return repairHistoryEntries(shop.jobs.filter((job) => job.kind === 'general'), [], shop.notes);
    if (scope === 'vehicle') return repairHistoryEntries(shop.jobs.filter((job) => job.fleetVehicleId === id), shop.repairs.filter((repair) => repair.fleetVehicleId === id), shop.notes);
    return [];
  }, [scope, id, shop.jobs, shop.notes, shop.repairs]);

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (access.status === 'ready' && !allowed) return <Redirect href="/" />;

  const title = scope === 'critical' ? 'Critical tasks' : scope === 'general' ? 'General shop' : vehicle?.name ?? 'Fleet unit';
  const subtitle = scope === 'critical' ? 'Open critical work across fleet and general shop' : scope === 'general' ? 'Tasks not tied to a fleet vehicle' : vehicle?.type ?? '';
  const contextFor = (job: ShopJob) => scope !== 'critical' ? undefined : job.kind === 'fleet' ? unitById.get(job.fleetVehicleId ?? '') ?? 'Fleet' : job.shopArea || 'General shop';

  const exportHistory = async () => {
    if (exporting || !history.length) return;
    setExporting(true);
    try {
      const result = await Print.printToFileAsync({ html: repairHistoryHtml({ title, subtitle: scope === 'vehicle' ? `${subtitle} · Completed repairs` : 'Completed repairs' }, history) });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(result.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Save or share repair history' });
      else await Print.printAsync({ uri: result.uri });
    } catch (caught) {
      Alert.alert('Repair history not exported', caught instanceof Error ? caught.message : 'Please try again.');
    } finally { setExporting(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={shop.refreshing} onRefresh={() => void refreshShop()} tintColor={theme.ember} />}>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {shop.error ? <Text style={styles.error}>{shop.error}</Text> : null}
        {scope !== 'critical' ? (
          <View style={styles.segment}>
            {(['tasks', 'history'] as const).map((value) => (
              <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: segment === value }} onPress={() => setSegment(value)} style={[styles.segmentItem, segment === value && styles.segmentSelected]}>
                <Text style={[styles.segmentText, segment === value && styles.segmentTextSelected]}>{value === 'tasks' ? 'Tasks to complete' : `Repair history${history.length ? ` (${history.length})` : ''}`}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {segment === 'history' && scope !== 'critical' ? (
          <>
            <Pressable accessibilityRole="button" disabled={!history.length || exporting} style={[styles.secondary, (!history.length || exporting) && styles.disabled]} onPress={() => void exportHistory()}>
              <Text style={styles.secondaryText}>{exporting ? 'Preparing PDF…' : 'Export PDF'}</Text>
            </Pressable>
            {history.map((entry) => (
              <Pressable key={entry.id} disabled={!entry.jobId} onPress={() => entry.jobId && router.push(`/shop/job/${entry.jobId}` as never)} style={styles.card}>
                <Text style={styles.title}>{entry.title}</Text>
                <Text style={styles.meta}>{entry.meta}</Text>
                <Text style={styles.meta}>{entry.kind === 'job' ? 'Closed' : 'Filed'} {new Date(entry.date).toLocaleDateString()}</Text>
                {entry.notes.trim() ? <Text style={styles.noteBody} numberOfLines={3}>{entry.notes.trim()}</Text> : null}
              </Pressable>
            ))}
            {!history.length ? <Text style={styles.empty}>Closed work for this {scope === 'general' ? 'shop area' : 'unit'} will show up here.</Text> : null}
          </>
        ) : (
          <>
            {scope !== 'critical' ? (
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.push((scope === 'general' ? '/shop/new?kind=general' : `/shop/new?vehicleId=${id}`) as never)}>
                  <Text style={styles.secondaryText}>+ Add task</Text>
                </Pressable>
                {scope === 'vehicle' ? (
                  <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => router.push(`/shop/repair?vehicleId=${id}` as never)}>
                    <Text style={styles.secondaryText}>Log repair</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Chip label="All open" selected={filter === 'open'} onPress={() => setFilter('open')} />
              {shopBoardStatuses.map((status) => <Chip key={status} label={shopStatusLabel(status)} selected={filter === status} onPress={() => setFilter(status)} />)}
            </ScrollView>
            {jobs.map((job) => <JobRow key={job.id} job={job} context={contextFor(job)} onPress={() => router.push(`/shop/job/${job.id}` as never)} />)}
            {!shop.loading && !jobs.length ? <Text style={styles.empty}>{scope === 'critical' ? 'No open critical tasks right now.' : 'No open tasks.'}</Text> : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
