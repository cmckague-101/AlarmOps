import type { InventoryItem } from '@fireops/domain';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSymbol } from '@/components/app-symbol';
import { deleteInventoryItem, refreshInventory, updateInventoryItem, useInventory } from '@/lib/inventory-store';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

export default function InventoryScreen() {
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  const { items, loading, refreshing, error } = useInventory(member?.user.role === 'owner' ? member.company.id : null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const filtered = items.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const total = items.reduce((sum, item) => sum + item.quantity, 0);

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (member && member.user.role !== 'owner') return <Redirect href="/(tabs)/more" />;

  const updateQuantity = async (item: InventoryItem, quantity: number) => {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999999 || quantity === item.quantity || busyId) return;
    setBusyId(item.id);
    setActionError('');
    try {
      await updateInventoryItem(item, { quantity });
    } catch (updateError) {
      setActionError(updateError instanceof Error ? updateError.message : 'Quantity could not be updated.');
    } finally {
      setBusyId('');
    }
  };

  const confirmDelete = (item: InventoryItem) => Alert.alert(
    `Delete ${item.name}?`,
    'This removes item and its current quantity from company inventory. This action cannot be undone.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete item', style: 'destructive', onPress: () => {
        setBusyId(item.id);
        setActionError('');
        void deleteInventoryItem(item).catch((deleteError) => {
          setActionError(deleteError instanceof Error ? deleteError.message : 'Item could not be deleted.');
        }).finally(() => setBusyId(''));
      } },
    ],
  );

  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <Stack.Screen options={{ title: 'Inventory' }} />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshInventory} tintColor={theme.commandForeground} />}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}><Text accessibilityRole="header" style={styles.title}>Inventory</Text><Text style={styles.subtitle}>Track company supplies and equipment counts.</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Add inventory item" onPress={() => router.push('/inventory/form' as never)} style={({ pressed }) => [styles.add, pressed && styles.pressed]}><AppSymbol name={{ ios: 'plus', android: 'add' } as never} color="#FFFFFF" size={18} /><Text style={styles.addText}>Add</Text></Pressable>
      </View>
      <View accessibilityLabel={`${items.length} inventory items, ${total} total units`} style={styles.summary}><Summary value={items.length.toLocaleString()} label={items.length === 1 ? 'item' : 'items'} styles={styles} /><View style={styles.summaryRule} /><Summary value={total.toLocaleString()} label="total units" styles={styles} /></View>
      <View style={styles.search}><AppSymbol name={{ ios: 'magnifyingglass', android: 'search' } as never} color={theme.secondary} size={18} /><TextInput accessibilityLabel="Search inventory" autoCapitalize="none" onChangeText={setQuery} placeholder="Search items" placeholderTextColor={theme.secondary} returnKeyType="search" style={styles.searchInput} value={query} />{query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear inventory search" onPress={() => setQuery('')}><AppSymbol name={{ ios: 'xmark.circle.fill', android: 'cancel' } as never} color={theme.secondary} size={18} /></Pressable> : null}</View>
      {error ? <View style={styles.error}><Text style={styles.errorTitle}>Inventory unavailable</Text><Text style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" onPress={refreshInventory} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
      {actionError ? <Text accessibilityRole="alert" style={styles.actionError}>{actionError}</Text> : null}
      {loading ? <Text style={styles.state}>Loading inventory…</Text> : null}
      {!loading && !error ? <View style={styles.list}>{filtered.map((item) => <InventoryRow key={`${item.id}:${item.quantity}`} item={item} busy={busyId === item.id} onQuantity={(quantity) => updateQuantity(item, quantity)} onRename={() => router.push({ pathname: '/inventory/form', params: { id: item.id } } as never)} onDelete={() => confirmDelete(item)} styles={styles} theme={theme} />)}{!filtered.length ? <View style={styles.empty}><View style={styles.emptyIcon}><AppSymbol name={{ ios: 'shippingbox', android: 'inventory_2' } as never} color={theme.secondary} size={27} /></View><Text style={styles.emptyTitle}>{items.length ? 'No items found' : 'No inventory items'}</Text><Text style={styles.emptyText}>{items.length ? 'Try another search.' : 'Add first item to begin tracking company stock.'}</Text>{items.length ? <Pressable accessibilityRole="button" onPress={() => setQuery('')} style={styles.clear}><Text style={styles.clearText}>Clear search</Text></Pressable> : null}</View> : null}</View> : null}
    </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function Summary({ value, label, styles }: { value: string; label: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.summaryItem}><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>;
}

function InventoryRow({ item, busy, onQuantity, onRename, onDelete, styles, theme }: { item: InventoryItem; busy: boolean; onQuantity: (quantity: number) => Promise<void>; onRename: () => void; onDelete: () => void; styles: ReturnType<typeof createStyles>; theme: FireOpsTheme }) {
  const [draft, setDraft] = useState(String(item.quantity));
  const commit = () => {
    const quantity = Number(draft);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999999) setDraft(String(item.quantity));
    else void onQuantity(quantity);
  };
  return <View style={styles.row}>
    <View style={styles.rowTop}><View style={styles.packageIcon}><AppSymbol name={{ ios: 'shippingbox', android: 'inventory_2' } as never} color={theme.commandForeground} size={20} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.updated}>Updated {new Date(item.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Rename ${item.name}`} disabled={busy} onPress={onRename} hitSlop={8} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><AppSymbol name={{ ios: 'pencil', android: 'edit' } as never} color={theme.secondary} size={18} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`} disabled={busy} onPress={onDelete} hitSlop={8} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><AppSymbol name={{ ios: 'trash', android: 'delete' } as never} color={theme.danger} size={18} /></Pressable></View>
    <View accessibilityLabel={`${item.name} quantity`} style={styles.quantity}><Pressable accessibilityRole="button" accessibilityLabel={`Remove one ${item.name}`} disabled={busy || item.quantity === 0} onPress={() => void onQuantity(item.quantity - 1)} style={({ pressed }) => [styles.quantityButton, (busy || item.quantity === 0) && styles.disabled, pressed && styles.pressed]}><AppSymbol name={{ ios: 'minus', android: 'remove' } as never} color={theme.ink} size={17} /></Pressable><TextInput accessibilityLabel={`${item.name} quantity`} editable={!busy} keyboardType="number-pad" maxLength={6} onBlur={commit} onChangeText={setDraft} onSubmitEditing={commit} selectTextOnFocus style={styles.quantityInput} value={draft} /><Pressable accessibilityRole="button" accessibilityLabel={`Add one ${item.name}`} disabled={busy || item.quantity === 999999} onPress={() => void onQuantity(item.quantity + 1)} style={({ pressed }) => [styles.quantityButton, (busy || item.quantity === 999999) && styles.disabled, pressed && styles.pressed]}><AppSymbol name={{ ios: 'plus', android: 'add' } as never} color={theme.ink} size={17} /></Pressable></View>
  </View>;
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    safe: { flex: 1, backgroundColor: theme.canvas }, content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 48, gap: 20 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 14 }, headingCopy: { flex: 1, gap: 6 }, title: { color: theme.ink, fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7 }, subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 21 }, add: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 11, backgroundColor: theme.ember, paddingHorizontal: 14 }, addText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
    summary: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.command, borderRadius: 14, paddingVertical: 17 }, summaryItem: { flex: 1, alignItems: 'center', gap: 2 }, summaryValue: { color: theme.commandText, fontSize: 25, fontWeight: '800', fontVariant: ['tabular-nums'] }, summaryLabel: { color: theme.commandText, opacity: 0.72, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }, summaryRule: { width: StyleSheet.hairlineWidth, height: 35, backgroundColor: theme.commandText, opacity: 0.25 },
    search: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, paddingHorizontal: 13 }, searchInput: { flex: 1, color: theme.ink, fontSize: 16, paddingVertical: 10 }, list: { overflow: 'hidden', borderWidth: 1, borderColor: theme.divider, borderRadius: 14, backgroundColor: theme.paper }, row: { gap: 14, padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider }, rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, packageIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: theme.surfaceAlt }, rowCopy: { flex: 1, gap: 3 }, rowTitle: { color: theme.ink, fontSize: 16, lineHeight: 21, fontWeight: '700' }, updated: { color: theme.secondary, fontSize: 11, lineHeight: 16 }, iconButton: { width: 34, height: 38, alignItems: 'center', justifyContent: 'center' }, quantity: { height: 44, flexDirection: 'row', alignSelf: 'stretch', overflow: 'hidden', borderWidth: 1, borderColor: theme.divider, borderRadius: 10 }, quantityButton: { width: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surfaceAlt }, quantityInput: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderColor: theme.divider, color: theme.ink, backgroundColor: theme.paper, textAlign: 'center', fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
    error: { backgroundColor: theme.dangerSurface, padding: 15, borderRadius: 12, gap: 6 }, errorTitle: { color: theme.danger, fontSize: 16, fontWeight: '700' }, errorText: { color: theme.danger, fontSize: 13, lineHeight: 19 }, retry: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', borderRadius: 8, backgroundColor: theme.command, paddingHorizontal: 13 }, retryText: { color: theme.commandText, fontSize: 13, fontWeight: '700' }, actionError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 13, fontSize: 13, lineHeight: 19 }, state: { color: theme.secondary, textAlign: 'center', paddingVertical: 32 }, empty: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 42, gap: 8 }, emptyIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 28, backgroundColor: theme.surfaceAlt, marginBottom: 3 }, emptyTitle: { color: theme.ink, fontSize: 18, fontWeight: '700' }, emptyText: { color: theme.secondary, fontSize: 14, lineHeight: 20, textAlign: 'center' }, clear: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12 }, clearText: { color: theme.commandForeground, fontSize: 14, fontWeight: '700' }, pressed: { opacity: 0.65 }, disabled: { opacity: 0.4 },
  });
}
