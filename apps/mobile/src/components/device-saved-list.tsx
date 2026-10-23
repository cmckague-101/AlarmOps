import { Text, View } from 'react-native';
import { useFireOpsTheme } from '@/theme';

type Row = { id: string; title: string; detail?: string; state: 'saved' | 'action_needed' | 'posted' };

/** Records created on this device that the shown list does not include yet. */
export function DeviceSavedList({ rows }: { rows: readonly Row[] }) {
  const theme = useFireOpsTheme();
  if (!rows.length) return null;
  const label = (state: Row['state']) => state === 'action_needed' ? 'Saved on this device — needs attention in Saved changes & sync' : state === 'posted' ? 'Synced — refreshing list' : 'Saved on this device — added when connected';
  return <View style={{ gap: 8, padding: 12, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper }}>
    {rows.map((row) => <View key={row.id} style={{ gap: 2 }}>
      <Text numberOfLines={1} style={{ color: theme.ink, fontSize: 15, fontWeight: '700' }}>{row.title}</Text>
      {row.detail ? <Text numberOfLines={1} style={{ color: theme.secondary, fontSize: 12 }}>{row.detail}</Text> : null}
      <Text style={{ color: theme.secondary, fontSize: 12 }}>{label(row.state)}</Text>
    </View>)}
  </View>;
}
