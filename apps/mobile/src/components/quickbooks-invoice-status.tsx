import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { qboInvoiceAction, qboStatusLabel, type InvoiceForm, type QboSyncStatus } from '@fireops/domain';
import { AppSymbol } from '@/components/app-symbol';
import { mergeInvoiceChanges } from '@/lib/invoice-store';
import { syncInvoiceToQuickbooks } from '@/lib/quickbooks';
import { type FireOpsTheme, useFireOpsTheme } from '@/theme';

/** QuickBooks status pill for invoice lists (owners and accounting, when the add-on is on and connected). */
export function QuickbooksBadge({ status }: { status: QboSyncStatus | undefined }) {
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const value = status ?? 'not_synced';
  return <Text accessibilityLabel={`QuickBooks: ${qboStatusLabel(value)}`} style={[styles.badge, badgeStyle(styles, value)]}>QB · {qboStatusLabel(value)}</Text>;
}

const badgeStyle = (styles: ReturnType<typeof createStyles>, status: QboSyncStatus) =>
  ({ not_synced: styles.notSynced, synced: styles.synced, out_of_sync: styles.outOfSync, needs_attention: styles.attention })[status];

/** Invoice details: QuickBooks status with Sync to QuickBooks / Push update to QuickBooks. Matching customers is on the web. */
export function QuickbooksInvoiceStatus({ companyId, form, offline, onChange }: { companyId: string; form: InvoiceForm; offline: boolean; onChange: (form: InvoiceForm) => void }) {
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const action = qboInvoiceAction(form);
  const status = form.qboSyncStatus ?? 'not_synced';
  async function run() {
    if (!action || busy) return;
    setBusy(true); setError('');
    try {
      const result = await syncInvoiceToQuickbooks(companyId, form.id, action);
      onChange(mergeInvoiceChanges(form.id, result.changes) ?? { ...form, ...result.changes });
      if (result.error) setError(result.error);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'QuickBooks sync failed.');
    } finally {
      setBusy(false);
    }
  }
  const message = error || form.qboLastError || '';
  return <View style={styles.card} accessibilityLabel="QuickBooks">
    <View style={styles.head}><Text style={styles.title}>QuickBooks</Text><Text style={[styles.badge, badgeStyle(styles, status)]}>{qboStatusLabel(status)}</Text></View>
    {form.qboSyncedAt ? <Text style={styles.help}>Last sent {new Date(form.qboSyncedAt).toLocaleString()}</Text> : null}
    {status === 'out_of_sync' ? <Text style={styles.help}>Changed in FireOps after it was sent. Push the update to QuickBooks.</Text> : null}
    {form.qboPaymentPending ? <Text style={styles.help}>The payment is waiting to be recorded in QuickBooks.</Text> : null}
    {message ? <Text style={status === 'needs_attention' || error ? styles.error : styles.help}>{message}</Text> : null}
    {status === 'needs_attention' && /Match customer/.test(message) ? <Text style={styles.help}>Match customers in Settings on the FireOps website.</Text> : null}
    {action ? <Pressable accessibilityRole="button" disabled={busy || offline} onPress={() => void run()} style={[styles.button, (busy || offline) && styles.disabled]}>
      <AppSymbol name={{ ios: 'arrow.triangle.2.circlepath', android: 'sync' } as never} color={theme.ink} size={18} />
      <Text style={styles.buttonText}>{busy ? 'Sending…' : offline ? 'QuickBooks needs a connection' : action === 'sync' ? 'Sync to QuickBooks' : 'Push update to QuickBooks'}</Text>
    </Pressable> : null}
  </View>;
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    card: { gap: 8, padding: 14, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    title: { color: theme.ink, fontSize: 15, fontWeight: '800' },
    badge: { overflow: 'hidden', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, fontSize: 11, fontWeight: '800' },
    notSynced: { color: theme.secondary, backgroundColor: theme.surfaceAlt },
    synced: { color: theme.green, backgroundColor: theme.greenSurface },
    outOfSync: { color: theme.blue, backgroundColor: theme.blueSurface },
    attention: { color: theme.warning, backgroundColor: theme.warningSurface },
    help: { color: theme.secondary, fontSize: 12, lineHeight: 17 },
    error: { color: theme.danger, backgroundColor: theme.dangerSurface, padding: 10, borderRadius: 9, fontSize: 13, lineHeight: 18 },
    button: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: theme.ink, borderRadius: 10, backgroundColor: theme.paper },
    buttonText: { color: theme.ink, fontWeight: '800' },
    disabled: { opacity: 0.45 },
  });
}
