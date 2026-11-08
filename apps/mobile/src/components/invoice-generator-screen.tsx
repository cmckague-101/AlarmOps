import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { formatCalendarDate, invoiceDueDate, type InvoiceCustomer } from '@fireops/domain';

import { FilterSelect } from '@/components/filter-select';
import { secureSessionStorage } from '@/lib/secure-storage';
import { FireOpsTheme, useFireOpsTheme } from '@/theme';

type LineItem = { id: number; description: string; quantity: string; rate: string };
type Draft = { invoiceDate: string; invoiceNumber: string; billFrom: string; billTo: string; customerId: string; items: LineItem[] };
export type GeneratedInvoice = { pdfUri: string; invoiceNumber: string; invoiceDate: string; amount: number; customerId: string };
const ADD_CUSTOMER = '__add_customer__';

type Props = {
  companyLogoUri?: string | null;
  company: { name: string; phone?: string; location?: string };
  customers: InvoiceCustomer[];
  /** Where this user's unfinished generator draft is kept on the device. */
  draftKey: string;
  onAddCustomer: (name: string) => Promise<InvoiceCustomer>;
  onAddToInvoices: (invoice: GeneratedInvoice) => Promise<void>;
};
const item = (id: number): LineItem => ({ id, description: '', quantity: '1', rate: '0.00' });
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);
const lineTotal = (row: LineItem) => (Number(row.quantity) || 0) * (Number(row.rate) || 0);
function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function dateFromIso(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return year ? new Date(year, month - 1, day) : new Date();
}
const emptyDraft = (company: Props['company']): Draft => ({
  invoiceDate: isoDate(new Date()),
  invoiceNumber: '',
  billFrom: [company.name, company.location, company.phone].filter(Boolean).join('\n'),
  billTo: '',
  customerId: '',
  items: [item(1)],
});

export function InvoiceGeneratorScreen({ companyLogoUri, company, customers, draftKey, onAddCustomer, onAddToInvoices }: Props) {
  const theme = useFireOpsTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(company));
  const [restored, setRestored] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const lastPdf = useRef<{ uri: string; signature: string } | null>(null);
  const logo = companyLogoUri ?? '';
  const total = useMemo(() => draft.items.reduce((sum, row) => sum + lineTotal(row), 0), [draft.items]);
  const signature = JSON.stringify(draft);

  // Keep the unfinished invoice on this device so leaving the screen does not lose it.
  useEffect(() => {
    let active = true;
    void secureSessionStorage.getItem(draftKey).then((saved) => {
      if (!active) return;
      if (saved) try { setDraft({ ...emptyDraft(company), ...JSON.parse(saved) as Draft }); } catch { /* ignore a damaged draft */ }
      setRestored(true);
    }).catch(() => { if (active) setRestored(true); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once per draft key
  }, [draftKey]);
  useEffect(() => {
    if (!restored) return;
    const timer = setTimeout(() => void secureSessionStorage.setItem(draftKey, signature).catch(() => {}), 500);
    return () => clearTimeout(timer);
  }, [draftKey, restored, signature]);

  const patch = (values: Partial<Draft>) => setDraft((current) => ({ ...current, ...values }));
  const update = (id: number, key: 'description' | 'quantity' | 'rate', value: string) => patch({ items: draft.items.map((row) => row.id === id ? { ...row, [key]: value } : row) });
  const chooseCustomer = (customerId: string) => {
    if (customerId === ADD_CUSTOMER) {
      setAddingCustomer(true);
      setCustomerName('');
      return;
    }
    setAddingCustomer(false);
    const name = customers.find((customer) => customer.id === customerId)?.name ?? '';
    const [, ...rest] = draft.billTo.split('\n');
    patch({ customerId, billTo: name ? [name, ...rest].join('\n') : draft.billTo });
  };
  const saveCustomer = async () => {
    const name = customerName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const created = await onAddCustomer(name);
      const [, ...rest] = draft.billTo.split('\n');
      patch({ customerId: created.id, billTo: [created.name, ...rest].join('\n') });
      setAddingCustomer(false);
      setCustomerName('');
    } catch (error) {
      Alert.alert('Could not add customer', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };
  const startOver = () => Alert.alert('Start a new invoice?', 'This clears the invoice in the generator.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Start over', style: 'destructive', onPress: () => { lastPdf.current = null; setDraft(emptyDraft(company)); } }]);

  const createPdf = async () => {
    if (lastPdf.current?.signature === signature) return lastPdf.current.uri;
    const due = invoiceDueDate({ invoiceDate: draft.invoiceDate });
    const rows = draft.items.map((row) => `<tr><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.quantity)}</td><td>${money(Number(row.rate) || 0)}</td><td>${money(lineTotal(row))}</td></tr>`).join('');
    const html = `<!doctype html><html><head><style>body{font:14px Arial;color:#18212f;padding:35px}.head{display:flex;justify-content:space-between;margin-bottom:40px}.logo{max-width:160px;max-height:80px}h1{color:#b42318;margin:0}.right{text-align:right}.parties{display:flex;gap:50px;margin-bottom:30px}.party{width:50%;white-space:pre-wrap}.label{font-size:11px;font-weight:bold;color:#667085;text-transform:uppercase;margin-bottom:8px}table{width:100%;border-collapse:collapse}th{background:#f2f4f7}th,td{padding:11px;border-bottom:1px solid #ddd;text-align:left}th:not(:first-child),td:not(:first-child){text-align:right}.total{text-align:right;font-size:20px;font-weight:bold;margin-top:22px}</style></head><body><div class="head"><div>${logo ? `<img class="logo" src="${escapeHtml(logo)}">` : ''}</div><div class="right"><h1>INVOICE</h1><div># ${escapeHtml(draft.invoiceNumber)}</div><div>${escapeHtml(formatCalendarDate(draft.invoiceDate, draft.invoiceDate))}</div>${due ? `<div>Due ${escapeHtml(formatCalendarDate(due))}</div>` : ''}</div></div><div class="parties"><div class="party"><div class="label">Bill from</div>${escapeHtml(draft.billFrom)}</div><div class="party"><div class="label">Bill to</div>${escapeHtml(draft.billTo)}</div></div><table><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>${rows}</table><div class="total">Total: ${money(total)}</div></body></html>`;
    const { uri } = await Print.printToFileAsync({ html });
    lastPdf.current = { uri, signature };
    return uri;
  };
  const generatePdf = async () => {
    try {
      const uri = await createPdf();
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Invoice ${draft.invoiceNumber || ''}`.trim(), UTI: 'com.adobe.pdf' });
      else Alert.alert('Invoice created', `PDF saved to ${uri}`);
    } catch {
      Alert.alert('Could not create invoice', 'Please check invoice details and try again.');
    }
  };
  const addToInvoices = async () => {
    if (!draft.invoiceNumber.trim() || !draft.invoiceDate || total <= 0 || !draft.customerId) {
      Alert.alert('Missing details', 'Add an invoice number, date, customer and at least one priced line item first.');
      return;
    }
    setBusy(true);
    try {
      const pdfUri = await createPdf();
      await onAddToInvoices({ pdfUri, invoiceNumber: draft.invoiceNumber.trim(), invoiceDate: draft.invoiceDate, amount: Math.round(total * 100) / 100, customerId: draft.customerId });
      lastPdf.current = null;
      setDraft(emptyDraft(company));
    } catch (error) {
      Alert.alert('Could not add invoice', error instanceof Error ? error.message : 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
    <View style={styles.heading}><View style={styles.flex}><Text style={styles.title}>Invoice Generator</Text><Text style={styles.subtitle}>Create an invoice PDF, then add it to Invoices. Your work is kept on this device until you finish.</Text></View><Pressable accessibilityRole="button" onPress={startOver} style={styles.secondaryButton}><Text style={styles.secondaryText}>Start over</Text></Pressable></View>
    <View style={styles.card}>
      <Text style={styles.label}>Invoice date</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Invoice date, ${formatCalendarDate(draft.invoiceDate)}`} onPress={() => setDateOpen((open) => !open)} style={styles.input}><Text style={styles.inputText}>{formatCalendarDate(draft.invoiceDate, 'Select date')}</Text></Pressable>
      {dateOpen ? <><DateTimePicker value={dateFromIso(draft.invoiceDate)} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={(event, date) => { if (Platform.OS !== 'ios') setDateOpen(false); if (event.type === 'set' && date) patch({ invoiceDate: isoDate(date) }); }} />{Platform.OS === 'ios' ? <Pressable accessibilityRole="button" onPress={() => setDateOpen(false)} style={styles.done}><Text style={styles.doneText}>Done</Text></Pressable> : null}</> : null}
      <Text style={styles.label}>Invoice number</Text><TextInput style={styles.input} value={draft.invoiceNumber} onChangeText={(invoiceNumber) => patch({ invoiceNumber })} placeholder="INV-001" placeholderTextColor={theme.secondary} />
      <Text style={styles.label}>Bill from</Text><TextInput style={[styles.input, styles.multiline]} multiline value={draft.billFrom} onChangeText={(billFrom) => patch({ billFrom })} placeholder={'Company name\nAddress\nEmail'} placeholderTextColor={theme.secondary} />
      <Text style={styles.label}>Customer</Text>
      <FilterSelect accessibilityLabel="Customer" placeholder={customers.length ? 'Select customer' : 'Add a customer'} value={addingCustomer ? ADD_CUSTOMER : draft.customerId} onChange={chooseCustomer} options={[...customers.map((customer) => ({ value: customer.id, label: customer.name })), { value: ADD_CUSTOMER, label: 'Add customer…' }]} />
      {addingCustomer ? <View style={styles.addCustomerRow}><TextInput autoFocus value={customerName} onChangeText={setCustomerName} maxLength={160} placeholder="Customer name" placeholderTextColor={theme.secondary} style={[styles.input, styles.addCustomerInput]} /><Pressable disabled={!customerName.trim() || busy} onPress={() => void saveCustomer()} style={[styles.addCustomerButton, (!customerName.trim() || busy) && styles.disabled]}><Text style={styles.addCustomerButtonText}>Add</Text></Pressable><Pressable onPress={() => { setAddingCustomer(false); setCustomerName(''); }} style={styles.cancelAdd}><Text style={styles.cancelAddText}>Cancel</Text></Pressable></View> : null}
      <Text style={styles.label}>Bill to</Text><TextInput style={[styles.input, styles.multiline]} multiline value={draft.billTo} onChangeText={(billTo) => patch({ billTo })} placeholder={'Customer name\nAddress\nEmail'} placeholderTextColor={theme.secondary} />
      <Text style={styles.label}>Company logo</Text>{logo ? <Image source={{ uri: logo }} style={styles.logo} resizeMode="contain" /> : <Text style={styles.help}>Add company logo in Settings to include it on invoices.</Text>}
      <View style={styles.lineHeader}><Text style={styles.sectionTitle}>Line items</Text><Pressable style={styles.secondaryButton} onPress={() => patch({ items: [...draft.items, item(Date.now())] })}><Text style={styles.secondaryText}>+ Add item</Text></Pressable></View>
      {draft.items.map((row) => <View key={row.id} style={styles.lineItem}>
        <TextInput accessibilityLabel="Item description" style={styles.input} value={row.description} onChangeText={(value) => update(row.id, 'description', value)} placeholder="Description" placeholderTextColor={theme.secondary} />
        <View style={styles.numberRow}>
          <View style={styles.number}><Text style={styles.smallLabel}>Qty</Text><TextInput accessibilityLabel="Quantity" style={styles.input} value={row.quantity} onChangeText={(value) => update(row.id, 'quantity', value)} keyboardType="decimal-pad" placeholderTextColor={theme.secondary} /></View>
          <View style={styles.number}><Text style={styles.smallLabel}>Rate</Text><TextInput accessibilityLabel="Rate" style={styles.input} value={row.rate} onChangeText={(value) => update(row.id, 'rate', value)} keyboardType="decimal-pad" placeholderTextColor={theme.secondary} /></View>
          <View style={styles.amount}><Text style={styles.smallLabel}>Amount</Text><Text style={styles.amountText}>{money(lineTotal(row))}</Text></View>
        </View>
        {draft.items.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel="Remove line item" onPress={() => patch({ items: draft.items.filter(({ id }) => id !== row.id) })} style={styles.removeButton}><Text style={styles.remove}>Remove</Text></Pressable> : null}
      </View>)}
      <Text style={styles.total}>Total: {money(total)}</Text>
      <Pressable style={styles.secondaryWide} onPress={() => void generatePdf()}><Text style={styles.secondaryText}>Preview & share PDF</Text></Pressable>
      <Pressable disabled={busy} style={[styles.primaryButton, busy && styles.disabled]} onPress={() => void addToInvoices()}><Text style={styles.primaryText}>{busy ? 'Adding…' : 'Add to Invoices'}</Text></Pressable>
      <Text style={styles.help}>Creates your invoice in progress with this PDF attached, ready to review and submit.</Text>
    </View>
  </ScrollView>;
}

function createStyles(theme: FireOpsTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.canvas }, content: { padding: 20, paddingBottom: 48 }, flex: { flex: 1 },
    heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 20 }, title: { color: theme.ink, fontSize: 28, fontWeight: '800' }, subtitle: { color: theme.secondary, marginTop: 5, lineHeight: 20 },
    card: { backgroundColor: theme.paper, borderColor: theme.divider, borderWidth: 1, borderRadius: 14, padding: 18 },
    label: { color: theme.ink, fontWeight: '700', fontSize: 13, marginBottom: 6, marginTop: 14 }, smallLabel: { color: theme.secondary, fontWeight: '700', fontSize: 11, marginBottom: 4 },
    input: { minHeight: 44, justifyContent: 'center', borderColor: theme.divider, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: theme.ink, backgroundColor: theme.paper }, inputText: { color: theme.ink, fontSize: 15 },
    multiline: { minHeight: 90, textAlignVertical: 'top' }, done: { minHeight: 40, alignItems: 'center', justifyContent: 'center' }, doneText: { color: theme.ember, fontSize: 15, fontWeight: '700' },
    logo: { width: 96, height: 64, borderWidth: 1, borderColor: theme.divider, borderRadius: 8 }, help: { color: theme.secondary, fontSize: 13, lineHeight: 18, marginTop: 8 },
    secondaryButton: { borderColor: theme.divider, borderWidth: 1, borderRadius: 8, backgroundColor: theme.paper, paddingHorizontal: 12, paddingVertical: 9 }, secondaryText: { color: theme.commandForeground, fontWeight: '700' },
    secondaryWide: { borderColor: theme.divider, borderWidth: 1, borderRadius: 9, padding: 13, alignItems: 'center', marginBottom: 10 },
    lineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 10 }, sectionTitle: { color: theme.ink, fontSize: 16, fontWeight: '800' },
    lineItem: { gap: 8, marginBottom: 14, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
    numberRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' }, number: { flex: 1 }, amount: { flex: 1, alignItems: 'flex-end', paddingBottom: 12 }, amountText: { color: theme.ink, fontSize: 15, fontWeight: '800' },
    removeButton: { alignSelf: 'flex-end', paddingVertical: 4 }, remove: { color: theme.danger, fontWeight: '700' },
    total: { textAlign: 'right', color: theme.ink, fontSize: 20, fontWeight: '800', marginVertical: 20 },
    primaryButton: { backgroundColor: theme.ember, borderRadius: 9, padding: 14, alignItems: 'center' }, primaryText: { color: '#fff', fontWeight: '800', fontSize: 16 }, disabled: { opacity: 0.45 },
    addCustomerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 },
    addCustomerInput: { flex: 1, minWidth: 140 },
    addCustomerButton: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: theme.ember },
    addCustomerButtonText: { color: '#fff', fontWeight: '800' },
    cancelAdd: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
    cancelAddText: { color: theme.secondary, fontWeight: '700' },
  });
}
