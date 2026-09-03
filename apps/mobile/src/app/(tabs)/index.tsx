import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { refreshFleet, useFleetVehicles } from '@/lib/fleet-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

const READY_STATUSES = ['ready', 'available', 'in service', 'active'];
const ATTENTION_STATUSES = ['maintenance', 'inspection', 'out of service', 'offline'];

function normalized(status: string) {
  return status.trim().toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ');
}

export default function DashboardScreen() {
  const theme = useFireOpsTheme();
  const { access } = useSession();
  const companyId = access.value?.kind === 'member' ? access.value.company.id : null;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { vehicles, loading, refreshing, error } = useFleetVehicles(companyId);
  const ready = vehicles.filter((vehicle) => READY_STATUSES.includes(normalized(vehicle.status))).length;
  const attention = vehicles.filter((vehicle) => ATTENTION_STATUSES.includes(normalized(vehicle.status))).length;
  const assigned = Math.max(vehicles.length - ready - attention, 0);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshFleet} tintColor={theme.command} />}
      >
        <View style={styles.headingGroup}>
          <Text style={styles.title}>Dashboard</Text>
          <Text style={styles.subtitle}>Live fleet readiness across your department.</Text>
        </View>

        {loading ? <Text style={styles.stateText}>Loading fleet status…</Text> : null}

        {error ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorTitle}>Fleet data unavailable</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={refreshFleet} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error ? (
          <>
            <View style={styles.readinessBlock}>
              <View style={styles.readinessHeading}>
                <Text style={styles.sectionTitle}>Fleet readiness</Text>
                <Text style={styles.total}>{vehicles.length} total</Text>
              </View>
              <View style={styles.metrics}>
                <View style={styles.metric}>
                  <Text style={[styles.metricValue, styles.readyValue]}>{ready}</Text>
                  <Text style={styles.metricLabel}>Ready</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>{assigned}</Text>
                  <Text style={styles.metricLabel}>Assigned</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.metric}>
                  <Text style={[styles.metricValue, attention > 0 && styles.attentionValue]}>{attention}</Text>
                  <Text style={styles.metricLabel}>Attention</Text>
                </View>
              </View>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.sectionTitle}>Current picture</Text>
              <Text style={styles.summaryText}>
                {vehicles.length === 0
                  ? 'No vehicles have been added yet.'
                  : attention > 0
                    ? `${attention} ${attention === 1 ? 'vehicle needs' : 'vehicles need'} attention.`
                    : 'All reported vehicles are operational.'}
              </Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.canvas },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, gap: 28 },
  headingGroup: { gap: 6 },
  title: { color: theme.command, fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
  subtitle: { color: '#56635B', fontSize: 16, lineHeight: 23 },
  stateText: { color: '#56635B', fontSize: 16, paddingVertical: 28 },
  readinessBlock: { backgroundColor: theme.greenSurface, borderRadius: 18, padding: 20, gap: 22 },
  readinessHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { color: theme.command, fontSize: 18, lineHeight: 23, fontWeight: '700' },
  total: { color: '#56635B', fontSize: 14, fontVariant: ['tabular-nums'] },
  metrics: { flexDirection: 'row', alignItems: 'stretch' },
  metric: { flex: 1, gap: 5 },
  metricValue: { color: theme.command, fontSize: 30, lineHeight: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  readyValue: { color: '#176B4D' },
  attentionValue: { color: '#9A3F35' },
  metricLabel: { color: '#56635B', fontSize: 13, lineHeight: 18 },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: '#B9CBC1', marginHorizontal: 14 },
  summaryRow: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#CBD3CE', paddingTop: 20 },
  summaryText: { color: '#56635B', fontSize: 16, lineHeight: 23 },
  errorBlock: { backgroundColor: '#F8E9E6', borderRadius: 16, padding: 18, gap: 8 },
  errorTitle: { color: '#702C26', fontSize: 17, fontWeight: '700' },
  errorText: { color: '#702C26', fontSize: 14, lineHeight: 20 },
  retryButton: { alignSelf: 'flex-start', backgroundColor: theme.command, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, marginTop: 6 },
  retryLabel: { color: theme.canvas, fontSize: 15, fontWeight: '700' },
  });
}
