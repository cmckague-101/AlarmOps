import { Text } from 'react-native';
import type { DownloadedListInfo } from '@/lib/offline-company-lists';
import { useFireOpsTheme } from '@/theme';

/** Says a list is the verified offline download (and how old it is), not live data. */
export function DownloadedListNotice({ info }: { info: DownloadedListInfo | null | undefined }) {
  const theme = useFireOpsTheme();
  if (!info) return null;
  const at = new Date(info.serverRequestAt).toLocaleString();
  return <Text accessibilityRole="text" style={{ color: theme.secondary, fontSize: 12, lineHeight: 17 }}>Offline — showing the list downloaded {at}. Changes saved on this device are shown on top.</Text>;
}
