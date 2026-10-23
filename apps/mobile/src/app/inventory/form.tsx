import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createInventoryItem, updateInventoryItem, useInventory } from '@/lib/inventory-store';
import { useIntentId, useOfflineUserSync } from '@/lib/use-offline-user-sync';
import { useInventoryEdits } from '@/lib/use-offline-edits';
import { useSession } from '@/providers/session-provider';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

export default function InventoryFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { session, access } = useSession();
  const member = access.value?.kind === 'member' ? access.value : null;
  // Offline, new items and renames are saved on this device; a rename applies only to an unchanged item.
  const { offline, userSync } = useOfflineUserSync(member?.company.id, member?.user.id);
  const intent = useIntentId();
  const inventory = useInventory(member?.user.role === 'owner' || member?.user.role === 'admin' ? member.company.id : null);
  const { loading } = inventory;
  const edits = useInventoryEdits(inventory.items, member, inventory.downloaded?.receiptWatermark);
  const items = edits.items;
  const item = id ? items.find((entry) => entry.id === id) : undefined;
  const [name, setName] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ name?: string; quantity?: string }>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const nameValue = name ?? item?.name ?? '';
  const quantityValue = quantity ?? (item ? String(item.quantity) : '0');

  if (!session || access.status === 'error') return <Redirect href="/" />;
  if (member && member.user.role !== 'owner' && member.user.role !== 'admin') return <Redirect href="/(tabs)/more" />;

  const submit = async () => {
    const nextErrors: { name?: string; quantity?: string } = {};
    const cleanName = nameValue.trim();
    const count = Number(quantityValue);
    if (!cleanName) nextErrors.name = 'Item name is required.';
    else if (cleanName.length > 160) nextErrors.name = 'Item name must be 160 characters or fewer.';
    if (!item && (!Number.isInteger(count) || count < 0 || count > 999999)) nextErrors.quantity = 'Quantity must be a whole number from 0 to 999,999.';
    setErrors(nextErrors);
    setSaveError('');
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    try {
      if (offline && Platform.OS !== 'web') {
        if (!userSync) throw new Error('Saving items offline is unavailable on this device.');
        if (item) {
          await userSync.updateInventoryItem(item.id, { name: cleanName }, edits.baseFor(item.id, { updatedAt: item.updatedAt }));
          router.back();
          return;
        }
        const content = { name: cleanName, quantity: count };
        await userSync.createInventoryItem({ id: intent.for(content), ...content });
        intent.reset();
        router.back();
        return;
      }
      if (item) await updateInventoryItem(item, { name: cleanName });
      else await createInventoryItem(cleanName, count);
      router.back();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : `Item could not be ${item ? 'renamed' : 'added'}.`);
    } finally {
      setSaving(false);
    }
  };

  const missingItem = Boolean(id && !loading && !item);
  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <Stack.Screen options={{ title: item ? 'Rename item' : 'Add item' }} />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled">
        {loading && id ? <Text style={styles.state}>Loading item…</Text> : null}
        {missingItem ? <View style={styles.message}><Text style={styles.messageTitle}>Item not found</Text><Text style={styles.messageText}>It may have been removed or you may no longer have access.</Text></View> : null}
        {!missingItem && (!id || item) ? <>
          <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>{item ? 'Rename inventory item' : 'Add inventory item'}</Text><Text style={styles.subtitle}>{item ? 'Change item name without changing its current quantity.' : 'Enter item name and current quantity.'}</Text></View>
          <View style={styles.field}><Text style={styles.label}>Item name</Text><TextInput accessibilityLabel="Item name" autoFocus maxLength={160} onChangeText={(value) => { setName(value); setErrors((current) => ({ ...current, name: undefined })); setSaveError(''); }} placeholder="Pulaski tools" placeholderTextColor={theme.secondary} style={[styles.input, errors.name && styles.inputError]} value={nameValue} />{errors.name ? <Text accessibilityRole="alert" style={styles.fieldError}>{errors.name}</Text> : null}<Text style={styles.help}>{nameValue.length}/160</Text></View>
          {!item ? <View style={styles.field}><Text style={styles.label}>Starting quantity</Text><TextInput accessibilityLabel="Starting quantity" keyboardType="number-pad" maxLength={6} onChangeText={(value) => { setQuantity(value); setErrors((current) => ({ ...current, quantity: undefined })); setSaveError(''); }} selectTextOnFocus style={[styles.input, errors.quantity && styles.inputError]} value={quantityValue} />{errors.quantity ? <Text accessibilityRole="alert" style={styles.fieldError}>{errors.quantity}</Text> : null}</View> : <View style={styles.current}><Text style={styles.currentLabel}>Current quantity</Text><Text style={styles.currentValue}>{item.quantity.toLocaleString()}</Text><Text style={styles.currentHelp}>Adjust count from inventory list.</Text></View>}
          {saveError ? <Text accessibilityRole="alert" style={styles.saveError}>{saveError}</Text> : null}
          <Pressable accessibilityRole="button" disabled={saving} onPress={() => void submit()} style={({ pressed }) => [styles.submit, saving && styles.disabled, pressed && styles.pressed]}><Text style={styles.submitText}>{saving ? 'Saving…' : item ? 'Save name' : 'Add item'}</Text></Pressable>
        </> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    flex: { flex: 1 }, safe: { flex: 1, backgroundColor: theme.canvas }, content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48, gap: 24 }, heading: { gap: 7 }, title: { color: theme.ink, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6 }, subtitle: { color: theme.secondary, fontSize: 15, lineHeight: 22 }, field: { gap: 8 }, label: { color: theme.ink, fontSize: 15, lineHeight: 20, fontWeight: '700' }, input: { minHeight: 50, borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, color: theme.ink, paddingHorizontal: 14, fontSize: 16 }, inputError: { borderColor: theme.danger }, fieldError: { color: theme.danger, fontSize: 13, lineHeight: 18 }, help: { color: theme.secondary, fontSize: 12, textAlign: 'right' }, current: { borderWidth: 1, borderColor: theme.divider, borderRadius: 12, backgroundColor: theme.paper, padding: 16, gap: 3 }, currentLabel: { color: theme.secondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }, currentValue: { color: theme.ink, fontSize: 25, fontWeight: '800', fontVariant: ['tabular-nums'] }, currentHelp: { color: theme.secondary, fontSize: 12 }, saveError: { color: theme.danger, backgroundColor: theme.dangerSurface, borderRadius: 10, padding: 13, fontSize: 14, lineHeight: 20 }, submit: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: theme.ember, paddingHorizontal: 18 }, submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' }, state: { color: theme.secondary, fontSize: 15, paddingVertical: 24 }, message: { paddingVertical: 48, gap: 9 }, messageTitle: { color: theme.ink, fontSize: 22, fontWeight: '700' }, messageText: { color: theme.secondary, fontSize: 15, lineHeight: 22 }, disabled: { opacity: 0.5 }, pressed: { opacity: 0.7 },
  });
}
